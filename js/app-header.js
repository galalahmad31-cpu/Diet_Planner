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
    ["nutritionsupport.html", "الدعم الغذائي", "fa-notes-medical"]
  ];
  const titles = Object.fromEntries(pages.map(([href, label]) => [href, label]));
  titles["patient-profile.html"] = "ملف المريض";
  titles["visit.html"] = "الخطة الغذائية";
  titles["nutritionsupport.html"] = "الدعم الغذائي";
  titles["nutritionsupport-patient.html"] = "الدعم الغذائي";
  titles["notifications.html"] = "الإشعارات";
  titles["admin.html"] = "لوحة الإدارة";
  titles["subscription_plans_index.html"] = "خطط الاشتراك";
  titles["subscription_plansم.html"] = "خطط الاشتراك";
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
        <span class="dp-app-header__page-title"></span>
      </div>
      <nav class="dp-app-header__nav" aria-label="التنقل الرئيسي">
        <div class="dp-app-header__track"></div>
      </nav>
      <div class="dp-app-header__context" hidden></div>`;
    const track = header.querySelector(".dp-app-header__track");
    pages.forEach(([href, label, icon]) => {
      const link = document.createElement("a");
      link.className = "dp-app-header__link";
      link.href = href;
      if (path === "weightم.html" && href === "app.html") link.id = "dashboardBtn";
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      if (path === href || ((path === "patient-profile.html" || path === "visit.html" || path === "weightم.html") && href === "patient.html") || (path === "article-view.html" && href === "article.html") || (path === "nutritionsupport-patient.html" && href === "nutritionsupport.html") || ((path === "subscription_plans_index.html" || path === "subscription_plansم.html") && href === "profile.html")) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      track.append(link);
    });
    return header;
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
        context.append(...actions.childNodes);
        actions.remove();
      }
      placeholder.replaceWith(header);
    } else {
      header.querySelector(".dp-app-header__page-title").textContent =
        titles[path] || document.title.split("|")[0].trim();
      const main = document.querySelector("main");
      document.body.insertBefore(header, main || document.body.firstChild);
    }
    if (context.children.length) context.hidden = false;
    document.body.classList.add("dp-has-app-header");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();