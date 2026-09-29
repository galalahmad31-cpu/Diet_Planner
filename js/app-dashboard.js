/* =========================================================
   Diet Planner — app-dashboard.js
   Dashboard UI only

   Depends on:
   js/auth.js
   js/access.js
   ========================================================= */

(() => {
  "use strict";

  const elements = {
    loading:
      document.getElementById("loadingScreen"),

    accountName:
      document.getElementById("doctorName"),

    logout:
      document.getElementById("logoutBtn")
  };

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  function hideLoading() {
    if (elements.loading) {
      elements.loading.style.display = "none";
    }

    document.documentElement.style.visibility =
      "visible";
  }

  async function renderAccountName(user) {
    if (!elements.accountName || !user?.id) {
      return;
    }

    try {
      const supabase =
        window.DietPlannerAccess?.supabaseClient;

      if (!supabase) {
        console.error(
          "Supabase client is unavailable."
        );

        elements.accountName.textContent =
          "حساب المستخدم";

        return;
      }

      const {
        data: profile,
        error
      } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        console.error(
          "Profile name lookup failed:",
          error
        );

        elements.accountName.textContent =
          "حساب المستخدم";

        return;
      }

      elements.accountName.textContent =
        profile?.full_name?.trim() ||
        user?.user_metadata?.full_name ||
        user?.user_metadata?.name ||
        user?.email ||
        "حساب المستخدم";
    } catch (error) {
      console.error(
        "Profile name lookup failed:",
        error
      );

      elements.accountName.textContent =
        "حساب المستخدم";
    }
  }

  // ---------------------------------------------------------
  // Logout
  // ---------------------------------------------------------
  async function logoutUser() {
    if (!elements.logout) {
      return;
    }

    elements.logout.disabled = true;

    try {
      await window.DietPlannerAccess?.logout();
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );

      window.location.replace(
        "index.html"
      );
    }
  }

  // ---------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------
  async function initializeDashboard() {
    hideLoading();

    const access =
      window.DietPlannerAccess;

    if (!access?.getAccessStatus) {
      console.error(
        "access.js must load before app-dashboard.js."
      );

      return;
    }

    try {
      const status =
        await access.getAccessStatus();

      if (
        !status.authenticated ||
        !status.user
      ) {
        return;
      }

      await renderAccountName(
        status.user
      );
    } catch (error) {
      console.error(
        "Dashboard initialization failed:",
        error
      );
    }
  }

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  function start() {
    elements.logout?.addEventListener(
      "click",
      logoutUser
    );

    initializeDashboard();
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

  window.DietPlannerDashboard = {
    init:
      initializeDashboard,

    logout:
      logoutUser
  };
})();
