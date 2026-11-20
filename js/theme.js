/* Compatibility loader: the single theme controller lives in theme-manager.js. */
(() => {
  if (window.__DIET_PLANNER_THEME_MANAGER_LOADED__) return;
  window.__DIET_PLANNER_THEME_MANAGER_LOADED__ = true;
  const script = document.createElement("script");
  script.src = "js/theme-manager.js?v=20261120-central-v1";
  script.defer = true;
  document.head.appendChild(script);
})();