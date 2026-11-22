/* Diet Planner — unified role-aware header.
   One renderer, one navigation layout, role-specific tab configuration. */
(() => {
  "use strict";
  if (window.__DP_APP_HEADER__) return;
  window.__DP_APP_HEADER__ = true;

  const path = decodeURIComponent(location.pathname.split("/").pop() || "index.html");
  const base = location.hostname === "galalahmad31-cpu.github.io" ? "/Diet_Planner/" : "/";
  const publicPages = [
    ["index.html", "الرئيسية", "fa-house"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["books.html", "مكتبة الكتب", "fa-book-open"],
    ["about.html", "عن المنصة", "fa-circle-info"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"],
    ["jobs.html", "الوظائف الطبية", "fa-briefcase"],
    ["quickcalc.html", "الحاسبة السريعة", "fa-calculator"]
  ];
  // Patient navigation: keep this list as the single source of truth.
  // Internal portal sections remain in patient-portal.html; standalone destinations keep their own pages.
  const patientPages = [
    ["patient-portal.html#portalHome", "الرئيسية", "fa-house"],
    ["patient-portal.html#portalContent", "الملف الصحي", "fa-heart-pulse"],
    ["professional-directory.html", "دليل المختصين", "fa-user-doctor"],
    ["patient-portal.html#portalDietBuilder", "صمم نظامك الغذائي", "fa-bowl-food"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["books.html", "مكتبة الكتب", "fa-book-open"],
    ["patient-portal.html#portalTools", "أدوات التغذية", "fa-calculator"],
    ["patient-portal.html#portalProfileArea", "الملف الشخصي", "fa-user"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"]
  ];
  // Professional navigation is the single source of truth for all professional pages.
  // Keep the requested order; the shared six-column grid wraps naturally into rows of six.
  const professionalPages = [
    ["app.html", "الرئيسية", "fa-house"],
    ["patient.html", "قائمة المرضى", "fa-user-group"],
    ["food.html", "مكتبة الأغذية", "fa-apple-whole"],
    ["diet.html", "مكتبة الدايت", "fa-layer-group"],
    ["products.html", "المنتجات الغذائية", "fa-box-open"],
    ["recipe.html", "الوصفات الصحية", "fa-bowl-food"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["books.html", "مكتبة الكتب", "fa-book-open"],
    ["quickcalc.html", "الحاسبة السريعة", "fa-calculator"],
    ["finance.html", "اشتراكات المرضى", "fa-wallet"],
    ["notifications.html", "الإشعارات", "fa-bell"],
    ["professional-communication.html", "التواصل مع المرضى", "fa-comments"],
    ["profile.html", "الصفحة الشخصية", "fa-user"],
    ["professional-directory-manage.html", "الملف المهني", "fa-id-card"],
    ["jobs.html", "الوظائف الطبية", "fa-briefcase"],
    ["about.html", "عن المنصة", "fa-circle-info"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"]
  ];
  const adminPage = ["admin.html", "الإدارة", "fa-shield-halved"];
  const publicPaths = new Set([...publicPages.map(([href]) => href), "article-view.html", "privacy.html", "job.html"]);
  const titles = {
    "patient-profile.html":"ملف المريض", "visit.html":"الخطة الغذائية",
    "nutritionsupport-patient.html":"الدعم الغذائي", "admin.html":"لوحة الإدارة",
    "article-view.html":"المقال", "privacy.html":"سياسة الخصوصية", "job.html":"تفاصيل الوظيفة"
  };
  let notificationChannel = null;
  let notificationUserId = null;
  let renderRevision = 0;
  const HEADER_STATE_KEY = "dp-app-header-card-state";

  function getSavedCollapsedState() {
    try { return localStorage.getItem(HEADER_STATE_KEY) === "collapsed"; }
    catch { return false; }
  }

  if (new URLSearchParams(location.search).get("embed") === "1" ||
      document.documentElement.classList.contains("visit-embedded") ||
      document.documentElement.classList.contains("nsp-embedded")) return;

  const access = () => window.DietPlannerAccess;
  const isPatientRoute = () => path === "patient-portal.html" || path === "professional-directory.html";
  const isPublicRoute = () => publicPaths.has(path) ||
    document.querySelector('[data-dp-app-header][data-dp-header-variant="public"]');

  function activeFor(href, role) {
    const target = href.split("#")[0];
    if (href.includes("#")) {
      const fragment = href.split("#")[1];
      if (role === "patient") {
        return path === "patient-portal.html" &&
          (location.hash === "#" + fragment || (!location.hash && fragment === "portalHome"));
      }
      return role === "professional" && path === target && location.hash === "#" + fragment;
    }
    if (path === target) {
      return true;
    }
    if (role === "professional" &&
        ((path === "patient-profile.html" && target === "patient.html") ||
         (path === "visit.html" && target === "diet.html") ||
         (path === "article-view.html" && target === "article.html") ||
         (path === "job.html" && target === "jobs.html"))) return true;
    return false;
  }

  function setCollapsed(header, trigger, collapsed, persist = true) {
    header.classList.toggle("is-collapsed", collapsed);
    trigger.setAttribute("aria-expanded", String(!collapsed));
    trigger.setAttribute("aria-label", collapsed ? "فتح بقية روابط الهيدر" : "طي بقية روابط الهيدر");
    if (persist) {
      try { localStorage.setItem(HEADER_STATE_KEY, collapsed ? "collapsed" : "expanded"); }
      catch (error) { console.warn("Could not save header display preference:", error); }
    }
  }

  function makeLink(item, role) {
    const [href, label, icon] = item;
    const link = document.createElement("a");
    link.className = "dp-app-header__link";
    link.href = base + href;
    link.dataset.headerHref = href;
    link.innerHTML = '<i class="fa-solid ' + icon + '" aria-hidden="true"></i><span></span>';
    link.querySelector("span").textContent = label;
    if (activeFor(href, role)) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
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
    return link;
  }

  function buildHeader({ role, signedIn, isAdmin, title, pageActions }) {
    const header = document.createElement("header");
    header.className = "dp-app-header no-print";
    header.dataset.accountRole = role;
    header.dir = "rtl";
    const homeHref = role === "patient" ? "patient-portal.html" : role === "professional" ? "app.html" : "index.html";
    const subtitle = role === "patient" ? "مساحة المريض" : role === "professional" ? "مساحة المختص" : "منصة التغذية العلاجية";
    header.innerHTML = `
      <div class="dp-app-header__brand-row">
        <div class="dp-app-header__brand">
          <a class="dp-app-header__logo-link" href="${base + homeHref}" aria-label="Diet Planner - الرئيسية">
            <span class="dp-app-header__logo" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
          </a>
          <button class="dp-app-header__brand-copy" type="button" aria-controls="dp-app-header-nav" aria-expanded="true">
            <strong>Diet Planner</strong><small>${subtitle}</small>
          </button>
        </div>
        <div class="dp-app-header__account">
          <a class="dp-app-header__account-link dp-app-header__login" href="${base}login.html">تسجيل الدخول</a>
          <a class="dp-app-header__account-link dp-app-header__register" href="${base}login.html#register">إنشاء حساب</a>
          <a class="dp-app-header__account-link dp-app-header__my-account" href="${base + homeHref}" hidden>حسابي</a>
          <button type="button" class="dp-app-header__account-link dp-app-header__logout" hidden><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i><span>تسجيل الخروج</span></button>
          <button type="button" class="dp-app-header__theme" aria-label="تغيير المظهر" title="تغيير المظهر"><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i></button>
        </div>
      </div>
      <nav class="dp-app-header__nav" id="dp-app-header-nav" aria-label="التنقل الرئيسي">
        <div class="dp-app-header__track" id="dp-app-header-track"></div>
      </nav>
      <div class="dp-app-header__page-title"></div>
      <div class="dp-app-header__context" hidden></div>`;
    const track = header.querySelector(".dp-app-header__track");
    const collapseTrigger = header.querySelector(".dp-app-header__brand-copy");
    const items = role === "patient" ? patientPages : role === "professional" ? (isAdmin ? [...professionalPages, adminPage] : professionalPages) : publicPages;
    items.forEach(item => track.append(makeLink(item, role)));
    collapseTrigger.addEventListener("click", () => {
      setCollapsed(header, collapseTrigger, collapseTrigger.getAttribute("aria-expanded") === "true");
    });
    header.addEventListener("click", event => {
      // Any non-control green surface toggles the header. Links and controls keep their own actions.
      if (event.target.closest("a, button, input, select, textarea, [role=\'button\'], .dp-app-header__link")) return;
      setCollapsed(header, collapseTrigger, !header.classList.contains("is-collapsed"));
    });
    setCollapsed(header, collapseTrigger, getSavedCollapsedState(), false);
    track.addEventListener("click", event => {
      const link = event.target.closest(".dp-app-header__link");
      if (!link) return;
      const href = link.dataset.headerHref;
      if (role === "patient" && href.includes("#") && path === "patient-portal.html") {
        event.preventDefault();
        const section = href.split("#")[1];
        window.DietPlannerPatientPortal?.navigateToSection(section);
        history.replaceState(null, "", location.pathname + "#" + section);
        track.querySelectorAll(".dp-app-header__link").forEach(node => {
          const active = node === link;
          node.classList.toggle("is-active", active);
          if (active) node.setAttribute("aria-current", "page");
          else node.removeAttribute("aria-current");
        });
      }
    });
    header.querySelector(".dp-app-header__theme").addEventListener("click", () => window.DietPlannerTheme?.toggle?.());
    const logout = header.querySelector(".dp-app-header__logout");
    logout.addEventListener("click", async () => {
      if (logout.disabled) return;
      logout.disabled = true;
      try { await access()?.logout(); }
      catch (error) { console.error("Header logout failed:", error); logout.disabled = false; }
    });
    header.querySelector(".dp-app-header__login").hidden = signedIn;
    header.querySelector(".dp-app-header__register").hidden = signedIn;
    header.querySelector(".dp-app-header__my-account").hidden = !signedIn;
    logout.hidden = !signedIn;

    const pageTitle = header.querySelector(".dp-app-header__page-title");
    const currentItem = items.find(item => activeFor(item[0], role));
    if (title && !currentItem) pageTitle.textContent = title;
    else pageTitle.remove();

    const context = header.querySelector(".dp-app-header__context");
    if (pageActions?.childNodes?.length) {
      context.append(...pageActions.childNodes);
      context.hidden = !context.childNodes.length;
    }
    return header;
  }

  async function syncNotificationBadge(user) {
    const supabase = access()?.supabaseClient;
    if (!supabase || !user?.id) {
      const link = document.getElementById("dpNotificationLink");
      const badge = document.getElementById("dpNotificationBadge");
      if (link) link.hidden = true;
      if (badge) badge.hidden = true;
      return;
    }
    const currentLink = document.getElementById("dpNotificationLink");
    if (currentLink) currentLink.hidden = false;
    const refresh = async () => {
      const { count, error } = await supabase.from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", user.id).is("read_at", null);
      if (error) { console.error("Notification badge lookup failed:", error); return; }
      const link = document.getElementById("dpNotificationLink");
      const badge = document.getElementById("dpNotificationBadge");
      if (!link || !badge) return;
      const unread = Number(count || 0);
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.hidden = unread === 0;
      link.setAttribute("aria-label", unread ? `الإشعارات، ${unread} غير مقروء` : "الإشعارات");
    };
    if (notificationUserId !== user.id) {
      if (notificationChannel) await supabase.removeChannel(notificationChannel);
      notificationUserId = user.id;
      notificationChannel = supabase.channel(`dp-header-notifications-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` }, refresh)
        .subscribe();
    }
    await refresh();
  }

  async function clearNotificationBadge() {
    const link = document.getElementById("dpNotificationLink");
    const badge = document.getElementById("dpNotificationBadge");
    const supabase = access()?.supabaseClient;
    if (link) link.hidden = true;
    if (badge) badge.hidden = true;
    if (notificationChannel && supabase) await supabase.removeChannel(notificationChannel);
    notificationChannel = null;
    notificationUserId = null;
  }

  async function resolveAccount(user) {
    if (!user?.id) return { role: "guest", isAdmin: false };
    try {
      const status = await access()?.getAccessStatus?.();
      if (status?.accountType === "patient") return { role: "patient", isAdmin: false };
      if (status?.accountType === "professional" || status?.isAdmin === true) {
        return { role: "professional", isAdmin: status.isAdmin === true };
      }
    } catch (error) {
      console.error("Header account type lookup failed:", error);
    }
    return { role: isPatientRoute() ? "patient" : "professional", isAdmin: false };
  }

  function findPageActions() {
    const explicit = document.querySelector("[data-dp-page-actions]");
    if (explicit) return explicit;
    return document.querySelector(".dp-public-header__page-actions, .dp-patient-header__page-actions, .dp-app-header__context");
  }

  function mountHeader(role, user, revision, isAdmin) {
    if (revision !== renderRevision || !document.body) return;
    const placeholder = document.querySelector("[data-dp-app-header], [data-dp-patient-header]");
    const existing = document.querySelector(".dp-app-header");
    const actions = findPageActions();
    const pageTitle = (placeholder?.dataset.pageTitle || titles[path] || document.title.split("|")[0].trim()).trim();
    const header = buildHeader({ role, signedIn: Boolean(user?.id), isAdmin: isAdmin === true, title: pageTitle, pageActions: actions });
    if (placeholder) placeholder.replaceWith(header);
    else if (existing) existing.replaceWith(header);
    else document.body.insertBefore(header, document.querySelector("main") || document.body.firstChild);
    actions?.remove();
    document.body.classList.toggle("dp-has-app-header", true);
    document.body.classList.toggle("dp-has-public-header", false);
    if (user?.id) void syncNotificationBadge(user);
    else void clearNotificationBadge();
  }

  async function renderForSession(user) {
    const revision = ++renderRevision;
    const account = await resolveAccount(user);
    if (revision !== renderRevision) return;
    const publicRoute = isPublicRoute();
    const selectedRole = user?.id ? account.role : (publicRoute ? "guest" : (isPatientRoute() ? "patient" : "professional"));
    mountHeader(selectedRole, user, revision, Boolean(user?.id && account.isAdmin && selectedRole === "professional"));
  }

  async function initialize() {
    if (!document.body) return;
    const supabase = access()?.supabaseClient;
    if (!supabase?.auth) {
      await renderForSession(null);
      return;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error("Header session lookup failed:", error);
    await renderForSession(data?.session?.user || null);
    supabase.auth.onAuthStateChange((_event, session) => {
      queueMicrotask(() => void renderForSession(session?.user || null));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    void initialize();
  }
})();