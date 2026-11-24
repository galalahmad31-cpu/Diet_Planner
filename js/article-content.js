/* Diet Planner — shared rich-content sanitizer for article editing and display. */
(() => {
  "use strict";
  if (window.DietPlannerArticleContent) return;

  const ALLOWED_TAGS = new Set([
    "A","B","BLOCKQUOTE","BR","DIV","EM","H1","H2","H3","H4","H5","H6",
    "I","LI","OL","P","SPAN","STRONG","SUB","SUP","TABLE","TBODY","TD",
    "TFOOT","TH","THEAD","TR","U","UL"
  ]);
  const DROP_TAGS = new Set([
    "SCRIPT","STYLE","IFRAME","OBJECT","EMBED","FORM","INPUT","BUTTON",
    "TEXTAREA","SELECT","OPTION","SVG","MATH","TEMPLATE","LINK","META",
    "BASE","VIDEO","AUDIO","SOURCE","IMG","NOSCRIPT"
  ]);

  function sanitizeStyle(value) {
    const allowed = {
      color: /^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i,
      "background-color": /^(#[0-9a-f]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i,
      "font-size": /^\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%)$/i,
      "text-align": /^(left|right|center|justify|start|end)$/i,
      direction: /^(ltr|rtl)$/i,
      "font-weight": /^(normal|bold|[1-9]00)$/i,
      "font-style": /^(normal|italic|oblique)$/i,
      "text-decoration": /^(none|underline|line-through|overline)$/i
    };
    return String(value || "").split(";").map(rule => {
      const index = rule.indexOf(":");
      if (index < 1) return "";
      const property = rule.slice(0, index).trim().toLowerCase();
      const val = rule.slice(index + 1).trim();
      return allowed[property]?.test(val) ? property + ":" + val : "";
    }).filter(Boolean).join(";");
  }

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
    const clean = parent => Array.from(parent.childNodes).forEach(node => {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); return; }
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }
      const tag = node.tagName;
      if (DROP_TAGS.has(tag)) { node.remove(); return; }
      if (!ALLOWED_TAGS.has(tag)) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
        return;
      }
      Array.from(node.attributes).forEach(attr => {
        const name = attr.name.toLowerCase(), value = attr.value.trim();
        if (name === "dir") {
          if (!/^(ltr|rtl|auto)$/i.test(value)) node.removeAttribute(attr.name);
        } else if (tag === "A" && name === "href") {
          if (!/^(https?:|mailto:|#|\/(?!\/))/i.test(value)) node.removeAttribute(attr.name);
        } else if (name === "style") {
          const style = sanitizeStyle(value);
          if (style) node.setAttribute("style", style);
          else node.removeAttribute("style");
        } else if ((tag === "TD" || tag === "TH") && (name === "colspan" || name === "rowspan")) {
          if (!/^[1-9]\d{0,2}$/.test(value)) node.removeAttribute(attr.name);
        } else node.removeAttribute(attr.name);
      });
      if (tag === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      clean(node);
    });
    clean(doc.body);
    return doc.body.innerHTML;
  }

  window.DietPlannerArticleContent = Object.freeze({ sanitize });
})();
