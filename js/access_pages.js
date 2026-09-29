/* =========================================================
   Diet Planner — access_pages.js
   Central Page Permission Rules

   Responsibilities:
   - Define page-level read/add/update/delete permissions.
   - Keep page permission rules separate from access.js.
   - Use access.js as the authorization engine.
   - Admin is exempt from all application-level restrictions.

   Database RLS remains the final security layer.
   ========================================================= */

(() => {
  "use strict";

  const access = window.DietPlannerAccess;

  if (!access) {
    console.error(
      "access.js must load before access_pages.js."
    );
    return;
  }

  const PAGE_RULES = {
    patient: {
      read: "always",
      delete: "always",
      add: "active_subscription",
      update: "active_subscription"
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

  async function can(pageKey, action) {
    const rule = PAGE_RULES?.[pageKey]?.[action];

    if (!rule) return false;

    const status = await access.getAccessStatus();

    if (!status.authenticated) {
      return false;
    }

    if (status.isAdmin) {
      return true;
    }

    if (rule === "always") {
      return true;
    }

    if (rule === "active_subscription") {
      return status.hasActiveSubscription === true;
    }

    return false;
  }

  function getRules(pageKey) {
    return PAGE_RULES?.[pageKey] || null;
  }

  window.DietPlannerPageAccess = {
    can,
    getRules
  };
})();
