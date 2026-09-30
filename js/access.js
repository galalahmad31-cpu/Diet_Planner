/* =========================================================
   Diet Planner — access.js
   Central Access API

   The backend RPC is the authorization authority.
   RLS remains the final security boundary.

   This file contains no role, subscription, quota,
   feature, authentication, or page-rule logic.
   ========================================================= */

(() => {
  "use strict";

  const supabaseClient = window.DietPlannerSupabase?.client;

  if (!supabaseClient) {
    console.error("supabase.js must load before access.js.");
    return;
  }

  /**
   * Ask the backend whether an operation is allowed.
   *
   * page  = protected resource/page identifier
   * action = operation being requested
   *
   * The frontend does not know why access is allowed or denied.
   * The backend decides using the authenticated user and all
   * relevant authorization rules.
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

  window.DietPlannerAccess = {
    can
  };
})();
