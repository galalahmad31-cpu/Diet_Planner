(function(){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const boundRoots=new WeakSet();
function renderTable(rows,{editable=true,caption='أصناف الوجبة'}={}){
 const list=Array.isArray(rows)?rows:[];
 const body=list.map((row,index)=>{
  const key=esc(row.key??index);
  return '<tr class="dpb-row" data-dpb-key="'+key+'">'+
   '<td class="dpb-food" '+(row.pickKey!==undefined?'data-pick="'+esc(row.pickKey)+'"':'')+'>'+esc(row.name||'صنف غير موجود')+'</td>'+
   '<td class="dpb-grams">'+(editable?'<input type="number" min="0" step="1" data-dpb-field="grams" value="'+esc(row.grams??0)+'" aria-label="الكمية بالجرام" '+(row.gramsChange||'')+'><span>جم</span>':esc(row.grams??0)+' جم')+'</td>'+
   '<td class="dpb-household">'+esc(row.household||'—')+'</td>'+
   '<td class="dpb-notes">'+(editable?'<input type="text" data-dpb-field="notes" value="'+esc(row.notes||'')+'" placeholder="ملاحظة الصنف" aria-label="ملاحظة الصنف" '+(row.notesChange||'')+'>':esc(row.notes||'—'))+'</td>'+
   (editable?'<td class="dpb-actions no-print"><button type="button" data-dpb-delete '+(row.deleteAction||'')+' aria-label="حذف الصنف" title="حذف الصنف">حذف</button></td>':'')+
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

function formatHouseholdNumber(value){
 const n=Number(value);
 if(!Number.isFinite(n))return '—';
 if(Math.abs(n-Math.round(n))<.0001)return String(Math.round(n));
 return String(Math.round(n*100)/100).replace(/\\.0+$/,'').replace(/(\\.\\d*?)0+$/,'$1');
}
function scaleHouseholdMeasure(measure,grams){
 if(!measure)return '—';
 const g=Number(grams);
 if(!Number.isFinite(g)||g<0)return String(measure);
 const factor=g/100;
 const arabic={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
 const fractions={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
 const normalized=String(measure).replace(/[٠-٩]/g,d=>arabic[d]);
 let text=normalized;
 Object.keys(fractions).forEach(symbol=>{text=text.replaceAll(symbol,formatHouseholdNumber(fractions[symbol]*factor));});
 text=text.replace(/(^|[^\\d.])(\\d+(?:\\.\\d+)?)(?=\\s|$|[^\\d.])/g,(match,prefix,value)=>prefix+formatHouseholdNumber(Number(value)*factor));
 return text===normalized?formatHouseholdNumber(factor)+' × '+text:text;
}
function calculateTotals(meals,foods,{foodIdKey='food_id',gramsKey='quantity_g',foodKeys={},outputKeys={}}={}){
 const map=foods instanceof Map?foods:new Map((Array.isArray(foods)?foods:[]).map(food=>[String(food.id),food]));
 const totals={kcal:0,protein:0,carb:0,fat:0,sodium:0,potassium:0,phosphorus:0};
 const sourceKeys={kcal:'kcal',protein:'protein',carb:'carb',fat:'fat',sodium:'sodium',potassium:'potassium',phosphorus:'phosphorus',...foodKeys};
 (Array.isArray(meals)?meals:[]).forEach(meal=>(Array.isArray(meal?.items)?meal.items:[]).forEach(item=>{
  const food=map.get(String(item?.[foodIdKey]??''));
  if(!food)return;
  const factor=Math.max(0,Number(item?.[gramsKey])||0)/100;
  Object.keys(totals).forEach(key=>{totals[key]+=(Number(food[sourceKeys[key]])||0)*factor;});
 }));
 return Object.keys(outputKeys).length?Object.fromEntries(Object.entries(totals).map(([key,value])=>[outputKeys[key]||key,value])):totals;
}
function renderMealCard({titleInputHtml='',actionsHtml='',rows=[],caption='أصناف الوجبة',editable=true}={}){
 return '<article class="meal-card"><header class="meal-card-header"><div class="meal-title-wrap">'+titleInputHtml+'</div><div class="meal-card-actions no-print">'+actionsHtml+'</div></header>'+renderTable(rows,{editable,caption})+'</article>';
}

window.DietPlannerDietBuilder=Object.freeze({renderTable,bind,formatHouseholdNumber,scaleHouseholdMeasure,calculateTotals,renderMealCard});
})();