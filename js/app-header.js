/* Diet Planner — single shared application header.
   Legacy page headers are replaced once at runtime; page-specific controls are preserved. */
(() => {
  "use strict";
  if (window.__DP_APP_HEADER__) return;
  window.__DP_APP_HEADER__ = true;

  const path = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
  const appBasePath = location.hostname === "galalahmad31-cpu.github.io" ? "/Diet_Planner/" : "/";
  let notificationChannel = null;
  let notificationUserId = null;
  let publicAuthSubscription = null;

  if (new URLSearchParams(location.search).get("embed") === "1") return;
  if (document.documentElement.classList.contains("visit-embedded") ||
      document.documentElement.classList.contains("nsp-embedded")) return;

  function mountPatientHeader({ publicPage = false } = {}) {
    const isDirectoryPage = path === "professional-directory.html";
    const patientPages = [
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalHome" : "#portalHome", "الرئيسية", "fa-house"],
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalContent" : "#portalContent", "الملف الصحي", "fa-heart-pulse"],
      ["professional-directory.html", "دليل المتخصصين", "fa-user-doctor"],
      ["notifications.html", "الإشعارات", "fa-bell"],
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalDietBuilder" : "#portalDietBuilder", "صمم نظامك الغذائي", "fa-bowl-food"],
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalEducation" : "#portalEducation", "المكتبة والتثقيف", "fa-book-open"],
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalTools" : "#portalTools", "أدوات التغذية", "fa-calculator"],
      [(isDirectoryPage || publicPage) ? "patient-portal.html#portalProfileArea" : "#portalProfileArea", "الملف الشخصي", "fa-user"]
    ];
    if (!document.body || document.querySelector(".dp-app-header:not(.dp-public-header)")) return;
    const header = document.createElement("header");
    header.className = "dp-app-header dp-patient-header no-print";
    header.setAttribute("dir", "rtl");
    header.innerHTML = `
      <div class="dp-app-header__brand-row">
        <a class="dp-app-header__brand" href="${appBasePath}patient-portal.html" aria-label="Diet Planner - بوابة المريض">
          <span class="dp-app-header__logo" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
          <span class="dp-app-header__brand-copy"><strong>Diet Planner</strong><small>بوابة المريض</small></span>
        </a>
        <div class="dp-patient-header__actions">
          <button type="button" id="portalThemeToggle" class="dp-patient-header__action" aria-label="تغيير المظهر" title="تغيير المظهر"><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i></button>
          <button id="logoutBtn" type="button" class="dp-app-header__logout" title="تسجيل الخروج" aria-label="تسجيل الخروج"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>تسجيل الخروج</span></button>
        </div>
      </div>
      <nav class="dp-app-header__nav is-collapsed dp-patient-header__nav" aria-label="التنقل في بوابة المريض">
        <div class="dp-app-header__nav-top">
          <button class="dp-app-header__toggle" type="button" aria-expanded="false" aria-controls="dp-patient-header-track">
            <span>التنقل بين صفحات بوابة المريض</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
          </button>
        </div>
        <div class="dp-app-header__track" id="dp-patient-header-track"></div>
      </nav>
      <div class="dp-app-header__context dp-patient-header__page-actions" hidden></div>`;
    const track = header.querySelector(".dp-app-header__track");
    const nav = header.querySelector(".dp-patient-header__nav");
    const toggle = header.querySelector(".dp-app-header__toggle");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      nav.classList.toggle("is-expanded", !expanded);
      nav.classList.toggle("is-collapsed", expanded);
    });
    patientPages.forEach(([href, label, icon]) => {
      const link = document.createElement("a");
      link.className = "dp-app-header__link";
      link.href = href.startsWith("#") ? href : appBasePath + href;
      link.dataset.patientTarget = href;
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      if (href === "notifications.html") {
        link.id = "dpNotificationLink";
        link.classList.add("dp-app-header__notification-nav-link");
        link.setAttribute("aria-label", "الإشعارات");
        const badge = document.createElement("span");
        badge.id = "dpNotificationBadge";
        badge.className = "dp-app-header__notification-badge";
        badge.hidden = true;
        badge.textContent = "0";
        link.append(badge);
      }
      if ((!isDirectoryPage && !publicPage && href === "#portalHome") ||
          (isDirectoryPage && href === "professional-directory.html") ||
          (publicPage && href === "patient-portal.html#portalHome")) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      track.append(link);
    });
    track.addEventListener("click", event => {
      const link = event.target.closest("[data-patient-target]");
      if (!link) return;
      const target = link.dataset.patientTarget;
      if (!target.startsWith("#")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-expanded");
        nav.classList.add("is-collapsed");
      }
      if (target.startsWith("#")) {
        event.preventDefault();
        window.DietPlannerPatientPortal?.navigateToSection(target.slice(1));
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-expanded");
        nav.classList.add("is-collapsed");
        track.querySelectorAll(".dp-app-header__link").forEach(item => {
          const active = item === link;
          item.classList.toggle("is-active", active);
          if (active) item.setAttribute("aria-current", "page");
          else item.removeAttribute("aria-current");
        });
      }
    });

    const logout = header.querySelector("#logoutBtn");
    logout.addEventListener("click", async () => {
      if (logout.disabled) return;
      logout.disabled = true;
      try { await window.DietPlannerAccess?.logout(); }
      catch (error) { console.error("Patient header logout failed:", error); logout.disabled = false; }
    });
    header.querySelector("#portalThemeToggle").addEventListener("click", () => {
      window.DietPlannerTheme?.toggle?.();
    });
    const placeholder = document.querySelector("[data-dp-patient-header], [data-dp-app-header]");
    const publicHeader = document.querySelector(".dp-public-header");
    const pageActions = publicHeader?.querySelector(".dp-public-header__page-actions");
    if (pageActions?.childNodes.length) {
      const slot = header.querySelector(".dp-patient-header__page-actions");
      slot.append(...pageActions.childNodes);
      slot.hidden = !slot.childNodes.length;
    }
    if (placeholder) placeholder.replaceWith(header);
    else if (publicHeader) publicHeader.replaceWith(header);
    else document.body.insertBefore(header, document.querySelector("main") || document.body.firstChild);
    document.body.classList.remove("dp-has-public-header");
    document.body.classList.add("dp-has-app-header");
    const access = window.DietPlannerAccess;
    access?.getCurrentUser?.().then(user => user ? syncNotificationBadge(user) : clearNotificationBadge());
    access?.supabaseClient?.auth?.onAuthStateChange((_event, session) => {
      if (session?.user) syncNotificationBadge(session.user);
      else clearNotificationBadge();
    });
  }

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
          <a id="dpNotificationLink" class="dp-app-header__notification-link" href="${appBasePath}notifications.html" aria-label="الإشعارات" title="الإشعارات" hidden>
            <i class="fa-solid fa-bell" aria-hidden="true"></i><span id="dpNotificationBadge" class="dp-app-header__notification-badge" hidden>0</span>
          </a>
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
      link.dataset.pageHref = href;
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      if (path === href || (path === "index.html" && href === "app.html") || ((path === "patient-profile.html" || path === "visit.html") && href === "patient.html") || (path === "article-view.html" && href === "article.html") || (/^[0-9a-f-]{36}$/i.test(path) && href === "jobs.html")) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      track.append(link);
    });
    const professionalLink = document.createElement("a");
    professionalLink.className = "dp-app-header__link";
    professionalLink.href = appBasePath + "professional-directory-manage.html";
    professionalLink.dataset.pageHref = "professional-directory-manage.html";
    professionalLink.innerHTML = '<i class="fa-solid fa-id-card" aria-hidden="true"></i><span>ملفي المهني</span>';
    professionalLink.style.display = "none";
    if (path === "professional-directory-manage.html") {
      professionalLink.classList.add("is-active");
      professionalLink.setAttribute("aria-current", "page");
    }
    track.append(professionalLink);
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


  async function syncNotificationBadge(user) {
    const link = document.getElementById("dpNotificationLink");
    const badge = document.getElementById("dpNotificationBadge");
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!link || !badge || !supabase || !user?.id) {
      if (link) link.hidden = true;
      if (badge) badge.hidden = true;
      return;
    }

    link.hidden = false;
    const refresh = async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("read_at", null);
      if (error) {
        console.error("Notification badge lookup failed:", error);
        return;
      }
      const unread = Number(count || 0);
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.hidden = unread === 0;
      link.setAttribute("aria-label", unread ? `الإشعارات، ${unread} غير مقروء` : "الإشعارات");
    };

    if (notificationUserId !== user.id) {
      if (notificationChannel) {
        await supabase.removeChannel(notificationChannel);
        notificationChannel = null;
      }
      notificationUserId = user.id;
      notificationChannel = supabase
        .channel(`dp-header-notifications-${user.id}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`
        }, refresh)
        .subscribe();
    }
    await refresh();
  }

  async function clearNotificationBadge() {
    const link = document.getElementById("dpNotificationLink");
    const badge = document.getElementById("dpNotificationBadge");
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (link) link.hidden = true;
    if (badge) badge.hidden = true;
    if (notificationChannel && supabase) {
      await supabase.removeChannel(notificationChannel);
    }
    notificationChannel = null;
    notificationUserId = null;
  }

  async function renderAccount(user) {
    const logout = document.getElementById("logoutBtn");
    const login = document.getElementById("loginCta");
    const register = document.getElementById("registerCta");
    const professionalLink = document.querySelector('.dp-app-header__link[data-page-href="professional-directory-manage.html"]');
    const context = document.querySelector(".dp-app-header__context");
    const signedIn = Boolean(user?.id);
    logout?.classList.toggle("hidden", !signedIn);
    login?.classList.toggle("hidden", signedIn);
    register?.classList.toggle("hidden", signedIn);
    if (context) context.hidden = signedIn;
    if (professionalLink) {
      let accountType = null;
      if (signedIn) {
        try { accountType = await window.DietPlannerAccess?.getUserAccountType(user.id); }
        catch (error) { console.error("Professional navigation access check failed:", error); }
      }
      professionalLink.style.display = accountType === "professional" ? "" : "none";
    }
    if (signedIn) await syncNotificationBadge(user);
    else await clearNotificationBadge();
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

  const publicPages = [
    ["index.html", "الرئيسية", "fa-house"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["about.html", "عن المنصة", "fa-circle-info"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"],
    ["jobs.html", "الوظائف", "fa-briefcase"],
    ["quickcalc.html", "الحاسبة", "fa-calculator"]
  ];

  function buildPublicHeader(title) {
    const header = document.createElement("header");
    header.className = "dp-app-header dp-public-header no-print";
    header.setAttribute("dir", "rtl");
    header.innerHTML = `
      <div class="dp-public-header__top">
        <a class="dp-app-header__brand" href="${appBasePath}index.html" aria-label="Diet Planner - الرئيسية">
          <span class="dp-app-header__logo" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
          <span class="dp-app-header__brand-copy"><strong>Diet Planner</strong><small>منصة التغذية العلاجية</small></span>
        </a>
        <div class="dp-public-header__account">
          <a class="dp-public-header__auth-link" id="dpPublicLogin" href="${appBasePath}login.html">تسجيل الدخول</a>
          <a class="dp-public-header__auth-link is-primary" id="dpPublicRegister" href="${appBasePath}login.html#register">إنشاء حساب</a>
          <a class="dp-public-header__account-link" id="dpPublicAccount" href="${appBasePath}login.html" hidden>حسابي</a>
          <button type="button" id="dpPublicLogout" class="dp-public-header__logout" hidden><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>خروج</span></button>
          <button type="button" id="dpPublicThemeToggle" class="dp-public-header__theme" aria-label="تغيير المظهر" title="تغيير المظهر"><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i></button>
        </div>
      </div>
      <nav class="dp-public-header__nav" aria-label="روابط الموقع">
        <div class="dp-public-header__links"></div>
        <span class="dp-public-header__page-title"></span>
      </nav>
      <div class="dp-public-header__page-actions" hidden></div>`;
    const links = header.querySelector(".dp-public-header__links");
    publicPages.forEach(([href, label, icon]) => {
      const link = document.createElement("a");
      link.className = "dp-public-header__link";
      link.href = appBasePath + href;
      link.dataset.publicPage = href;
      link.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
      link.querySelector("span").textContent = label;
      const active = path === href || (path === "article-view.html" && href === "article.html");
      if (active) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      links.append(link);
    });
    const titleNode = header.querySelector(".dp-public-header__page-title");
    if (title && path !== "index.html") titleNode.textContent = title;
    else titleNode.remove();
    return header;
  }

  async function renderPublicAccount(user, header) {
    if (!header.isConnected) return;
    const login = header.querySelector("#dpPublicLogin");
    const register = header.querySelector("#dpPublicRegister");
    const account = header.querySelector("#dpPublicAccount");
    const logout = header.querySelector("#dpPublicLogout");
    const signedIn = Boolean(user?.id);
    login.hidden = signedIn;
    register.hidden = signedIn;
    account.hidden = !signedIn;
    logout.hidden = !signedIn;
    if (!signedIn) return;

    try {
      const status = await window.DietPlannerAccess?.getAccessStatus?.();
      if (!status || status.accessVerificationFailed || (!status.accountType && !status.isAdmin)) {
        account.href = appBasePath + "login.html";
        account.textContent = "استكمال الحساب";
        return;
      }
      if (status.accountType === "patient") {
        publicAuthSubscription?.unsubscribe?.();
        publicAuthSubscription = null;
        mountPatientHeader({ publicPage: true });
        return;
      }
      if (status.accountType === "professional" || status.isAdmin) {
        const roleHeader = buildHeader();
        const title = (header.querySelector(".dp-public-header__page-title")?.textContent || "").trim();
        const titleNode = roleHeader.querySelector(".dp-app-header__page-title");
        const activeHref = roleHeader.querySelector(".dp-app-header__link.is-active")?.dataset.pageHref;
        if (title && activeHref !== path) titleNode.textContent = title;
        else titleNode.remove();
        const pageActions = header.querySelector(".dp-public-header__page-actions");
        if (pageActions?.childNodes.length) {
          const context = roleHeader.querySelector(".dp-app-header__context");
          context.append(...pageActions.childNodes);
          context.hidden = !context.childNodes.length;
        }
        publicAuthSubscription?.unsubscribe?.();
        publicAuthSubscription = null;
        header.replaceWith(roleHeader);
        document.body.classList.remove("dp-has-public-header");
        document.body.classList.add("dp-has-app-header");
        bindAccountActions();
        return;
      }
      account.href = appBasePath + "login.html";
      account.textContent = "استكمال الحساب";
    } catch (error) {
      console.error("Public header account lookup failed:", error);
    }
  }

  function bindPublicAccountActions(header) {
    header.querySelector("#dpPublicThemeToggle")?.addEventListener("click", () => window.DietPlannerTheme?.toggle?.());
    const logout = header.querySelector("#dpPublicLogout");
    logout?.addEventListener("click", async () => {
      if (logout.disabled) return;
      logout.disabled = true;
      try { await window.DietPlannerAccess?.logout(); }
      catch (error) { console.error("Public header logout failed:", error); logout.disabled = false; }
    });
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase?.auth) {
      renderPublicAccount(null, header);
      return;
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("Public header session lookup failed:", error);
      renderPublicAccount(data?.session?.user || null, header);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => renderPublicAccount(session?.user || null, header));
    publicAuthSubscription = data?.subscription || null;
  }

  function mount() {
    if (!document.body || document.querySelector(".dp-app-header")) return;
    if (path === "patient-portal.html" || path === "professional-directory.html") {
      mountPatientHeader();
      return;
    }
    const placeholder = document.querySelector("[data-dp-app-header]");
    if (placeholder?.dataset.dpHeaderVariant === "public") {
      const title = (placeholder.dataset.pageTitle || "").trim();
      const publicHeader = buildPublicHeader(title);
      placeholder.replaceWith(publicHeader);
      const actions = document.querySelector("[data-dp-page-actions]");
      if (actions) {
        const slot = publicHeader.querySelector(".dp-public-header__page-actions");
        slot.append(...actions.childNodes);
        slot.hidden = !slot.childNodes.length;
        actions.remove();
      }
      bindPublicAccountActions(publicHeader);
      document.body.classList.add("dp-has-public-header");
      return;
    }
    const header = buildHeader();
    const context = header.querySelector(".dp-app-header__context");
    if (placeholder) {
      const title = (placeholder.dataset.pageTitle || titles[path] || document.title.split("|")[0].trim()).trim();
      const activeHref = header.querySelector(".dp-app-header__link.is-active")?.dataset.pageHref;
      const isCurrentNavigationPage = activeHref === path || (path === "index.html" && activeHref === "app.html");
      const pageTitle = header.querySelector(".dp-app-header__page-title");
      if (title && !isCurrentNavigationPage) pageTitle.textContent = title;
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
      const activeHref = header.querySelector(".dp-app-header__link.is-active")?.dataset.pageHref;
      const isCurrentNavigationPage = activeHref === path || (path === "index.html" && activeHref === "app.html");
      const pageTitle = header.querySelector(".dp-app-header__page-title");
      if (title && !isCurrentNavigationPage) pageTitle.textContent = title;
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