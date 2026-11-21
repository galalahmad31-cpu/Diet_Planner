(() => {
  "use strict";

  const elements = {
    patientCard: document.getElementById("landingPatientCard"),
    professionalCard: document.getElementById("landingProfessionalCard"),
    patientAction: document.getElementById("landingPatientAction"),
    professionalAction: document.getElementById("landingProfessionalAction"),
    status: document.getElementById("landingAccountStatus"),
    themeToggle: document.getElementById("landingThemeToggle")
  };

  function showAccountRoute(accountType, hasActiveSubscription) {
    if (accountType === "patient") {
      elements.professionalCard.hidden = true;
      elements.patientAction.href = "patient-portal.html";
      elements.patientAction.innerHTML = 'دخول بوابة المريض <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
      
      return;
    }

    if (accountType === "professional") {
      elements.guestAction.hidden = true;
      elements.patientCard.hidden = true;
      elements.professionalAction.href = hasActiveSubscription ? "app.html" : "profile.html";
      elements.professionalAction.innerHTML = hasActiveSubscription
        ? 'دخول لوحة المختص <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>'
        : 'استكمال الملف والاشتراك <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
      
      return;
    }

    if (accountType === "pending") {
      elements.guestAction.hidden = true;
      elements.patientCard.hidden = true;
      elements.professionalCard.hidden = true;
      elements.status.hidden = false;
      elements.status.textContent = "حسابك يحتاج إلى استكمال تحديد نوع الاستخدام. سجّل الدخول لمتابعة إعداد الحساب.";
      return;
    }
  }

  async function initialize() {
    elements.themeToggle?.addEventListener("click", () => window.DietPlannerTheme?.toggle?.());

    const access = window.DietPlannerAccess;
    if (!access?.getAccessStatus) {
      elements.status.hidden = false;
      elements.status.textContent = "يمكنك استعراض المنصة، لكن تعذر التحقق من حالة الحساب حاليًا.";
      return;
    }

    try {
      const status = await access.getAccessStatus();
      if (!status.authenticated) return;

      if (status.accessVerificationFailed) {
        elements.status.hidden = false;
        elements.status.textContent = "تعذر التحقق من صلاحيات الحساب أو الاشتراك حاليًا. يمكنك المحاولة لاحقًا.";
        return;
      }

      if (status.isAdmin) {
        elements.guestAction.hidden = true;
        elements.patientCard.hidden = true;
        elements.professionalCard.hidden = true;
        elements.status.hidden = false;
        elements.status.textContent = "تم تسجيل الدخول بحساب الإدارة.";
        const adminAction = document.createElement("a");
        adminAction.className = "dp-landing-role-action";
        adminAction.href = "app.html";
        adminAction.textContent = "دخول لوحة الإدارة";
        elements.status.append(" ", adminAction);
        return;
      }

      showAccountRoute(status.accountType, status.hasActiveSubscription);
    } catch (error) {
      console.error("Landing account check failed:", error);
      elements.status.hidden = false;
      elements.status.textContent = "تعذر التحقق من حالة الحساب حاليًا. يمكنك تسجيل الدخول والمحاولة مرة أخرى.";
    }
  }

  initialize();
})();