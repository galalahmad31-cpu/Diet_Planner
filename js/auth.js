/* =========================================================
   Diet Planner — auth.js
   Central Authentication

   Responsibilities:
   - One Supabase client for the whole application.
   - Login / Register / Google / Logout.
   - Session access.
   - Authentication UI on index.html.
   - Post-login routing.

   Authorization and page access belong to access.js / access_pages.js.
   ========================================================= */

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

  function isIndexPage() {
    const path = window.location.pathname;

    return (
      path.endsWith("/index.html") ||
      path === "/" ||
      path === ""
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

  async function getCurrentUser() {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session lookup failed:", error);
      return null;
    }

    return data?.session?.user || null;
  }

  async function getSession() {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      console.error("Session check failed:", error);
      return null;
    }

    return data?.session || null;
  }

  async function handlePostAuth(session) {
    if (!session?.user) return false;

    window.location.replace("app.html");
    return true;
  }

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

    handlePostAuth(data?.session);
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
      handlePostAuth(data.session);
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
              "https://nutrition-3.vercel.app/index.html"
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
      await supabaseClient.auth.signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    } finally {
      window.location.replace("index.html");
    }
  }

  function initializeAuthTabs() {
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

  function initializeOAuthCallback() {
    const isAuthCallback =
      window.location.hash.includes("access_token=") ||
      window.location.hash.includes("refresh_token=") ||
      new URLSearchParams(window.location.search).has("code");

    if (!isAuthCallback) return;

    let handled = false;
    let authStateSubscription = null;

    const handleCallbackSession = async (session) => {
      if (handled || !session?.user) return;

      handled = true;

      try {
        await handlePostAuth(session);
      } finally {
        authStateSubscription?.unsubscribe?.();
      }
    };

    const { data: authStateData } =
      supabaseClient.auth.onAuthStateChange(
        (event, session) => {
          if (
            event === "SIGNED_IN" ||
            event === "INITIAL_SESSION" ||
            event === "TOKEN_REFRESHED"
          ) {
            handleCallbackSession(session);
          }
        }
      );

    authStateSubscription =
      authStateData?.subscription;

    getSession().then((session) => {
      if (session?.user) {
        handleCallbackSession(session);
      }
    });
  }

  function initializeIndex() {
    if (!isIndexPage()) return;

    document
      .getElementById("loginButton")
      ?.addEventListener("click", loginUser);

    document
      .getElementById("registerButton")
      ?.addEventListener("click", registerUser);

    document
      .getElementById("googleLoginButton")
      ?.addEventListener(
        "click",
        loginWithGoogle
      );

    initializeAuthTabs();
    initializeOAuthCallback();
  }

  window.DietPlannerAuth = {
    supabaseClient,
    getCurrentUser,
    getSession,
    logout: logoutUser,
    handlePostAuth
  };

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
