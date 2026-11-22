(() => {
  "use strict";

  const EVENT_ICONS = {
    nutrition_plan_published: "fa-bowl-food",
    appointment_confirmed: "fa-calendar-check",
    appointment_declined: "fa-calendar-xmark",
    appointment_cancelled: "fa-calendar-minus",
    message_received: "fa-comment-dots",
    followup_activated: "fa-circle-check",
    followup_ended: "fa-handshake-slash"
  };

  let client = null;
  let channel = null;
  let recipientId = null;
  let root = null;
  let busy = false;
  let clickHandlerAttached = false;

  const $ = (selector) => root?.querySelector(selector);

  function setStatus(message) {
    const status = $("[data-patient-notification-status]");
    if (status) status.textContent = message || "";
    const empty = $("[data-patient-notification-empty]");
    if (empty && message) empty.hidden = true;
  }

  function formatDate(value) {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })
      : "";
  }

  function getDestination(type) {
    if (type === "nutrition_plan_published") return "portalPlansPanel";
    if (type?.startsWith("appointment_")) return "portalAppointmentsPanel";
    return "portalCommunicationPanel";
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
    markAll.hidden = unreadCount === 0;
    empty.hidden = items.length > 0;
    empty.textContent = "لا توجد إشعارات حتى الآن.";
    list.replaceChildren();

    items.forEach(item => {
      const card = document.createElement("article");
      card.className = "patient-notification-item" + (item.read_at ? "" : " is-unread");

      const icon = document.createElement("span");
      icon.className = "patient-notification-icon";
      const glyph = document.createElement("i");
      glyph.className = "fa-solid " + (EVENT_ICONS[item.event_type] || "fa-bell");
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
        fresh.textContent = "جديد";
        heading.append(fresh);
      }

      const body = document.createElement("p");
      body.textContent = item.body || "";
      const time = document.createElement("time");
      time.dateTime = item.created_at || "";
      time.textContent = formatDate(item.created_at);
      content.append(heading, body, time);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "patient-notification-open";
      open.dataset.openPatientNotification = item.id;
      open.dataset.destination = getDestination(item.event_type);
      open.textContent = "عرض التفاصيل";

      card.append(icon, content, open);
      list.append(card);
    });

    setStatus("");
  }

  async function load() {
    if (!client || !recipientId || !root) {
      throw new Error("لم يتم تهيئة اتصال الإشعارات أو حساب المريض.");
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    try {
      const { data, error } = await client
        .from("notifications")
        .select("id,event_type,title,body,created_at,read_at")
        .eq("recipient_id", recipientId)
        .order("created_at", { ascending: false })
        .limit(30)
        .abortSignal(controller.signal);

      if (error) throw error;
      render(data || []);
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
        event: "INSERT",
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

  window.DietPlannerPatientNotifications = Object.freeze({ init });
})();