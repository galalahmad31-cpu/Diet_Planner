/* =========================================================
   Diet Planner — feedback.js
   Public feedback + own feedback management.

   Depends on:
   - js/auth-access.js
   - public.app_feedback

   Authentication and Supabase client are provided by
   DietPlannerAccess. This file does not duplicate auth logic.
   ========================================================= */

(() => {
  "use strict";

  const state = {
    user: null,
    isAdmin: false,
    feedback: null,
    editingId: null,
    saving: false,
    deleting: false,
    pendingDeleteId: null,
    feedbacks: []
  };

  const elements = {};

  function cacheElements() {
    elements.loading = document.getElementById("loadingScreen");
    elements.form = document.getElementById("feedbackForm");
    elements.rating = document.getElementById("feedbackRating");
    elements.comment = document.getElementById("feedbackComment");
    elements.name = document.getElementById("feedbackName");
    elements.saveBtn = document.getElementById("saveFeedbackBtn");
    elements.deleteBtn = document.getElementById("deleteFeedbackBtn");
    elements.status = document.getElementById("feedbackStatus");
    elements.stars = document.querySelectorAll("[data-rating]");
    elements.list = document.getElementById("feedbackList");
    elements.empty = document.getElementById("feedbackEmpty");
    elements.deleteModal = document.getElementById("feedbackDeleteModal");
    elements.cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    elements.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
  }

  function hideLoading() {
    if (elements.loading) elements.loading.style.display = "none";
  }

  function showStatus(message, type = "info") {
    if (!elements.status) return;

    const styles = {
      info: "border-slate-200 bg-slate-50 text-slate-600",
      success: "border-emerald-200 bg-emerald-50 text-emerald-700",
      error: "border-red-200 bg-red-50 text-red-700"
    };

    elements.status.className =
      `mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${styles[type] || styles.info}`;
    elements.status.textContent = message;
    elements.status.classList.remove("hidden");
  }

  function clearStatus() {
    elements.status?.classList.add("hidden");
  }

  function normalizeName(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    if (!value) return "";

    try {
      return new Intl.DateTimeFormat("ar-EG", {
        year: "numeric",
        month: "long",
        day: "numeric"
      }).format(new Date(value));
    } catch {
      return "";
    }
  }

  async function getDisplayName(user) {
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase || !user?.id) return "حساب المستخدم";

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error) console.error("Feedback profile lookup failed:", error);

      return (
        normalizeName(profile?.full_name) ||
        normalizeName(user?.user_metadata?.full_name) ||
        normalizeName(user?.user_metadata?.name) ||
        normalizeName(user?.email) ||
        "حساب المستخدم"
      );
    } catch (error) {
      console.error("Feedback profile lookup failed:", error);
      return (
        normalizeName(user?.user_metadata?.full_name) ||
        normalizeName(user?.user_metadata?.name) ||
        normalizeName(user?.email) ||
        "حساب المستخدم"
      );
    }
  }

  function setRating(value) {
    const rating = Number(value);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;

    elements.rating.value = String(rating);

    elements.stars.forEach((star) => {
      const starValue = Number(star.dataset.rating);
      const active = starValue <= rating;
      star.classList.toggle("text-yellow-400", active);
      star.classList.toggle("text-slate-300", !active);
      star.setAttribute(
        "aria-checked",
        active && starValue === rating ? "true" : "false"
      );
    });
  }

  function resetRating() {
    elements.rating.value = "";
    elements.stars.forEach((star) => {
      star.classList.remove("text-yellow-400");
      star.classList.add("text-slate-300");
      star.setAttribute("aria-checked", "false");
    });
  }

  function setFormMode(feedback = null) {
    state.feedback = feedback;
    state.editingId = feedback?.id || null;

    if (!feedback) {
      resetRating();
      elements.comment.value = "";
      elements.deleteBtn?.classList.add("hidden");
      elements.saveBtn.innerHTML =
        '<i class="fa-solid fa-paper-plane"></i><span>إرسال التقييم</span>';
      return;
    }

    setRating(feedback.rating);
    elements.comment.value = feedback.comment || "";
    elements.deleteBtn?.classList.remove("hidden");
    elements.saveBtn.innerHTML =
      '<i class="fa-solid fa-pen"></i><span>تحديث التقييم</span>';
  }

  function renderOwnFeedback(feedback) {
    if (feedback) {
      setFormMode(feedback);
    } else if (!state.editingId) {
      setFormMode(null);
    }
  }

  function renderFeedbackList(feedbacks) {
    if (!elements.list) return;

    if (!feedbacks.length) {
      elements.list.innerHTML = "";
      elements.empty?.classList.remove("hidden");
      return;
    }

    elements.empty?.classList.add("hidden");

    elements.list.innerHTML = feedbacks.map((feedback) => {
      const isOwner = feedback.user_id === state.user?.id;
      const canManage = state.isAdmin || isOwner;
      const stars = Array.from({ length: 5 }, (_, index) => {
        const active = index < Number(feedback.rating);
        return `<i class="fa-solid fa-star ${active ? "text-yellow-400" : "text-slate-300"}"></i>`;
      }).join("");

      return `
        <article class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <i class="fa-solid fa-user"></i>
                </div>
                <div class="min-w-0">
                  <div class="truncate font-extrabold text-slate-800">${escapeHtml(feedback.display_name)}</div>
                  <div class="text-xs text-slate-400">${escapeHtml(formatDate(feedback.created_at))}</div>
                </div>
              </div>
            </div>
            <div class="shrink-0 flex gap-0.5 text-sm" aria-label="${Number(feedback.rating)} من 5 نجوم">
              ${stars}
            </div>
          </div>

          <p class="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-600">${escapeHtml(feedback.comment || "")}</p>

          ${canManage ? `
            <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <button type="button" data-edit-feedback="${escapeHtml(feedback.id)}"
                class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50">
                <i class="fa-solid fa-pen"></i><span>تعديل</span>
              </button>
              <button type="button" data-delete-feedback="${escapeHtml(feedback.id)}"
                class="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-extrabold text-red-600 transition hover:bg-red-100">
                <i class="fa-solid fa-trash"></i><span>حذف</span>
              </button>
            </div>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  async function loadFeedbacks() {
    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase) return;

    const { data, error } = await supabase
      .from("app_feedback")
      .select("id,user_id,rating,comment,display_name,created_at,updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Feedback list load failed:", error);
      showStatus("تعذر تحميل آراء المستخدمين حاليًا. حاول مرة أخرى.", "error");
      return;
    }

    state.feedbacks = Array.isArray(data) ? data : [];
    renderFeedbackList(state.feedbacks);

    const own = (data || []).find((item) => item.user_id === state.user?.id);
    if (own && !state.editingId) renderOwnFeedback(own);
  }

  async function saveFeedback(event) {
    event?.preventDefault();
    if (state.saving || !state.user?.id) return;

    clearStatus();

    const rating = Number(elements.rating.value);
    const comment = elements.comment.value.trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      showStatus("من فضلك اختر تقييمًا من نجمة إلى 5 نجوم.", "error");
      return;
    }

    if (comment.length > 2000) {
      showStatus("الرأي يجب ألا يتجاوز 2000 حرف.", "error");
      return;
    }

    const supabase = window.DietPlannerAccess?.supabaseClient;
    if (!supabase) {
      showStatus("تعذر الاتصال بقاعدة البيانات حاليًا.", "error");
      return;
    }

    state.saving = true;
    elements.saveBtn.disabled = true;
    if (elements.deleteBtn) elements.deleteBtn.disabled = true;

    try {
      let data;

      if (state.editingId) {
        const { data: updated, error } = await supabase
          .from("app_feedback")
          .update({ rating, comment })
          .eq("id", state.editingId)
          .select("id,user_id,rating,comment,display_name,created_at,updated_at")
          .single();

        if (error) throw error;
        data = updated;
      } else {
        const displayName = await getDisplayName(state.user);

        const { data: created, error } = await supabase
          .from("app_feedback")
          .upsert(
            {
              user_id: state.user.id,
              rating,
              comment,
              display_name: displayName
            },
            { onConflict: "user_id" }
          )
          .select("id,user_id,rating,comment,display_name,created_at,updated_at")
          .single();

        if (error) throw error;
        data = created;
      }

      setFormMode(data);
      showStatus("تم حفظ التقييم بنجاح.", "success");
      await loadFeedbacks();
    } catch (error) {
      console.error("Feedback save failed:", error);
      showStatus("تعذر حفظ التقييم حاليًا. حاول مرة أخرى.", "error");
    } finally {
      state.saving = false;
      elements.saveBtn.disabled = false;
      if (elements.deleteBtn) elements.deleteBtn.disabled = false;
      elements.saveBtn.innerHTML = state.editingId
        ? '<i class="fa-solid fa-pen"></i><span>تحديث التقييم</span>'
        : '<i class="fa-solid fa-paper-plane"></i><span>إرسال التقييم</span>';
    }
  }

  function openDeleteModal(feedbackId = state.editingId) {
    if (!feedbackId) return;
    state.pendingDeleteId = feedbackId;
    elements.deleteModal?.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
    elements.cancelDeleteBtn?.focus();
  }

  function closeDeleteModal() {
    state.pendingDeleteId = null;
    elements.deleteModal?.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  }

  function confirmDelete() {
    const feedbackId = state.pendingDeleteId;
    closeDeleteModal();
    performDeleteFeedback(feedbackId);
  }

  async function performDeleteFeedback(feedbackId) {
    if (state.deleting || !feedbackId || !state.user?.id) return;

    state.deleting = true;
    clearStatus();

    try {
      const supabase = window.DietPlannerAccess?.supabaseClient;
      if (!supabase) throw new Error("Supabase client is unavailable.");

      const { error } = await supabase
        .from("app_feedback")
        .delete()
        .eq("id", feedbackId);

      if (error) throw error;

      if (state.editingId === feedbackId) {
        setFormMode(null);
      }

      showStatus("تم حذف التقييم بنجاح.", "success");
      await loadFeedbacks();
    } catch (error) {
      console.error("Feedback delete failed:", error);
      showStatus("تعذر حذف التقييم حاليًا. حاول مرة أخرى.", "error");
    } finally {
      state.deleting = false;
    }
  }

  function editFeedback(feedbackId) {
    const card = state.feedbacks?.find((item) => item.id === feedbackId);
    if (!card) return;

    if (!state.isAdmin && card.user_id !== state.user?.id) return;

    setFormMode(card);
    elements.form?.scrollIntoView({ behavior: "smooth", block: "start" });
    clearStatus();
  }

  function handleFeedbackListClick(event) {
    const editButton = event.target.closest("[data-edit-feedback]");
    if (editButton) {
      editFeedback(editButton.dataset.editFeedback);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-feedback]");
    if (deleteButton) {
      openDeleteModal(deleteButton.dataset.deleteFeedback);
    }
  }

  function bindEvents() {
    elements.form?.addEventListener("submit", saveFeedback);
    elements.deleteBtn?.addEventListener("click", () => openDeleteModal());
    elements.cancelDeleteBtn?.addEventListener("click", closeDeleteModal);
    elements.confirmDeleteBtn?.addEventListener("click", confirmDelete);
    elements.deleteModal?.addEventListener("click", (event) => {
      if (event.target === elements.deleteModal) closeDeleteModal();
    });
    elements.list?.addEventListener("click", handleFeedbackListClick);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.deleteModal?.classList.contains("hidden")) {
        closeDeleteModal();
      }
    });

    elements.stars.forEach((star) => {
      star.addEventListener("click", () => setRating(star.dataset.rating));
    });
  }

  async function initialize() {
    cacheElements();
    bindEvents();

    const access = window.DietPlannerAccess;
    if (!access?.getCurrentUser || !access?.supabaseClient) {
      hideLoading();
      showStatus("تعذر تحميل خدمة الحساب حاليًا.", "error");
      return;
    }

    try {
      const accessStatus = await access.getAccessStatus();
      if (!accessStatus?.authenticated || !accessStatus.user) {
        hideLoading();
        showStatus("يجب تسجيل الدخول لاستخدام هذه الصفحة.", "error");
        return;
      }

      state.user = accessStatus.user;
      state.isAdmin = accessStatus.isAdmin === true;

      const displayName = await getDisplayName(state.user);
      if (elements.name) elements.name.textContent = displayName;

      await loadFeedbacks();
    } catch (error) {
      console.error("Feedback initialization failed:", error);
      showStatus("تعذر تحميل صفحة التقييم حاليًا.", "error");
    } finally {
      hideLoading();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  window.DietPlannerFeedback = {
    init: initialize
  };
})();
