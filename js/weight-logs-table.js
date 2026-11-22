(() => {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const adherenceLabels = { excellent:"ممتاز", good:"جيد", fair:"متوسط", poor:"ضعيف" };
  const number = (value, suffix = "") => {
    if (value === null || value === undefined || value === "") return "—";
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `<bdi dir="ltr" class="measurement-number">${parsed.toFixed(1)}${escapeHtml(suffix)}</bdi>` : "—";
  };
  const date = value => {
    if (!value) return "—";
    const parsed = new Date(String(value).slice(0,10) + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleDateString("ar-EG",{day:"2-digit",month:"short",year:"numeric"});
  };
  function createEditorRow(log = null) {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const row = document.createElement("tr");
    row.className = "measurement-entry-row";
    row.dataset.measurementEditor = "true";
    if (log?.id) row.dataset.measurementEditorId = String(log.id);
    row.innerHTML = '<td><input data-field="date" type="date" required aria-label="تاريخ القياس"></td>' +
      '<td><input data-field="weight" type="number" min="0.1" step="0.1" required aria-label="الوزن بالكيلوجرام"></td>' +
      '<td><input data-field="bodyFat" type="number" min="0" max="100" step="0.1" aria-label="نسبة الدهون"></td>' +
      '<td><input data-field="muscle" type="number" min="0" max="100" step="0.1" aria-label="نسبة العضلات"></td>' +
      '<td><input data-field="water" type="number" min="0" max="100" step="0.1" aria-label="نسبة الماء"></td>' +
      '<td><input data-field="waist" type="number" min="0.1" step="0.1" aria-label="محيط الوسط"></td>' +
      '<td><input data-field="hip" type="number" min="0.1" step="0.1" aria-label="محيط الأرداف"></td>' +
      '<td><select data-field="adherence" aria-label="الالتزام الغذائي"><option value="">لم يحدد</option><option value="excellent">ممتاز</option><option value="good">جيد</option><option value="fair">متوسط</option><option value="poor">ضعيف</option></select></td>' +
      '<td><textarea data-field="notes" rows="2" aria-label="ملاحظات المريض"></textarea></td>' +
      '<td class="measurement-entry-actions"><button type="button" class="measurement-save-button" data-measurement-save>حفظ</button><button type="button" class="measurement-cancel-button" data-measurement-cancel>إلغاء</button></td>';
    const values = {date:log?.date || localDate,weight:log?.weight ?? "",bodyFat:log?.bodyFat ?? "",muscle:log?.muscle ?? "",water:log?.water ?? "",waist:log?.waist ?? "",hip:log?.hip ?? "",adherence:log?.adherence || "",notes:log?.notes || ""};
    Object.entries(values).forEach(([key,value]) => { const field=row.querySelector('[data-field="'+key+'"]'); if(field) field.value=String(value); });
    return row;
  }

  function render({container,logs,actionCell,addDisabled=false,emptyMessage="لا توجد قياسات مسجلة لهذا المريض."}) {
    if (!container) throw new Error("عنصر جدول القياسات غير موجود في الصفحة.");
    const rows = Array.isArray(logs) ? logs : [];
    const body = rows.length ? rows.map((log,index) => {
      const actions = typeof actionCell === "function" ? actionCell(log,index) : "";
      return `<tr${log.id ? ` data-measurement-id="${escapeHtml(log.id)}"` : ""}>
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
      <div class="measurements-table-heading"><h3>سجل القياسات</h3><div class="measurements-table-tools"><button type="button" class="measurements-add-button" data-add-measurement ${addDisabled ? "disabled" : ""}>＋ إضافة قياس</button></div></div>
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
  window.DietPlannerWeightLogs = Object.freeze({render,createEditorRow});
})();
