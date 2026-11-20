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
    const card = elements.adminCard;
    if (!card) return;

    // Fail closed: hide the card unless the verified role is exactly admin.
    const canViewAdminCard = isAdmin === true;

    if (!canViewAdminCard) {
      card.hidden = true;
      card.setAttribute("aria-hidden", "true");
      card.setAttribute("tabindex", "-1");
      card.style.setProperty("display", "none", "important");
      return;
    }

    // Reveal only after getAccessStatus() confirms role === "admin".
    // The card is initially hidden by three independent mechanisms:
    // the hidden attribute, Tailwind's .hidden class, and inline display:none!important.
    // Clear all three so the admin card is visible on phones as well as desktop.
    card.hidden = false;
    card.classList.remove("hidden");
    card.removeAttribute("hidden");
    card.removeAttribute("aria-hidden");
    card.removeAttribute("tabindex");
    card.style.removeProperty("display");
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

  function notificationFormatDate(value) {
    const key = notificationDateKey(value);
    if (!key) return "";
    const [year, month, day] = key.split("-");
    return `${day}/${month}/${year}`;
  }

  function renderDashboardNotifications(items, loadState = "loaded") {
    const host = document.getElementById("dashboardNotificationsContent");
    if (!host) return;
    host.replaceChildren();

    if (loadState === "loading") {
      const loading = document.createElement("div");
      loading.className = "dashboard-notifications-loading";
      loading.textContent = "جارٍ تحميل الإشعارات...";
      host.appendChild(loading);
      host.dataset.loadState = loadState;
      return;
    }

    if (loadState === "error" || loadState === "unavailable") {
      const message = document.createElement("div");
      message.className = "dashboard-notifications-empty";
      message.textContent = loadState === "unavailable"
        ? "سجّل الدخول لعرض إشعارات المرضى ومهام المتابعة."
        : "تعذر تحميل الإشعارات حاليًا.";
      host.appendChild(message);
      host.dataset.loadState = loadState;
      return;
    }

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "dashboard-notifications-empty";
      empty.textContent = "لا توجد إشعارات أو مهام متابعة مستحقة حاليًا.";
      host.appendChild(empty);
      host.dataset.loadState = loadState;
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = `dashboard-notification-row ${item.kind}`;

      const icon = document.createElement("span");
      icon.className = "dashboard-notification-row-icon";
      const iconElement = document.createElement("i");
      iconElement.className = item.icon;
      iconElement.setAttribute("aria-hidden", "true");
      icon.appendChild(iconElement);

      const details = document.createElement("div");
      details.className = "dashboard-notification-row-details";

      const patient = document.createElement("strong");
      patient.className = "dashboard-notification-patient";
      patient.textContent = item.patientName || "المريض";

      const action = document.createElement("span");
      action.className = "dashboard-notification-action";
      action.textContent = item.action;

      const date = document.createElement("time");
      date.className = "dashboard-notification-date";
      date.textContent = notificationFormatDate(item.date);
      date.dateTime = item.date || "";

      details.append(patient, action);
      row.append(icon, details, date);
      host.appendChild(row);
    });

    host.dataset.loadState = loadState;
  }

  async function loadDashboardNotifications(userId) {
    if (!userId) {
      renderDashboardNotifications([], "unavailable");
      return;
    }

    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase) {
      renderDashboardNotifications([], "unavailable");
      return;
    }

    renderDashboardNotifications([], "loading");

    try {
      const { data, error } = await supabase
        .from("patient_finances")
        .select("patient_id,subscription_end_date,next_follow_up_date,subscription_start_date,subscription_months,patients(name)")
        .eq("user_id", userId);

      if (error) throw error;

      const today = notificationTodayKey();
      const notifications = [];

      (data || []).forEach((row) => {
        const patientName = row.patients?.name || "المريض";
        const followUp = notificationDateKey(row.next_follow_up_date);
        const followUpDays = followUp ? notificationDaysUntil(followUp, today) : null;

        if (followUpDays === 0 || followUpDays === 1) {
          notifications.push({
            patientName,
            kind: "follow-up",
            icon: "fa-solid fa-calendar-check",
            action: followUpDays === 0 ? "مطلوب: متابعة المريض اليوم" : "مطلوب: متابعة المريض غدًا",
            date: followUp
          });
        }

        const subscriptionEnd = notificationDateKey(row.subscription_end_date) ||
          notificationAddMonths(row.subscription_start_date, row.subscription_months);
        const subscriptionDays = subscriptionEnd ? notificationDaysUntil(subscriptionEnd, today) : null;

        if (subscriptionDays !== null && subscriptionDays <= 7) {
          let action = "مطلوب: التواصل مع المريض لتجديد الاشتراك";
          if (subscriptionDays === 0) action = "مطلوب: تجديد الاشتراك — ينتهي اليوم";
          else if (subscriptionDays === 1) action = "مطلوب: التواصل للتجديد — ينتهي غدًا";
          else if (subscriptionDays > 1) action = `مطلوب: التواصل للتجديد — متبقي ${subscriptionDays} أيام`;
          else action = "مطلوب: التواصل مع المريض — الاشتراك منتهٍ";

          notifications.push({
            patientName,
            kind: "subscription",
            icon: "fa-solid fa-credit-card",
            action,
            date: subscriptionEnd
          });
        }
      });

      notifications.sort((a, b) => b.date.localeCompare(a.date) || a.patientName.localeCompare(b.patientName, "ar"));
      renderDashboardNotifications(notifications, "loaded");
    } catch (error) {
      renderDashboardNotifications([], "error");
      console.warn("Dashboard notifications could not be loaded:", error);
    }
  }

  // Public announcements feed; RLS limits this query to published items.
  const ANNOUNCEMENT_PRESENTATION = {
    update: { label: "تحديث جديد", icon: "fa-wand-magic-sparkles", className: "update" },
    announcement: { label: "إعلان مهم", icon: "fa-bullhorn", className: "announcement" },
    tip: { label: "نصيحة واستخدام", icon: "fa-lightbulb", className: "tip" },
    alert: { label: "تنبيه", icon: "fa-triangle-exclamation", className: "alert" }
  };

  function announcementFormatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  }

  function openDashboardAnnouncement(item) {
    const dialog = document.getElementById("dashboardAnnouncementDialog");
    if (!dialog) return;
    const type = ANNOUNCEMENT_PRESENTATION[item.type] || ANNOUNCEMENT_PRESENTATION.update;
    const typeNode = document.getElementById("dashboardAnnouncementDialogType");
    const titleNode = document.getElementById("dashboardAnnouncementDialogTitle");
    const contentNode = document.getElementById("dashboardAnnouncementDialogContent");
    const dateNode = document.getElementById("dashboardAnnouncementDialogDate");
    if (typeNode) { typeNode.className = `dashboard-announcement-type ${type.className}`; typeNode.textContent = type.label; }
    if (titleNode) titleNode.textContent = item.title || "";
    if (contentNode) contentNode.textContent = item.content || "";
    if (dateNode) dateNode.textContent = announcementFormatDate(item.created_at);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function bindAnnouncementDialog() {
    const dialog = document.getElementById("dashboardAnnouncementDialog");
    const close = document.getElementById("dashboardAnnouncementDialogClose");
    if (!dialog || dialog.dataset.bound === "true") return;
    dialog.dataset.bound = "true";
    close?.addEventListener("click", () => dialog.close?.());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close?.(); });
  }

  async function loadDashboardAnnouncements() {
    const section = document.getElementById("dashboardAnnouncementsSection");
    const host = document.getElementById("dashboardAnnouncementsList");
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!section || !host || !supabase) return;
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("announcements")
        .select("id,title,content,type,is_pinned,starts_at,expires_at,created_at")
        .eq("is_active", true).lte("starts_at", now)
        .order("is_pinned", { ascending: false }).order("starts_at", { ascending: false }).limit(30);
      if (error) throw error;
      const current = (data || []).filter(item => !item.expires_at || new Date(item.expires_at).getTime() > Date.now()).slice(0, 3);
      host.replaceChildren();
      if (!current.length) { section.hidden = true; return; }
      current.forEach(item => {
        const type = ANNOUNCEMENT_PRESENTATION[item.type] || ANNOUNCEMENT_PRESENTATION.update;
        const card = document.createElement("article");
        card.className = `dashboard-announcement-card ${type.className}`;
        const top = document.createElement("div"); top.className = "dashboard-announcement-card-top";
        const label = document.createElement("span"); label.className = `dashboard-announcement-type ${type.className}`;
        const icon = document.createElement("i"); icon.className = `fa-solid ${type.icon}`; icon.setAttribute("aria-hidden", "true");
        label.append(icon, document.createTextNode(" " + type.label)); top.appendChild(label);
        if (item.is_pinned) { const pin=document.createElement("span");pin.className="dashboard-announcement-pinned";pin.textContent="مثبت";top.appendChild(pin); }
        const title=document.createElement("h4");title.textContent=item.title;
        const content=document.createElement("p");content.textContent=item.content;
        const footer=document.createElement("div");footer.className="dashboard-announcement-card-footer";
        const date=document.createElement("span");date.textContent=announcementFormatDate(item.created_at);
        const more=document.createElement("button");more.type="button";more.className="dashboard-announcement-more";more.textContent="اقرأ التفاصيل";
        more.addEventListener("click",()=>openDashboardAnnouncement(item));
        footer.append(date,more);card.append(top,title,content,footer);host.appendChild(card);
      });
      section.hidden = false;
    } catch (error) {
      section.hidden = true;
      console.warn("Dashboard announcements could not be loaded:", error);
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
  }

  async function initializeDashboard() {
    hideLoading();
    bindAnnouncementDialog();

    const access =
      window.DietPlannerAccess;

    if (!access?.getAccessStatus) {
      console.error(
        "auth-access.js must load before app-dashboard.js."
      );
      renderDashboardNotifications([], "error");
      return;
    }

    try {
      await loadDashboardAnnouncements();
      const status =
        await access.getAccessStatus();

      if (!status.authenticated || !status.user) {
        renderAdminCard(false);
        renderVisitorDashboard();
        renderDashboardNotifications([], "unavailable");
        return;
      }

      await renderAccountName(status.user, status.isAdmin === true);
      renderAdminCard(status.isAdmin);
      // Load the dashboard notification summary after authentication.
      await loadDashboardNotifications(status.user.id);
    } catch (error) {
      console.error("Dashboard access verification failed:", error);
      // The public dashboard remains available even when account verification fails.
      renderAdminCard(false);
      renderVisitorDashboard();
      renderDashboardNotifications([], "unavailable");
    }
  }

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  function start() {
    renderDashboardNotifications([], "loading");
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
