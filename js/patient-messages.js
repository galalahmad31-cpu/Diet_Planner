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
    if ((patientId == null && !options.allowStandalone) || !["patient", "professional"].includes(role)) {
      root.textContent = "بيانات المحادثة غير مكتملة.";
      return;
    }

    root.innerHTML = `
      <div class="patient-messages-shell">
        <div class="patient-messages-toolbar">
          <div><strong>${role === "patient" ? "التواصل مع المختص" : "محادثة المريض"}</strong><small data-message-counter>رسائل آمنة بين المريض والمختص</small></div>
          <button type="button" class="patient-messages-refresh" data-message-refresh aria-label="تحديث الرسائل"><i class="fa-solid fa-rotate"></i> تحديث</button>
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
    let recipientId = null;
    let counterpartLabel = role === "patient" ? "المختص" : "المريض";
    try {
      if (role === "patient") {
        if (options.professionalId) {
          recipientId = options.professionalId;
        } else {
          const { data: patient, error } = await supabase.from("patients")
            .select("id,user_id")
            .eq("id", patientId)
            .maybeSingle();
          if (error) throw error;
          if (!patient?.user_id) throw new Error("تعذر تحديد المختص المسؤول عن هذا الملف.");
          recipientId = patient.user_id;
        }
        const { data: profile, error: profileError } = await supabase.from("profiles")
          .select("full_name,profession")
          .eq("id", recipientId)
          .maybeSingle();
        if (profileError) throw profileError;
        counterpartLabel = options.counterpartName || profile?.full_name || "المختص";
      } else if (options.patientUserId) {
        recipientId = options.patientUserId;
        counterpartLabel = options.patientName || "المريض";
      } else {
        const { data: account, error } = await supabase.from("patient_accounts")
          .select("user_id")
          .eq("patient_id", patientId)
          .eq("status", "active")
          .maybeSingle();
        if (error) throw error;
        if (!account?.user_id) throw new Error("لم يتم ربط حساب المريض بهذا الملف بعد.");
        recipientId = account.user_id;
        const { data: patient, error: patientError } = await supabase.from("patients")
          .select("name")
          .eq("id", patientId)
          .maybeSingle();
        if (patientError) throw patientError;
        counterpartLabel = patient?.name || "المريض";
      }
    } catch (error) {
      console.error("Patient messaging setup failed:", error);
      list.innerHTML = '<div class="patient-messages-empty is-error">' + escapeHtml(error.message || "تعذر تهيئة المحادثة.") + '</div>';
      form.hidden = true;
      setStatus(root, error.message || "تعذر تحميل بيانات التواصل.", "error");
      return;
    }

    let busy = false;
    let loading = false;

    async function loadMessages() {
      if (loading || !recipientId) return;
      loading = true;
      refreshButton.disabled = true;
      try {
        const { error: readError } = await supabase.rpc("mark_patient_messages_read", {
          p_other_user_id: recipientId
        });
        if (readError) throw readError;
        let messageQuery = supabase.from("patient_messages")
          .select("id,sender_id,recipient_id,body,created_at,read_at");
        const { data, error } = await messageQuery
          .or(`and(sender_id.eq.${user.id},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${user.id})`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const messages = (data || []).reverse();
        if (!messages.length) {
          list.innerHTML = '<div class="patient-messages-empty">لا توجد رسائل بعد. يمكنك بدء المحادثة برسالة قصيرة.</div>';
        } else {
          list.innerHTML = messages.map(message => {
            const mine = message.sender_id === user.id;
            return `<article class="patient-message-bubble ${mine ? "is-mine" : "is-theirs"}">
              <div class="patient-message-body">${escapeHtml(message.body)}</div>
              <div class="patient-message-meta"><time>${escapeHtml(formatTime(message.created_at))}</time>${mine ? `<span>${message.read_at ? "تمت القراءة" : "تم الإرسال"}</span>` : `<span>${escapeHtml(counterpartLabel)}</span>`}</div>
            </article>`;
          }).join("");
          list.scrollTop = list.scrollHeight;
        }
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

    form.addEventListener("submit", async event => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body || busy || !recipientId) return;
      busy = true;
      sendButton.disabled = true;
      setStatus(root, "جاري إرسال الرسالة...");
      try {
        const { error } = await supabase.from("patient_messages").insert({
          sender_id: user.id,
          recipient_id: recipientId,
          body
        });
        if (error) throw error;
        input.value = "";
        setStatus(root, "تم إرسال الرسالة.", "success");
        await loadMessages();
      } catch (error) {
        console.error("Patient message send failed:", error);
        setStatus(root, error.message || "تعذر إرسال الرسالة.", "error");
      } finally {
        busy = false;
        sendButton.disabled = false;
      }
    });
    refreshButton.addEventListener("click", () => void loadMessages());
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
    void mount(chatRoot, { ...chatOptions, allowStandalone: chatOptions?.patientId == null });
  }


  window.DietPlannerPatientMessages = { mount, openConversation: openCentralConversation };
})();
