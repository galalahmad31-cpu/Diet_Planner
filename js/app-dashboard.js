/* =========================================================
   Diet Planner — app-dashboard.js
   Dashboard UI only

   Depends on:
   - js/supabase.js
   - js/auth.js
   - js/access.js
   ========================================================= */

(() => {
  "use strict";

  const supabase = window.DietPlannerSupabase?.client;
  const auth = window.DietPlannerAuth;
  const access = window.DietPlannerAccess;

  const elements = {
    loading: document.getElementById("loadingScreen"),
    accountName: document.getElementById("doctorName"),
    logout: document.getElementById("logoutBtn"),
    adminCard: document.getElementById("adminCard")
  };

  function hideLoading() {
    if (elements.loading) {
      elements.loading.style.display = "none";
    }

    document.documentElement.style.visibility = "visible";
  }

  async function renderAccountName(user) {
    if (!elements.accountName || !user?.id || !supabase) {
      return;
    }

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Profile name lookup failed:", error);
      }

      elements.accountName.textContent =
        profile?.full_name?.trim() ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "حساب المستخدم";
    } catch (error) {
      console.error("Profile name lookup failed:", error);

      elements.accountName.textContent =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        "حساب المستخدم";
    }
  }

  async function renderAdminCard() {
    if (!elements.adminCard || !access?.getPageAccess) {
      return;
    }

    try {
      const permissions = await access.getPageAccess("admin");
      const isAdmin = permissions?.read === true;

      elements.adminCard.classList.toggle("hidden", !isAdmin);
    } catch (error) {
      console.error("Admin UI access lookup failed:", error);
      elements.adminCard.classList.add("hidden");
    }
  }

  async function logoutUser() {
    if (!elements.logout) {
      return;
    }

    elements.logout.disabled = true;

    try {
      await auth?.logoutUser();
    } catch (error) {
      console.error("Logout failed:", error);
      window.location.replace("index.html");
    }
  }

  async function initializeDashboard() {
    hideLoading();

    if (!auth?.getCurrentUser) {
      console.error("auth.js must load before app-dashboard.js.");
      return;
    }

    if (!supabase) {
      console.error("supabase.js must load before app-dashboard.js.");
      return;
    }

    try {
      const user = await auth.getCurrentUser();

      if (!user) {
        window.location.replace("index.html");
        return;
      }

      await Promise.all([
        renderAccountName(user),
        renderAdminCard()
      ]);
    } catch (error) {
      console.error("Dashboard initialization failed:", error);
    }
  }

  function start() {
    elements.logout?.addEventListener("click", logoutUser);
    initializeDashboard();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.DietPlannerDashboard = Object.freeze({
    init: initializeDashboard,
    logout: logoutUser
  });
})();
