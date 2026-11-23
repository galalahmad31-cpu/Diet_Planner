(() => {
  "use strict";

  const EVENT_ICONS = {
    nutrition_plan_published: "fa-bowl-food",
    message_received: "fa-comment-dots",
    connection_request_received: "fa-user-plus",
    connection_request_accepted: "fa-user-check",
    connection_request_declined: "fa-user-xmark",
    followup_activated: "fa-calendar-check",
    followup_ended: "fa-calendar-xmark"
  };

  const VISIBLE_EVENT_TYPES = Object.keys(EVENT_ICONS);
  const REMINDER_WINDOW_DAYS = 7;

  let client = null;
  let channel = null;
  let recipientId = null;
  let root = null;
  let busy = false;
  let clickHandlerAttached = false;
  let loadSequence = 0;

  const $ = (selector) => root?.querySelector(selector);

  function setStatus(message) {
    const status = $("[data-patient-notification-status]");
    if (status) status.textContent = message || "";
    const empty = $("[data-patient-notification-empty]");
    if (empty && message) empty.hidden = true;
  }

  function dateKey(value) {
    if (!value) return "";
    const key = String(value).slice(0, 10);
    return /^\\d{4}-\\d{2}-\\d{2}$/.test(key) ? key : "";
  }

  function todayKey() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function daysBetween(target, base) {
    const targetDate = new Date(target + "T00:00:00");
    const baseDate = new Date(base + "T00:00:00");
    if (Number.isNaN(targetDate.getTime()) || Number.isNaN(baseDate.getTime())) return null;
    return Math.round((targetDate - baseDate) / 86400000);
  }

  function formatDate(value) {
    const key = dateKey(value);
    if (!key) return "";
    const date = new Date(key + "T00:00:00");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ar-EG", { dateStyle: "medium" });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })
      : "";
  }

  function getDestination(type) {
    if (type === "nutrition_plan_published") return "portalPlansPanel";
    return "portalCommunicationPanel";
  }

  function buildReminders(finances) {
    const today = todayKey();
    const reminders = [];

    (finances || []).forEach((finance) => {
      const patientId = finance.patient_id;
      const followUpDate = dateKey(finance.next_follow_up_date);
      const subscriptionEnd = dateKey(finance.subscription_end_date);

      if (followUpDate) {
        const days = daysBetween(followUpDate, today);
        if (days !== null && days >= 0 && days <= REMINDER_WINDOW_DAYS) {
          const label = days === 0
            ? "موعد المتابعة اليوم"
            : days === 1
              ? "موعد المتابعة غدًا"
              : "موعد المتابعة بعد " + days.toLocaleString("ar-EG") + " أيام";

          reminders.push({
            id: "followup:" + patientId + ":" + followUpDate,
            computed: true,
            event_type: "follow_up_reminder",
            title: label,
            body: "لديك موعد متابعة قادم في ملفك الصحي.",
            created_at: followUpDate + "T00:00:00",
            read_at: null,
            destination: "portalFinancePanel",
            reminder_date: followUpDate
          });
        }
      }

      if (subscriptionEnd) {
        const days = daysBetween(subscriptionEnd, today);
        if (days === null) return;

        if (days >= 0 && days <= REMINDER_WINDOW_DAYS) {
          const label = days === 0
            ? "ينتهي اشتراكك اليوم"
            : days === 1
              ? "ينتهي اشتراكك غدًا"
              : "يتبقى " + days.toLocaleString("ar-EG") + " أيام على انتهاء الاشتراك";

          reminders.push({
            id: "subscription:" + patientId + ":" + subscriptionEnd,
            computed: true,
            event_type: "subscription_reminder",
            title: label,
            body: "راجع تفاصيل الاشتراك في ملفك الصحي وتواصل مع المختص عند الحاجة.",
            created_at: subscriptionEnd + "T00:00:00",
            read_at: null,
            destination: "portalFinancePanel",
            reminder_date: subscriptionEnd
          });
        } else if (days < 0) {
          reminders.push({
            id: "subscription:" + patientId + ":" + subscriptionEnd,
            computed: true,
            event_type: "subscription_expired",
            title: "انتهى اشتراكك",
            body: "انتهت مدة الاشتراك المسجلة في هذا الملف الصحي. تواصل مع المختص بشأن استمرار المتابعة.",
            created_at: subscriptionEnd + "T00:00:00",
            read_at: null,
            destination: "portalFinancePanel",
            reminder_date: subscriptionEnd
          });
        }
      }
    });

    return reminders;
  }

  async function loadPatientReminders() {
    const { data: accounts, error: accountsError } = await client
      .from("patient_accounts")
      .select("patient_id")
      .eq("user_id", recipientId)
      .eq("status", "active");

    if (accountsError) throw accountsError;

    const patientIds = [...new Set((accounts || []).map(row => row.patient_id).filter(Boolean))];
    if (!patientIds.length) return [];

    const { data: finances, error: financeError } = await client
      .from("patient_finances")
      .select("patient_id,next_follow_up_date,subscription_end_date")
      .in("patient_id", patientIds);

    if (financeError) throw financeError;
    return buildReminders(finances || []);
  }

  function render(items) {
    const list = $("[data-patient-notification-list]");
    const count = $("[data-patient-notification-count]");
    const empty = $("[data-patient-notification-empty]");
    const markAll = $("[data-patient-notification-read-all]");
    if (!list || !count || !empty || !markAll) {
      throw new Error("عناصر واجهة الإشعارات غير مكتملة في صفحة المريض.");
    }

    const unreadCount = items.filter(item => !item.read_at).length;
    count.textContent = unreadCount.toLocaleString("ar-EG");
    count.hidden = unreadCount === 0;
    markAll.hidden = !items.some(item => !item.read_at && !item.computed);
    empty.hidden = items.length > 0;
    empty.textContent = "لا توجد إشعارات أو تنبيهات حاليًا.";
    list.replaceChildren();

    items.forEach(item => {
      const card = document.createElement("article");
      card.className = "patient-notification-item" + (item.read_at ? "" : " is-unread");

      const icon = document.createElement("span");
      icon.className = "patient-notification-icon";
      const glyph = document.createElement("i");
      glyph.className = "fa-solid " + (item.computed
        ? item.event_type === "follow_up_reminder" ? "fa-calendar-check" : "fa-credit-card"
        : EVENT_ICONS[item.event_type] || "fa-bell");
      icon.append(glyph);

      const content = document.createElement("div");
      content.className = "patient-notification-content";
      const heading = document.createElement("div");
      heading.className = "patient-notification-heading";
      const title = document.createElement("strong");
      title.textContent = item.title || "إشعار جديد";
      heading.append(title);

      if (!item.read_at) {
        const fresh = document.createElement("span");
        fresh.className = "patient-notification-new";
        fresh.textContent = item.computed ? "تنبيه" : "جديد";
        heading.append(fresh);
      }

      const body = document.createElement("p");
      body.textContent = item.body || "";
      const time = document.createElement("time");
      time.dateTime = item.computed ? item.reminder_date || "" : item.created_at || "";
      time.textContent = item.computed
        ? formatDate(item.reminder_date)
        : formatDateTime(item.created_at);
      content.append(heading, body, time);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "patient-notification-open";
      if (item.computed) {
        open.dataset.openPatientReminder = item.destination;
        open.textContent = "عرض بيانات الاشتراك والمتابعة";
      } else {
        open.dataset.openPatientNotification = item.id;
        open.dataset.destination = getDestination(item.event_type);
        open.textContent = "عرض التفاصيل";
      }

      card.append(icon, content, open);
      list.append(card);
    });

    setStatus("");
  }

  async function load() {
    if (!client || !recipientId || !root) {
      throw new Error("لم يتم تهيئة اتصال الإشعارات أو حساب المريض.");
    }

    const sequence = ++loadSequence;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    try {
      const [eventResult, reminders] = await Promise.all([
        client
          .from("notifications")
          .select("id,event_type,title,body,created_at,read_at")
          .eq("recipient_id", recipientId)
          .in("event_type", VISIBLE_EVENT_TYPES)
          .order("created_at", { ascending: false })
          .limit(50)
          .abortSignal(controller.signal),
        loadPatientReminders()
      ]);

      if (eventResult.error) throw eventResult.error;
      if (sequence !== loadSequence) return;

      const events = (eventResult.data || []).map(item => ({ ...item, computed: false }));
      const combined = [...events, ...reminders].sort((a, b) => {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime;
      });
      render(combined);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("استغرق الاتصال بقاعدة البيانات وقتًا أطول من المعتاد. تحقق من الاتصال ثم أعد تحميل الصفحة.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function markRead(id) {
    const { error } = await client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("recipient_id", recipientId)
      .is("read_at", null);

    if (error) throw error;
  }

  async function markAllRead() {
    if (busy) return;
    busy = true;
    const button = $("[data-patient-notification-read-all]");
    if (button) button.disabled = true;

    try {
      const { error } = await client
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", recipientId)
        .in("event_type", VISIBLE_EVENT_TYPES)
        .is("read_at", null);

      if (error) throw error;
      await load();
    } catch (error) {
      console.error("Patient notifications mark-all failed:", error);
      setStatus("تعذر تحديث الإشعارات. حاول مرة أخرى.");
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  }

  async function handleClick(event) {
    const markAllButton = event.target.closest("[data-patient-notification-read-all]");
    if (markAllButton) {
      await markAllRead();
      return;
    }

    const reminderButton = event.target.closest("[data-open-patient-reminder]");
    if (reminderButton && !busy) {
      await window.DietPlannerPatientPortal?.navigateToSection(reminderButton.dataset.openPatientReminder);
      return;
    }

    const openButton = event.target.closest("[data-open-patient-notification]");
    if (!openButton || busy) return;

    busy = true;
    openButton.disabled = true;

    try {
      await markRead(openButton.dataset.openPatientNotification);
      await load();
      await window.DietPlannerPatientPortal?.navigateToSection(openButton.dataset.destination);
    } catch (error) {
      console.error("Patient notification action failed:", error);
      setStatus("تعذر فتح الإشعار. حاول مرة أخرى.");
    } finally {
      busy = false;
      openButton.disabled = false;
    }
  }

  function subscribe() {
    if (!recipientId || channel) return;

    channel = client
      .channel("dp-patient-notifications-" + recipientId)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: "recipient_id=eq." + recipientId
      }, () => {
        load().catch(error => {
          console.error("Patient notifications realtime refresh failed:", error);
          setStatus("تعذر تحديث الإشعارات تلقائيًا.");
        });
      })
      .subscribe();
  }

  async function init(container, userId) {
    root = container;
    recipientId = userId;
    client = window.DietPlannerAccess?.supabaseClient || null;

    if (!root) throw new Error("لم يتم العثور على قسم إشعارات المريض.");
    if (!recipientId) throw new Error("تعذر تحديد حساب المريض.");
    if (!client) throw new Error("اتصال قاعدة البيانات غير متاح في صفحة المريض.");

    if (!clickHandlerAttached) {
      root.addEventListener("click", handleClick);
      clickHandlerAttached = true;
    }

    if (channel) {
      await client.removeChannel(channel);
      channel = null;
    }

    setStatus("");
    const empty = $("[data-patient-notification-empty]");
    if (empty) {
      empty.hidden = false;
      empty.textContent = "جاري تحميل الإشعارات...";
    }

    try {
      await load();
      subscribe();
    } catch (error) {
      console.error("Patient notifications initialization failed:", error);
      setStatus(error?.message || "تعذر تحميل الإشعارات حاليًا.");
      throw error;
    }
  }

  window.DietPlannerPatientNotifications = Object.freeze({ init, refresh: load });
})();
