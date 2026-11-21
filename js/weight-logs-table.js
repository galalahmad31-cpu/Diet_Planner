(() => {
  "use strict";

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  const adherenceLabels = { excellent: "ممتاز", good: "جيد", fair: "متوسط", poor: "ضعيف" };
  const number = (value, suffix = "") => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(1) + suffix : "—";
  };
  const date = value => {
    if (!value) return "—";
    const parsed = new Date(String(value).slice(0, 10) + "T00:00:00");
    return Number.isNaN(parsed.getTime())
      ? escapeHtml(value)
      : parsed.toLocaleDateString("ar-EG", { day: "2-digit", month: "short", year: "numeric" });
  };

  function render({ tbody, logs, actionCell, emptyMessage = "لا توجد قياسات مسجلة لهذا المريض." }) {
    if (!tbody) return;
    if (!Array.isArray(logs) || !logs.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="measurements-state">' + escapeHtml(emptyMessage) + "</td></tr>";
      return;
    }

    tbody.innerHTML = logs.map((log, index) => {
      const actions = typeof actionCell === "function" ? actionCell(log, index) : "";
      return `<tr>
        <td data-label="التاريخ">${date(log.date)}</td>
        <td data-label="الوزن (كجم)" class="measurement-weight">${number(log.weight)}</td>
        <td data-label="نسبة الدهون">${number(log.bodyFat, "%")}</td>
        <td data-label="نسبة العضلات">${number(log.muscle, "%")}</td>
        <td data-label="نسبة الماء">${number(log.water, "%")}</td>
        <td data-label="محيط الوسط (سم)">${number(log.waist)}</td>
        <td data-label="محيط الأرداف (سم)">${number(log.hip)}</td>
        <td data-label="الالتزام">${escapeHtml(adherenceLabels[log.adherence] || "—")}</td>
        <td data-label="ملاحظات المريض" class="measurement-notes-cell">${escapeHtml(log.notes || "—")}</td>
        <td data-label="إجراء" class="no-print measurement-row-actions">${actions}</td>
      </tr>`;
    }).join("");
  }

  window.DietPlannerWeightLogs = Object.freeze({ render });
})();
