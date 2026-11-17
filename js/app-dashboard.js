/* =========================================================
   Diet Planner — app-dashboard.js
   Dashboard UI only

   Depends on:
   js/auth-access.js
   ========================================================= */

(() => {
  "use strict";

  const elements = {
    loading: document.getElementById("loadingScreen"),
    accountName: document.getElementById("doctorName"),
    logout: document.getElementById("logoutBtn"),
    adminCard: document.getElementById("adminCard"),
    featureCards: document.querySelectorAll(
      "a.nav-card:not(#adminCard)"
    )
  };

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  function hideLoading() {
    if (elements.loading) {
      elements.loading.style.display = "none";
    }

    document.documentElement.style.visibility = "visible";
  }

  async function renderAccountName(user, isAdmin = false) {
    if (!user?.id) return;

    // Authentication status, not profile lookup, controls account actions.
    // Show logout for every signed-in user before any database request.
    document.getElementById("accountInfo")?.classList.remove("hidden");
    document.getElementById("loginCta")?.classList.add("hidden");
    document.getElementById("registerCta")?.classList.add("hidden");

    if (elements.logout) {
      elements.logout.classList.remove("hidden");
      elements.logout.disabled = false;
      if (elements.logout.dataset.handlerBound !== "true") {
        elements.logout.addEventListener("click", logoutUser);
        elements.logout.dataset.handlerBound = "true";
      }
    }

    if (!elements.accountName) return;

    // The name is supplementary; a profile read failure must never hide logout.
    const fallbackName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email ||
      "حساب المستخدم";

    elements.accountName.textContent = fallbackName;
    elements.accountName.classList.remove("hidden");

    try {
      const supabase = window.DietPlannerAccess?.supabaseClient;
      if (!supabase) {
        console.error("Supabase client is unavailable.");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Profile name lookup failed:", error);
        return;
      }

      elements.accountName.textContent =
        profile?.full_name?.trim() || fallbackName;
    } catch (error) {
      console.error("Profile name lookup failed:", error);
    }
  }

  function renderAdminCard(isAdmin) {
    if (!elements.adminCard) return;

    // يظهر فقط عندما تكون القيمة true صراحةً.
    elements.adminCard.classList.toggle(
      "hidden",
      isAdmin !== true
    );
  }

  // ---------------------------------------------------------
  // Locked cards
  // ---------------------------------------------------------
  function addLockStyles() {
    if (document.getElementById("dp-feature-lock-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "dp-feature-lock-style";

    style.textContent = `
      .dp-feature-locked {
        position: relative;
        cursor: pointer !important;
        opacity: .88;
      }

      .dp-feature-locked:hover {
        transform: none !important;
        box-shadow: none !important;
        border-color: rgba(226,232,240,.85) !important;
      }

      .dp-lock-overlay {
        position: absolute;
        inset: 0;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: inherit;
        background: rgba(248,250,252,.68);
        backdrop-filter: blur(2px);
      }

      .dp-lock-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 7px 12px;
        border-radius: 999px;
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(203,213,225,.9);
        color: #64748b;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.5;
        text-align: center;
        white-space: nowrap;
        box-shadow: 0 8px 20px rgba(15,23,42,.08);
      }
    `;

    document.head.appendChild(style);
  }

  function lockCard(card, visitor = false) {
    if (!card) return;

    card.classList.add("dp-feature-locked");
    card.setAttribute(
      "aria-disabled",
      "true"
    );
    card.setAttribute(
      "title",
      visitor ? "سجّل الدخول لاستخدام هذه الخدمة" : "هذه الخدمة غير متاحة في اشتراكك الحالي"
    );


  }

  function bindLockedCard(card) {
    if (card.dataset.lockHandlerBound === "true") {
      return;
    }

    card.dataset.lockHandlerBound = "true";

    card.addEventListener("click", (event) => {
      if (!card.classList.contains("dp-feature-locked")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      showLockedMessage(card.dataset.visitorLocked === "true");
    });
  }

  function showLockedMessage(visitor = false) {
    let message =
      document.getElementById("dpLockedMessage");

    if (!message) {
      message = document.createElement("div");
      message.id = "dpLockedMessage";

      message.style.cssText = `
        position: fixed;
        left: 50%;
        bottom: 24px;
        transform: translateX(-50%);
        z-index: 200;
        max-width: calc(100% - 32px);
        padding: 12px 18px;
        border-radius: 14px;
        background: #17252a;
        color: #fff;
        font-family: Cairo, sans-serif;
        font-size: 13px;
        font-weight: 700;
        text-align: center;
        box-shadow: 0 15px 40px rgba(15,23,42,.18);
      `;

      document.body.appendChild(message);
    }

    message.textContent =
      visitor ? "للوصول إلى أدوات Diet Planner، سجّل الدخول أو أنشئ حسابًا جديدًا." : "هذه الخدمة غير متاحة في اشتراكك الحالي.";

    message.style.display = "block";

    clearTimeout(window.__dpLockedMessageTimer);

    window.__dpLockedMessageTimer =
      setTimeout(() => {
        message.style.display = "none";
      }, 2600);
  }

  async function renderFeatureCards(userId, isAdmin) {
    if (isAdmin || !elements.featureCards.length) {
      return;
    }

    const access = window.DietPlannerAccess;

    if (!access?.hasFeature) {
      console.error(
        "auth-access.js feature API is unavailable."
      );
      return;
    }

    addLockStyles();

    // Check each distinct feature once through the centralized API.
    const featureCache = new Map();

    const featureResults = await Promise.all(
      Array.from(elements.featureCards).map(
        async (card) => {
          const feature = card.dataset.feature;

          if (!feature) {
            return { card, allowed: true };
          }

          if (!featureCache.has(feature)) {
            featureCache.set(
              feature,
              access.hasFeature(userId, feature)
                .then(value => value === true)
            );
          }

          const allowed = await featureCache.get(feature);

          return { card, allowed };
        }
      )
    );

    featureResults.forEach(
      ({ card, allowed }) => {
        bindLockedCard(card);

        if (!allowed) {
          lockCard(card);
        }
      }
    );
  }

  // ---------------------------------------------------------
  // Notification card indicators
  // Keep this calculation aligned with js/notifications.js.
  // Data is fetched for the signed-in user and remains protected by RLS.
  // ---------------------------------------------------------
  function notificationDateKey(value) {
    const key = String(value ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  }

  function notificationTodayKey() {
    const now = new Date();
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  }

  function notificationAddMonths(baseDate, months) {
    const key = notificationDateKey(baseDate);
    if (!key || !Number.isInteger(Number(months))) return "";
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setMonth(date.getMonth() + Number(months));
    if (date.getDate() !== day) date.setDate(0);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function notificationDaysUntil(targetDate, referenceDate) {
    const target = notificationDateKey(targetDate);
    const reference = notificationDateKey(referenceDate);
    if (!target || !reference) return null;
    const [ty, tm, td] = target.split("-").map(Number);
    const [ry, rm, rd] = reference.split("-").map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(ry, rm - 1, rd)) / 86400000);
  }

  function renderNotificationIndicators(counts) {
    const host = document.getElementById("notificationCardIndicators");
    if (!host) return;

    const types = [
      { key: "today", icon: "fa-solid fa-calendar-check", label: "متابعات اليوم", color: "today" },
      { key: "tomorrow", icon: "fa-solid fa-calendar-plus", label: "متابعات الغد", color: "tomorrow" },
      { key: "subscriptions", icon: "fa-solid fa-credit-card", label: "تنبيهات الاشتراكات", color: "subscriptions" }
    ];

    host.replaceChildren();
    types.forEach((type) => {
      const count = counts[type.key] || 0;
      const marker = document.createElement("span");
      marker.className = `notification-card-indicator ${type.color}`;
      marker.title = `${type.label}: ${count}`;
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-label", `${type.label}: ${count}`);
      marker.innerHTML = `<i class="${type.icon}" aria-hidden="true"></i><span class="notification-count">${count}</span>`;
      host.appendChild(marker);
    });
    host.classList.toggle("has-notifications", host.childElementCount > 0);
  }

  async function loadNotificationCardIndicators(userId) {
    const host = document.getElementById("notificationCardIndicators");
    if (!host || !userId) return;

    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from("patient_finances")
        .select("subscription_end_date,next_follow_up_date,subscription_start_date,subscription_months")
        .eq("user_id", userId);

      if (error) throw error;

      const counts = { today: 0, tomorrow: 0, subscriptions: 0 };
      const today = notificationTodayKey();

      (data || []).forEach((row) => {
        const followUp = notificationDateKey(row.next_follow_up_date);
        const followUpDays = followUp ? notificationDaysUntil(followUp, today) : null;
        if (followUpDays === 0) counts.today += 1;
        if (followUpDays === 1) counts.tomorrow += 1;

        const subscriptionEnd = notificationDateKey(row.subscription_end_date) ||
          notificationAddMonths(row.subscription_start_date, row.subscription_months);
        const subscriptionDays = subscriptionEnd ? notificationDaysUntil(subscriptionEnd, today) : null;
        if (subscriptionDays !== null && subscriptionDays <= 7) counts.subscriptions += 1;
      });

      renderNotificationIndicators(counts);
    } catch (error) {
      // Indicator failure must not block the dashboard or reveal other users' data.
      console.warn("Notification card indicators could not be loaded:", error);
    }
  }

  // ---------------------------------------------------------
  // Logout
  // ---------------------------------------------------------
  async function logoutUser() {
    if (!elements.logout) return;

    elements.logout.disabled = true;

    try {
      await window.DietPlannerAccess?.logout();
    } catch (error) {
      console.error("Logout failed:", error);
      window.location.replace("index.html");
    }
  }

  // ---------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------
  function renderVisitorDashboard() {
    // Visitor state: never show account placeholder or logout before authentication.
    document.getElementById("loginCta")?.classList.remove("hidden");
    document.getElementById("registerCta")?.classList.remove("hidden");
    // Visitors must never see or use logout; no session exists to end.
    elements.logout?.classList.add("hidden");
    elements.accountName?.classList.add("hidden");
    if (elements.accountName) elements.accountName.textContent = "";
    document.getElementById("accountInfo")?.classList.add("hidden");
    addLockStyles();
    elements.featureCards.forEach(card => {
      const href = (card.getAttribute("href") || "").split("?")[0];
      // Public pages should remain accessible to visitors.
      if (href === "about.html" || href === "feedback.html") {
        card.classList.remove("dp-feature-locked");
        card.removeAttribute("aria-disabled");
        card.removeAttribute("title");
        return;
      }
      card.dataset.visitorLocked = "true";
      bindLockedCard(card);
      lockCard(card, true);
    });
  }

  async function initializeDashboard() {
    hideLoading();

    const access =
      window.DietPlannerAccess;

    if (!access?.getAccessStatus) {
      console.error(
        "auth-access.js must load before app-dashboard.js."
      );
      return;
    }

    try {
      const status =
        await access.getAccessStatus();

      // app.html itself does not redirect.
      // The central auth layer is responsible for auth routing.
      if (!status.authenticated || !status.user) {
        renderAdminCard(false);
        renderVisitorDashboard();
        return;
      }

      await renderAccountName(status.user, status.isAdmin === true);
      renderAdminCard(status.isAdmin);

      await renderFeatureCards(
        status.user.id,
        status.isAdmin
      );

      // Load subtle per-type notification markers after authentication.
      await loadNotificationCardIndicators(status.user.id);
    } catch (error) {
      console.error(
        "Dashboard initialization failed:",
        error
      );

      renderAdminCard(false);
      renderVisitorDashboard();
    }
  }

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  function start() {
    initializeDashboard();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

  window.DietPlannerDashboard = {
    init: initializeDashboard,
    logout: logoutUser
  };
})();
