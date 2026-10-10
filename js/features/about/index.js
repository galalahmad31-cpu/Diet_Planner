const db = window.DietPlannerAccess?.supabaseClient;

const state = {
  isAdmin: false,
  sections: [],
  deletingId: null,
  linkEditorId: null,
  linkSelection: null
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setAdminUI() {
  const button = $("addSectionBtn");
  if (button) button.classList.toggle("hidden", !state.isAdmin);
}

function showEmpty(message) {
  const empty = $("emptyState");
  const hint = $("emptyHint");
  if (!empty) return;
  empty.classList.remove("hidden");
  if (hint) hint.textContent = message;
}

function closeDeleteModal() {
  state.deletingId = null;
  $("deleteModal")?.classList.add("hidden");
  $("deleteModal")?.classList.remove("flex");
}

function openDeleteModal(id) {
  if (!state.isAdmin) return;
  state.deletingId = id;
  $("deleteModal")?.classList.remove("hidden");
  $("deleteModal")?.classList.add("flex");
}

function openLinkModal(id) {
  if (!state.isAdmin) return;

  const editor = $("editor-" + id);
  if (!editor) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
    alert("حدد النص أو الرمز الذي تريد ربطه أولاً.");
    return;
  }

  state.linkEditorId = id;
  state.linkSelection = selection.getRangeAt(0).cloneRange();

  const modal = $("linkModal");
  const input = $("linkUrlInput");
  if (!modal || !input) return;

  input.value = "https://";
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeLinkModal() {
  state.linkEditorId = null;
  state.linkSelection = null;
  $("linkModal")?.classList.add("hidden");
  $("linkModal")?.classList.remove("flex");
}

function applyLink() {
  const id = state.linkEditorId;
  const editor = id ? $("editor-" + id) : null;
  const input = $("linkUrlInput");
  if (!editor || !input) return;

  const url = input.value.trim();
  if (!url) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    input.focus();
    input.select();
    alert("يرجى إدخال رابط صحيح.");
    return;
  }

  if (!["http:", "https:", "mailto:", "tel:"].includes(parsedUrl.protocol)) {
    input.focus();
    input.select();
    alert("نوع الرابط غير مدعوم.");
    return;
  }

  editor.focus();
  const selection = window.getSelection();
  selection?.removeAllRanges();
  if (state.linkSelection) selection?.addRange(state.linkSelection);

  document.execCommand("createLink", false, url);

  editor.querySelectorAll("a").forEach(link => {
    if (link.href === url || link.getAttribute("href") === url) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });

  autoGrow(editor);
  closeLinkModal();
}

function toolbarHtml(id) {
  const commands = [
    ["bold", "fa-bold", "عريض"],
    ["italic", "fa-italic", "مائل"],
    ["underline", "fa-underline", "تحته خط"],
    ["insertUnorderedList", "fa-list-ul", "قائمة"],
    ["insertOrderedList", "fa-list-ol", "قائمة مرقمة"],
    ["justifyRight", "fa-align-right", "محاذاة يمين"],
    ["justifyCenter", "fa-align-center", "توسيط"],
    ["justifyLeft", "fa-align-left", "محاذاة يسار"],
    ["createLink", "fa-link", "إضافة رابط"],
    ["removeFormat", "fa-eraser", "إزالة التنسيق"]
  ];
  return `<div class="toolbar flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3 mb-3">
    ${commands.map(([cmd, icon, title]) => `
      <button type="button" data-cmd="${cmd}" data-id="${id}" title="${title}">
        <i class="fa-solid ${icon}"></i>
      </button>`).join("")}
  </div>`;
}

function editorHtml(section) {
  return `<article class="section-card glass rounded-3xl p-5 sm:p-6" data-section-id="${section.id}">
    ${toolbarHtml(section.id)}
    <input data-field="title" data-id="${section.id}"
      value="${escapeHtml(section.title)}"
      placeholder="عنوان المربع"
      class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-extrabold text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
    <div id="editor-${section.id}" contenteditable="true" dir="auto"
      data-placeholder="اكتب محتوى المربع هنا..."
      class="editor mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 focus:border-brand-500 focus:ring-2 focus:ring-brand-100">${section.content || ""}</div>
    <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
      <button type="button" data-action="save" data-id="${section.id}" class="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-extrabold text-white hover:bg-brand-700">
        <i class="fa-solid fa-check ml-1"></i>حفظ
      </button>
      <button type="button" data-action="cancel" data-id="${section.id}" class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50">إلغاء</button>
    </div>
  </article>`;
}

function viewHtml(section) {
  const index = state.sections.findIndex(item => item.id === section.id);
  const canMoveUp = index > 0;
  const canMoveDown = index >= 0 && index < state.sections.length - 1;

  return `<article class="section-card glass rounded-3xl p-5 sm:p-6" data-section-id="${section.id}">
    ${section.title ? `<h3 class="text-lg font-black text-slate-800">${escapeHtml(section.title)}</h3>` : ""}
    <div class="content-display ${section.title ? "mt-3" : ""} text-sm text-slate-600" dir="auto">${section.content || ""}</div>
    ${state.isAdmin ? `<div class="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
      <button type="button" data-action="move" data-direction="up" data-id="${section.id}" ${canMoveUp ? "" : "disabled"} title="تحريك لأعلى" class="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
        <i class="fa-solid fa-arrow-up"></i>
      </button>
      <button type="button" data-action="move" data-direction="down" data-id="${section.id}" ${canMoveDown ? "" : "disabled"} title="تحريك لأسفل" class="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
        <i class="fa-solid fa-arrow-down"></i>
      </button>
      <button type="button" data-action="edit" data-id="${section.id}" class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50">
        <i class="fa-solid fa-pen ml-1"></i>تعديل
      </button>
      <button type="button" data-action="delete" data-id="${section.id}" class="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-extrabold text-red-600 hover:bg-red-100">
        <i class="fa-solid fa-trash ml-1"></i>حذف
      </button>
    </div>` : ""}
  </article>`;
}

function autoGrow(editor) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = `${Math.max(120, editor.scrollHeight)}px`;
}

function render() {
  const container = $("sectionsContainer");
  const empty = $("emptyState");
  if (!container) return;

  container.innerHTML = state.sections.map(section =>
    section._editing ? editorHtml(section) : viewHtml(section)
  ).join("");

  container.querySelectorAll(".editor").forEach(autoGrow);

  if (empty) {
    empty.classList.toggle("hidden", state.sections.length > 0);
    if (!state.sections.length) {
      $("emptyHint").textContent = state.isAdmin
        ? "اضغط «إضافة مربع» لإضافة محتوى جديد."
        : "سيظهر المحتوى هنا عند إضافته.";
    }
  }
}

async function initializeUser() {
  if (!db || !window.DietPlannerAccess?.getCurrentUser) {
    throw new Error("تعذر تهيئة الاتصال الآمن بالتطبيق.");
  }

  const accessStatus = await window.DietPlannerAccess.getAccessStatus();
  if (!accessStatus?.authenticated || !accessStatus.user) {
    window.location.replace("index.html");
    return false;
  }

  state.isAdmin = accessStatus.isAdmin === true;
  setAdminUI();
  return true;
}

async function loadSections() {
  const { data, error } = await db
    .from("about_sections")
    .select("id,title,content,display_order,created_at,updated_at")
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;
  state.sections = Array.isArray(data) ? data : [];
  render();
}

async function moveSection(id, direction) {
  if (!state.isAdmin) return;

  const currentIndex = state.sections.findIndex(item => item.id === id);
  if (currentIndex < 0) return;

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= state.sections.length) return;

  const current = state.sections[currentIndex];
  const target = state.sections[targetIndex];
  const currentOrder = Number(current.display_order);
  const targetOrder = Number(target.display_order);

  if (!Number.isFinite(currentOrder) || !Number.isFinite(targetOrder)) return;

  const buttons = $("sectionsContainer")?.querySelectorAll(
    `[data-action="move"][data-id="${id}"]`
  );
  buttons?.forEach(button => {
    button.disabled = true;
  });

  const [currentResult, targetResult] = await Promise.all([
    db.from("about_sections").update({ display_order: targetOrder }).eq("id", current.id),
    db.from("about_sections").update({ display_order: currentOrder }).eq("id", target.id)
  ]);

  if (currentResult.error || targetResult.error) {
    console.error("Move about section failed:", currentResult.error || targetResult.error);
    await loadSections();
    return;
  }

  [state.sections[currentIndex], state.sections[targetIndex]] = [
    state.sections[targetIndex],
    state.sections[currentIndex]
  ];

  render();
}

function addSection() {
  if (!state.isAdmin) return;
  const nextOrder = state.sections.length
    ? Math.max(...state.sections.map(item => Number(item.display_order) || 0)) + 1
    : 0;

  const section = {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    display_order: nextOrder,
    _new: true,
    _editing: true
  };

  state.sections.push(section);
  render();
  requestAnimationFrame(() => $("editor-" + section.id)?.focus());
}

function editSection(id) {
  if (!state.isAdmin) return;
  const section = state.sections.find(item => item.id === id);
  if (!section) return;
  section._editing = true;
  render();
  requestAnimationFrame(() => $("editor-" + id)?.focus());
}

function cancelEdit(id) {
  const index = state.sections.findIndex(item => item.id === id);
  if (index < 0) return;
  if (state.sections[index]._new) state.sections.splice(index, 1);
  else delete state.sections[index]._editing;
  render();
}

async function saveSection(id) {
  if (!state.isAdmin) return;
  const section = state.sections.find(item => item.id === id);
  if (!section) return;

  const title = $("sectionsContainer")?.querySelector(`[data-field="title"][data-id="${id}"]`)?.value.trim() || "";
  const editor = $("editor-" + id);
  const content = editor?.innerHTML.trim() || "";

  if (!content || content === "<br>") {
    alert("اكتب محتوى المربع أولاً.");
    editor?.focus();
    return;
  }

  const payload = {
    title,
    content,
    display_order: Number(section.display_order) || 0
  };

  const button = $("sectionsContainer")?.querySelector(`[data-action="save"][data-id="${id}"]`);
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin ml-1"></i>جاري الحفظ...';
  }

  const request = section._new
    ? db.from("about_sections").insert(payload).select("id,title,content,display_order,created_at,updated_at").single()
    : db.from("about_sections").update(payload).eq("id", id).select("id,title,content,display_order,created_at,updated_at").single();

  const { data, error } = await request;
  if (error) {
    console.error("Save about section failed:", error);
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-check ml-1"></i>حفظ';
    }
    alert("تعذر حفظ المربع: " + error.message);
    return;
  }

  const index = state.sections.findIndex(item => item.id === id);
  state.sections[index] = data;
  render();
}

function requestDelete(id) {
  if (!state.isAdmin) return;
  if (!state.sections.some(item => item.id === id)) return;
  openDeleteModal(id);
}

async function confirmDelete() {
  const id = state.deletingId;
  if (!id || !state.isAdmin) return;

  const button = $("confirmDeleteBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "جاري الحذف...";
  }

  const { error } = await db.from("about_sections").delete().eq("id", id);
  if (error) {
    console.error("Delete about section failed:", error);
    if (button) {
      button.disabled = false;
      button.textContent = "حذف";
    }
    alert("تعذر حذف المربع: " + error.message);
    return;
  }

  state.sections = state.sections.filter(item => item.id !== id);
  if (button) {
    button.disabled = false;
    button.textContent = "حذف";
  }
  closeDeleteModal();
  render();
}

function runCommand(command, id) {
  if (!state.isAdmin) return;
  const editor = $("editor-" + id);
  if (!editor) return;

  if (command === "createLink") {
    openLinkModal(id);
    return;
  }

  editor.focus();
  document.execCommand(command, false, null);
  autoGrow(editor);
}

$("addSectionBtn")?.addEventListener("click", addSection);
$("cancelDeleteBtn")?.addEventListener("click", closeDeleteModal);
$("confirmDeleteBtn")?.addEventListener("click", confirmDelete);
$("cancelLinkBtn")?.addEventListener("click", closeLinkModal);
$("applyLinkBtn")?.addEventListener("click", applyLink);
$("linkUrlInput")?.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyLink();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeLinkModal();
  }
});
$("deleteModal")?.addEventListener("click", event => {
  if (event.target === $("deleteModal")) closeDeleteModal();
});
$("linkModal")?.addEventListener("click", event => {
  if (event.target === $("linkModal")) closeLinkModal();
});

$("sectionsContainer")?.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.cmd) return runCommand(button.dataset.cmd, id);
  if (button.dataset.action === "move") return moveSection(id, button.dataset.direction);
  if (button.dataset.action === "save") return saveSection(id);
  if (button.dataset.action === "cancel") return cancelEdit(id);
  if (button.dataset.action === "edit") return editSection(id);
  if (button.dataset.action === "delete") return requestDelete(id);
});

$("sectionsContainer")?.addEventListener("input", event => {
  if (event.target.matches(".editor")) autoGrow(event.target);
});

$("sectionsContainer")?.addEventListener("keyup", event => {
  if (event.target.matches(".editor")) autoGrow(event.target);
});

$("sectionsContainer")?.addEventListener("paste", event => {
  const editor = event.target.closest(".editor");
  if (editor) requestAnimationFrame(() => autoGrow(editor));
});

// Render the shell immediately; then authenticate and load the database content.
render();
setAdminUI();

(async function start() {
  try {
    const authenticated = await initializeUser();
    if (!authenticated) return;
    await loadSections();
  } catch (error) {
    console.error("About page initialization failed:", error);
    showEmpty("تعذر تحميل محتوى الصفحة. افتح أدوات المطور لمعرفة الخطأ التفصيلي.");
  }
})();
