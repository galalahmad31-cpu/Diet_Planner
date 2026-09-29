/* =========================================================
   Diet Planner — access.js
   Core Authorization Engine

   Responsibilities:
   - Role checks.
   - Subscription checks.
   - Feature checks.
   - Patient quota checks.
   - Shared access status.

   Page-specific rules belong to access_pages.js.
   Authentication belongs to auth.js.
   Database RLS remains the final security layer.
   ========================================================= */

(() => {
  "use strict";

  const auth = window.DietPlannerAuth;

  if (!auth?.supabaseClient) {
    console.error("auth.js must load before access.js.");
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

    const { data, error } = await supabaseClient.rpc(
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

    const { data, error } = await supabaseClient.rpc(
      "can_add_patient",
      { p_user_id: userId }
    );

    if (error) {
      console.error("Patient quota check failed:", error);
      return false;
    }

    return data === true;
  }

  async function hasFeature(userId, featureKey) {
    if (!userId || !featureKey) return false;

    const { data, error } = await supabaseClient.rpc(
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

    const role = await getUserRole(user.id);
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

  window.DietPlannerAccess = {
    supabaseClient,
    getCurrentUser: auth.getCurrentUser,
    getUserRole,
    hasActiveSubscription,
    canAddPatient,
    hasFeature,
    getAccessStatus,
    clearAccessCache
  };
})();
