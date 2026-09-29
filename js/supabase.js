/* =========================================================
 * Diet Planner — supabase.js
 * Central Supabase Client
 *
 * Responsibility:
 * - Create and expose the single Supabase client used by the app.
 *
 * Authentication belongs to auth.js.
 * Authorization belongs to access.js / access_pages.js.
 * ========================================================= */

(() => {
  "use strict";

  const SUPABASE_URL =
    "https://zwxnmnfoknfbzvptnpmv.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_A6u5kWAdL60bYpz1wRyv6w_J2p896iY";

  if (!window.supabase) {
    console.error("Supabase JS library is not loaded.");
    return;
  }

  const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );

  window.DietPlannerSupabase = {
    client: supabaseClient
  };
})();
