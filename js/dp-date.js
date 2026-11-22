/* Diet Planner shared calendar-date utilities. Load before dependent page scripts. */
(() => {
  "use strict";

  if (window.DPDate) return;

  function dateKey(value) {
    const key = String(value ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
  }

  function todayKey() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
  }

  function daysUntil(targetDate, referenceDate) {
    const target = dateKey(targetDate);
    const reference = dateKey(referenceDate);
    if (!target || !reference) return NaN;

    const [ty, tm, td] = target.split("-").map(Number);
    const [ry, rm, rd] = reference.split("-").map(Number);
    const targetUtc = Date.UTC(ty, tm - 1, td);
    const referenceUtc = Date.UTC(ry, rm - 1, rd);
    return Math.round((targetUtc - referenceUtc) / 86400000);
  }

  function addMonths(value, months) {
    const key = dateKey(value);
    const monthCount = Number(months);
    if (!key || !Number.isFinite(monthCount) || monthCount === 0) return "";

    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setMonth(date.getMonth() + monthCount);

    if (!Number.isFinite(date.getTime())) return "";

    // Preserve the source date's day when possible; otherwise use month end.
    if (date.getDate() !== day) date.setDate(0);

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  window.DPDate = Object.freeze({ dateKey, todayKey, daysUntil, addMonths });
})();
