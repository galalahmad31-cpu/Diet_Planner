/* =========================================================
   Diet Planner — access_pages.js
   Page Access Rules

   Responsibilities:
   - Define page/action access rules.
   - Ask access.js for backend authorization results.
   - Protect feature-gated pages.

   UI locking belongs to access_ui.js.
   Database RLS remains the final security layer.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;
  const access = window.DietPlannerAccess;

  if (!auth?.getCurrentUser || !access) {
    console.error("auth.js and access.js must load before access_pages.js.");
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

    if (user) return true;

    const path = window.location.pathname;
    const isIndex = path.endsWith("/index.html") || path === "/" || path === "";

    if (!isIndex) {
      window.location.replace("index.html");
    }

    return false;
  }

  async function can(pageKey, action) {
    const rule = PAGE_RULES[pageKey]?.[action];
    if (!rule) return false;

    const status = await access.getAccessStatus();
    if (!status.authenticated) return false;

    if (status.isAdmin || rule === "always") return true;

    switch (rule) {
      case "active_subscription":
        return status.hasActiveSubscription === true;

      case "active_subscription_and_quota":
        return (
          status.hasActiveSubscription === true &&
          await access.canAddPatient()
        );

      default:
        return false;
    }
  }

  function getRules(pageKey) {
    return PAGE_RULES[pageKey] || null;
  }

  async function requireFeature(featureKey) {
    const status = await access.getAccessStatus();

    if (!status.authenticated) {
      window.location.replace("index.html");
      return false;
    }

    return status.isAdmin || access.hasFeature(featureKey);
  }

  window.DietPlannerPageAccess = {
    can,
    getRules,
    requireAuthentication,
    requireFeature
  };

  requireAuthentication();
})();
