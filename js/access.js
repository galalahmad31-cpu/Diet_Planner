/* =========================================================
   Diet Planner — access.js
   Backend-Authoritative Access API

   Responsibilities:
   - Call backend RPCs that make authorization decisions.
   - Return authorization results to access_pages.js.
   - Provide a small, stable API for page code.

   Does NOT:
   - Calculate subscription validity.
   - Calculate quotas.
   - Calculate feature access.
   - Decide admin privileges locally.
   - Read subscription tables as a fallback.
   - Contain page-specific rules.

   Authentication belongs to auth.js.
   Supabase client belongs to supabase.js.
   Page rules belong to access_pages.js.
   Backend/RPC + RLS are the security authority.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;
  const supabaseClient = window.DietPlannerSupabase?.client;

  if (!auth?.getCurrentUser || !supabaseClient) {
    console.error(
      "supabase.js and auth.js must load before access.js."
    );
    return;
  }

  function clearAccessCache() {
    // Kept as a no-op for API compatibility.
    // Authorization results are intentionally not cached here.
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

    const { data, error } = await supabaseClient.rpc(
      "get_access_status"
    );

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
      hasActiveSubscription:
        data.has_active_subscription === true
    };
  }

  async function getUserRole() {
    const status = await getAccessStatus();
    return status.role;
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
      console.error(
        `Feature RPC failed (${featureKey}):`,
        error
      );
      return false;
    }

    return data === true;
  }

  window.DietPlannerAccess = {
    getAccessStatus,
    getUserRole,
    hasActiveSubscription,
    canAddPatient,
    hasFeature,
    clearAccessCache
  };
})();
