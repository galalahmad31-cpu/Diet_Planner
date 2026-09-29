/* =========================================================
   Diet Planner — access.js
   Central Authorization + Page Access

   Responsibilities:
   - Role checks.
   - Subscription checks.
   - Feature checks.
   - Patient quota checks.
   - Page/card access.
   - Post-login routing.

   Authentication itself belongs to auth.js.
   Database RLS remains the final security layer.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;

  if (!auth?.supabaseClient) {
    console.error(
      "auth.js must load before access.js."
    );
    return;
  }

  const supabaseClient = auth.supabaseClient;

  const accessCache = {
    userId: null,
    role: null
  };

  function clearAccessCache() {
    accessCache.userId = null;
    accessCache.role = null;
  }

  function getToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function isIndexPage() {
    const path = window.location.pathname;

    return (
      path.endsWith("/index.html") ||
      path === "/" ||
      path === ""
    );
  }

  async function getUserRole(userId) {
    if (!userId) return null;

    if (
      accessCache.userId === userId &&
      accessCache.role !== null
    ) {
      return accessCache.role;
    }

    const { data, error } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.error("Role check failed:", error);
      return null;
    }

    const role = data?.role || "user";

    accessCache.userId = userId;
    accessCache.role = role;

    return role;
  }

  async function hasActiveSubscription(userId) {
    if (!userId) return null;

    const role = await getUserRole(userId);

    if (role === "admin") return true;

    const { data, error } =
      await supabaseClient.rpc(
        "has_active_subscription",
        { p_user_id: userId }
      );

    if (!error) {
      return data === true;
    }

    console.error(
      "Subscription RPC failed; using read-only fallback:",
      error
    );

    const today = getToday();

    const {
      data: subscription,
      error: fallbackError
    } = await supabaseClient
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .lte("start_date", today)
      .gte("expiry_date", today)
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      console.error(
        "Subscription fallback check failed:",
        fallbackError
      );
      return null;
    }

    return !!subscription;
  }

  async function canAddPatient(userId) {
    if (!userId) return false;

    const { data, error } =
      await supabaseClient.rpc(
        "can_add_patient",
        { p_user_id: userId }
      );

    if (error) {
      console.error(
        "Patient quota check failed:",
        error
      );
      return false;
    }

    return data === true;
  }

  async function canWrite(userId) {
    if (!userId) return false;

    const active =
      await hasActiveSubscription(userId);

    return active === true;
  }

  async function hasFeature(
    userId,
    featureKey
  ) {
    if (!userId || !featureKey) return false;

    const { data, error } =
      await supabaseClient.rpc(
        "has_feature",
        {
          p_user_id: userId,
          p_feature: featureKey
        }
      );

    if (error) {
      console.error(
        `Feature check failed (${featureKey}):`,
        error
      );
      return false;
    }

    return data === true;
  }

  async function getAccessStatus() {
    const user = await auth.getCurrentUser();

    if (!user) {
      return {
        authenticated: false,
        user: null,
        role: null,
        isAdmin: false,
        hasActiveSubscription: false
      };
    }

    const role =
      await getUserRole(user.id);

    const active =
      role === "admin"
        ? true
        : await hasActiveSubscription(user.id);

    return {
      authenticated: true,
      user,
      role,
      isAdmin: role === "admin",
      hasActiveSubscription: active === true
    };
  }

  async function requireAuthentication() {
    const user =
      await auth.getCurrentUser();

    if (!user) {
      if (!isIndexPage()) {
        window.location.replace("index.html");
      }

      return false;
    }

    return true;
  }

  async function handlePostAuth(session) {
    if (!session?.user) return false;

    // Every authenticated user enters the application.
    window.location.replace("app.html");
    return true;
  }

  function addLockStyles() {
    if (
      document.getElementById(
        "dp-access-lock-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id = "dp-access-lock-style";

    style.textContent = `
      .dp-feature-locked {
        position: relative;
        cursor: not-allowed !important;
        opacity: .72;
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

  function lockCard(card) {
    if (!card) return;

    card.classList.add(
      "dp-feature-locked"
    );

    card.setAttribute(
      "aria-disabled",
      "true"
    );

    card.setAttribute(
      "title",
      "هذه الخدمة غير متاحة في اشتراكك الحالي"
    );

    if (
      card.querySelector(
        ".dp-lock-overlay"
      )
    ) {
      return;
    }

    const overlay =
      document.createElement("div");

    overlay.className =
      "dp-lock-overlay";

    overlay.innerHTML = `
      <span class="dp-lock-badge">
        <i class="fa-solid fa-lock"></i>
        <span>غير متاح في خطتك الحالية</span>
      </span>
    `;

    card.appendChild(overlay);
  }

  function bindLockedCard(card) {
    if (
      card.dataset.accessBound === "true"
    ) {
      return;
    }

    card.dataset.accessBound = "true";

    card.addEventListener(
      "click",
      (event) => {
        if (
          !card.classList.contains(
            "dp-feature-locked"
          )
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        showLockedMessage();
      }
    );
  }

  function showLockedMessage() {
    let message =
      document.getElementById(
        "dpLockedMessage"
      );

    if (!message) {
      message =
        document.createElement("div");

      message.id =
        "dpLockedMessage";

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

      document.body.appendChild(
        message
      );
    }

    message.textContent =
      "هذه الخدمة غير متاحة في اشتراكك الحالي.";

    message.style.display = "block";

    clearTimeout(
      window.__dpLockedMessageTimer
    );

    window.__dpLockedMessageTimer =
      setTimeout(() => {
        message.style.display = "none";
      }, 2600);
  }

  async function applyCardAccess() {
    const status =
      await getAccessStatus();

    if (!status.authenticated) {
      return false;
    }

    const cards =
      document.querySelectorAll(
        "a.nav-card[data-feature], a.nav-card[data-admin-only]"
      );

    if (!cards.length) {
      return true;
    }

    addLockStyles();

    const featureCache =
      new Map();

    await Promise.all(
      Array.from(cards).map(
        async (card) => {
          const isAdminOnly =
            card.dataset.adminOnly === "true";

          const feature =
            card.dataset.feature;

          if (
            isAdminOnly &&
            !status.isAdmin
          ) {
            card.classList.add("hidden");
            return;
          }

          if (
            !feature ||
            status.isAdmin
          ) {
            return;
          }

          if (
            !featureCache.has(feature)
          ) {
            featureCache.set(
              feature,
              hasFeature(
                status.user.id,
                feature
              )
            );
          }

          const allowed =
            await featureCache.get(
              feature
            );

          bindLockedCard(card);

          if (!allowed) {
            lockCard(card);
          }
        }
      )
    );

    return true;
  }

  async function requireFeature(
    featureKey
  ) {
    const status =
      await getAccessStatus();

    if (!status.authenticated) {
      window.location.replace("index.html");
      return false;
    }

    if (status.isAdmin) {
      return true;
    }

    return hasFeature(
      status.user.id,
      featureKey
    );
  }

  window.DietPlannerAccess = {
    supabaseClient,
    getCurrentUser:
      auth.getCurrentUser,
    getUserRole,
    hasActiveSubscription,
    canAddPatient,
    canWrite,
    hasFeature,
    getAccessStatus,
    requireAuthentication,
    requireFeature,
    applyCardAccess,
    handlePostAuth,
    clearAccessCache,
    logout: auth.logout
  };

  if (!document.body) {
    return;
  }

  requireAuthentication().then(
    (authenticated) => {
      if (!authenticated) return;

      if (!isIndexPage()) {
        applyCardAccess();
      }
    }
  );
})();
