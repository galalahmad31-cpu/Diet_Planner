(() => {
  "use strict";

  const elements = {
    patientCard: document.getElementById("landingPatientCard"),
    professionalCard: document.getElementById("landingProfessionalCard"),
    patientAction: document.getElementById("landingPatientAction"),
    professionalAction: document.getElementById("landingProfessionalAction"),
    status: document.getElementById("landingAccountStatus"),
    articles: document.getElementById("landingLatestArticles")
  };

  function showAccountRoute(accountType, hasActiveSubscription) {
    if (accountType === "patient") {
      elements.professionalCard.hidden = true;
      elements.patientAction.href = "patient-portal.html";
      elements.patientAction.innerHTML = 'دخول بوابة المريض <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
      return;
    }
    if (accountType === "professional") {
      elements.patientCard.hidden = true;
      elements.professionalAction.href = hasActiveSubscription ? "app.html" : "profile.html";
      elements.professionalAction.innerHTML = hasActiveSubscription
        ? 'دخول لوحة المختص <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>'
        : 'استكمال الملف والاشتراك <i class="fa-solid fa-arrow-left" aria-hidden="true"></i>';
      return;
    }
    if (accountType === "pending") {
      elements.patientCard.hidden = true;
      elements.professionalCard.hidden = true;
      elements.status.hidden = false;
      elements.status.textContent = "حسابك يحتاج إلى استكمال تحديد نوع الاستخدام. سجّل الدخول لمتابعة إعداد الحساب.";
    }
  }

  function formatArticleDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(date);
  }

  function renderArticleState(message) {
    if (!elements.articles) return;
    const state = document.createElement("p");
    state.className = "dp-landing-articles-state";
    state.textContent = message;
    elements.articles.replaceChildren(state);
  }

  function renderLatestArticles(rows) {
    if (!elements.articles) return;
    if (!rows.length) {
      renderArticleState("لا توجد مقالات منشورة حاليًا.");
      return;
    }
    const fragment = document.createDocumentFragment();
    rows.forEach(article => {
      const link = document.createElement("a");
      link.className = "dp-landing-article-card";
      link.href = "article.html?id=" + encodeURIComponent(article.id);

      const meta = document.createElement("span");
      meta.className = "dp-landing-article-meta";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-book-open";
      icon.setAttribute("aria-hidden", "true");
      meta.append(icon, document.createTextNode("مقال علمي"));

      const title = document.createElement("strong");
      title.textContent = article.title || "مقال بدون عنوان";

      const author = document.createElement("span");
      author.className = "dp-landing-article-author";
      const date = formatArticleDate(article.published_at || article.updated_at);
      author.textContent = [article.author_name, date].filter(Boolean).join(" · ") || "Diet Planner";

      link.append(meta, title, author);
      fragment.append(link);
    });
    elements.articles.replaceChildren(fragment);
  }

  async function loadLatestArticles() {
    if (!elements.articles) return;
    const client = window.DietPlannerAccess?.supabaseClient;
    if (!client) {
      renderArticleState("تعذر تحميل المقالات حاليًا. يمكنك تصفح مكتبة المقالات.");
      return;
    }
    try {
      const { data, error } = await client
        .from("articles")
        .select("id,title,author_name,published_at,updated_at")
        .eq("visibility", "public")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      renderLatestArticles(data || []);
    } catch (error) {
      console.error("Landing latest articles failed:", error);
      renderArticleState("تعذر تحميل المقالات الآن. يمكنك زيارة مكتبة المقالات.");
    }
  }

  async function initialize() {
    const articleTask = loadLatestArticles();
    const access = window.DietPlannerAccess;
    if (!access?.getAccessStatus) {
      elements.status.hidden = false;
      elements.status.textContent = "يمكنك استعراض المنصة، لكن تعذر التحقق من حالة الحساب حاليًا.";
      await articleTask;
      return;
    }
    try {
      const status = await access.getAccessStatus();
      if (!status.authenticated) return;
      // The landing page is an entry point, not an authenticated workspace.
      // Route only after the account identity and required access have been verified.
      if (status.isAdmin === true) {
        window.location.replace("app.html");
        return;
      }
      if (status.accessVerificationFailed) {
        elements.status.hidden = false;
        elements.status.textContent = "تعذر التحقق من صلاحيات الحساب أو الاشتراك حاليًا. يمكنك المحاولة لاحقًا.";
        return;
      }
      if (status.accountType === "patient") {
        window.location.replace("patient-portal.html");
        return;
      }
      if (status.accountType === "professional") {
        window.location.replace(status.hasActiveSubscription ? "app.html" : "profile.html");
        return;
      }
      showAccountRoute(status.accountType, status.hasActiveSubscription);
    } catch (error) {
      console.error("Landing account check failed:", error);
      elements.status.hidden = false;
      elements.status.textContent = "تعذر التحقق من حالة الحساب حاليًا. يمكنك تسجيل الدخول والمحاولة مرة أخرى.";
    } finally {
      await articleTask;
    }
  }

  initialize();
})();