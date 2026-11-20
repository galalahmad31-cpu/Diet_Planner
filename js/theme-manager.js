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
  const syncEmbeddedFrames = (theme) => {
    if (window.parent !== window) return;
    document.querySelectorAll("iframe").forEach((frame) => {
      if (!frame.dataset.dpThemeSyncBound) {
        frame.dataset.dpThemeSyncBound = "true";
        frame.addEventListener("load", () => {
          frame.contentWindow?.postMessage({ type: "dp-theme-sync", theme: root.dataset.theme }, window.location.origin);
        });
      }
      frame.contentWindow?.postMessage({ type: "dp-theme-sync", theme }, window.location.origin);
    });
  };
  const apply = (theme) => {
    const next = valid(theme) ? theme : "light";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    setMeta("color-scheme", next);
    setMeta("theme-color", next === "dark" ? "#101B19" : "#F1F5F4");
    updateToggle();
    syncEmbeddedFrames(next);
  };
  // Embedded same-origin pages follow the parent theme even when opened before
  // the parent's preference has been persisted or restored.
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === "dp-theme-sync" && valid(event.data.theme)) apply(event.data.theme);
  });
  const save = (theme) => {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
    apply(theme);
  };
  const createToggle = () => {
    // Pages may opt out of the floating switch while still using this
    // centralized theme manager and its cross-page synchronization.
    if (!document.body) return;
    // Embedded modules inherit the host page's theme and must never
    // create a second floating switch inside the iframe.
    if (document.body.dataset.dpThemeToggle === "off" ||
        root.classList.contains("nsp-embedded") ||
        window.parent !== window) {
      document.getElementById("dp-theme-toggle")?.remove();
      return;
    }
    let button = document.getElementById("dp-theme-toggle");
    if (button) { updateToggle(); return; }
    button = document.createElement("button");
    button.type = "button";
    button.id = "dp-theme-toggle";
    button.className = "dp-theme-toggle";
    button.addEventListener("click", () => save(root.dataset.theme === "dark" ? "light" : "dark"));
    document.body.appendChild(button);
    updateToggle();
  };

  // Every page receives exactly one copy of each central stylesheet.
  // Versioning here prevents stale page-level URLs from retaining an old theme.
  const ensureCentralStylesheets = () => {
    const files = [
      ["design-tokens.css", "css/design-tokens.css?v=20261120-central-v14"],
      ["light-theme.css", "css/light-theme.css?v=20261120-central-v14"],
      ["components.css", "css/components.css?v=20261120-central-v14"],
      ["dark-theme.css", "css/dark-theme.css?v=20261120-central-v14"]
    ];
    const allLinks = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
    files.forEach(([filename, href]) => {
      const matches = allLinks.filter((node) => {
        const path = (node.getAttribute("href") || "").split("?")[0];
        return path.endsWith("/" + filename) || path === filename;
      });
      let link = matches.shift();
      matches.forEach((duplicate) => duplicate.remove());
      if (!link) {
        link = document.createElement("link");
        link.rel = "stylesheet";
        document.head.appendChild(link);
      }
      if (link.getAttribute("href") !== href) link.setAttribute("href", href);
      // Append in order so page-specific styles cannot override the central theme.
      document.head.appendChild(link);
    });
  };

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
    ensureCentralStylesheets();
    createToggle();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else initialize();
})();
