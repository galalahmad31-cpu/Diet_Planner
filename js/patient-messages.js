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
        <section class="patient-messages-quick-actions" data-message-quick-actions hidden aria-label="تأكيدات الاتفاق والدفع">
          <div class="patient-messages-quick-actions-heading">
            <strong>تأكيدات الاتفاق والدفع</strong>
            <small>تُسجل كتأكيدات مؤرخة، ولا تتحقق المنصة من وصول التحويل.</small>
          </div>
          <div class="patient-messages-quick-actions-buttons">
            <button type="button" data-message-confirm="agreement">تأكيد الاتفاق</button>
            <button type="button" data-message-confirm="payment">${role === "patient" ? "تأكيد إرسال المبلغ" : "تأكيد استلام المبلغ"}</button>
          </div>
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
    let busy = false;
    let loading = false;
    let counterpartLabel = role === "patient" ? "المختص" : "المريض";

    try {
      if (role === "patient") {
        const { data: team, error: teamError } = await supabase
          .from("patient_care_team")
          .select("professional_id,relationship_role")
          .eq("patient_id", patientId)
          .eq("status", "active")
          .order("relationship_role", { ascending: true });
        if (teamError) throw teamError;
        const professionalIds = [...new Set((team || [])
          .sort((a, b) => (a.relationship_role === "primary" ? 0 : 1) - (b.relationship_role === "primary" ? 0 : 1))
          .map(item => item.professional_id))];
        if (!professionalIds.length) {
          list.innerHTML = '<div class="patient-messages-empty">لم يتم ربط مختص نشط بهذا الملف حتى الآن.</div>';
          form.hidden = true;
          recipientWrap.hidden = true;
          return;
        }
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id,full_name,profession")
          .in("id", professionalIds);
        if (profileError) throw profileError;
        const profileById = new Map((profiles || []).map(profile => [profile.id, profile]));
        const contacts = professionalIds.map(id => ({
          id,
          name: profileById.get(id)?.full_name || "المختص",
          profession: profileById.get(id)?.profession || "",
          role: team.find(item => item.professional_id === id)?.relationship_role || "collaborator"
        }));
        recipientSelect.innerHTML = contacts.map(contact =>
          `<option value="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}${contact.profession ? " · " + escapeHtml(contact.profession) : ""}${contact.role === "primary" ? " (المختص الأساسي)" : ""}</option>`
        ).join("");
        recipientId = contacts[0].id;
        recipientWrap.hidden = contacts.length < 2;
        counterpartLabel = contacts.length === 1 ? contacts[0].name : "المختص";
        recipientSelect.addEventListener("change", () => {
          recipientId = recipientSelect.value;
          counterpartLabel = contacts.find(contact => contact.id === recipientId)?.name || "المختص";
          void loadMessages();
        });
      } else {
        const { data: account, error: accountError } = await supabase
          .from("patient_accounts")
          .select("user_id")
          .eq("patient_id", patientId)
          .eq("status", "active")
          .maybeSingle();
        if (accountError) throw accountError;
        if (!account?.user_id) {
          list.innerHTML = '<div class="patient-messages-empty">لم يربط المريض حسابه بعد. أرسل دعوة الربط أولًا.</div>';
          form.hidden = true;
          return;
        }
        recipientId = account.user_id;
        counterpartLabel = "المريض";
      }
    } catch (error) {
      console.error("Patient messaging setup failed:", error);
      list.innerHTML = '<div class="patient-messages-empty is-error">تعذر تهيئة المحادثة. تحقق من الربط والصلاحيات ثم حاول مجددًا.</div>';
      setStatus(root, error.message || "تعذر تحميل بيانات التواصل.", "error");
      form.hidden = true;
      return;
    }

    quickActions.hidden = false;

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

    root.querySelectorAll("[data-message-confirm]").forEach(button => {
      button.addEventListener("click", () => {
        const action = button.dataset.messageConfirm;
        const isAgreement = action === "agreement";
        const body = isAgreement
          ? "تأكيد الاتفاق\nأؤكد موافقتي على تفاصيل الخدمة والسعر والمدة التي اتفقنا عليها في هذه المحادثة."
          : role === "patient"
            ? "تأكيد إرسال المبلغ\nأؤكد أنني أرسلت المبلغ المتفق عليه للمختص."
            : "تأكيد استلام المبلغ\nأؤكد أنني استلمت المبلغ المتفق عليه من المريض.";
        const prompt = isAgreement
          ? "هل تؤكد موافقتك على تفاصيل الخدمة والسعر والمدة التي اتفقتما عليها؟"
          : role === "patient"
            ? "هل تؤكد أنك أرسلت المبلغ بالفعل؟"
            : "هل تؤكد أنك استلمت المبلغ بالفعل؟";

        if (!window.confirm(prompt)) return;
        void sendMessage(body, {
          successMessage: isAgreement ? "تم إرسال تأكيد الاتفاق." : role === "patient" ? "تم إرسال تأكيد إرسال المبلغ." : "تم إرسال تأكيد استلام المبلغ."
        });
      });
    });

    refreshButton.addEventListener("click", () => void loadMessages());
    await loadMessages();
  }

  window.DietPlannerPatientMessages = { mount };
})();
