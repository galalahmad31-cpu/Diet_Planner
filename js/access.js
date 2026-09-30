/* =========================================================
   Diet Planner — access.js
   Central Access API

   Access decisions are made by the backend RPC.
   RLS remains the final security boundary.

   This file intentionally contains no subscription, quota,
   role, or page-rule calculations.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;
  const supabaseClient = window.DietPlannerSupabase?.client;

  if (!auth?.getCurrentUser || !supabaseClient) {
    console.error("supabase.js and auth.js must load before access.js.");
    return;
  }

  /**
   * Read the current access status for UI/status screens.
   * This is informational; can() is the authorization API.
   */
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

  /**
   * Ask the backend whether a specific page operation is allowed.
   *
   * No authorization rules are duplicated in the frontend.
   * The backend decides using the authenticated user, role,
   * subscription, quota, and feature state as appropriate.
   */
  async function can(page, action) {
    if (!page || !action) return false;

    const { data, error } = await supabaseClient.rpc("can_access", {
      p_page: page,
      p_action: action
    });

    if (error) {
      console.error(`Access check failed (${page}.${action}):`, error);
      return false;
    }

    return data === true;
  }

  /**
   * Feature access uses the same backend authorization API.
   */
  async function hasFeature(featureKey) {
    if (!featureKey) return false;
    return can("feature", featureKey);
  }

  /**
   * Authentication guard retained for existing page entry points.
   * Authentication itself remains owned by auth.js.
   */
  async function requireAuthentication() {
    const user = await auth.getCurrentUser();
    if (user) return true;

    const path = window.location.pathname;
    const isIndex =
      path.endsWith("/index.html") ||
      path === "/" ||
      path === "";

    if (!isIndex) window.location.replace("index.html");
    return false;
  }

  async function requireFeature(featureKey) {
    const allowed = await hasFeature(featureKey);

    if (!allowed) {
      const user = await auth.getCurrentUser();
      if (!user) window.location.replace("index.html");
    }

    return allowed;
  }

  window.DietPlannerAccess = {
    getAccessStatus,
    can,
    hasFeature,
    requireAuthentication,
    requireFeature
  };

  requireAuthentication();
})();
