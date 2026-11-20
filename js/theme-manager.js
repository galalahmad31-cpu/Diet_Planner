/* Diet Planner — centralized theme manager */
(() => {
  "use strict";
  const STORAGE_KEY = "diet-planner-theme";
  const root = document.documentElement;
  const valid = (value) => value === "dark" || value === "light";
  const stored = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (valid(value)) return value;
    } catch (_) {}
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  };
  const setMeta = (name, value) => {
    let meta = document.querySelector('meta[name="' + name + '"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = name;
      document.head.appendChild(meta);
    }
    meta.content = value;
  };
  const updateToggle = () => {
    const button = document.getElementById("dp-theme-toggle");
    if (!button) return;
    const dark = root.dataset.theme === "dark";
    button.textContent = dark ? "☀️" : "🌙";
    button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    button.title = dark ? "Light mode" : "Dark mode";
  };
  const apply = (theme) => {
    const next = valid(theme) ? theme : "light";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    setMeta("color-scheme", next);
    setMeta("theme-color", next === "dark" ? "#101B19" : "#F1F5F4");
    updateToggle();
  };
  const save = (theme) => {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
    apply(theme);
  };
  const createToggle = () => {
    let button = document.getElementById("dp-theme-toggle");
    if (button) { updateToggle(); return; }
    if (!document.body) return;
    button = document.createElement("button");
    button.type = "button";
    button.id = "dp-theme-toggle";
    button.className = "dp-theme-toggle";
    button.addEventListener("click", () => save(root.dataset.theme === "dark" ? "light" : "dark"));
    document.body.appendChild(button);
    updateToggle();
  };
  // Keep the central dark theme after page and component styles.
  const normalizeThemeStylesheetOrder = () => {
    const link = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))
      .find((node) => /(?:^|\/)dark-theme\.css(?:\?|$)/.test(node.getAttribute("href") || ""));
    if (link && link.parentNode) link.parentNode.appendChild(link);
  };
  // Apply the saved mode immediately; stylesheet ordering is normalized before UI initialization.
  apply(stored());
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", (event) => {
    try { if (localStorage.getItem(STORAGE_KEY)) return; } catch (_) {}
    apply(event.matches ? "dark" : "light");
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    apply(valid(event.newValue) ? event.newValue : stored());
  });
  window.DietPlannerTheme = {
    get: () => root.dataset.theme || stored(),
    set: save,
    toggle: () => save(root.dataset.theme === "dark" ? "light" : "dark")
  };
  const initialize = () => {
    normalizeThemeStylesheetOrder();
    createToggle();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else initialize();
})();