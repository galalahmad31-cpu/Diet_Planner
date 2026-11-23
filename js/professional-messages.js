(() => {
  "use strict";

  const db = window.DietPlannerAccess?.supabaseClient;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  function renderEmpty(root, message) {
    if (root) root.innerHTML = '<p class="patient-messages-empty">' + esc(message) + '</p>';
  }

  function renderRequest(item) {
    return '<article class="dp-chat-contact-row dp-conversation-request">' +
      '<div class="dp-chat-contact">' +
        '<span class="dp-chat-avatar"><i class="fa-solid fa-user"></i></span>' +
        '<span class="dp-chat-contact-copy"><strong>' + esc(item.patient_name || "مريض") + '</strong>' +
        '<small>' + esc(item.message || "طلب بدء محادثة معك") + '</small></span>' +
        '<span class="dp-chat-contact-status">' + esc(new Date(item.created_at).toLocaleDateString("ar-EG")) + '</span>' +
      '</div>' +
      '<div class="dp-conversation-actions">' +
        '<button type="button" data-conversation-accept="' + esc(item.request_id) + '">قبول وبدء المحادثة</button>' +
        '<button type="button" data-conversation-decline="' + esc(item.request_id) + '">رفض</button>' +
      '</div></article>';
  }

  function renderConversation(item) {
    return '<button type="button" class="dp-chat-contact" data-conversation-open="' + esc(item.patient_id) + '">' +
      '<span class="dp-chat-avatar"><i class="fa-solid fa-user"></i></span>' +
      '<span class="dp-chat-contact-copy"><strong>' + esc(item.patient_name || "مريض") + '</strong>' +
      '<small>' + esc(item.subtitle || "محادثة مقبولة") + '</small></span>' +
      '<span class="dp-chat-contact-status">مفتوحة</span><i class="fa-solid fa-chevron-left"></i></button>';
  }

  async function load() {
    const requestsRoot = $("professionalConversationRequests");
    const conversationsRoot = $("professionalConversationList");
    const refresh = $("professionalConversationsRefresh");
    if (!db || !requestsRoot || !conversationsRoot) return;
    if (refresh) refresh.disabled = true;
    renderEmpty(requestsRoot, "جاري تحميل الطلبات...");
    renderEmpty(conversationsRoot, "جاري تحميل المحادثات...");

    try {
      const { data, error } = await db.rpc("list_professional_connection_requests");
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      const pending = rows.filter(row => row.status === "pending");
      const accepted = rows.filter(row => row.status === "accepted");
      requestsRoot.innerHTML = pending.length
        ? pending.map(renderRequest).join("")
        : '<p class="patient-messages-empty">لا توجد طلبات محادثة جديدة.</p>';

      const contacts = new Map();
      accepted.forEach(row => contacts.set(row.patient_id, {
        patient_id: row.patient_id,
        patient_user_id: row.patient_user_id,
        patient_name: row.patient_name,
        subtitle: "محادثة مقبولة"
      }));

      // Include patients whose health files are owned by this professional.
      // The patient account link is reused; no duplicate contact table is created.
      const { data: accounts, error: accountsError } = await db.from("patient_accounts")
        .select("patient_id,user_id")
        .eq("status", "active");
      if (!accountsError && Array.isArray(accounts) && accounts.length) {
        const ids = [...new Set(accounts.map(row => row.patient_id).filter(Boolean))];
        const { data: patients, error: patientsError } = await db.from("patients")
          .select("id,name")
          .in("id", ids);
        if (!patientsError) {
          const names = new Map((patients || []).map(patient => [patient.id, patient.name]));
          accounts.forEach(account => {
            if (!contacts.has(account.patient_id)) {
              contacts.set(account.patient_id, {
                patient_id: account.patient_id,
                patient_user_id: account.user_id,
                patient_name: names.get(account.patient_id) || "مريض",
                subtitle: "ملف صحي مرتبط بك"
              });
            }
          });
        }
      }

      const activeRows = [...contacts.values()];
      conversationsRoot.innerHTML = activeRows.length
        ? activeRows.map(renderConversation).join("")
        : '<p class="patient-messages-empty">ستظهر هنا أسماء المرضى بعد ربط حساباتهم أو قبول طلبات المحادثة.</p>';

      requestsRoot.querySelectorAll("[data-conversation-accept],[data-conversation-decline]").forEach(button => {
        button.addEventListener("click", async () => {
          const decision = button.hasAttribute("data-conversation-accept") ? "accepted" : "declined";
          const requestId = button.dataset.conversationAccept || button.dataset.conversationDecline;
          button.disabled = true;
          try {
            const { error: responseError } = await db.rpc("respond_professional_connection_request", {
              p_request_id: requestId,
              p_decision: decision
            });
            if (responseError) throw responseError;
            await load();
          } catch (error) {
            console.error("Conversation request response failed:", error);
            button.disabled = false;
            window.alert(error.message || "تعذر تنفيذ طلب المحادثة.");
          }
        });
      });

      conversationsRoot.querySelectorAll("[data-conversation-open]").forEach(button => {
        button.addEventListener("click", () => {
          const contact = contacts.get(button.dataset.conversationOpen);
          if (!contact) return;
          window.DietPlannerPatientMessages?.openConversation({
            name: contact.patient_name,
            subtitle: contact.subtitle
          }, {
            patientId: contact.patient_id,
            role: "professional",
            patientUserId: contact.patient_user_id,
            patientName: contact.patient_name
          });
        });
      });
    } catch (error) {
      console.error("Professional conversations load failed:", error);
      renderEmpty(requestsRoot, error.message || "تعذر تحميل طلبات المحادثة.");
      renderEmpty(conversationsRoot, "تعذر تحميل قائمة المرضى المتواصلين.");
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("professionalConversationsRefresh")?.addEventListener("click", load);
    void load();
  }, { once: true });
})();
