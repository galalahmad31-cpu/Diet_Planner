(() => {
  "use strict";
  if (window.DPConfirm) return;

  let root = null;
  let pending = null;

  function ensureModal() {
    if (root?.isConnected) return root;
    root = document.createElement("div");
    root.className = "dp-confirm-backdrop";
    root.hidden = true;
    root.innerHTML = '<section class="dp-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dpConfirmTitle" aria-describedby="dpConfirmMessage"><h2 id="dpConfirmTitle"></h2><p id="dpConfirmMessage"></p><textarea class="dp-confirm-input" data-confirm-input hidden></textarea><div class="dp-confirm-actions"><button type="button" class="dp-confirm-primary" data-confirm-yes></button><button type="button" class="dp-confirm-secondary" data-confirm-no></button></div></section>';
    document.body.appendChild(root);
    root.addEventListener("click", event => {
      if (event.target === root || event.target.closest("[data-confirm-no]")) finish(false);
      if (event.target.closest("[data-confirm-yes]")) finish(root.dataset.mode === "text" ? root.querySelector("[data-confirm-input]").value : true);
    });
    document.addEventListener("keydown", event => {
      if (!pending) return;
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key === "Tab") {
        const buttons = [...root.querySelectorAll("textarea:not([hidden]),button")];
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    return root;
  }

  function finish(confirmed) {
    if (!pending) return;
    const resolve = pending.resolve;
    pending = null;
    root.hidden = true;
    root.dataset.mode = "confirm";
    document.body.classList.remove("dp-confirm-open");
    resolve(confirmed);
  }

  function ask(options = {}) {
    if (pending) finish(false);
    const modal = ensureModal();
    modal.querySelector("#dpConfirmTitle").textContent = options.title || "تأكيد الإجراء";
    modal.querySelector("#dpConfirmMessage").textContent = options.message || "هل تريد المتابعة؟";
    const yes = modal.querySelector("[data-confirm-yes]");
    yes.textContent = options.confirmText || "تأكيد";
    yes.classList.toggle("is-danger", options.variant === "danger");
    modal.querySelector("[data-confirm-no]").textContent = options.cancelText || "إلغاء";
    root.dataset.mode = "confirm";
    const input = modal.querySelector("[data-confirm-input]");
    input.hidden = true;
    input.value = "";
    root.hidden = false;
    document.body.classList.add("dp-confirm-open");
    return new Promise(resolve => {
      pending = { resolve };
      modal.querySelector("[data-confirm-no]").focus();
    });
  }

  function askText(options = {}) {
    if (pending) finish(null);
    const modal = ensureModal();
    modal.querySelector("#dpConfirmTitle").textContent = options.title || "إدخال ملاحظة";
    modal.querySelector("#dpConfirmMessage").textContent = options.message || "اكتب الملاحظة المطلوبة.";
    const input = modal.querySelector("[data-confirm-input]");
    input.hidden = false;
    input.value = options.value || "";
    input.placeholder = options.placeholder || "اكتب هنا...";
    input.rows = options.rows || 4;
    const yes = modal.querySelector("[data-confirm-yes]");
    yes.textContent = options.confirmText || "متابعة";
    yes.classList.toggle("is-danger", options.variant === "danger");
    modal.querySelector("[data-confirm-no]").textContent = options.cancelText || "إلغاء";
    root.dataset.mode = "text";
    root.hidden = false;
    document.body.classList.add("dp-confirm-open");
    return new Promise(resolve => {
      pending = { resolve };
      input.focus();
    });
  }

  function close() { if (pending) finish(false); }

  window.DPConfirm = Object.freeze({ ask, askText, close });
  window.DietPlannerConfirm = Object.freeze({ ask(title, message, action) {
    if (typeof action !== "function") return;
    void ask({ title, message }).then(confirmed => { if (confirmed) return action(); });
  } });
})();