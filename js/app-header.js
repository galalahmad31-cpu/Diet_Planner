/* Diet Planner — single shared application header.
   Legacy page headers are replaced once at runtime; page-specific controls are preserved. */
(() => {
  "use strict";
  if (window.__DP_APP_HEADER__) return;
  window.__DP_APP_HEADER__ = true;

  const path = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
  if (new URLSearchParams(location.search).get("embed") === "1") return;
  if (document.documentElement.classList.contains("visit-embedded") ||
      document.documentElement.classList.contains("nsp-embedded")) return;

  const pages = [
    ["app.html", "الرئيسية", "fa-house"],
    ["patient.html", "قائمة المرضى", "fa-user-group"],
    ["food.html", "مكتبة الأغذية", "fa-apple-whole"],
    ["products.html", "المنتجات الغذائية", "fa-prescription-bottle-medical"],
    ["diet.html", "مكتبة الدايت", "fa-layer-group"],
    ["recipe.html", "الوصفات الصحية", "fa-bowl-food"],
    ["quickcalc.html", "الحاسبة السريعة", "fa-calculator"],
    ["finance.html", "اشتراكات المرضى", "fa-wallet"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["profile.html", "الصفحة الشخصية", "fa-user-doctor"],
    ["feedback.html", "شاركنا رأيك", "fa-star"],
    ["about.html", "عن التطبيق", "fa-circle-info"],
    ["notifications.html", "الإشعارات", "fa-bell"],
  ];
  const titles = Object.fromEntries(pages.map(([href, label]) => [href, label]));
  titles["patient-profile.html"] = "ملف المريض";
  titles["visit.html"] = "الخطة الغذائية";
  titles["nutritionsupport.html"] = "الدعم الغذائي";
  titles["nutritionsupport-patient.html"] = "الدعم الغذائي";
  titles["admin.html"] = "لوحة الإدارة";
  titles["article-view.html"] = "المقال";
  titles["privacy.html"] = "سياسة الخصوصية";
  titles["weightم.html"] = "متابعة الوزن";

  function buildHeader() {
    const header = document.createElement("header");
    header.className = "dp-app-header no-print";
    header.setAttribute("dir", "rtl");
    header.innerHTML = `
      <div class="dp-app-header__brand-row">
        <a class="dp-app-header__brand" href="app.html" aria-label="Diet Planner - الرئيسية">
          <span class="dp-app-header__logo" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
          <span class="dp-app-header__brand-copy"><strong>Diet Planner</strong><small>د. أحمد جلال</small></span>
        </a>
        <div class="dp-app-header__page-meta">
          <span class="dp-app-header__page-title"></span>
          <button id="logoutBtn" type="button" class="dp-app-header__logout hidden" title="تسجيل الخروج" aria-label="تسجيل الخروج">
            <i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>خروج</span>
          </button>
        </div>
      </div>
      <nav class="dp-app-header__nav" aria-label="التنقل الرئيسي">
        <div class="dp-app-header__track"></div>
      </nav>
      <div class="dp-app-header__context">
        <div id="headerActions" class="dp-header-account-actions">
          <div id="accountInfo" class="dp-header-account-info hidden">
            <span id="doctorName" class="dp-header-account-name" aria-live="polite"></span>

          </div>
          <div class="dp-header-auth-actions">
            <a id="loginCta" class="hidden" href="login.html">تسجيل الدخول</a>
            <a id="registerCta" class="hidden" href="login.html#register">إنشاء حساب</a>
          </div>
        </div>
      </div>`;
    const track = header.querySelector(".dp-app-header__track");
    pages.forEach(([href, label, icon]) => {
      const link = document.createElement("a");
      link.className = "dp-app-header__link";
      link.href = href;
      if (path === "weightم.html" && href === "app.html") link.id = "dashboardBtn";
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      if (path === href || (path === "index.html" && href === "app.html") || ((path === "patient-profile.html" || path === "visit.html" || path === "weightم.html") && href === "patient.html") || (path === "article-view.html" && href === "article.html")) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      track.append(link);
    });
    return header;
  }


  function renderAccount(user) {
    const info = document.getElementById("accountInfo");
    const name = document.getElementById("doctorName");
    const logout = document.getElementById("logoutBtn");
    const login = document.getElementById("loginCta");
    const register = document.getElementById("registerCta");
    const signedIn = Boolean(user?.id);
    info?.classList.toggle("hidden", !signedIn);
    logout?.classList.toggle("hidden", !signedIn);
    login?.classList.toggle("hidden", signedIn);
    register?.classList.toggle("hidden", signedIn);
    if (name) name.textContent = signedIn
      ? (user.user_metadata?.full_name || user.user_metadata?.name || user.email || "حساب المستخدم")
      : "";
  }

  function bindAccountActions() {
    const logout = document.getElementById("logoutBtn");
    if (logout && logout.dataset.centralHandlerBound !== "true") {
      logout.addEventListener("click", async () => {
        if (logout.disabled) return;
        logout.disabled = true;
        try {
          await window.DietPlannerAccess?.logout();
        } catch (error) {
          console.error("Central logout failed:", error);
          logout.disabled = false;
        }
      });
      logout.dataset.centralHandlerBound = "true";
    }
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase?.auth) {
      renderAccount(null);
      console.warn("DietPlannerAccess is unavailable; central account actions remain in visitor mode.");
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("Header session lookup failed:", error);
      renderAccount(data?.session?.user || null);
    });
    supabase.auth.onAuthStateChange((_event, session) => renderAccount(session?.user || null));
  }
  function mount() {
    if (!document.body || document.querySelector(".dp-app-header")) return;
    const placeholder = document.querySelector("[data-dp-app-header]");
    const header = buildHeader();
    const context = header.querySelector(".dp-app-header__context");
    if (placeholder) {
      const title = placeholder.dataset.pageTitle || titles[path] || document.title.split("|")[0].trim();
      header.querySelector(".dp-app-header__page-title").textContent = title;
      const actions = document.querySelector("[data-dp-page-actions]");
      if (actions) {
        if (actions.dataset.placement === "title") {
          const pageMeta = header.querySelector(".dp-app-header__page-meta");
          const logout = pageMeta.querySelector(".dp-app-header__logout");
          pageMeta.insertBefore(actions.firstElementChild || actions.firstChild, logout);
        } else {
          context.append(...actions.childNodes);
        }
        actions.remove();
      }
      placeholder.replaceWith(header);
    } else {
      header.querySelector(".dp-app-header__page-title").textContent =
        titles[path] || document.title.split("|")[0].trim();
      const main = document.querySelector("main");
      document.body.insertBefore(header, main || document.body.firstChild);
    }
    context.hidden = false;
    bindAccountActions();
    document.body.classList.add("dp-has-app-header");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();