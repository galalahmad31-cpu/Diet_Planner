/* =========================================================
   Diet Planner — access_pages.js
   Page Access Rules

   Responsibilities:
   - Define read/add/update/delete rules for pages.
   - Apply feature access to dashboard cards.
   - Protect feature-gated pages.
   - Use access.js as the authorization engine.

   Database RLS remains the final security layer.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;
  const access = window.DietPlannerAccess;

  if (!auth || !access) {
    console.error(
      "auth.js and access.js must load before access_pages.js."
    );
    return;
  }

  const PAGE_RULES = {
    patient: {
      read: "always",
      delete: "always",
      add: "active_subscription_and_quota",
      update: "active_subscription_and_quota"
    },

    patientProfileVisits: {
      read: "always",
      delete: "always",
      add: "active_subscription",
      update: "active_subscription"
    },

    visitContent: {
      read: "always",
      delete: "always",
      add: "active_subscription",
      update: "active_subscription"
    }
  };

  async function requireAuthentication() {
    const user = await auth.getCurrentUser();

    if (!user) {
      const path = window.location.pathname;
      const isIndex =
        path.endsWith("/index.html") ||
        path === "/" ||
        path === "";

      if (!isIndex) {
        window.location.replace("index.html");
      }

      return false;
    }

    return true;
  }

  async function can(pageKey, action) {
    const rule = PAGE_RULES?.[pageKey]?.[action];

    if (!rule) return false;

    const status = await access.getAccessStatus();

    if (!status.authenticated) return false;
    if (status.isAdmin) return true;
    if (rule === "always") return true;

    if (rule === "active_subscription") {
      return status.hasActiveSubscription === true;
    }

    if (rule === "active_subscription_and_quota") {
      if (status.hasActiveSubscription !== true) {
        return false;
      }

      return access.canAddPatient(status.user?.id) === true;
    }

    return false;
  }

  function getRules(pageKey) {
    return PAGE_RULES?.[pageKey] || null;
  }

  async function requireFeature(featureKey) {
    const status = await access.getAccessStatus();

    if (!status.authenticated) {
      window.location.replace("index.html");
      return false;
    }

    if (status.isAdmin) return true;

    return access.hasFeature(status.user.id, featureKey);
  }

  function addLockStyles() {
    if (document.getElementById("dp-access-lock-style")) return;

    const style = document.createElement("style");
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

    card.classList.add("dp-feature-locked");
    card.setAttribute("aria-disabled", "true");
    card.setAttribute(
      "title",
      "هذه الخدمة غير متاحة في اشتراكك الحالي"
    );

    if (card.querySelector(".dp-lock-overlay")) return;

    const overlay = document.createElement("div");
    overlay.className = "dp-lock-overlay";
    overlay.innerHTML = `
      <span class="dp-lock-badge">
        <i class="fa-solid fa-lock"></i>
        <span>غير متاح في خطتك الحالية</span>
      </span>
    `;

    card.appendChild(overlay);
  }

  function bindLockedCard(card) {
    if (card.dataset.accessBound === "true") return;

    card.dataset.accessBound = "true";

    card.addEventListener("click", (event) => {
      if (!card.classList.contains("dp-feature-locked")) return;

      event.preventDefault();
      event.stopPropagation();
      showLockedMessage();
    });
  }

  function showLockedMessage() {
    let message = document.getElementById("dpLockedMessage");

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
      "هذه الخدمة غير متاحة في اشتراكك الحالي.";
    message.style.display = "block";

    clearTimeout(window.__dpLockedMessageTimer);

    window.__dpLockedMessageTimer = setTimeout(() => {
      message.style.display = "none";
    }, 2600);
  }

  async function applyCardAccess() {
    const status = await access.getAccessStatus();

    if (!status.authenticated) return false;

    const cards = document.querySelectorAll(
      "a.nav-card[data-feature], a.nav-card[data-admin-only]"
    );

    if (!cards.length) return true;

    addLockStyles();

    const featureCache = new Map();

    await Promise.all(
      Array.from(cards).map(async (card) => {
        const isAdminOnly = card.dataset.adminOnly === "true";
        const feature = card.dataset.feature;

        if (isAdminOnly && !status.isAdmin) {
          card.classList.add("hidden");
          return;
        }

        if (!feature || status.isAdmin) return;

        if (!featureCache.has(feature)) {
          featureCache.set(
            feature,
            access.hasFeature(status.user.id, feature)
          );
        }

        const allowed = await featureCache.get(feature);

        bindLockedCard(card);

        if (!allowed) lockCard(card);
      })
    );

    return true;
  }

  window.DietPlannerPageAccess = {
    can,
    getRules,
    requireAuthentication,
    requireFeature,
    applyCardAccess
  };

  if (!document.body) return;

  requireAuthentication().then((authenticated) => {
    if (!authenticated) return;

    const path = window.location.pathname;
    const isIndex =
      path.endsWith("/index.html") ||
      path === "/" ||
      path === "";

    if (!isIndex) {
      applyCardAccess();
    }
  });
})();
