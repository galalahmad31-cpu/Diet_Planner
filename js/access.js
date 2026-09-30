/* =========================================================
   Diet Planner — access.js
   UI Access API

   Purpose:
   - Fetch page-level UI permissions from the backend.
   - Keep authorization rules out of the frontend.

   Security:
   - This API is for UI/UX only.
   - Backend/RPC and RLS remain the final security boundary.

   Public API:
     DietPlannerAccess.getPageAccess(page)
   ========================================================= */

(() => {
  "use strict";

  const supabaseClient = window.DietPlannerSupabase?.client;

  if (!supabaseClient) {
    console.error("supabase.js must load before access.js.");
    return;
  }

  /**
   * Fetch all UI permissions for a page in one backend request.
   *
   * Example result:
   * {
   *   read: true,
   *   add: true,
   *   update: false,
   *   delete: true
   * }
   *
   * The frontend does not calculate or interpret authorization rules.
   * It only uses the returned values to control the UI.
   */
  async function getPageAccess(page) {
    if (!page) {
      console.error("getPageAccess requires a page identifier.");
      return null;
    }

    const { data, error } = await supabaseClient.rpc("get_page_access", {
      p_page: page
    });

    if (error) {
      console.error(`Page access request failed (${page}):`, error);
      return null;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error(`Invalid page access response (${page}).`);
      return null;
    }

    return data;
  }

  window.DietPlannerAccess = Object.freeze({
    getPageAccess
  });
})();
