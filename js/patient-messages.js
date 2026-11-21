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
        <section class="patient-messages-quick-actions" data-message-quick-actions hidden aria-label="مراحل الاتفاق والدفع">
          <div class="patient-messages-quick-actions-heading">
            <strong data-message-stage>حالة الاتفاق</strong>
            <small data-message-stage-note></small>
          </div>
          <div class="patient-messages-quick-actions-buttons" data-message-confirmation-buttons></div>
        </section>
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
        <p class="patient-messages-disclaimer">هذه المحادثة مخصصة للمتابعة الغذائية، ولا تُعد وسيلة للطوارئ الطبية. تأكيد الدفع إقرار من صاحبه، وليس تحققًا بنكيًا من المنصة.</p>
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
    const quickActions = root.querySelector("[data-message-quick-actions]");
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
          .in("status", ["accepted", "active"])
          .order("created_at", { ascending: false });
        if (requestError) throw requestError;

        const contactsById = new Map((requests || []).map(item => [item.professional_id, {
          id: item.professional_id, requestId: item.id, status: item.status
        }]));
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

        const contactRows = [...contactsById.values()];
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
          void loadRequestState().then(loadMessages);
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
            list.innerHTML = '<div class="patient-messages-empty">لم يربط المريض حسابه بعد.</div>';
            form.hidden = true;
            return;
          }
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
      if (!requestId) { quickActions.hidden = true; return; }
      const { data, error } = await supabase.from("professional_connection_requests")
        .select("id,status,patient_agreement_at,professional_agreement_at,payment_sent_at,payment_received_at")
        .eq("id", requestId).maybeSingle();
      if (error) throw error;
      requestState = data || null;
      renderQuickActions();
    }

    function renderQuickActions() {
      const stage = root.querySelector("[data-message-stage]");
      const note = root.querySelector("[data-message-stage-note]");
      const buttons = root.querySelector("[data-message-confirmation-buttons]");
      if (!requestState || !["accepted", "active"].includes(requestState.status)) {
        quickActions.hidden = true;
        return;
      }
      quickActions.hidden = false;
      buttons.replaceChildren();
      const isPatient = role === "patient";
      const patientAgreed = Boolean(requestState.patient_agreement_at);
      const professionalAgreed = Boolean(requestState.professional_agreement_at);
      const makeButton = (step, label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.messageConfirm = step;
        button.textContent = label;
        buttons.appendChild(button);
      };

      if (requestState.status === "active" || requestState.payment_received_at) {
        stage.textContent = "المتابعة نشطة";
        note.textContent = "تم تأكيد استلام المبلغ وبدء المتابعة.";
      } else if (!patientAgreed || !professionalAgreed) {
        stage.textContent = "المرحلة 1 من 3 · تأكيد الاتفاق";
        const ownConfirmed = isPatient ? patientAgreed : professionalAgreed;
        const otherConfirmed = isPatient ? professionalAgreed : patientAgreed;
        if (!ownConfirmed) makeButton("agreement", "أؤكد الاتفاق");
        note.textContent = ownConfirmed
          ? "تم تأكيد موافقتك. ننتظر تأكيد الطرف الآخر."
          : otherConfirmed
            ? "الطرف الآخر أكد الاتفاق. راجع تفاصيل الخدمة والسعر والمدة ثم أكد موافقتك."
            : "بعد الاتفاق على الخدمة والسعر والمدة، يؤكد كل طرف موافقته.";
      } else if (!requestState.payment_sent_at) {
        stage.textContent = "المرحلة 2 من 3 · تأكيد الدفع";
        if (isPatient) makeButton("payment_sent", "تأكيد إرسال المبلغ");
        note.textContent = isPatient
          ? "أرسل المبلغ بالطريقة التي اتفقتما عليها، ثم أكد الإرسال."
          : "تم تأكيد الاتفاق من الطرفين. ننتظر تأكيد المريض إرسال المبلغ.";
      } else {
        stage.textContent = "المرحلة 3 من 3 · تأكيد الاستلام";
        if (!isPatient) makeButton("payment_received", "تأكيد استلام المبلغ");
        note.textContent = isPatient
          ? "تم تسجيل تأكيد الإرسال. ننتظر تأكيد المختص استلام المبلغ."
          : "لا تؤكد الاستلام إلا بعد التحقق بنفسك من وصول المبلغ.";
      }
    }

    async function loadMessages() {
      if (loading) return;
      loading = true;
      refreshButton.disabled = true;
      try {
        const { error: readError } = await supabase.rpc("mark_patient_messages_read", {
          p_patient_id: patientId,
          p_other_user_id: recipientId
        });
        if (readError) throw readError;
        const { data, error } = await supabase
          .from("patient_messages")
          .select("id,sender_id,recipient_id,body,created_at,read_at")
          .eq("patient_id", patientId)
          .or(`and(sender_id.eq.${user.id},recipient_id.eq.${recipientId}),and(sender_id.eq.${recipientId},recipient_id.eq.${user.id})`)
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        const messages = (data || []).reverse();
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
      root.querySelectorAll("[data-message-confirm]").forEach(button => { button.disabled = true; });
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
        root.querySelectorAll("[data-message-confirm]").forEach(button => { button.disabled = false; });
      }
    }

    form.addEventListener("submit", event => {
      event.preventDefault();
      void sendMessage(input.value.trim(), { clearInput: true });
    });

    quickActions.addEventListener("click", async event => {
      const button = event.target.closest("[data-message-confirm]");
      if (!button || !requestId || busy) return;
      const step = button.dataset.messageConfirm;
      const prompts = {
        agreement: "هل تؤكد موافقتك على الخدمة والسعر والمدة الموضحة في المحادثة؟",
        payment_sent: "هل تؤكد أنك أرسلت المبلغ بالفعل؟",
        payment_received: "هل تحققت من وصول المبلغ وتؤكد استلامه بالفعل؟"
      };
      if (!window.confirm(prompts[step] || "هل تريد تأكيد هذه الخطوة؟")) return;
      busy = true;
      sendButton.disabled = true;
      button.disabled = true;
      setStatus(root, "جاري تسجيل التأكيد...");
      try {
        const { error } = await supabase.rpc("confirm_professional_connection_step", {
          p_request_id: requestId, p_step: step
        });
        if (error) throw error;
        setStatus(root, "تم تسجيل التأكيد بنجاح.", "success");
        await loadRequestState();
        await loadMessages();
        if (requestState?.status === "active") window.location.reload();
      } catch (error) {
        console.error("Connection confirmation failed:", error);
        setStatus(root, error.message || "تعذر تسجيل التأكيد.", "error");
        await loadRequestState();
      } finally {
        busy = false;
        sendButton.disabled = false;
      }
    });

    refreshButton.addEventListener("click", () => void loadMessages());
    await loadRequestState();
    await loadMessages();
  }

  window.DietPlannerPatientMessages = { mount };
})();
