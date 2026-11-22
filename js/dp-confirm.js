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
    root.innerHTML = '<section class="dp-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="dpConfirmTitle" aria-describedby="dpConfirmMessage"><h2 id="dpConfirmTitle"></h2><p id="dpConfirmMessage"></p><div class="dp-confirm-actions"><button type="button" class="dp-confirm-primary" data-confirm-yes></button><button type="button" class="dp-confirm-secondary" data-confirm-no></button></div></section>';
    document.body.appendChild(root);
    root.addEventListener("click", event => {
      if (event.target === root || event.target.closest("[data-confirm-no]")) finish(false);
      if (event.target.closest("[data-confirm-yes]")) finish(true);
    });
    document.addEventListener("keydown", event => {
      if (!pending) return;
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key === "Tab") {
        const buttons = [...root.querySelectorAll("button")];
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
    root.hidden = false;
    document.body.classList.add("dp-confirm-open");
    return new Promise(resolve => {
      pending = { resolve };
      modal.querySelector("[data-confirm-no]").focus();
    });
  }

  window.DPConfirm = Object.freeze({ ask });
})();