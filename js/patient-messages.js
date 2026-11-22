(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  const formatTime = value => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar-EG", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
    });
  };

  function setStatus(root, message, type = "") {
    const node = root.querySelector("[data-message-status]");
    if (!node) return;
    node.textContent = message || "";
    node.className = "patient-messages-status" + (type ? " is-" + type : "");
  }

  async function mount(root, options = {}) {
    if (!root || root.dataset.messagesMounted === "true") return;
    if (!supabase || !access?.getCurrentUser) {
      root.textContent = "تعذر تهيئة خدمة الرسائل.";
      return;
    }
    root.dataset.messagesMounted = "true";
    const patientId = options.patientId;
    const role = options.role;
    if (!patientId || !["patient", "professional"].includes(role)) {
      root.textContent = "بيانات المحادثة غير مكتملة.";
      return;
    }

    root.innerHTML = `
      <div class="patient-messages-shell">
        <div class="patient-messages-toolbar">
          <div><strong>${role === "patient" ? "التواصل مع المختص" : "محادثة المريض"}</strong><small data-message-counter>رسائل آمنة بين المريض والمختص</small></div>
          <button type="button" class="patient-messages-refresh" data-message-refresh aria-label="تحديث الرسائل"><i class="fa-solid fa-rotate"></i> تحديث</button>
        </div>
        <div class="patient-messages-contact" data-message-contact hidden>
          <label for="patientMessageRecipient">المختص</label>
          <select id="patientMessageRecipient" data-message-recipient></select>
        </div>
        <div class="patient-messages-list" data-message-list aria-live="polite">
          <div class="patient-messages-empty">جاري تحميل المحادثة...</div>
        </div>
        <form class="patient-messages-compose" data-message-form>
          <textarea data-message-input maxlength="4000" rows="3" placeholder="اكتب رسالتك هنا..." required></textarea>
          <div class="patient-messages-compose-footer">
            <span data-message-status class="patient-messages-status" role="status"></span>
            <button type="submit" data-message-send><i class="fa-solid fa-paper-plane"></i> إرسال</button>
          </div>
        </form>
        <p class="patient-messages-disclaimer">هذه المحادثة مخصصة للتواصل والمتابعة الغذائية، ولا تُعد وسيلة للطوارئ الطبية.</p>
      </div>`;

    const user = await access.getCurrentUser();
    if (!user?.id) {
      root.querySelector("[data-message-list]").textContent = "يجب تسجيل الدخول لاستخدام المحادثة.";
      return;
    }

    const list = root.querySelector("[data-message-list]");
    const form = root.querySelector("[data-message-form]");
    const input = root.querySelector("[data-message-input]");
    const sendButton = root.querySelector("[data-message-send]");
    const refreshButton = root.querySelector("[data-message-refresh]");
    const recipientWrap = root.querySelector("[data-message-contact]");
    const recipientSelect = root.querySelector("[data-message-recipient]");
    let recipientId = null;
    let requestId = options.requestId || null;
    let requestState = null;
    let busy = false;
    let loading = false;
    let counterpartLabel = role === "patient" ? "المختص" : "المريض";

    try {
      if (role === "patient") {
        const { data: requests, error: requestError } = await supabase
          .from("professional_connection_requests")
          .select("id,professional_id,status,created_at")
          .eq("patient_id", patientId)
          .eq("requested_by", user.id)
          .in("status", ["accepted", "active", "ended"])
          .order("created_at", { ascending: false });
        if (requestError) throw requestError;

        const contactsById = new Map();
        (requests || []).forEach(item => {
          if (!contactsById.has(item.professional_id)) {
            contactsById.set(item.professional_id, {
              id: item.professional_id, requestId: item.id, status: item.status
            });
          }
        });
        const { data: team, error: teamError } = await supabase
          .from("patient_care_team")
          .select("professional_id,relationship_role")
          .eq("patient_id", patientId)
          .eq("status", "active");
        if (teamError) throw teamError;
        (team || []).forEach(item => {
          if (!contactsById.has(item.professional_id)) {
            contactsById.set(item.professional_id, { id: item.professional_id, requestId: null, status: "active" });
          }
        });

        let contactRows = [...contactsById.values()];
        if (options.professionalId) contactRows = contactRows.filter(item => item.id === options.professionalId);
        if (!contactRows.length) {
          list.innerHTML = '<div class="patient-messages-empty">لا توجد محادثات مقبولة حتى الآن. يمكنك إرسال طلب محادثة من دليل المختصين.</div>';
          form.hidden = true;
          recipientWrap.hidden = true;
          return;
        }

        const { data: profiles, error: profileError } = await supabase
          .from("profiles").select("id,full_name,profession").in("id", contactRows.map(item => item.id));
        if (profileError) throw profileError;
        const profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
        const contacts = contactRows.map(item => ({
          ...item,
          name: profileById.get(item.id)?.full_name || "المختص",
          profession: profileById.get(item.id)?.profession || ""
        }));
        recipientSelect.innerHTML = contacts.map(contact =>
          `<option value="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}${contact.profession ? " · " + escapeHtml(contact.profession) : ""}</option>`
        ).join("");
        recipientId = contacts[0].id;
        requestId = contacts[0].requestId;
        counterpartLabel = contacts.length === 1 ? contacts[0].name : "المختص";
        recipientWrap.hidden = contacts.length < 2;
        recipientSelect.addEventListener("change", () => {
          const selected = contacts.find(contact => contact.id === recipientSelect.value);
          recipientId = selected?.id || null;
          requestId = selected?.requestId || null;
          counterpartLabel = selected?.name || "المختص";
          void loadRequestState().then(loadMessages).catch(error => {
            console.error("Conversation state refresh failed:", error);
            setStatus(root, "تعذر تحديث حالة المحادثة.", "error");
          });
        });
      } else {
        let request = null;
        if (requestId) {
          const { data, error: requestError } = await supabase
            .from("professional_connection_requests").select("id,requested_by")
            .eq("id", requestId).maybeSingle();
          if (requestError) throw requestError;
          request = data;
        } else {
          const { data, error: requestError } = await supabase
            .from("professional_connection_requests").select("id,requested_by")
            .eq("patient_id", patientId).eq("professional_id", user.id)
            .in("status", ["accepted", "active"]).maybeSingle();
          if (requestError) throw requestError;
          request = data;
          requestId = request?.id || null;
        }

        if (request?.requested_by) {
          recipientId = request.requested_by;
        } else {
          // Legacy care-team conversations predate connection requests.
          const { data: account, error: accountError } = await supabase
            .from("patient_accounts").select("user_id")
            .eq("patient_id", patientId).eq("status", "active").maybeSingle();
          if (accountError) throw accountError;
          if (!account?.user_id) {
            root.closest(".patient-conversation-drawer")?.classList.add("is-unlinked");
            root.innerHTML = '<div class="patient-messages-unlinked" role="status">لم يتم ربط حساب المريض بعد.</div>';
            return;
          }
          root.closest(".patient-conversation-drawer")?.classList.remove("is-unlinked");
          recipientId = account.user_id;
        }
        counterpartLabel = "المريض";
      }
    } catch (error) {
      console.error("Patient messaging setup failed:", error);
      list.innerHTML = '<div class="patient-messages-empty is-error">تعذر تهيئة المحادثة. تحقق من الربط والصلاحيات ثم حاول مجددًا.</div>';
      setStatus(root, error.message || "تعذر تحميل بيانات التواصل.", "error");
      form.hidden = true;
      return;
    }

    async function loadRequestState() {
      requestState = null;
      if (!requestId) { form.hidden = false; return; }
      const { data, error } = await supabase.from("professional_connection_requests")
        .select("id,status")
        .eq("id", requestId).maybeSingle();
      if (error) throw error;
      requestState = data || null;
      form.hidden = requestState?.status === "ended";
    }

    async function loadMessages() {
      if (loading) return;
      loading = true;
      refreshButton.disabled = true;
      try {
        if (requestState?.status !== "ended") {
          const { error: readError } = await supabase.rpc("mark_patient_messages_read", {
            p_patient_id: patientId,
            p_other_user_id: recipientId
          });
          if (readError) throw readError;
        }
        const { data, error } = await supabase
          .from("patient_messages")
          .select("id,sender_id,recipient_id,body,created_at,read_at")
          .eq("patient_id", patientId)
          .or(`and(sender_id.eq.${user.id},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${user.id})`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const legacyMilestoneMessages = new Set([
          "تأكيد الاتفاق: أوافق على تفاصيل الخدمة والسعر والمدة المسجلة في اتفاق المتابعة.",
          "تأكيد إرسال المبلغ: أؤكد أنني أرسلت المبلغ المتفق عليه للمختص.",
          "تأكيد استلام المبلغ: أؤكد أنني استلمت المبلغ المتفق عليه من المريض. بدأت المتابعة."
        ]);
        const messages = (data || []).filter(message => !legacyMilestoneMessages.has(message.body)).reverse();
        if (!messages.length) {
          list.innerHTML = '<div class="patient-messages-empty">لا توجد رسائل بعد. يمكنك بدء المحادثة برسالة قصيرة.</div>';
          return;
        }
        list.innerHTML = messages.map(message => {
          const mine = message.sender_id === user.id;
          return `<article class="patient-message-bubble ${mine ? "is-mine" : "is-theirs"}">
            <div class="patient-message-body">${escapeHtml(message.body)}</div>
            <div class="patient-message-meta"><time>${escapeHtml(formatTime(message.created_at))}</time>${mine ? `<span>${message.read_at ? "تمت القراءة" : "تم الإرسال"}</span>` : `<span>${escapeHtml(counterpartLabel)}</span>`}</div>
          </article>`;
        }).join("");
        list.scrollTop = list.scrollHeight;
        root.querySelector("[data-message-counter]").textContent = `${messages.length.toLocaleString("ar-EG")} رسالة في المحادثة`;
      } catch (error) {
        console.error("Patient messages load failed:", error);
        list.innerHTML = '<div class="patient-messages-empty is-error">تعذر تحميل الرسائل. اضغط تحديث للمحاولة مرة أخرى.</div>';
        setStatus(root, error.message || "تعذر تحميل الرسائل.", "error");
      } finally {
        loading = false;
        refreshButton.disabled = false;
      }
    }

    async function sendMessage(body, options = {}) {
      const { clearInput = false, successMessage = "تم إرسال الرسالة." } = options;
      if (!body || busy || !recipientId) return false;

      busy = true;
      sendButton.disabled = true;
      setStatus(root, "جاري إرسال الرسالة...");

      try {
        const { error } = await supabase.from("patient_messages").insert({
          patient_id: patientId,
          sender_id: user.id,
          recipient_id: recipientId,
          body
        });
        if (error) throw error;

        if (clearInput) input.value = "";
        setStatus(root, successMessage, "success");
        await loadMessages();
        return true;
      } catch (error) {
        console.error("Patient message send failed:", error);
        setStatus(root, error.message || "تعذر إرسال الرسالة.", "error");
        return false;
      } finally {
        busy = false;
        sendButton.disabled = false;
      }
    }

    form.addEventListener("submit", event => {
      event.preventDefault();
      void sendMessage(input.value.trim(), { clearInput: true });
    });

    refreshButton.addEventListener("click", () => {
      void loadRequestState().then(loadMessages).catch(error => {
        console.error("Patient conversation refresh failed:", error);
        setStatus(root, "تعذر تحديث المحادثة. حاول مرة أخرى.", "error");
      });
    });
    try { await loadRequestState(); } catch (error) {
      console.error("Conversation state load failed:", error);
      setStatus(root, "تعذر تحميل حالة الاتفاق والدفع.", "error");
    }
    await loadMessages();
  }


  function ensureFloatingChatWidget() {
    let widget = document.getElementById("dpCentralChatWidget");
    if (widget) return widget;

    widget = document.createElement("section");
    widget.id = "dpCentralChatWidget";
    widget.className = "dp-central-chat";
    widget.hidden = true;
    widget.setAttribute("aria-label", "نافذة المحادثة");
    widget.innerHTML = `
      <header class="dp-central-chat__header">
        <div class="dp-central-chat__identity">
          <strong data-central-chat-title>المحادثة</strong>
          <small data-central-chat-subtitle>رسائل آمنة بين المريض والمختص</small>
        </div>
        <div class="dp-central-chat__controls">
          <button type="button" data-central-chat-minimize aria-label="تصغير المحادثة" title="تصغير"><i class="fa-solid fa-minus"></i></button>
          <button type="button" data-central-chat-close aria-label="إغلاق المحادثة" title="إغلاق"><i class="fa-solid fa-xmark"></i></button>
        </div>
      </header>
      <div class="dp-central-chat__body" data-central-chat-body></div>`;
    document.body.appendChild(widget);

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "dpCentralChatLauncher";
    launcher.className = "dp-central-chat-launcher";
    launcher.innerHTML = '<i class="fa-solid fa-comments" aria-hidden="true"></i><span>المحادثات</span>';
    launcher.setAttribute("aria-controls", widget.id);
    launcher.setAttribute("aria-expanded", "false");
    document.body.appendChild(launcher);

    const hide = () => {
      widget.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
    };
    const show = () => {
      widget.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
    };
    launcher.addEventListener("click", () => {
      if (widget.hidden) show();
      else hide();
    });
    widget.querySelector("[data-central-chat-minimize]").addEventListener("click", hide);
    widget.querySelector("[data-central-chat-close]").addEventListener("click", () => {
      hide();
      widget.querySelector("[data-central-chat-body]").replaceChildren();
      widget.querySelector("[data-central-chat-title]").textContent = "المحادثة";
      widget.querySelector("[data-central-chat-subtitle]").textContent = "اختر شخصًا من قائمة المحادثات لبدء التواصل";
    });
    return widget;
  }

  function openCentralConversation(contact, chatOptions) {
    const widget = ensureFloatingChatWidget();
    const body = widget.querySelector("[data-central-chat-body]");
    widget.querySelector("[data-central-chat-title]").textContent = contact.name || "المحادثة";
    widget.querySelector("[data-central-chat-subtitle]").textContent = contact.subtitle || "رسائل آمنة بين المريض والمختص";
    body.replaceChildren();
    const chatRoot = document.createElement("div");
    chatRoot.dataset.patientMessages = "";
    body.appendChild(chatRoot);
    widget.hidden = false;
    document.getElementById("dpCentralChatLauncher")?.setAttribute("aria-expanded", "true");
    void mount(chatRoot, chatOptions);
  }

  async function mountInbox(root, options = {}) {
    if (!root || root.dataset.inboxMounted === "true") return;
    if (!supabase || !access?.getCurrentUser) { root.textContent = "تعذر تهيئة قائمة المحادثات."; return; }
    root.dataset.inboxMounted = "true";
    const role = options.role, patientId = options.patientId;
    if (!["patient", "professional"].includes(role) || (role === "patient" && !patientId)) { root.textContent = "بيانات قائمة المحادثات غير مكتملة."; return; }
    root.innerHTML = '<div class="dp-chat-inbox"><div class="dp-chat-contact-list" data-chat-contacts><p class="patient-messages-empty">جاري تحميل جهات التواصل...</p></div></div>';
    const list = root.querySelector("[data-chat-contacts]");
    try {
      const user = await access.getCurrentUser();
      if (!user?.id) throw new Error("يجب تسجيل الدخول لعرض المحادثات.");
      let contacts = [];
      if (role === "patient") {
        const { data: requests, error: requestError } = await supabase.from("professional_connection_requests").select("id,professional_id,status,created_at").eq("patient_id", patientId).eq("requested_by", user.id).in("status", ["accepted", "active", "ended"]).order("created_at", { ascending: false });
        if (requestError) throw requestError;
        const byId = new Map();
        (requests || []).forEach(item => { if (!byId.has(item.professional_id)) byId.set(item.professional_id, { id: item.professional_id, requestId: item.id, status: item.status }); });
        const { data: team, error: teamError } = await supabase.from("patient_care_team").select("professional_id,relationship_role").eq("patient_id", patientId).eq("status", "active");
        if (teamError) throw teamError;
        (team || []).forEach(item => { if (!byId.has(item.professional_id)) byId.set(item.professional_id, { id: item.professional_id, requestId: null, status: "active" }); });
        const rows = [...byId.values()];
        if (rows.length) {
          const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,full_name,profession").in("id", rows.map(x => x.id));
          if (profileError) throw profileError;
          const profileMap = new Map((profiles || []).map(x => [x.id, x]));
          contacts = rows.map(x => ({ ...x, name: profileMap.get(x.id)?.full_name || "المختص", subtitle: profileMap.get(x.id)?.profession || "مختص مرتبط" }));
        }
      } else {
        contacts = (options.contacts || []).map(x => ({ id: x.patient_id, patientId: x.patient_id, requestId: x.request_id, name: x.patient_name || "مريض", status: x.status, subtitle: x.status === "active" ? "متابعة نشطة" : x.status === "ended" ? "انتهت المتابعة" : "محادثة مفتوحة" }));
        const seen = new Set();
        contacts = contacts.filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
      }
      if (!contacts.length) {
        list.innerHTML = '<div class="patient-messages-empty">' + (role === "patient" ? "لا توجد محادثات مرتبطة حتى الآن. يمكنك إرسال طلب من دليل المختصين." : "لا توجد محادثات مقبولة حتى الآن.") + "</div>";
        return;
      }
      ensureFloatingChatWidget();
      list.innerHTML = contacts.map(x =>
        '<button type="button" class="dp-chat-contact" data-chat-open="' + escapeHtml(x.id) + '">' +
        '<span class="dp-chat-avatar"><i class="fa-solid ' + (role === "patient" ? "fa-user-doctor" : "fa-user") + '"></i></span>' +
        '<span class="dp-chat-contact-copy"><strong>' + escapeHtml(x.name) + '</strong><small>' + escapeHtml(x.subtitle || "") + '</small></span>' +
        '<span class="dp-chat-contact-status">' + (x.status === "active" ? "نشطة" : x.status === "ended" ? "منتهية" : "مفتوحة") + '</span>' +
        '<i class="fa-solid fa-chevron-left"></i></button>'
      ).join("");
      list.querySelectorAll("[data-chat-open]").forEach(button => button.addEventListener("click", () => {
        const contact = contacts.find(x => x.id === button.dataset.chatOpen);
        if (!contact) return;
        const chatOptions = role === "patient"
          ? { patientId, role, professionalId: contact.id }
          : { patientId: contact.patientId, requestId: contact.requestId, role };
        openCentralConversation(contact, chatOptions);
      }));
    } catch (error) {
      console.error("Conversation inbox load failed:", error);
      list.innerHTML = '<div class="patient-messages-empty is-error">تعذر تحميل قائمة المحادثات. أعد تحميل الصفحة للمحاولة.</div>';
    }
  }

  window.DietPlannerPatientMessages = { mount, mountInbox };
})();
