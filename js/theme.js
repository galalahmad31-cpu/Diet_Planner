/* Compatibility loader: the single theme controller lives in theme-manager.js. */
(() => {
  if (window.__DIET_PLANNER_THEME_MANAGER_LOADED__) return;
  window.__DIET_PLANNER_THEME_MANAGER_LOADED__ = true;
  // Apply the stored theme before the external manager loads to avoid a light-mode flash.
  try {
    const saved = localStorage.getItem("diet-planner-theme");
    const initial = saved === "dark" || saved === "light"
      ? saved
      : (window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light");
    document.documentElement.dataset.theme = initial;
    document.documentElement.style.colorScheme = initial;
  } catch (_) {}
  const script = document.createElement("script");
  script.src = "js/theme-manager.js?v=20261120-central-v11";
  script.async = false;
  document.head.appendChild(script);
})();