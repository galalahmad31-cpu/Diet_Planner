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
  const ALLOWED_ATTR = ['href', 'title', 'colspan', 'rowspan', 'dir', 'lang', 'style'];

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

    const clean = window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math']
    });

    // Rich-text editors need a few presentation styles. Keep only known-safe
    // properties and reject URLs, expressions, custom properties, and markup.
    const holder = document.createElement('div');
    holder.innerHTML = clean;
    const allowedStyles = new Set([
      'color', 'background-color', 'font-size', 'font-weight',
      'font-style', 'text-decoration', 'text-align'
    ]);

    holder.querySelectorAll('[style]').forEach((element) => {
      const accepted = [];
      const declarations = element.getAttribute('style').split(';');
      declarations.forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator < 1) return;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = declaration.slice(separator + 1).trim();
        if (!allowedStyles.has(property) || !value || /url\\s*\\(|expression\\s*\\(|[<>]/i.test(value)) return;

        let valid = false;
        if (property === 'font-size') {
          valid = /^(?:\\d{1,3}(?:\\.\\d+)?(?:px|pt|em|rem|%)|xx-small|x-small|small|medium|large|x-large|xx-large)$/i.test(value);
        } else if (property === 'text-align') {
          valid = /^(?:left|right|center|justify|start|end)$/i.test(value);
        } else if (property === 'font-weight') {
          valid = /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(value);
        } else if (property === 'font-style') {
          valid = /^(?:normal|italic|oblique)$/i.test(value);
        } else if (property === 'text-decoration') {
          valid = /^(?:none|underline|line-through|overline)$/i.test(value);
        } else {
          valid = /^(?:#[0-9a-f]{3,8}|rgba?\\([\\d\\s.,%]+\\)|hsla?\\([\\d\\s.,%deg]+\\)|[a-z]{1,24})$/i.test(value);
        }
        if (valid) accepted.push([property, value]);
      });

      element.removeAttribute('style');
      accepted.forEach(([property, value]) => element.style.setProperty(property, value));
    });
    return holder.innerHTML;
  }

  window.DietPlannerSecurity = Object.freeze({
    escapeHtml,
    sanitizeRichHtml
  });
})(window, document);
