/* Shared frontend security helpers.
 * Keep this file dependency-light and load it before page-specific scripts.
 */
(function (window, document) {
  'use strict';

  const ALLOWED_TAGS = [
    'a', 'b', 'blockquote', 'br', 'caption', 'div', 'em', 'h1', 'h2', 'h3',
    'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 's', 'span', 'strong',
    'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u',
    'ul'
  ];
  const ALLOWED_ATTR = ['href', 'title', 'colspan', 'rowspan', 'dir', 'lang'];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function sanitizeRichHtml(value) {
    const html = String(value ?? '');
    if (!html) return '';

    // DOMPurify is loaded from a pinned version by rich-text pages.
    // If that dependency fails to load, fail closed: display the content as text.
    if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== 'function') {
      return escapeHtml(html).replace(/\r?\n/g, '<br>');
    }

    return window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math'],
      FORBID_ATTR: ['style']
    });
  }

  window.DietPlannerSecurity = Object.freeze({
    escapeHtml,
    sanitizeRichHtml
  });
})(window, document);
