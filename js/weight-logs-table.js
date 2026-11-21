(() => {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const adherenceLabels = { excellent:"ممتاز", good:"جيد", fair:"متوسط", poor:"ضعيف" };
  const number = (value, suffix = "") => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(1) + suffix : "—";
  };
  const date = value => {
    if (!value) return "—";
    const parsed = new Date(String(value).slice(0,10) + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleDateString("ar-EG",{day:"2-digit",month:"short",year:"numeric"});
  };
  function render({container,logs,actionCell,emptyMessage="لا توجد قياسات مسجلة لهذا المريض."}) {
    if (!container) throw new Error("عنصر جدول القياسات غير موجود في الصفحة.");
    const rows = Array.isArray(logs) ? logs : [];
    const body = rows.length ? rows.map((log,index) => {
      const actions = typeof actionCell === "function" ? actionCell(log,index) : "";
      return `<tr>
        <td data-label="التاريخ">${date(log.date)}</td>
        <td data-label="الوزن (كجم)" class="measurement-weight">${number(log.weight)}</td>
        <td data-label="نسبة الدهون">${number(log.bodyFat,"%")}</td>
        <td data-label="نسبة العضلات">${number(log.muscle,"%")}</td>
        <td data-label="نسبة الماء">${number(log.water,"%")}</td>
        <td data-label="محيط الوسط (سم)">${number(log.waist)}</td>
        <td data-label="محيط الأرداف (سم)">${number(log.hip)}</td>
        <td data-label="الالتزام">${escapeHtml(adherenceLabels[log.adherence]||"—")}</td>
        <td data-label="ملاحظات المريض" class="measurement-notes-cell">${escapeHtml(log.notes||"—")}</td>
        <td data-label="إجراء" class="no-print measurement-row-actions">${actions}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="10" class="measurements-state">${escapeHtml(emptyMessage)}</td></tr>`;
    const bodyId = container.id === "weightTableContainer" ? "weightTableBody" : "portalMeasurementsRows";
    container.innerHTML = `
      <div class="measurements-table-heading"><div><h3>سجل القياسات</h3><p>تاريخ وقياسات المريض المسجلة بترتيب زمني</p></div><span class="measurements-table-unit">الوزن ومحيطات الجسم</span></div>
      <div class="measurements-table-wrap" role="region" aria-label="جدول سجل القياسات" tabindex="0">
        <table class="measurements-table">
          <caption class="measurements-table-caption">سجل قياسات المريض: التاريخ والوزن ونسب الدهون والعضلات والماء ومحيطات الجسم والالتزام والملاحظات</caption>
          <thead><tr>
            <th scope="col">التاريخ</th><th scope="col">الوزن <span>(كجم)</span></th>
            <th scope="col">نسبة الدهون <span>(%)</span></th><th scope="col">نسبة العضلات <span>(%)</span></th>
            <th scope="col">نسبة الماء <span>(%)</span></th><th scope="col">محيط الوسط <span>(سم)</span></th>
            <th scope="col">محيط الأرداف <span>(سم)</span></th><th scope="col">الالتزام الغذائي</th>
            <th scope="col">ملاحظات المريض</th><th scope="col" class="no-print">إجراء</th>
          </tr></thead><tbody id="${bodyId}">${body}</tbody>
        </table>
      </div>`;
  }
  window.DietPlannerWeightLogs = Object.freeze({render});
})();
