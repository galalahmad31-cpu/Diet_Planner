/* Diet Planner shared utilities. Load before page-specific scripts. */
(() => {
  "use strict";

  if (window.DPUtils) return;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }

  window.DPUtils = Object.freeze({ escapeHtml });
})();
