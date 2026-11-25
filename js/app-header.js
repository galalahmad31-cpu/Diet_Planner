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
    ["quickcalc.html", "الحاسبة السريعة", "fa-calculator"],
    ["contact.html", "تواصل معنا", "fa-headset"]
  ];
  // Patient navigation: keep this list as the single source of truth.
  // Internal portal sections remain in patient-portal.html; standalone destinations keep their own pages.
  const patientPages = [
    ["patient-portal.html#portalHome", "الرئيسية", "fa-house"],
    ["patient-health.html", "الملف الصحي", "fa-heart-pulse"],
    ["communications.html", "التواصل مع المختص", "fa-comments"],
    ["professional-directory.html", "دليل المختصين", "fa-user-doctor"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["books.html", "مكتبة الكتب", "fa-book-open"],
    ["patient-portal.html#portalTools", "أدوات التغذية", "fa-calculator"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"],
    ["patient-portal.html#portalProfileArea", "الصفحة الشخصية", "fa-user"],
    ["contact.html", "تواصل معنا", "fa-headset"]
  ];
  // Professional navigation is the single source of truth for all professional pages.
  // Keep the requested order; the shared six-column grid wraps naturally into rows of six.
  const professionalPages = [
    ["app.html", "الرئيسية", "fa-house"],
    ["patient.html", "قائمة المرضى", "fa-user-group"],
    ["communications.html", "التواصل مع المرضى", "fa-comments"],
    ["food.html", "مكتبة الأغذية", "fa-apple-whole"],
    ["diet.html", "مكتبة الدايت", "fa-layer-group"],
    ["products.html", "المنتجات الغذائية", "fa-box-open"],
    ["recipe.html", "الوصفات الصحية", "fa-bowl-food"],
    ["article.html", "المقالات", "fa-newspaper"],
    ["books.html", "مكتبة الكتب", "fa-book-open"],
    ["quickcalc.html", "الحاسبة السريعة", "fa-calculator"],
    ["finance.html", "اشتراكات المرضى", "fa-wallet"],
    ["notifications.html", "الإشعارات", "fa-bell"],
    
    ["profile.html", "الصفحة الشخصية", "fa-user"],
    ["professional-directory-manage.html", "الملف المهني", "fa-id-card"],
    ["jobs.html", "الوظائف الطبية", "fa-briefcase"],
    ["about.html", "عن المنصة", "fa-circle-info"],
    ["feedback.html", "شاركنا رأيك", "fa-comment-dots"],
    ["contact.html", "تواصل معنا", "fa-headset"]
  ];
  const adminPage = ["admin.html", "الإدارة", "fa-shield-halved"];
  const publicPaths = new Set([...publicPages.map(([href]) => href), "article-view.html", "privacy.html", "job.html", "contact.html"]);
  const titles = {
    "patient-profile.html":"ملف المريض", "patient-health.html":"الملف الصحي", "visit.html":"الخطة الغذائية",
    "nutritionsupport-patient.html":"الدعم الغذائي", "admin.html":"لوحة الإدارة",
    "article-view.html":"المقال", "privacy.html":"سياسة الخصوصية", "job.html":"تفاصيل الوظيفة", "contact.html":"تواصل معنا"
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
  const isPatientRoute = () => path === "patient-portal.html" || path === "patient-health.html";
  const isPublicRoute = () => publicPaths.has(path) || path === "professional-directory.html" ||
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

  function setCollapsed(header, collapsed, persist = true) {
    header.classList.toggle("is-collapsed", collapsed);
    const toggle = header.querySelector(".dp-app-header__collapse-toggle");
    if (toggle) {
      const actionLabel = collapsed ? "عرض باقي التبويبات" : "طي القائمة";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", actionLabel);
      toggle.title = actionLabel;
    }
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
    if (href === "contact.html") link.dataset.headerKey = "contact";
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
      header.innerHTML = `
      <div class="dp-app-header__brand-row">
        <div class="dp-app-header__brand">
          <a class="dp-app-header__logo-link" href="${base + homeHref}" aria-label="Diet Planner - الرئيسية">
            <span class="dp-app-header__logo" aria-hidden="true"><i class="fa-solid fa-leaf"></i></span>
          </a>
          <div class="dp-app-header__brand-copy">
            <strong>Diet Planner</strong>
          </div>
        </div>
        <button class="dp-app-header__collapse-toggle" type="button" aria-expanded="true" aria-controls="dp-app-header-track" aria-label="طي القائمة" title="طي القائمة"><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
        <div class="dp-app-header__account">
          <a class="dp-app-header__account-link dp-app-header__login" href="${base}login.html">تسجيل الدخول</a>
          <a class="dp-app-header__account-link dp-app-header__register" href="${base}login.html#register">إنشاء حساب</a>
          <button type="button" class="dp-app-header__account-link dp-app-header__logout" aria-label="تسجيل الخروج" title="تسجيل الخروج" hidden><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i></button>
          <button type="button" class="dp-app-header__theme" aria-label="تغيير المظهر" title="تغيير المظهر"><i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i></button>
        </div>
      </div>
      <nav class="dp-app-header__nav" id="dp-app-header-nav" aria-label="التنقل الرئيسي">
        <div class="dp-app-header__track" id="dp-app-header-track"></div>
      </nav>
      <div class="dp-app-header__page-title"></div>
      <div class="dp-app-header__context" hidden></div>`;
    const track = header.querySelector(".dp-app-header__track");
    const items = role === "patient" ? patientPages : role === "professional" ? (isAdmin ? [...professionalPages, adminPage] : professionalPages) : publicPages;
    items.forEach(item => track.append(makeLink(item, role)));
    header.addEventListener("click", event => {
      if (event.target.closest("a, button, input, select, textarea, [role=button], .dp-app-header__link, .dp-app-header__brand-copy")) return;
      setCollapsed(header, !header.classList.contains("is-collapsed"));
    });
    header.querySelector(".dp-app-header__collapse-toggle").addEventListener("click", () => {
      setCollapsed(header, !header.classList.contains("is-collapsed"));
    });
    header.addEventListener("keydown", event => {
      if (event.target !== header || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      setCollapsed(header, !header.classList.contains("is-collapsed"));
    });
    setCollapsed(header, getSavedCollapsedState(), false);
    track.addEventListener("click", async event => {
      const link = event.target.closest(".dp-app-header__link");
      if (!link) return;
      const href = link.dataset.headerHref;
      if (href.includes("#") && path === "patient-portal.html") {
        const section = href.split("#")[1];
        const navigate = window.DietPlannerPatientPortal?.navigateToSection;
        // Keep native hash navigation as a safe fallback until the portal router is ready.
        if (typeof navigate !== "function") {
          console.warn("Patient portal navigation is not ready; using the page route.");
          return;
        }
        event.preventDefault();
        track.querySelectorAll(".dp-app-header__link").forEach(node => {
          const active = node === link;
          node.classList.toggle("is-active", active);
          if (active) node.setAttribute("aria-current", "page");
          else node.removeAttribute("aria-current");
        });
        try {
          await navigate(section);
          history.replaceState(null, "", location.pathname + location.search + "#" + section);
        } catch (error) {
          console.error("Patient portal navigation failed; falling back to page navigation:", error);
          window.location.assign(link.href);
        }
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

  function notificationDateKey(value) {
    const key = String(value ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  }

  function notificationDaysUntil(target, reference) {
    const a = notificationDateKey(target);
    const b = notificationDateKey(reference);
    if (!a || !b) return NaN;
    return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
  }

  function notificationAddMonths(value, months) {
    const key = notificationDateKey(value);
    const count = Number(months);
    if (!key || !Number.isFinite(count) || count === 0) return "";
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setMonth(date.getMonth() + count);
    if (!Number.isFinite(date.getTime())) return "";
    if (date.getDate() !== day) date.setDate(0);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function buildCalculatedNotificationRows(rows, userId) {
    const now = new Date();
    const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
    const records = [];
    (rows || []).forEach(row => {
      const patientId = row.patient_id;
      if (!patientId) return;
      const followUpDate = notificationDateKey(row.next_follow_up_date);
      if (followUpDate) {
        const days = notificationDaysUntil(followUpDate, today);
        if (days === 0 || days === 1) {
          const isToday = days === 0;
          records.push({
            recipient_id: userId,
            patient_id: patientId,
            actor_id: null,
            event_type: isToday ? "calculated_follow_up_today" : "calculated_follow_up_tomorrow",
            title: isToday ? "موعد المتابعة اليوم" : "موعد المتابعة غدًا",
            body: isToday ? "المريض لديه موعد متابعة اليوم." : "المريض لديه موعد متابعة غدًا.",
            source_key: `follow_up:${patientId}:${followUpDate}`
          });
        }
      }

      const endDate = notificationDateKey(row.subscription_end_date) ||
        notificationAddMonths(row.subscription_start_date, row.subscription_months);
      if (!endDate) return;
      const days = notificationDaysUntil(endDate, today);
      if (days < -7 || days > 7) return;

      let title;
      let body;
      if (days < 0) {
        title = "انتهى اشتراك المريض";
        body = `انتهى الاشتراك منذ ${Math.abs(days)} ${Math.abs(days) === 1 ? "يوم" : "أيام"}. يُرجى التواصل مع المريض لتجديد الاشتراك واستمرار المتابعة.`;
      } else if (days === 0) {
        title = "الاشتراك ينتهي اليوم";
        body = "ينتهي اشتراك المريض اليوم. يُرجى التواصل معه لتجديد الاشتراك واستمرار المتابعة.";
      } else if (days === 1) {
        title = "الاشتراك يقترب من الانتهاء";
        body = "يتبقى يوم واحد على انتهاء الاشتراك. يُفضّل التواصل مع المريض لتجديد الاشتراك قبل انتهائه.";
      } else {
        title = "الاشتراك يقترب من الانتهاء";
        body = `يتبقى ${days} أيام على انتهاء الاشتراك. يُفضّل التواصل مع المريض مسبقًا لتجديد الاشتراك.`;
      }
      records.push({
        recipient_id: userId,
        patient_id: patientId,
        actor_id: null,
        event_type: "calculated_subscription",
        title,
        body,
        source_key: `subscription:${patientId}:${endDate}:${today}`
      });
    });
    return records;
  }

  async function syncCalculatedNotifications(supabase, user) {
    const { data: financeRows, error: financeError } = await supabase
      .from("patient_finances")
      .select("patient_id,subscription_end_date,next_follow_up_date,subscription_start_date,subscription_months")
      .eq("user_id", user.id);
    if (financeError) throw financeError;

    const records = buildCalculatedNotificationRows(financeRows, user.id);
    const activeKeys = new Set(records.map(item => item.source_key));
    if (records.length) {
      const { error } = await supabase.from("notifications")
        .upsert(records, { onConflict: "recipient_id,source_key", ignoreDuplicates: true });
      if (error) throw error;
    }

    const { data: existing, error: existingError } = await supabase
      .from("notifications")
      .select("id,source_key")
      .eq("recipient_id", user.id)
      .in("event_type", ["calculated_follow_up_today", "calculated_follow_up_tomorrow", "calculated_subscription"]);
    if (existingError) throw existingError;

    const staleIds = (existing || []).filter(item => !activeKeys.has(item.source_key)).map(item => item.id);
    if (staleIds.length) {
      const { error } = await supabase.from("notifications")
        .delete().eq("recipient_id", user.id).in("id", staleIds);
      if (error) throw error;
    }
    return records;
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
    const link = document.getElementById("dpNotificationLink");
    if (link) link.hidden = false;

    const refresh = async () => {
      try {
        await syncCalculatedNotifications(supabase, user);
        const { count, error } = await supabase.from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", user.id).is("read_at", null);
        if (error) throw error;
        const badge = document.getElementById("dpNotificationBadge");
        const currentLink = document.getElementById("dpNotificationLink");
        if (!currentLink || !badge) return;
        const total = Number(count || 0);
        badge.textContent = total > 99 ? "99+" : String(total);
        badge.hidden = total === 0;
        currentLink.setAttribute("aria-label", total ? `الإشعارات، ${total} تنبيه` : "الإشعارات");
      } catch (error) {
        console.error("Notification badge sync failed:", error);
      }
    };

    if (notificationUserId !== user.id) {
      if (notificationChannel) await supabase.removeChannel(notificationChannel);
      notificationUserId = user.id;
      notificationChannel = supabase.channel(`dp-header-notifications-${user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_id=eq.${user.id}` }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "patient_finances", filter: `user_id=eq.${user.id}` }, refresh)
        .subscribe();
    }
    await refresh();
  }

  window.DPNotificationStore = {
    sync: async user => {
      const supabase = access()?.supabaseClient;
      if (!supabase || !user?.id) throw new Error("تعذر تحديد حساب المستخدم.");
      await syncCalculatedNotifications(supabase, user);
    }
  };

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

    const placeholders = [...document.querySelectorAll("[data-dp-app-header], [data-dp-patient-header]")];
    const existingHeaders = [...document.querySelectorAll(".dp-app-header")];
    const actions = findPageActions();
    const pageTitle = (
      placeholders[0]?.dataset.pageTitle ||
      titles[path] ||
      document.title.split("|")[0].trim()
    ).trim();

    const header = buildHeader({
      role,
      signedIn: Boolean(user?.id),
      isAdmin: isAdmin === true,
      title: pageTitle,
      pageActions: actions
    });

    // Always mount the shared header at the document level.
    // Page placeholders may be nested inside constrained <main> containers.
    // Keeping the header outside page layout wrappers guarantees identical
    // width, alignment and spacing across every route.
    document.body.insertBefore(header, document.body.firstChild);

    placeholders.forEach(node => node.remove());
    existingHeaders.forEach(node => node.remove());
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