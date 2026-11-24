(() => {
  "use strict";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const instances = new WeakMap();
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);

  function create(container) {
    const state = { patientId:null, canEdit:()=>false, rows:[], db:window.DietPlannerAccess?.supabaseClient, loading:false, saving:false };
    const root = container;
    const fields = [
      ["test_name","اسم التحليل","text",160],
      ["result_value","النتيجة","text",120],
      ["unit","الوحدة","text",40],
      ["reference_range","المدى المرجعي","text",120],
      ["notes","ملاحظات","text",1000]
    ];
    function editor(row = null) {
      const tr = document.createElement("tr");
      tr.className = "lab-entry-row";
      tr.dataset.labEditor = "true";
      if (row?.id) tr.dataset.labId = row.id;
      tr.innerHTML = '<td><input type="date" data-lab-field="test_date" required aria-label="تاريخ التحليل"></td>' +
        fields.map(([key,label,type,max]) => '<td><input type="'+type+'" data-lab-field="'+key+'" maxlength="'+max+'" aria-label="'+label+'" '+(key==="test_name"||key==="result_value"?"required":"")+'></td>').join("") +
        '<td class="no-print lab-actions"><button type="button" data-lab-save>حفظ</button><button type="button" data-lab-cancel>إلغاء</button></td>';
      tr.querySelector('[data-lab-field="test_date"]').value = row?.test_date || today();
      fields.forEach(([key]) => { tr.querySelector('[data-lab-field="'+key+'"]').value = row?.[key] || ""; });
      return tr;
    }
    function render() {
      const editable = !!state.canEdit();
      const body = state.rows.map((row,index) => '<tr data-lab-row="'+esc(row.id)+'">' +
        '<td data-label="التاريخ">'+esc(row.test_date)+'</td>' +
        '<td data-label="اسم التحليل" class="lab-name">'+esc(row.test_name)+'</td>' +
        '<td data-label="النتيجة" class="lab-value">'+esc(row.result_value)+'</td>' +
        '<td data-label="الوحدة">'+esc(row.unit || "—")+'</td>' +
        '<td data-label="المدى المرجعي">'+esc(row.reference_range || "—")+'</td>' +
        '<td data-label="ملاحظات" class="lab-notes">'+esc(row.notes || "—")+'</td>' +
        (editable ? '<td class="no-print lab-actions"><button type="button" data-lab-edit="'+index+'">تعديل</button><button type="button" data-lab-delete="'+index+'">حذف</button></td>' : '') +
        '</tr>').join("");
      root.innerHTML = '<div class="lab-table-heading"><h3>سجل التحاليل</h3>' +
        (editable ? '<button type="button" class="lab-add-button" data-lab-add>＋ إضافة تحليل</button>' : '<span class="lab-readonly">للعرض فقط</span>') +
        '</div><div class="lab-table-wrap" role="region" aria-label="جدول نتائج التحاليل" tabindex="0"><table class="lab-table"><caption class="lab-caption">نتائج التحاليل المسجلة للمريض</caption><thead><tr><th>التاريخ</th><th>اسم التحليل</th><th>النتيجة</th><th>الوحدة</th><th>المدى المرجعي</th><th>ملاحظات</th>'+(editable?'<th class="no-print">إجراء</th>':'')+'</tr></thead><tbody id="labResultsBody">'+(body || '<tr><td colspan="'+(editable?7:6)+'" class="lab-empty">لا توجد تحاليل مسجلة.</td></tr>')+'</tbody></table></div>';
    }
    function openNew() {
      if (!state.canEdit()) return;
      if (root.querySelector('[data-lab-editor]')) return;
      const body = root.querySelector("#labResultsBody");
      if (!body) return;
      const empty = body.querySelector(".lab-empty");
      if (empty) body.replaceChildren();
      const row = editor();
      body.prepend(row);
      row.querySelector('[data-lab-field="test_name"]')?.focus();
    }
    function openEdit(index) {
      if (!state.canEdit() || root.querySelector('[data-lab-editor]')) return;
      const record = state.rows[index];
      const target = root.querySelector('[data-lab-row="'+CSS.escape(String(record?.id || ""))+'"]');
      if (!record || !target) return;
      target.replaceWith(editor(record));
      root.querySelector('[data-lab-editor] [data-lab-field="test_name"]')?.focus();
    }
    async function save(row) {
      if (!row || state.saving || !state.canEdit()) return;
      const value = key => String(row.querySelector('[data-lab-field="'+key+'"]')?.value || "").trim();
      const record = {
        patient_id:state.patientId, test_date:value("test_date"),
        test_name:value("test_name"), result_value:value("result_value"),
        unit:value("unit") || null, reference_range:value("reference_range") || null,
        notes:value("notes") || null
      };
      if (!record.test_date || !record.test_name || !record.result_value) {
        alert("أدخل التاريخ واسم التحليل والنتيجة.");
        return;
      }
      state.saving = true;
      const saveButton = row.querySelector("[data-lab-save]");
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = "جارٍ الحفظ"; }
      try {
        const id = row.dataset.labId || "";
        let query = id
          ? state.db.from("patient_lab_results").update(record).eq("id",id).eq("patient_id",state.patientId)
          : state.db.from("patient_lab_results").insert(record);
        const {data,error} = await query.select("id,patient_id,test_date,test_name,result_value,unit,reference_range,notes,created_at").single();
        if (error) throw error;
        state.rows = id ? state.rows.map(item => item.id===id ? data : item) : [data,...state.rows];
        state.rows.sort((a,b)=>String(b.test_date).localeCompare(String(a.test_date)) || String(b.created_at).localeCompare(String(a.created_at)));
        render();
      } catch (error) {
        console.error("Patient lab save failed:",error);
        alert(error?.message || "تعذر حفظ نتيجة التحليل. تحقق من الاتصال والصلاحيات.");
        if (saveButton) { saveButton.disabled=false; saveButton.textContent="حفظ"; }
      } finally { state.saving=false; }
    }
    root.addEventListener("click", async event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.hasAttribute("data-lab-add")) openNew();
      else if (button.hasAttribute("data-lab-cancel")) render();
      else if (button.hasAttribute("data-lab-save")) void save(button.closest("[data-lab-editor]"));
      else if (button.hasAttribute("data-lab-edit")) openEdit(Number(button.dataset.labEdit));
      else if (button.hasAttribute("data-lab-delete") && state.canEdit()) {
        const record = state.rows[Number(button.dataset.labDelete)];
        if (!record) return;
        const confirmed = await window.DPConfirm?.ask({title:"حذف نتيجة التحليل؟",message:"سيتم حذف نتيجة التحليل المحددة.",confirmText:"حذف",variant:"danger"});
        if (!confirmed) return;
        const {error} = await state.db.from("patient_lab_results").delete().eq("id",record.id).eq("patient_id",state.patientId);
        if (error) { console.error(error); alert("تعذر حذف نتيجة التحليل."); return; }
        state.rows = state.rows.filter(item=>item.id!==record.id);
        render();
      }
    });
    state.load = async () => {
      if (!state.patientId || !state.db || state.loading) return;
      state.loading = true;
      root.textContent = "جاري تحميل سجل التحاليل...";
      try {
        const {data,error} = await state.db.from("patient_lab_results")
          .select("id,patient_id,test_date,test_name,result_value,unit,reference_range,notes,created_at")
          .eq("patient_id",state.patientId).order("test_date",{ascending:false}).order("created_at",{ascending:false});
        if (error) throw error;
        state.rows = data || [];
        render();
      } catch (error) {
        console.error("Patient labs load failed:",error);
        root.textContent = "تعذر تحميل سجل التحاليل. تحقق من الاتصال والصلاحيات.";
      } finally { state.loading=false; }
    };
    return state;
  }
  async function init({container,patientId,canEdit=()=>false}={}) {
    if (!container || !patientId) return;
    let state = instances.get(container);
    if (!state) { state=create(container); instances.set(container,state); }
    state.patientId=patientId; state.canEdit=canEdit; state.rows=[];
    await state.load();
  }
  window.DietPlannerLabResults = Object.freeze({init});
})();
