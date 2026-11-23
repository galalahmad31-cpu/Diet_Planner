(function(){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const boundRoots=new WeakSet();
function renderTable(rows,{editable=true,caption='أصناف الوجبة'}={}){
 const list=Array.isArray(rows)?rows:[];
 const body=list.map((row,index)=>{
  const key=esc(row.key??index);
  return '<tr class="dpb-row" data-dpb-key="'+key+'">'+
   '<td class="dpb-food">'+esc(row.name||'صنف غير موجود')+'</td>'+
   '<td class="dpb-grams">'+(editable?'<input type="number" min="0" step="1" data-dpb-field="grams" value="'+esc(row.grams??0)+'" aria-label="الكمية بالجرام"><span>جم</span>':esc(row.grams??0)+' جم')+'</td>'+
   '<td class="dpb-household">'+esc(row.household||'—')+'</td>'+
   '<td class="dpb-notes">'+(editable?'<input type="text" data-dpb-field="notes" value="'+esc(row.notes||'')+'" placeholder="ملاحظة الصنف" aria-label="ملاحظة الصنف">':esc(row.notes||'—'))+'</td>'+
   (editable?'<td class="dpb-actions no-print"><button type="button" data-dpb-delete aria-label="حذف الصنف" title="حذف الصنف">حذف</button></td>':'')+
  '</tr>';
 }).join('');
 return '<div class="dpb-table-wrap"><table class="dpb-table"><caption class="dpb-caption">'+esc(caption)+'</caption><thead><tr><th>الصنف</th><th>الكمية</th><th>المقياس المنزلي</th><th>ملاحظة</th>'+(editable?'<th class="no-print">إجراء</th>':'')+'</tr></thead><tbody>'+(body||'<tr><td colspan="'+(editable?5:4)+'" class="dpb-empty">لا توجد أصناف مضافة لهذه الوجبة بعد</td></tr>')+'</tbody></table></div>';
}
function bind(root,handlers){
 if(!root)return;
 if(!boundRoots.has(root)){
  root.addEventListener('input',event=>{
   const field=event.target.closest('[data-dpb-field]');
   if(!field)return;
   const row=field.closest('[data-dpb-key]');
   handlers.onInput?.({key:row?.dataset.dpbKey,field:field.dataset.dpbField,value:field.value,row});
  });
  root.addEventListener('change',event=>{
   const field=event.target.closest('[data-dpb-field]');
   if(!field)return;
   const row=field.closest('[data-dpb-key]');
   handlers.onChange?.({key:row?.dataset.dpbKey,field:field.dataset.dpbField,value:field.value,row});
  });
  root.addEventListener('click',event=>{
   const button=event.target.closest('[data-dpb-delete]');
   if(!button)return;
   const row=button.closest('[data-dpb-key]');
   handlers.onDelete?.({key:row?.dataset.dpbKey,row});
  });
  boundRoots.add(root);
 }
}
window.DietPlannerDietBuilder=Object.freeze({renderTable,bind});
})();