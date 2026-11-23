(() => {
  "use strict";

  const db = window.DietPlannerAccess?.supabaseClient;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const state = { requests: [], conversations: [], activeTab: "conversations", search: "" };

  function renderEmpty(root, message) {
    root.innerHTML = '<p class="patient-messages-empty">' + esc(message) + '</p>';
  }

  function filtered(items) {
    const term = state.search.trim().toLocaleLowerCase("ar");
    if (!term) return items;
    return items.filter(item => String(item.patient_name || "").toLocaleLowerCase("ar").includes(term));
  }

  function renderRequest(item) {
    const date = new Date(item.created_at);
    const dateLabel = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ar-EG");
    return '<article class="dp-chat-contact-row dp-conversation-request">' +
      '<div class="dp-chat-contact">' +
        '<span class="dp-chat-avatar"><i class="fa-solid fa-user"></i></span>' +
        '<span class="dp-chat-contact-copy"><strong>' + esc(item.patient_name || "مريض") + '</strong>' +
        '<small>' + esc(item.message || "طلب بدء محادثة معك") + '</small></span>' +
        '<span class="dp-chat-contact-status">' + esc(dateLabel) + '</span>' +
      '</div>' +
      '<div class="dp-conversation-actions">' +
        '<button type="button" data-conversation-accept="' + esc(item.request_id) + '">قبول وبدء المحادثة</button>' +
        '<button type="button" data-conversation-decline="' + esc(item.request_id) + '">رفض</button>' +
      '</div></article>';
  }

  function renderConversation(item) {
    return '<button type="button" class="dp-chat-contact" data-conversation-open="' + esc(item.patient_user_id) + '">' +
      '<span class="dp-chat-avatar"><i class="fa-solid fa-user"></i></span>' +
      '<span class="dp-chat-contact-copy"><strong>' + esc(item.patient_name || "مريض") + '</strong>' +
      '<small>محادثة مقبولة</small></span>' +
      '<span class="dp-chat-contact-status">تواصل متاح</span><i class="fa-solid fa-chevron-left"></i></button>';
  }

  function render() {
    const requestsRoot = $("professionalConversationRequests");
    const conversationsRoot = $("professionalConversationList");
    if (!requestsRoot || !conversationsRoot) return;
    const requests = filtered(state.requests);
    const conversations = filtered(state.conversations);
    $("communicationsRequestCount").textContent = String(state.requests.length);
    $("communicationsConversationCount").textContent = String(state.conversations.length);
    requestsRoot.innerHTML = requests.length
      ? requests.map(renderRequest).join("")
      : '<p class="patient-messages-empty">' + (state.search ? "لا توجد طلبات تطابق البحث." : "لا توجد طلبات تواصل معلقة.") + '</p>';
    conversationsRoot.innerHTML = conversations.length
      ? conversations.map(renderConversation).join("")
      : '<p class="patient-messages-empty">' + (state.search ? "لا توجد محادثات تطابق البحث." : "لا توجد محادثات مقبولة حاليًا.") + '</p>';
    requestsRoot.hidden = state.activeTab !== "requests";
    conversationsRoot.hidden = state.activeTab !== "conversations";
    const conversationsTab = $("communicationsTabConversations");
    const requestsTab = $("communicationsTabRequests");
    conversationsTab.setAttribute("aria-selected", String(state.activeTab === "conversations"));
    requestsTab.setAttribute("aria-selected", String(state.activeTab === "requests"));
    conversationsTab.className = state.activeTab === "conversations"
      ? "rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white"
      : "rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold text-slate-700";
    requestsTab.className = state.activeTab === "requests"
      ? "rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white"
      : "rounded-xl border border-slate-200 px-4 py-3 text-sm font-extrabold text-slate-700";
    bindActions();
  }

  function bindActions() {
    const requestsRoot = $("professionalConversationRequests");
    const conversationsRoot = $("professionalConversationList");
    requestsRoot.querySelectorAll("[data-conversation-accept],[data-conversation-decline]").forEach(button => {
      button.addEventListener("click", async () => {
        const decision = button.hasAttribute("data-conversation-accept") ? "accepted" : "declined";
        const requestId = button.dataset.conversationAccept || button.dataset.conversationDecline;
        button.disabled = true;
        try {
          const { error } = await db.rpc("respond_professional_connection_request", {
            p_request_id: requestId, p_decision: decision
          });
          if (error) throw error;
          await load();
        } catch (error) {
          console.error("Conversation request response failed:", error);
          button.disabled = false;
          window.alert(error.message || "تعذر تنفيذ طلب التواصل.");
        }
      });
    });
    conversationsRoot.querySelectorAll("[data-conversation-open]").forEach(button => {
      button.addEventListener("click", () => {
        const contact = state.conversations.find(item => item.patient_user_id === button.dataset.conversationOpen);
        if (!contact) return;
        window.DietPlannerPatientMessages?.openConversation({
          name: contact.patient_name || "المريض", subtitle: "محادثة مقبولة"
        }, {
          patientId: contact.patient_id, role: "professional",
          patientUserId: contact.patient_user_id, patientName: contact.patient_name
        });
      });
    });
  }

  async function load() {
    const refresh = $("professionalConversationsRefresh");
    if (!db) {
      renderEmpty($("professionalConversationRequests"), "تعذر تهيئة خدمة التواصل.");
      renderEmpty($("professionalConversationList"), "تعذر تهيئة خدمة التواصل.");
      return;
    }
    if (refresh) refresh.disabled = true;
    renderEmpty($("professionalConversationRequests"), "جاري تحميل الطلبات...");
    renderEmpty($("professionalConversationList"), "جاري تحميل المحادثات...");
    try {
      const { data, error } = await db.rpc("list_professional_connection_requests");
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      state.requests = rows.filter(row => row.status === "pending");
      const accepted = rows.filter(row => row.status === "accepted");
      const unique = new Map();
      accepted.forEach(row => {
        const key = row.patient_id || row.patient_user_id;
        if (!unique.has(key)) unique.set(key, {
          patient_id: row.patient_id, patient_user_id: row.patient_user_id,
          patient_name: row.patient_name
        });
      });
      state.conversations = [...unique.values()].sort((a, b) =>
        String(a.patient_name || "").localeCompare(String(b.patient_name || ""), "ar"));
      render();
    } catch (error) {
      console.error("Professional communications load failed:", error);
      renderEmpty($("professionalConversationRequests"), error.message || "تعذر تحميل طلبات التواصل.");
      renderEmpty($("professionalConversationList"), "تعذر تحميل قائمة المحادثات.");
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("communicationsTabConversations")?.addEventListener("click", () => { state.activeTab = "conversations"; render(); });
    $("communicationsTabRequests")?.addEventListener("click", () => { state.activeTab = "requests"; render(); });
    $("communicationsSearch")?.addEventListener("input", event => { state.search = event.target.value; render(); });
    $("professionalConversationsRefresh")?.addEventListener("click", load);
    void load();
  }, { once: true });
})();
