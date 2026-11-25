/* =========================================================
   Diet Planner — auth-access.js
   Central Authentication + Access Control

   Responsibilities:
   - One Supabase client for the whole application.
   - Login / Register / Google / Logout.
   - Session and role checks.
   - Authentication, roles, and active-subscription checks.
   - Shared API for application pages.

   Important:
   - Account routing runs after successful authentication on login.html.
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
    role: null,
    accountType: null
  };

  function clearAccessCache() {
    accessCache.userId = null;
    accessCache.role = null;
    accessCache.accountType = null;
  }
  function isLoginPage() {
    const path = window.location.pathname;

    return (
      path.endsWith("/login.html")
    );
  }

  function showAuthMessage(message, type = "error") {
    const box = document.getElementById("authMessage");
    if (!box) return;

    const lines = String(message || "").split("\n");
    const isVerification = lines[0]?.trim() === "التحقق من البريد الإلكتروني";

    box.className = "msg " + type + (isVerification ? " email-verification" : "");
    box.replaceChildren();

    if (isVerification) {
      const content = document.createElement("div");
      content.className = "verification-content";

      const title = document.createElement("div");
      title.className = "verification-title";
      title.textContent = lines[0];

      const body = document.createElement("p");
      body.className = "verification-text";
      body.textContent = lines[1] || "";

      content.append(title, body);

      if (lines[2]) {
        const spamNote = document.createElement("div");
        spamNote.className = "verification-spam-note";

        const spamLabel = document.createElement("strong");
        spamLabel.textContent = "ملحوظة:";

        const spamText = document.createElement("span");
        spamText.textContent = lines[2];

        spamNote.append(spamLabel, spamText);
        content.append(spamNote);
      }
      box.append(content);
    } else {
      box.textContent = message;
    }

    box.style.display = "flex";
    box.setAttribute("role", type === "error" ? "alert" : "status");
    box.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
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

  async function getUserAccountType(userId) {
    if (!userId) return null;
    if (accessCache.userId === userId && accessCache.accountType !== null) {
      return accessCache.accountType;
    }

    const { data, error } = await supabaseClient
      .from("profiles")
      .select("account_type")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data?.account_type) {
      console.error("Account type lookup failed:", error);
      return null;
    }

    accessCache.userId = userId;
    accessCache.accountType = data.account_type;
    return data.account_type;
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
    const accountType = await getUserAccountType(userId);
    if (accountType === "patient" || accountType === "pending") return false;
    if (accountType !== "professional") return null;

    const { data, error } = await supabaseClient.rpc(
      "has_active_subscription",
      { p_user_id: userId }
    );

    if (!error) return data === true;

    // Fail closed: never grant access through a client-side fallback.
    // A transient RPC failure must not be interpreted as an active subscription.
    console.error("Subscription RPC failed; access denied until verification succeeds:", error);
    return null;
  }

  async function canWrite(userId) {
    if (!userId) return false;

    const active = await hasActiveSubscription(userId);
    return active === true;
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
    const accountType = await getUserAccountType(user.id);
    const activeSubscription = role === "admin"
      ? true
      : accountType === "professional"
        ? await hasActiveSubscription(user.id)
        : false;

    return {
      authenticated: true,
      user,
      role,
      accountType,
      isAdmin: role === "admin",
      hasActiveSubscription: activeSubscription === true,
      accessVerificationFailed: role === null || accountType === null || activeSubscription === null
    };
  }

  // ---------------------------------------------------------
  // Post-authentication account routing
  // ---------------------------------------------------------
  async function checkUserAccess(session) {
    if (!session?.user) return false;

    const requestedNext = new URLSearchParams(window.location.search).get("next") || "";
    if (requestedNext === "books.html") {
      window.location.replace("books.html");
      return true;
    }

    const userId = session.user.id;
    const role = await getUserRole(userId);
    if (role === null) {
      showAuthMessage("تعذر التحقق من صلاحية الحساب حاليًا. حاول مرة أخرى.");
      return false;
    }

    if (role === "admin") {
      clearGoogleSignupIntent();
      window.location.replace("app.html");
      return true;
    }


    if (requestedNext === "patient-portal.html" || requestedNext.startsWith("patient-portal.html?invite=")) {
      window.location.replace(requestedNext);
      return true;
    }

    let accountType = await getUserAccountType(userId);
    if (!accountType) {
      showAuthMessage("تعذر التحقق من نوع الحساب حاليًا. حاول مرة أخرى.");
      return false;
    }

    if (accountType !== "pending") {
      // Existing accounts always follow the account type already stored in profiles.
      // A type selected before Google sign-in must never overwrite an existing account.
      clearGoogleSignupIntent();
    }

    if (accountType === "pending") {
      const requestedType = getGoogleSignupIntent();
      if (requestedType) {
        const { error } = await supabaseClient.rpc("complete_account_type_selection", {
          p_account_type: requestedType
        });
        if (error) {
          console.error("Google signup account type could not be saved:", error);
          showAccountTypeSelection();
          return false;
        }
        clearGoogleSignupIntent();
        clearAccessCache();
        accountType = requestedType;
      } else {
        showAccountTypeSelection();
        return false;
      }
    }

    if (accountType === "patient") {
      window.location.replace("patient-portal.html");
      return true;
    }

    if (accountType !== "professional") {
      showAuthMessage("نوع الحساب غير معروف. تواصل مع الدعم.");
      return false;
    }

    const active = await hasActiveSubscription(userId);
    if (active === true) {
      window.location.replace("app.html");
      return true;
    }
    if (active === null) {
      showAuthMessage("تعذر التحقق من الاشتراك حاليًا. لم يتم منح الوصول. حاول مرة أخرى.");
      return false;
    }

    window.location.replace("profile.html");
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
        error?.code === "email_not_confirmed"
          ? "التحقق من البريد الإلكتروني\nيرجى التحقق من بريدك الإلكتروني. إذا لم تجد رسالة التأكيد في صندوق الوارد، فتفقّد قسم الرسائل غير المرغوب فيها (Spam)."
          : error?.code === "invalid_credentials"
            ? "البريد الإلكتروني أو كلمة المرور غير صحيحة."
            : error?.message || "تعذر تسجيل الدخول حاليًا."
      );
      return;
    }

    await checkUserAccess(data?.session);
  }

  let pendingSignupEmail = "";
  let signupBusy = false;

  function showOtpStep(email) {
    const registerForm = document.getElementById("registerForm");
    const fields = document.getElementById("registerFields");
    const otpPanel = document.getElementById("signupOtpPanel");
    const emailLabel = document.getElementById("signupOtpEmail");

    pendingSignupEmail = email;
    if (fields) fields.hidden = true;
    if (otpPanel) otpPanel.hidden = false;
    if (emailLabel) emailLabel.textContent = email;
    if (registerForm) registerForm.dataset.step = "verify";
    document.getElementById("signupOtp")?.focus();
  }

  function showRegistrationStep() {
    const fields = document.getElementById("registerFields");
    const otpPanel = document.getElementById("signupOtpPanel");
    const registerForm = document.getElementById("registerForm");
    if (fields) fields.hidden = false;
    if (otpPanel) otpPanel.hidden = true;
    if (registerForm) delete registerForm.dataset.step;
    pendingSignupEmail = "";
  }

  async function registerUser() {
    if (signupBusy) return;

    const name = document.getElementById("registerName")?.value.trim();
    const email = document.getElementById("registerEmail")?.value.trim().toLowerCase();
    const password = document.getElementById("registerPassword")?.value;
    const accountType = document.querySelector('input[name="registerAccountType"]:checked')?.value;
    const button = document.getElementById("registerButton");

    if (!name || !email || !password || !["professional", "patient"].includes(accountType)) {
      showAuthMessage("من فضلك أكمل جميع البيانات.");
      return;
    }
    if (!isStrongPassword(password)) {
      showAuthMessage(STRONG_PASSWORD_MESSAGE);
      return;
    }

    signupBusy = true;
    setBusy(button, true, "إنشاء الحساب");
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, account_type: accountType } }
      });

      if (error) {
        showAuthMessage(
          error.message || "تعذر إنشاء الحساب حاليًا. حاول مرة أخرى."
        );
        return;
      }

      if (data?.session) {
        await checkUserAccess(data.session);
        return;
      }

      if (data?.user && !data.user.email_confirmed_at) {
        showOtpStep(email);
        showAuthMessage(
          "التحقق من البريد الإلكتروني\nتم إنشاء حسابك بنجاح. أرسلنا رمز التحقق المكوّن من 8 أرقام إلى بريدك الإلكتروني.\nإذا لم تجد الرسالة في صندوق الوارد (Inbox)، يُرجى مراجعة البريد غير المرغوب فيه (Spam أو Junk).",
          "success"
        );
        return;
      }

      showAuthMessage("تعذر بدء التحقق من البريد الإلكتروني. حاول إعادة التسجيل أو تسجيل الدخول.");
    } catch (error) {
      console.error("Signup failed:", error);
      showAuthMessage(error?.message || "حدث خطأ أثناء إنشاء الحساب.");
    } finally {
      signupBusy = false;
      setBusy(button, false, "إنشاء الحساب");
    }
  }

  async function verifySignupOtp() {
    if (signupBusy) return;
    const otp = document.getElementById("signupOtp")?.value.trim();
    const button = document.getElementById("verifySignupOtpButton");

    if (!pendingSignupEmail) {
      showAuthMessage("ابدأ إنشاء الحساب أولًا لإرسال رمز التحقق.");
      showRegistrationStep();
      return;
    }
    if (!/^\d{8}$/.test(otp || "")) {
      showAuthMessage("أدخل رمز التحقق المكوّن من 8 أرقام.");
      return;
    }

    signupBusy = true;
    setBusy(button, true, "جارٍ التحقق...");
    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: pendingSignupEmail,
        token: otp,
        type: "signup"
      });

      if (error) {
        showAuthMessage(
          error.message?.toLowerCase().includes("expired")
            ? "انتهت صلاحية الرمز. اطلب إرسال رمز جديد."
            : "رمز التحقق غير صحيح أو انتهت صلاحيته. راجع الرمز أو اطلب رمزًا جديدًا."
        );
        return;
      }

      if (!data?.session?.user) {
        showAuthMessage("تم التحقق، لكن تعذر إنشاء جلسة الدخول. حاول تسجيل الدخول.");
        return;
      }

      showAuthMessage("تم تأكيد بريدك الإلكتروني بنجاح.", "success");
      await checkUserAccess(data.session);
    } catch (error) {
      console.error("OTP verification failed:", error);
      showAuthMessage("تعذر التحقق من الرمز حاليًا. حاول مرة أخرى.");
    } finally {
      signupBusy = false;
      setBusy(button, false, "تأكيد البريد الإلكتروني");
    }
  }

  async function resendSignupOtp() {
    if (signupBusy) return;
    if (!pendingSignupEmail) {
      showAuthMessage("لا يوجد تسجيل قيد التحقق. ابدأ بإنشاء الحساب أولًا.");
      return;
    }

    const button = document.getElementById("resendSignupOtpButton");
    signupBusy = true;
    setBusy(button, true, "جارٍ إعادة الإرسال...");
    try {
      const { error } = await supabaseClient.auth.resend({
        type: "signup",
        email: pendingSignupEmail
      });
      if (error) {
        showAuthMessage(
          error.message || "تعذر إعادة إرسال رمز التحقق. انتظر قليلًا ثم حاول مرة أخرى."
        );
        return;
      }
      showAuthMessage(
        "التحقق من البريد الإلكتروني\nتم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.\nإذا لم تجده في صندوق الوارد (Inbox)، راجع مجلد البريد غير المرغوب فيه (Spam أو Junk).",
        "success"
      );
      document.getElementById("signupOtp")?.focus();
    } catch (error) {
      console.error("OTP resend failed:", error);
      showAuthMessage("تعذر إعادة إرسال الرمز حاليًا. حاول مرة أخرى.");
    } finally {
      signupBusy = false;
      setBusy(button, false, "إعادة إرسال الرمز");
    }
  }



  // ---------------------------------------------------------
  // Password recovery — shared Supabase Auth flow
  // ---------------------------------------------------------
  const RECOVERY_COOLDOWN_MS = 60 * 1000;
  const RECOVERY_COOLDOWN_KEY = "dp_recovery_otp_sent_at";
  let recoveryBusy = false;
  let recoveryCooldownTimer = null;
  let recoveryEmail = "";

  function recoveryElement(id) {
    return document.getElementById(id);
  }

  function showRecoveryMessage(message, type = "error") {
    const box = recoveryElement("recoveryMessage");
    if (!box) return;
    box.textContent = message;
    box.className = "msg " + type;
    box.style.display = "block";
    box.setAttribute("role", type === "error" ? "alert" : "status");
    box.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  }

  function setRecoveryBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? "جاري التنفيذ..." : label;
  }

  function showRecoveryStep(step) {
    ["recoveryEmailStep", "recoveryOtpStep", "recoveryPasswordStep"].forEach((id) => {
      const panel = recoveryElement(id);
      if (panel) panel.hidden = id !== step;
    });
  }

  function getRecoveryCooldownRemaining() {
    const sentAt = Number(localStorage.getItem(RECOVERY_COOLDOWN_KEY) || 0);
    return Math.max(0, RECOVERY_COOLDOWN_MS - (Date.now() - sentAt));
  }

  function startRecoveryCooldown() {
    localStorage.setItem(RECOVERY_COOLDOWN_KEY, String(Date.now()));
    const button = recoveryElement("resendRecoveryOtpButton");
    const update = () => {
      const remaining = getRecoveryCooldownRemaining();
      if (button) {
        button.disabled = recoveryBusy || remaining > 0;
        button.textContent = remaining > 0
          ? `إعادة الإرسال بعد ${Math.ceil(remaining / 1000)} ثانية`
          : "إعادة إرسال الرمز";
      }
      if (remaining <= 0 && recoveryCooldownTimer) {
        clearInterval(recoveryCooldownTimer);
        recoveryCooldownTimer = null;
      }
    };
    if (recoveryCooldownTimer) clearInterval(recoveryCooldownTimer);
    update();
    recoveryCooldownTimer = setInterval(update, 1000);
  }

  async function sendRecoveryOtp(isResend = false) {
    if (recoveryBusy) return;
    const emailInput = recoveryElement("recoveryEmail");
    const email = (recoveryEmail || emailInput?.value || "").trim().toLowerCase();
    if (!email) {
      showRecoveryMessage("أدخل البريد الإلكتروني أولًا.");
      return;
    }
    if (isResend && getRecoveryCooldownRemaining() > 0) return;

    const button = recoveryElement(isResend ? "resendRecoveryOtpButton" : "sendRecoveryOtpButton");
    recoveryBusy = true;
    setRecoveryBusy(button, true, isResend ? "إعادة إرسال الرمز" : "إرسال رمز الاستعادة");
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
      if (error) throw error;
      recoveryEmail = email;
      if (emailInput) emailInput.value = email;
      const emailLabel = recoveryElement("recoveryOtpEmail");
      if (emailLabel) emailLabel.textContent = email;
      showRecoveryStep("recoveryOtpStep");
      showRecoveryMessage(
        "إذا كان البريد مرتبطًا بحساب، فسيصلك رمز استعادة من 8 أرقام. راجع البريد الوارد والرسائل غير المرغوب فيها.",
        "success"
      );
      startRecoveryCooldown();
      recoveryElement("recoveryOtp")?.focus();
    } catch (error) {
      console.error("Password recovery OTP request failed:", error);
      showRecoveryMessage("تعذر إرسال رمز الاستعادة حاليًا. حاول مرة أخرى لاحقًا.");
    } finally {
      recoveryBusy = false;
      setRecoveryBusy(button, false, isResend ? "إعادة إرسال الرمز" : "إرسال رمز الاستعادة");
      if (isResend) startRecoveryCooldown();
    }
  }

  async function verifyRecoveryOtp() {
    if (recoveryBusy) return;
    const token = recoveryElement("recoveryOtp")?.value.trim() || "";
    if (!recoveryEmail) {
      showRecoveryStep("recoveryEmailStep");
      showRecoveryMessage("ابدأ بإدخال بريدك الإلكتروني لإرسال رمز الاستعادة.");
      return;
    }
    if (!/^\\d{8}$/.test(token)) {
      showRecoveryMessage("أدخل رمز التحقق المكوّن من 8 أرقام.");
      return;
    }

    const button = recoveryElement("verifyRecoveryOtpButton");
    recoveryBusy = true;
    setRecoveryBusy(button, true, "التحقق من الرمز");
    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        email: recoveryEmail,
        token,
        type: "recovery"
      });
      if (error) throw error;
      if (!data?.session?.user) throw new Error("لم يتم إنشاء جلسة استعادة صالحة.");
      showRecoveryStep("recoveryPasswordStep");
      showRecoveryMessage("تم التحقق من الرمز. أدخل كلمة المرور الجديدة.", "success");
      recoveryElement("newRecoveryPassword")?.focus();
    } catch (error) {
      console.error("Password recovery OTP verification failed:", error);
      showRecoveryMessage("رمز التحقق غير صحيح أو انتهت صلاحيته. راجع الرمز أو اطلب رمزًا جديدًا.");
    } finally {
      recoveryBusy = false;
      setRecoveryBusy(button, false, "تأكيد الرمز");
    }
  }

  async function saveRecoveredPassword() {
    if (recoveryBusy) return;
    const password = recoveryElement("newRecoveryPassword")?.value || "";
    const confirmation = recoveryElement("confirmRecoveryPassword")?.value || "";
    if (!isStrongPassword(password)) {
      showRecoveryMessage(STRONG_PASSWORD_MESSAGE);
      return;
    }
    if (password !== confirmation) {
      showRecoveryMessage("كلمتا المرور غير متطابقتين.");
      return;
    }
    const button = recoveryElement("saveRecoveryPasswordButton");
    recoveryBusy = true;
    setRecoveryBusy(button, true, "حفظ كلمة المرور الجديدة");
    try {
      const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData?.session?.user) {
        throw new Error("انتهت جلسة الاستعادة. اطلب رمزًا جديدًا.");
      }
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) throw error;
      await supabaseClient.auth.signOut({ scope: "local" });
      recoveryElement("newRecoveryPassword").value = "";
      recoveryElement("confirmRecoveryPassword").value = "";
      showRecoveryStep("recoveryEmailStep");
      recoveryEmail = "";
      localStorage.removeItem(RECOVERY_COOLDOWN_KEY);
      showRecoveryMessage("تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.", "success");
      button.textContent = "تم تغيير كلمة المرور";
      button.disabled = true;
    } catch (error) {
      console.error("Recovered password update failed:", error);
      showRecoveryMessage(error?.message || "تعذر تغيير كلمة المرور. أعد طلب رمز الاستعادة إذا انتهت الجلسة.");
    } finally {
      recoveryBusy = false;
      if (button && button.textContent !== "تم تغيير كلمة المرور") {
        setRecoveryBusy(button, false, "حفظ كلمة المرور الجديدة");
      }
    }
  }

  function initializeRecoveryPage() {
    if (!window.location.pathname.endsWith("/forgot-password.html")) return;
    recoveryElement("sendRecoveryOtpButton")?.addEventListener("click", () => sendRecoveryOtp(false));
    recoveryElement("resendRecoveryOtpButton")?.addEventListener("click", () => sendRecoveryOtp(true));
    recoveryElement("verifyRecoveryOtpButton")?.addEventListener("click", verifyRecoveryOtp);
    recoveryElement("saveRecoveryPasswordButton")?.addEventListener("click", saveRecoveredPassword);
    recoveryElement("recoveryOtp")?.addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/\\D/g, "").slice(0, 8);
    });
    const email = new URLSearchParams(window.location.search).get("email");
    if (email && recoveryElement("recoveryEmail")) recoveryElement("recoveryEmail").value = email;
  }

  let accountTypeSelectionMode = "complete";

  function showAccountTypeSelection(mode = "complete") {
    const panel = document.getElementById("accountTypeOnboarding");
    if (!panel) {
      showAuthMessage("هذا الحساب يحتاج إلى تحديد نوعه. حدّث الصفحة وحاول مرة أخرى.");
      return;
    }

    accountTypeSelectionMode = mode === "google" ? "google" : "complete";
    document.querySelectorAll(".auth-form").forEach(form => { form.style.display = "none"; });
    document.querySelectorAll("[data-auth-tab]").forEach(tab => tab.classList.remove("active"));

    const tabs = document.querySelector(".tabs");
    if (tabs) tabs.hidden = true;

    const actionButton = document.getElementById("completeAccountTypeButton");
    const cancelButton = document.getElementById("cancelAccountTypeSelectionButton");
    const heading = panel.querySelector("h2");
    const description = panel.querySelector(":scope > p");

    if (heading) heading.textContent = accountTypeSelectionMode === "google"
      ? "اختر نوع الحساب"
      : "كيف ستستخدم Diet Planner؟";
    if (description) description.textContent = accountTypeSelectionMode === "google"
      ? "حدد نوع حسابك أولًا، ثم أكمل المتابعة باستخدام Google."
      : "اختر نوع الحساب لاستكمال إعداد مساحتك.";
    if (actionButton) actionButton.textContent = accountTypeSelectionMode === "google"
      ? "المتابعة باستخدام Google"
      : "متابعة";
    if (cancelButton) cancelButton.hidden = accountTypeSelectionMode !== "google";

    panel.hidden = false;

    const requestedAccountType = new URLSearchParams(window.location.search).get("account_type");
    if (["patient", "professional"].includes(requestedAccountType)) {
      const preferred = panel.querySelector(`input[name="onboardingAccountType"][value="${requestedAccountType}"]`);
      if (preferred) preferred.checked = true;
    }

    document.getElementById("authMessage")?.style.setProperty("display", "none");
  }

  function cancelAccountTypeSelection() {
    const panel = document.getElementById("accountTypeOnboarding");
    const tabs = document.querySelector(".tabs");
    if (panel) panel.hidden = true;
    if (tabs) tabs.hidden = false;

    document.querySelectorAll('input[name="onboardingAccountType"]').forEach(input => {
      input.checked = false;
    });

    document.querySelectorAll(".auth-form").forEach(form => {
      form.style.display = form.id === "loginForm" ? "block" : "none";
    });
    document.querySelectorAll("[data-auth-tab]").forEach(tab => {
      const active = tab.dataset.authTab === "loginForm";
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    accountTypeSelectionMode = "complete";
  }

  async function completeAccountTypeSelection() {
    if (signupBusy) return;

    const accountType = document.querySelector('input[name="onboardingAccountType"]:checked')?.value;
    const button = document.getElementById("completeAccountTypeButton");

    if (!["professional", "patient"].includes(accountType)) {
      showAuthMessage("اختر نوع الحساب أولًا.");
      return;
    }

    if (accountTypeSelectionMode === "google") {
      await startGoogleOAuth(button, accountType);
      return;
    }

    signupBusy = true;
    setBusy(button, true, "جارٍ حفظ الاختيار...");
    try {
      const { error } = await supabaseClient.rpc("complete_account_type_selection", {
        p_account_type: accountType
      });
      if (error) throw error;
      clearGoogleSignupIntent();
      clearAccessCache();
      const user = await getCurrentUser();
      await checkUserAccess({ user });
    } catch (error) {
      console.error("Account type selection failed:", error);
      showAuthMessage(error?.message || "تعذر حفظ نوع الحساب. حاول مرة أخرى.");
    } finally {
      signupBusy = false;
      setBusy(button, false, "متابعة");
    }
  }

  const GOOGLE_SIGNUP_INTENT_KEY = "dp_google_signup_account_type";

  function getGoogleSignupIntent() {
    try {
      const value = window.sessionStorage.getItem(GOOGLE_SIGNUP_INTENT_KEY);
      return ["professional", "patient"].includes(value) ? value : null;
    } catch (error) {
      console.warn("Google signup intent is unavailable:", error);
      return null;
    }
  }

  function clearGoogleSignupIntent() {
    try {
      window.sessionStorage.removeItem(GOOGLE_SIGNUP_INTENT_KEY);
    } catch (error) {
      console.warn("Google signup intent could not be cleared:", error);
    }
  }

  async function startGoogleOAuth(button, accountType = null) {
    if (accountType && !["professional", "patient"].includes(accountType)) {
      showAuthMessage("اختر نوع الحساب أولًا.");
      return;
    }

    try {
      if (accountType) {
        window.sessionStorage.setItem(GOOGLE_SIGNUP_INTENT_KEY, accountType);
      } else {
        clearGoogleSignupIntent();
      }
    } catch (error) {
      console.warn("Google signup intent could not be stored:", error);
    }

    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i><span>جاري فتح Google...</span>';
    }

    try {
      const redirectTo = new URL(window.location.href);
      redirectTo.hash = "";
      redirectTo.search = "";

      const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo.toString() }
      });

      if (error) throw error;
    } catch (error) {
      if (accountType) clearGoogleSignupIntent();
      showAuthMessage(error?.message || "تعذر المتابعة باستخدام Google.");
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="fa-brands fa-google" aria-hidden="true"></i><span>المتابعة باستخدام Google</span>';
      }
    }
  }

  async function loginWithGoogle() {
    // Ask for the intended account type before starting Google OAuth.
    // For existing users, the saved profiles.account_type remains authoritative.
    showAccountTypeSelection("google");
  }

  async function registerWithGoogle() {
    const accountType = document.querySelector('input[name="registerAccountType"]:checked')?.value;
    if (!["professional", "patient"].includes(accountType)) {
      showAuthMessage("اختر نوع الحساب أولًا قبل المتابعة باستخدام Google.");
      return;
    }
    return startGoogleOAuth(document.getElementById("googleSignupButton"), accountType);
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
  // Login-page event binding
  // ---------------------------------------------------------
  function initializeLoginPage() {
    if (!isLoginPage()) return;

    /*
     * IMPORTANT:
     * Do not run an asynchronous session redirect on a normal visit to
     * login.html. On Android and some desktop browsers, an immediate
     * navigation can interrupt native input focus and make the keyboard
     * appear/disappear or make the fields feel unresponsive.
     *
     * Normal access routing happens after a successful login. OAuth
     * callbacks are the only case where login.html must process the existing
     * session automatically.
     */
    document
      .getElementById("loginButton")
      ?.addEventListener("click", loginUser);

    document
      .getElementById("registerButton")
      ?.addEventListener("click", registerUser);
    document
      .getElementById("verifySignupOtpButton")
      ?.addEventListener("click", verifySignupOtp);
    document
      .getElementById("resendSignupOtpButton")
      ?.addEventListener("click", resendSignupOtp);
    document
      .getElementById("signupOtp")
      ?.addEventListener("input", (event) => {
        event.target.value = event.target.value.replace(/\D/g, "").slice(0, 8);
      });

    document
      .getElementById("googleLoginButton")
      ?.addEventListener("click", loginWithGoogle);
    document
      .getElementById("googleSignupButton")
      ?.addEventListener("click", registerWithGoogle);
    document
      .getElementById("completeAccountTypeButton")
      ?.addEventListener("click", completeAccountTypeSelection);
    document
      .getElementById("cancelAccountTypeSelectionButton")
      ?.addEventListener("click", cancelAccountTypeSelection);

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
              const active = tab === button;
              tab.classList.toggle("active", active);
              tab.setAttribute("aria-selected", String(active));
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

    // Apply the requested tab only after its click handler is registered.
    if (window.location.hash === "#register") {
      const registerTab = document.querySelector('[data-auth-tab="registerForm"]');
      registerTab?.click();

      const requestedAccountType = new URLSearchParams(window.location.search).get("account_type");
      if (["patient", "professional"].includes(requestedAccountType)) {
        const preferred = document.querySelector(`input[name="registerAccountType"][value="${requestedAccountType}"]`);
        if (preferred) preferred.checked = true;
      }
    }
  }

  // ---------------------------------------------------------
  // Shared page access notice
  // ---------------------------------------------------------
  function showAccessPrompt({ title, message, actionLabel, actionHref }) {
    const existing = document.getElementById("dpAccessPrompt");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "dpAccessPrompt";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "dpAccessPromptTitle");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.72);backdrop-filter:blur(5px);";
    const panel = document.createElement("section");
    panel.style.cssText = "width:min(100%,440px);padding:28px 22px;border-radius:20px;background:var(--dp-surface,#fff);color:var(--dp-text,#172033);border:1px solid var(--dp-border,#e5e7eb);box-shadow:0 24px 70px rgba(0,0,0,.25);text-align:center;font-family:inherit;";
    const icon = document.createElement("div");
    icon.textContent = "🔒";
    icon.style.cssText = "font-size:34px;margin-bottom:12px;";
    const heading = document.createElement("h2");
    heading.id = "dpAccessPromptTitle";
    heading.textContent = title;
    heading.style.cssText = "margin:0 0 9px;font-size:20px;font-weight:900;";
    const description = document.createElement("p");
    description.textContent = message;
    description.style.cssText = "margin:0 0 20px;font-size:14px;line-height:1.9;color:var(--dp-text-2,#64748b);";
    const action = document.createElement("a");
    action.href = actionHref;
    action.textContent = actionLabel;
    action.style.cssText = "display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 22px;border-radius:12px;background:var(--dp-primary,#159b78);color:#fff;text-decoration:none;font-weight:800;font-size:14px;";
    panel.append(icon, heading, description, action);
    overlay.append(panel);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    action.focus();
    return overlay;
  }

  // ---------------------------------------------------------
  // Public API
  // ---------------------------------------------------------
  window.DietPlannerAccess = {
    supabaseClient,
    getCurrentUser,
    getUserRole,
    getUserAccountType,
    hasActiveSubscription,
    canWrite,
    getAccessStatus,
    showAccessPrompt,
    logout: logoutUser
  };

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeLoginPage,
      { once: true }
    );
  } else {
    initializeLoginPage();
  }
})();
