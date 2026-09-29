/* =========================================================
   Diet Planner — access.js
   Central Access & Authorization API

   Responsibilities:
   - Call backend RPCs for authorization decisions.
   - Define page/action access rules.
   - Expose one public access API to application pages.

   Does NOT:
   - Calculate subscription validity locally.
   - Calculate quotas locally.
   - Read subscription tables as a fallback.
   - Contain page business logic.
   - Contain UI locking/presentation logic.

   Authentication belongs to auth.js.
   Supabase client belongs to supabase.js.
   Backend/RPC + RLS remain the security authority.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;
  const supabaseClient = window.DietPlannerSupabase?.client;

  if (!auth?.getCurrentUser || !supabaseClient) {
    console.error("supabase.js and auth.js must load before access.js.");
    return;
  }

  /* =========================================================
     Backend Access API
     ========================================================= */

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

    const { data, error } = await supabaseClient.rpc("get_access_status");

    if (error || !data) {
      console.error("Access status RPC failed:", error);
      return {
        authenticated: true,
        user,
        role: null,
        isAdmin: false,
        hasActiveSubscription: false
      };
    }

    return {
      authenticated: data.authenticated === true,
      user,
      role: data.role ?? null,
      isAdmin: data.is_admin === true,
      hasActiveSubscription: data.has_active_subscription === true
    };
  }

  async function hasActiveSubscription() {
    const user = await auth.getCurrentUser();
    if (!user) return false;

    const { data, error } = await supabaseClient.rpc(
      "has_active_subscription",
      { p_user_id: user.id }
    );

    if (error) {
      console.error("Subscription RPC failed:", error);
      return false;
    }

    return data === true;
  }

  async function canAddPatient() {
    const user = await auth.getCurrentUser();
    if (!user) return false;

    const { data, error } = await supabaseClient.rpc(
      "can_add_patient",
      { p_user_id: user.id }
    );

    if (error) {
      console.error("Patient quota RPC failed:", error);
      return false;
    }

    return data === true;
  }

  async function hasFeature(featureKey) {
    if (!featureKey) return false;

    const user = await auth.getCurrentUser();
    if (!user) return false;

    const { data, error } = await supabaseClient.rpc(
      "has_feature",
      {
        p_user_id: user.id,
        p_feature: featureKey
      }
    );

    if (error) {
      console.error(`Feature RPC failed (${featureKey}):`, error);
      return false;
    }

    return data === true;
  }

  /* =========================================================
     Page Authorization
     ========================================================= */

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

    const status = await getAccessStatus();
    if (!status.authenticated) return false;

    if (status.isAdmin || rule === "always") return true;

    switch (rule) {
      case "active_subscription":
        return status.hasActiveSubscription === true;

      case "active_subscription_and_quota":
        return (
          status.hasActiveSubscription === true &&
          await canAddPatient()
        );

      default:
        return false;
    }
  }

  function getRules(pageKey) {
    return PAGE_RULES[pageKey] || null;
  }

  async function requireFeature(featureKey) {
    const status = await getAccessStatus();

    if (!status.authenticated) {
      window.location.replace("index.html");
      return false;
    }

    return status.isAdmin || hasFeature(featureKey);
  }

  /* =========================================================
     Public API
     ========================================================= */

  window.DietPlannerAccess = {
    getAccessStatus,
    hasActiveSubscription,
    canAddPatient,
    hasFeature,
    requireAuthentication,
    can,
    getRules,
    requireFeature
  };

  requireAuthentication();
})();
