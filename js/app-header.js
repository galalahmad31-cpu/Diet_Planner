/* Diet Planner — single shared application header.
   Legacy page headers are replaced once at runtime; page-specific controls are preserved. */
(() => {
  "use strict";
  if (window.__DP_APP_HEADER__) return;
  window.__DP_APP_HEADER__ = true;

  const path = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
  const appBasePath = location.hostname === "galalahmad31-cpu.github.io" ? "/Diet_Planner/" : "/";

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
    ["jobs.html", "الوظائف الطبية", "fa-briefcase"],
    ["profile.html", "الصفحة الشخصية", "fa-user-doctor"],
    ["feedback.html", "شاركنا رأيك", "fa-star"],
    ["about.html", "عن التطبيق", "fa-circle-info"],
    ["notifications.html", "الإشعارات", "fa-bell"],
  ];
  const titles = Object.fromEntries(pages.map(([href, label]) => [href, label]));
  titles["patient-profile.html"] = "ملف المريض";
  titles["visit.html"] = "الخطة الغذائية";
  titles["nutritionsupport-patient.html"] = "الدعم الغذائي";
  titles["admin.html"] = "لوحة الإدارة";
  titles["article-view.html"] = "المقال";
  titles["privacy.html"] = "سياسة الخصوصية";

  function buildHeader() {
    const header = document.createElement("header");
    header.className = "dp-app-header no-print";
    header.setAttribute("dir", "rtl");
    header.innerHTML = `
      <div class="dp-app-header__brand-row">
        <a class="dp-app-header__brand" href="${appBasePath}app.html" aria-label="Diet Planner - الرئيسية">
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
      <nav class="dp-app-header__nav is-collapsed" aria-label="التنقل الرئيسي">
        <div class="dp-app-header__nav-top">
          <button class="dp-app-header__toggle" type="button" aria-expanded="false" aria-controls="dp-app-header-track">
            <span>التنقل بين الصفحات</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
          </button>
        </div>
        <div class="dp-app-header__track" id="dp-app-header-track"></div>
      </nav>
      <div class="dp-app-header__context" hidden>
        <div id="headerActions" class="dp-header-account-actions">
          <div class="dp-header-auth-actions">
            <a id="loginCta" class="hidden" href="${appBasePath}login.html">تسجيل الدخول</a>
            <a id="registerCta" class="hidden" href="${appBasePath}login.html#register">إنشاء حساب</a>
          </div>
        </div>
      </div>`;
    const track = header.querySelector(".dp-app-header__track");
    pages.forEach(([href, label, icon]) => {
      const link = document.createElement("a");
      link.className = "dp-app-header__link";
      link.href = appBasePath + href;
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      if (path === href || (path === "index.html" && href === "app.html") || ((path === "patient-profile.html" || path === "visit.html") && href === "patient.html") || (path === "article-view.html" && href === "article.html") || (/^[0-9a-f-]{36}$/i.test(path) && href === "jobs.html")) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      track.append(link);
    });
    const toggle = header.querySelector(".dp-app-header__toggle");
    const nav = header.querySelector(".dp-app-header__nav");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("is-expanded", !expanded);
      nav.classList.toggle("is-collapsed", expanded);
    });
    track.addEventListener("click", event => {
      if (event.target.closest(".dp-app-header__link")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-expanded");
        nav.classList.add("is-collapsed");
      }
    });
    return header;
  }


  function renderAccount(user) {
    const logout = document.getElementById("logoutBtn");
    const login = document.getElementById("loginCta");
    const register = document.getElementById("registerCta");
    const context = document.querySelector(".dp-app-header__context");
    const signedIn = Boolean(user?.id);
    logout?.classList.toggle("hidden", !signedIn);
    login?.classList.toggle("hidden", signedIn);
    register?.classList.toggle("hidden", signedIn);
    if (context) context.hidden = signedIn;
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
      const title = (placeholder.dataset.pageTitle || titles[path] || document.title.split("|")[0].trim()).trim();
      const activeLink = header.querySelector(".dp-app-header__link.is-active");
      const activeLabel = activeLink?.querySelector("span")?.textContent.trim();
      const pageTitle = header.querySelector(".dp-app-header__page-title");
      if (title && title !== activeLabel) pageTitle.textContent = title;
      else pageTitle.remove();
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
      const title = (titles[path] || document.title.split("|")[0].trim()).trim();
      const activeLink = header.querySelector(".dp-app-header__link.is-active");
      const activeLabel = activeLink?.querySelector("span")?.textContent.trim();
      const pageTitle = header.querySelector(".dp-app-header__page-title");
      if (title && title !== activeLabel) pageTitle.textContent = title;
      else pageTitle.remove();
      const main = document.querySelector("main");
      document.body.insertBefore(header, main || document.body.firstChild);
    }
    bindAccountActions();
    document.body.classList.add("dp-has-app-header");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();