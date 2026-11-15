/* =========================================================
   Diet Planner — auth-access.js
   Central Authentication + Access Control

   Responsibilities:
   - One Supabase client for the whole application.
   - Login / Register / Google / Logout.
   - Session and role checks.
   - Subscription and feature checks.
   - Shared API for application pages.

   Important:
   - Redirect logic for an existing session runs ONLY on index.html.
   - Other application pages never redirect themselves through this file.
   ========================================================= */

(() => {
  "use strict";


  // ---------------------------------------------------------
  // Supabase
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------
  const accessCache = {
    userId: null,
    role: null
  };

  function clearAccessCache() {
    accessCache.userId = null;
    accessCache.role = null;
  }
  // ---------------------------------------------------------
  function getToday() {
    return new Date().toISOString().slice(0, 10);
  }

  function isIndexPage() {
    const path = window.location.pathname;

    return (
      path.endsWith("/login.html")
    );
  }

  function showAuthMessage(message, type = "error") {
    const box = document.getElementById("authMessage");
    if (!box) return;

    box.textContent = message;
    box.className = "msg " + type;
    box.style.display = "block";
  }

  function setBusy(button, busy, text) {
    if (!button) return;

    button.disabled = busy;
    button.textContent = busy ? "جاري التنفيذ..." : text;
  }

  function isStrongPassword(password) {
    return (
      password.length >= 8 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /\d/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    );
  }

  const STRONG_PASSWORD_MESSAGE =
    "كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل، وحرف كبير، وحرف صغير، ورقم، ورمز.";

  // ---------------------------------------------------------
  // Session / User
  // ---------------------------------------------------------
  async function getCurrentUser() {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session lookup failed:", error);
      return null;
    }

    return data?.session?.user || null;
  }

  // ---------------------------------------------------------
  // Role
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------
  async function hasActiveSubscription(userId) {
    if (!userId) return null;

    // Admin access is determined locally from the already verified profile role.
    // This also prevents a temporary RPC failure from locking the entire UI.
    const role = await getUserRole(userId);
    if (role === "admin") return true;

    const { data, error } = await supabaseClient.rpc(
      "has_active_subscription",
      { p_user_id: userId }
    );

    if (!error) return data === true;

    console.error("Subscription RPC failed; using read-only fallback:", error);

    // UI fallback only. Database RLS remains the final write authorization layer.
    const today = getToday();
    const { data: subscription, error: fallbackError } = await supabaseClient
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .lte("start_date", today)
      .gte("expiry_date", today)
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      console.error("Subscription fallback check failed:", fallbackError);
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

  async function canWrite(userId) {
    if (!userId) return false;

    const active = await hasActiveSubscription(userId);
    return active === true;
  }

  // ---------------------------------------------------------
  // Feature
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // Complete access snapshot
  // One place for page-level access information.
  // ---------------------------------------------------------
  async function getAccessStatus() {
    const user = await getCurrentUser();

    if (!user) {
      return {
        authenticated: false,
        user: null,
        role: null,
        isAdmin: false
      };
    }

    const role = await getUserRole(user.id);

    return {
      authenticated: true,
      user,
      role,
      isAdmin: role === "admin"
    };
  }

  // ---------------------------------------------------------
  // Index page access routing
  // ---------------------------------------------------------
  async function checkUserAccess(session) {
    if (!session?.user) return false;

    const userId = session.user.id;
    const role = await getUserRole(userId);

    if (role === null) {
      showAuthMessage(
        "تعذر التحقق من صلاحية الحساب حاليًا. حاول مرة أخرى."
      );
      return false;
    }

    if (role === "admin") {
      window.location.replace("index.html");
      return true;
    }

    const active = await hasActiveSubscription(userId);

    if (active === null) {
      showAuthMessage(
        "تعذر التحقق من حالة الاشتراك حاليًا. حاول مرة أخرى."
      );
      return false;
    }

    if (active) {
      window.location.replace("index.html");
      return true;
    }

    window.location.replace(
      "subscription_plans_index.html"
    );

    return false;
  }

  async function checkSession() {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session check failed:", error);
      return;
    }

    if (!data?.session?.user) return null;

    return data.session;
  }

  // ---------------------------------------------------------
  // Authentication actions
  // ---------------------------------------------------------
  async function loginUser() {
    const email =
      document.getElementById("loginEmail")?.value.trim();

    const password =
      document.getElementById("loginPassword")?.value;

    const button =
      document.getElementById("loginButton");

    if (!email || !password) {
      showAuthMessage(
        "من فضلك أدخل البريد الإلكتروني وكلمة المرور."
      );
      return;
    }

    setBusy(button, true, "تسجيل الدخول");

    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    setBusy(button, false, "تسجيل الدخول");

    if (error) {
      showAuthMessage(
        error?.code === "invalid_credentials"
          ? "البريد الإلكتروني أو كلمة المرور غير صحيحة."
          : error?.message || "تعذر تسجيل الدخول حاليًا."
      );
      return;
    }

    await checkUserAccess(data?.session);
  }

  async function registerUser() {
    const name =
      document.getElementById("registerName")?.value.trim();

    const email =
      document.getElementById("registerEmail")?.value.trim();

    const password =
      document.getElementById("registerPassword")?.value;

    const button =
      document.getElementById("registerButton");

    if (!name || !email || !password) {
      showAuthMessage("من فضلك أكمل جميع البيانات.");
      return;
    }

    if (!isStrongPassword(password)) {
      showAuthMessage(STRONG_PASSWORD_MESSAGE);
      return;
    }

    setBusy(button, true, "إنشاء الحساب");

    const { data, error } =
      await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name
          }
        }
      });

    setBusy(button, false, "إنشاء الحساب");

    if (error) {
      showAuthMessage(error.message);
      return;
    }

    if (data?.session) {
      await checkUserAccess(data.session);
      return;
    }

    showAuthMessage(
      "تم إنشاء الحساب بنجاح. إذا كان تأكيد البريد الإلكتروني مفعّلًا، افتح رسالة التأكيد ثم سجل الدخول.",
      "success"
    );
  }

  async function loginWithGoogle() {
    const button =
      document.getElementById("googleLoginButton");

    if (button) {
      button.disabled = true;
      button.innerHTML =
        '<i class="fa-brands fa-google"></i><span>جاري فتح Google...</span>';
    }

    try {
      const { error } =
        await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo:
              "https://galalahmad31-cpu.github.io/Diet_Planner/index.html"
          }
        });

      if (error) throw error;
    } catch (error) {
      showAuthMessage(
        error?.message ||
        "تعذر تسجيل الدخول باستخدام Google."
      );

      if (button) {
        button.disabled = false;
        button.innerHTML =
          '<i class="fa-brands fa-google"></i><span>المتابعة باستخدام Google</span>';
      }
    }
  }

  async function logoutUser() {
    try {
      clearAccessCache();
      await supabaseClient.auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      window.location.replace("index.html");
    }
  }

  // ---------------------------------------------------------
  // Index-only event binding
  // ---------------------------------------------------------
  function initializeIndex() {
    if (!isIndexPage()) return;

    /*
     * IMPORTANT:
     * Do not run an asynchronous session redirect on a normal visit to
     * index.html. On Android and some desktop browsers, an immediate
     * navigation can interrupt native input focus and make the keyboard
     * appear/disappear or make the fields feel unresponsive.
     *
     * Normal access routing happens after a successful login. OAuth
     * callbacks are the only case where index must process the existing
     * session automatically.
     */
    document
      .getElementById("loginButton")
      ?.addEventListener("click", loginUser);

    document
      .getElementById("registerButton")
      ?.addEventListener("click", registerUser);

    document
      .getElementById("googleLoginButton")
      ?.addEventListener("click", loginWithGoogle);

    if (window.location.hash === "#register") {
      document.querySelector('[data-auth-tab="registerForm"]')?.click();
    }

    const isAuthCallback =
      window.location.hash.includes("access_token=") ||
      window.location.hash.includes("refresh_token=") ||
      new URLSearchParams(window.location.search).has("code");

    if (isAuthCallback) {
      let handled = false;
      let authStateSubscription = null;

      const handleCallbackSession = async (session) => {
        if (handled || !session?.user) return;
        handled = true;

        try {
          await checkUserAccess(session);
        } finally {
          authStateSubscription?.unsubscribe?.();
        }
      };

      const { data: authStateData } =
        supabaseClient.auth.onAuthStateChange((event, session) => {
          if (
            event === "SIGNED_IN" ||
            event === "INITIAL_SESSION" ||
            event === "TOKEN_REFRESHED"
          ) {
            handleCallbackSession(session);
          }
        });

      authStateSubscription = authStateData?.subscription;

      // Fallback for providers/browsers where the callback event can be
      // delivered before the listener is attached.
      checkSession().then((session) => {
        if (session?.user) handleCallbackSession(session);
      });
    }

    document
      .querySelectorAll("[data-auth-tab]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const target = button.dataset.authTab;

          document
            .querySelectorAll("[data-auth-tab]")
            .forEach((tab) => {
              tab.classList.toggle(
                "active",
                tab === button
              );
            });

          document
            .querySelectorAll(".auth-form")
            .forEach((form) => {
              form.style.display =
                form.id === target
                  ? "block"
                  : "none";
            });

          const box =
            document.getElementById("authMessage");

          if (box) box.style.display = "none";
        });
      });
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------
  window.DietPlannerAccess = {
    supabaseClient,
    getCurrentUser,
    getUserRole,
    hasActiveSubscription,
    canAddPatient,
    canWrite,
    hasFeature,
    getAccessStatus,
    logout: logoutUser
  };

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeIndex,
      { once: true }
    );
  } else {
    initializeIndex();
  }
})();
