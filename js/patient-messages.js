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

  window.DietPlannerPatientMessages = { mount };
})();
