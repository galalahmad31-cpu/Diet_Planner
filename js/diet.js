/* =========================================================
   Diet Planner — Diet Library
   Feature logic only. Authentication/Supabase client is centralized
   in js/auth-access.js.
   ========================================================= */
(function(){
'use strict';

const supabase = window.DietPlannerAccess?.supabaseClient;
if(!supabase){
  console.error('Diet Library: js/auth-access.js must load before this file.');
}

let user=null,isAdmin=false,foods=[],diets=[],authors={},editingId=null,activeMealIndex=null,selectedFood=null,day={day_number:1,day_name:'اليوم',meals:[]};
const $=id=>document.getElementById(id), num=v=>Number(v||0);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toast(msg,ok=true){const e=$('toast');e.textContent=msg;e.className=`fixed bottom-5 left-5 z-[150] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${ok?'bg-brand-600':'bg-red-600'}`;e.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.add('hidden'),3200)}
async function getSession(){
  if(!supabase){
    toast('تعذر تهيئة الاتصال الآمن بالتطبيق',false);
    return false;
  }
  const access=await window.DietPlannerAccess?.getAccessStatus?.();
  if(!access?.authenticated){
    location.replace('index.html');
    return false;
  }
  user=access.user;
  isAdmin=access.isAdmin;
  return true;
}
const CACHE_TTL=5*60*1000;
const cacheKey=(type)=>`diet-library:${type}:${user?.id||'guest'}`;
function readCache(type){
  try{
    const raw=localStorage.getItem(cacheKey(type));
    if(!raw)return null;
    const cached=JSON.parse(raw);
    if(!cached?.timestamp||Date.now()-cached.timestamp>CACHE_TTL)return null;
    return cached.data;
  }catch{return null}
}
function writeCache(type,data){
  try{localStorage.setItem(cacheKey(type),JSON.stringify({timestamp:Date.now(),data}))}catch{}
}
function clearCache(type){
  try{localStorage.removeItem(cacheKey(type))}catch{}
}
async function loadFoods(force=false){
  if(!force&&foods.length)return true;
  if(!force){
    const cached=readCache('foods');
    if(cached){
      foods=cached;
      return true;
    }
  }
  const {data,error}=await supabase.from('foods').select('id,name_ar,name_en,is_custom,household,kcal,protein,carb,fat,sodium,potassium,phosphorus').order('name_ar',{ascending:true});
  if(error){
    toast('تعذر تحميل مكتبة الأغذية: '+error.message,false);
    return false;
  }
  foods=(data||[]).map(f=>({...f,id:String(f.id),is_custom:Boolean(f.is_custom),kcal:num(f.kcal),protein:num(f.protein),carb:num(f.carb),fat:num(f.fat),sodium:num(f.sodium),potassium:num(f.potassium),phosphorus:num(f.phosphorus)}));
  writeCache('foods',foods);
  return true;
}
async function loadDiets(force=false){
  $('statusStat').textContent='جاري التحميل...';

  if(!force){
    const cached=readCache('diets');
    if(cached?.diets){
      diets=cached.diets;
      authors=cached.authors||{};
      $('statusStat').textContent='متصل';
      $('statusStat').className='mt-1 text-sm font-extrabold text-brand-600';
      renderDiets();
    }
  }

  const {data,error}=await supabase.from('diet_templates').select('id,name,description,notes,target_calories,target_protein,target_carb,target_fat,target_fluid,goal,visibility,required_feature,created_by,publisher_name,created_at,updated_at').order('updated_at',{ascending:false});
  if(error){
    if(!diets.length){
      $('statusStat').textContent='خطأ';
      $('statusStat').className='mt-1 text-sm font-extrabold text-red-600';
      toast('تعذر تحميل مكتبة الدايت: '+error.message,false);
    }
    return false;
  }

  diets=data||[];
  authors={};
  const ids=[...new Set([...diets.filter(d=>d.visibility==='public').map(d=>d.created_by).filter(Boolean),user.id].filter(Boolean))];
  if(ids.length){
    const pr=await supabase.from('profiles').select('id,full_name').in('id',ids);
    if(!pr.error)(pr.data||[]).forEach(p=>{authors[p.id]=p.full_name||''});
  }
  if(!authors[user.id])authors[user.id]=user.user_metadata?.full_name||user.user_metadata?.name||'';
  diets.forEach(d=>{if(d.publisher_name)authors[d.created_by]=d.publisher_name});
  writeCache('diets',{diets,authors});
  $('statusStat').textContent='متصل';
  $('statusStat').className='mt-1 text-sm font-extrabold text-brand-600';
  renderDiets();
  return true;
}
function renderDiets(){const q=$('search').value.trim().toLowerCase(),f=$('visibilityFilter').value;const arr=diets.filter(d=>(!q||`${d.name} ${d.description||''} ${d.notes||''}`.toLowerCase().includes(q))&&(f==='all'||(f==='mine'&&d.created_by===user.id)||(f==='public'&&d.visibility==='public')));$('dietGrid').innerHTML=arr.map(d=>{const mine=d.created_by===user.id,canEdit=mine||isAdmin,pub=d.visibility==='public',author=authors[d.created_by]||'';const authorText=author?`نشر بواسطة <strong class="text-slate-600">د. ${esc(author)}</strong>`:'نشر بواسطة طبيب';return `<article class="glass overflow-hidden rounded-3xl"><div class="border-b border-slate-100 p-5"><div class="flex items-start justify-between gap-3"><div><div class="flex flex-wrap gap-2"><span class="rounded-full ${pub?'bg-indigo-50 text-indigo-600':'bg-brand-50 text-brand-700'} px-2.5 py-1 text-[10px] font-extrabold">${pub?'منشور':'خاص'}</span>${mine?'<span class="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">ملكي</span>':''}</div><h3 class="mt-3 text-lg font-extrabold text-slate-800">${esc(d.name)}</h3><p class="mt-1 text-xs text-slate-400 line-clamp-2">${esc(d.description||'بدون وصف')}</p>${pub?`<div class="mt-3 flex items-center gap-2 text-[10px] text-slate-400"><span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"><i class="fa-solid fa-user-doctor"></i></span><span>${authorText}</span></div>`:''}</div><i class="fa-solid fa-utensils text-2xl text-brand-100"></i></div><div class="mt-5 grid grid-cols-4 gap-2"><div class="rounded-xl bg-amber-50 p-2 text-center"><div class="text-[9px] text-amber-600 font-bold">سعرات</div><div class="mt-1 text-sm font-extrabold text-amber-900">${d.target_calories==null?'—':num(d.target_calories).toFixed(0)}</div></div><div class="rounded-xl bg-slate-50 p-2 text-center"><div class="text-[9px] text-slate-500 font-bold">بروتين</div><div class="mt-1 text-sm font-extrabold text-slate-800">${d.target_protein==null?'—':num(d.target_protein).toFixed(1)}g</div></div><div class="rounded-xl bg-amber-50/60 p-2 text-center"><div class="text-[9px] text-amber-700 font-bold">كارب</div><div class="mt-1 text-sm font-extrabold text-amber-900">${d.target_carb==null?'—':num(d.target_carb).toFixed(1)}g</div></div><div class="rounded-xl bg-emerald-50 p-2 text-center"><div class="text-[9px] text-emerald-700 font-bold">دهون</div><div class="mt-1 text-sm font-extrabold text-emerald-900">${d.target_fat==null?'—':num(d.target_fat).toFixed(1)}g</div></div></div></div><div class="flex items-center justify-between gap-2 bg-slate-50/70 p-4">${canEdit?`<div class="flex flex-wrap gap-2"><button data-open="${d.id}" class="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white"><i class="fa-solid fa-pen ml-1"></i> فتح وتعديل</button><button data-duplicate="${d.id}" class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><i class="fa-solid fa-copy ml-1"></i> نسخ</button><button data-del="${d.id}" class="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-500"><i class="fa-solid fa-trash"></i></button></div>`:`<div class="flex gap-2"><button data-open="${d.id}" class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><i class="fa-solid fa-eye ml-1"></i> عرض الدايت</button><button data-duplicate="${d.id}" class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><i class="fa-solid fa-copy ml-1"></i> نسخ</button></div>`}<span class="text-[10px] text-slate-400">يوم واحد</span></div></article>`}).join('');$('empty').classList.toggle('hidden',arr.length>0);$('countBadge').textContent=`${diets.length} دايت`;$('totalStat').textContent=diets.length;$('mineStat').textContent=diets.filter(d=>d.created_by===user.id).length;$('publicStat').textContent=diets.filter(d=>d.visibility==='public').length} 
function scaleHouseholdMeasure(measure,grams){if(!measure)return '—';const g=num(grams);if(!Number.isFinite(g)||g<0)return measure;const factor=g/100;const arabic={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};const frac={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};let text=String(measure).replace(/[٠-٩]/g,d=>arabic[d]);Object.keys(frac).forEach(ch=>text=text.replaceAll(ch,formatHouseholdNumber(frac[ch]*factor)));text=text.replace(/(^|[^\d.])(\d+(?:\.\d+)?)(?=\s|$|[^\d.])/g,(m,b,n)=>b+formatHouseholdNumber(parseFloat(n)*factor));if(text===String(measure).replace(/[٠-٩]/g,d=>arabic[d]))return `${formatHouseholdNumber(factor)} × ${text}`;return text}
function formatHouseholdNumber(v){if(!Number.isFinite(v))return '—';if(Math.abs(v-Math.round(v))<.0001)return String(Math.round(v));return String(Math.round(v*100)/100).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1')}
function calcTotals(){const t={kcal:0,protein:0,carb:0,fat:0,sodium:0,potassium:0,phosphorus:0};day.meals.forEach(m=>m.items.forEach(it=>{if(it.includeInCalculation===false)return;const f=foods.find(x=>x.id===String(it.food_id));if(!f)return;const factor=num(it.quantity_g)/100;t.kcal+=f.kcal*factor;t.protein+=f.protein*factor;t.carb+=f.carb*factor;t.fat+=f.fat*factor;t.sodium+=f.sodium*factor;t.potassium+=f.potassium*factor;t.phosphorus+=f.phosphorus*factor}));return t}
function summaryCard(label,value,unit,cls){return `<div class="rounded-xl border ${cls} p-3"><div class="text-[9px] font-bold opacity-70">${label}</div><div class="mt-1 flex items-baseline gap-1"><span class="text-lg font-black">${value}</span><small class="text-[9px] font-bold opacity-70">${unit}</small></div></div>`}
function renderSummary(){const t=calcTotals();$('dailySummary').innerHTML=summaryCard('🔥 السعرات',t.kcal.toFixed(0),'kcal','border-amber-200 bg-amber-50 text-amber-900')+summaryCard('🥩 البروتين',t.protein.toFixed(1),'g','border-slate-200 bg-slate-50 text-slate-800')+summaryCard('🍞 الكارب',t.carb.toFixed(1),'g','border-amber-200 bg-amber-50/60 text-amber-900')+summaryCard('🥑 الدهون',t.fat.toFixed(1),'g','border-emerald-200 bg-emerald-50 text-emerald-900')+summaryCard('🧂 الصوديوم',t.sodium.toFixed(0),'mg','border-sky-200 bg-sky-50 text-sky-900')+summaryCard('🍌 البوتاسيوم',t.potassium.toFixed(0),'mg','border-emerald-200 bg-emerald-50/70 text-emerald-900')+summaryCard('🦴 الفسفور',t.phosphorus.toFixed(0),'mg','border-purple-200 bg-purple-50 text-purple-900')}
function syncAccessControl(){const wrap=$('dietAccessWrap');if(wrap)wrap.classList.toggle('hidden',!isAdmin)}
function setDietAccess(value){const el=$('dietAccess');if(el)el.value=value||''}
function openNew(){editingId=null;day={day_number:1,day_name:'اليوم',meals:[]};$('editorTitle').textContent='إنشاء دايت جديد';$('dietName').value='';$('description').value='';$('notes').value='';$('visibility').value='private';setDietAccess('');syncAccessControl();setReadOnly(false);renderDay();toggleEditor(true)}
async function openDiet(id){const d=diets.find(x=>x.id===id);if(!d)return;await loadFoods();editingId=id;$('editorTitle').textContent=d.created_by===user.id?'تعديل الدايت':'عرض الدايت';$('dietName').value=d.name||'';$('description').value=d.description||'';$('notes').value=d.notes||'';$('visibility').value=d.visibility||'private';setDietAccess(d.required_feature||'');syncAccessControl();const {data:dr,error}=await supabase.from('diet_template_days').select('id,diet_id,day_number,day_name').eq('diet_id',id).order('day_number',{ascending:true}).limit(1);if(error){toast('تعذر تحميل اليوم',false);return}const drow=dr?.[0];if(!drow){day={day_number:1,day_name:'اليوم',meals:[]}}else{const {data:mr,error:me}=await supabase.from('diet_template_meals').select('id,day_id,meal_name,meal_order,frequency').eq('day_id',drow.id).order('meal_order',{ascending:true});if(me){toast('تعذر تحميل الوجبات: '+(me.message||me),false);return}const mids=(mr||[]).map(x=>x.id);let ir=[];if(mids.length){const r=await supabase.from('diet_template_items').select('id,meal_id,food_id,quantity_g,household_measure,frequency,notes,item_order').in('meal_id',mids).order('item_order',{ascending:true});if(r.error){toast('تعذر تحميل الأصناف',false);return}ir=r.data||[];}day={id:drow.id,day_number:1,day_name:drow.day_name||'اليوم',meals:(mr||[]).map(m=>({id:m.id,name:m.meal_name||'وجبة',items:ir.filter(i=>i.meal_id===m.id).map(i=>({id:i.id,food_id:String(i.food_id),quantity_g:num(i.quantity_g),household_measure:i.household_measure||'',frequency:i.frequency||'',notes:i.notes||'',includeInCalculation:true}))}))} }const canEdit=d.created_by===user.id||isAdmin;renderDay();toggleEditor(true);setReadOnly(!canEdit);if(!canEdit)toast('هذا قالب منشور — وضع العرض فقط')}
function setReadOnly(ro){['dietName','description','notes','visibility','dietAccess','addMeal','saveDiet'].forEach(id=>{const el=$(id);if(el)el.disabled=ro});$('saveDiet').classList.toggle('hidden',ro);$('addMeal').classList.toggle('hidden',ro);document.querySelectorAll('[data-add-item],[data-remove-meal],[data-remove-item],[data-pick],[data-toggle-calc],[data-move-meal]').forEach(e=>e.classList.toggle('hidden',ro))}
function toggleEditor(show){$('editor').classList.toggle('hidden',!show);$('editor').classList.toggle('flex',show)}
function renderDay(){renderSummary();$('mealsEditor').innerHTML=day.meals.length?day.meals.map((m,mi)=>mealHTML(mi,m)).join(''):`<div class="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center"><div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><i class="fa-solid fa-utensils text-xl"></i></div><p class="mt-3 font-extrabold text-slate-600">لم تتم إضافة أي وجبة</p><p class="mt-1 text-xs text-slate-400">ابدأ بإضافة وجبة ثم اختر الأصناف والكميات.</p></div>`;document.querySelectorAll('.food-name-text').forEach(el=>{const f=foods.find(x=>String(x.id)===String(el.dataset.foodId));el.textContent=f?.name_ar||'صنف غير موجود';if(f?.name_en){const en=document.createElement('span');en.className='food-name-en';en.textContent=f.name_en;el.appendChild(en)}});if($('saveDiet').classList.contains('hidden'))setReadOnly(true)}
function mealHTML(mi,m){return `<div class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"><div class="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between"><input data-meal-name="${mi}" value="${esc(m.name)}" class="flex-1 max-w-xl rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-extrabold" placeholder="اسم الوجبة"><div class="flex items-center gap-2"><button data-move-meal="${mi}:up" class="h-9 w-9 rounded-xl bg-white text-slate-500 ring-1 ring-slate-200" title="تحريك لأعلى"><i class="fa-solid fa-arrow-up"></i></button><button data-move-meal="${mi}:down" class="h-9 w-9 rounded-xl bg-white text-slate-500 ring-1 ring-slate-200" title="تحريك لأسفل"><i class="fa-solid fa-arrow-down"></i></button><button data-remove-meal="${mi}" class="rounded-xl bg-red-50 px-3 py-2.5 text-red-500 hover:bg-red-100 text-xs font-bold"><i class="fa-solid fa-trash ml-1"></i> حذف الوجبة</button></div></div><div class="overflow-x-auto"><table class="diet-table w-full text-right text-[11px] sm:text-xs"><thead class="bg-white text-slate-500 font-bold border-b border-slate-100"><tr><th class="py-3 px-3 w-[30%]">اسم الصنف</th><th class="py-3 px-3 text-center w-[15%]">الكمية بالجرام</th><th class="py-3 px-3 text-center w-[25%]">المقياس المنزلي</th><th class="py-3 px-3 text-center w-[12%]">التكرار</th><th class="py-3 px-3 text-center w-[18%]">ملاحظة</th><th class="py-3 px-3 text-center w-[15%]">الإجراء</th></tr></thead><tbody>${m.items.length?m.items.map((it,ii)=>itemHTML(mi,ii,it)).join(''):`<tr><td colspan="6" class="py-8 text-center text-slate-400">لا توجد أصناف مضافة لهذه الوجبة بعد</td></tr>`}</tbody></table></div><div class="p-3 border-t border-slate-100"><button data-add-item="${mi}" class="rounded-xl border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2 text-[11px] font-bold text-brand-700 hover:bg-brand-50"><i class="fa-solid fa-plus ml-1"></i> إضافة صنف</button></div></div>`}
function itemHTML(mi,ii,it){const foodId=String(it.food_id);const f=foods.find(x=>String(x.id)===foodId);const house=f?.household?scaleHouseholdMeasure(f.household,num(it.quantity_g)):(it.household_measure||'—');const checked=it.includeInCalculation!==false;return `<tr class="food-row hover:bg-slate-50/80"><td class="py-2.5 px-3"><div data-pick="${mi}:${ii}" class="food-name-cell"><span class="food-name-text" data-food-id="${esc(foodId)}"></span></div></td><td class="py-2.5 px-3 text-center"><div class="flex items-center justify-center gap-1"><input data-qty="${mi}:${ii}" type="number" min="0" step="1" value="${num(it.quantity_g)}" class="w-24 bg-brand-50 border border-brand-200 rounded-lg px-2 py-2 text-center font-extrabold text-brand-700"><span class="text-[9px] text-slate-400">جم</span></div></td><td class="py-2.5 px-3 text-center text-brand-700 font-bold leading-5">${esc(house)}</td><td class="py-2.5 px-3 text-center"><input data-frequency="${mi}:${ii}" value="${esc(it.frequency||'')}" placeholder="7/7" class="w-20 max-w-full bg-sky-50 border border-sky-200 rounded-lg px-2 py-2 text-center font-extrabold text-sky-700" title="مثال: 7/7 أو 7/5"></td><td class="py-2.5 px-3 text-center"><input data-note="${mi}:${ii}" value="${esc(it.notes||'')}" placeholder="مثال: مشوي" class="w-full min-w-[110px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-2 text-right font-semibold text-amber-800" title="ملاحظة خاصة بهذا الصنف"></td><td class="py-2.5 px-3"><div class="flex items-center justify-center gap-3"><label class="flex items-center gap-1.5 cursor-pointer" title="إدخال الصنف في حسابات اليوم"><input data-toggle-calc="${mi}:${ii}" type="checkbox" ${checked?'checked':''} class="h-4 w-4 accent-brand-600"><span class="text-[9px] font-bold text-slate-500">حساب</span></label><button data-remove-item="${mi}:${ii}" class="h-8 w-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100" title="حذف"><i class="fa-solid fa-trash"></i></button></div></td></tr>`}
async function openPicker(mi,ii=null){await loadFoods();activeMealIndex=mi;selectedFood=null;$('selectedFoodBox').classList.add('hidden');$('selectedFoodGrams').value='100';$('foodSearch').value='';$('foodPicker').classList.remove('hidden');$('foodPicker').classList.add('flex');renderPicker();if(ii!==null){selectedFood={editIndex:ii}}}
function closePicker(){activeMealIndex=null;selectedFood=null;$('foodPicker').classList.add('hidden');$('foodPicker').classList.remove('flex')}
function renderPicker(){const q=$('foodSearch').value.trim().toLowerCase();const arr=foods.filter(f=>(`${f.name_ar||''} ${f.name_en||''} ${f.id}`.toLowerCase().includes(q)));$('pickerList').innerHTML=arr.map(f=>`<button data-food="${esc(f.id)}" class="flex w-full items-center justify-between gap-4 border-b border-slate-100 px-5 py-3 text-right hover:bg-brand-50"><div class="min-w-0"><div class="text-xs font-extrabold text-slate-700">${esc(f.name_ar)}</div><div class="mt-1 text-[9px] text-slate-400">${esc(f.name_en||'')}</div></div><div class="flex shrink-0 items-center gap-2 text-[9px] text-slate-400"><span>${f.kcal} kcal/100g</span><span class="${f.is_custom?'text-violet-600':'text-emerald-600'}">${f.is_custom?'مخصص':'أساسي'}</span><i class="fa-solid fa-chevron-left text-slate-300"></i></div></button>`).join('')||'<div class="p-10 text-center text-xs text-slate-400">لا توجد نتائج</div>'}
function chooseFood(id){const f=foods.find(x=>x.id===String(id));if(!f)return;selectedFood={...f,editIndex:selectedFood?.editIndex??null};$('selectedFoodName').textContent=f.name_ar||f.name_en||f.id;$('selectedFoodGrams').value=selectedFood.editIndex!==null&&selectedFood.editIndex!==undefined?num(day.meals[activeMealIndex].items[selectedFood.editIndex]?.quantity_g)||100:100;$('selectedFoodBox').classList.remove('hidden');$('selectedFoodGrams').focus()}
function addSelected(){if(!selectedFood||activeMealIndex===null){toast('اختر صنفًا أولاً',false);return}const grams=num($('selectedFoodGrams').value);if(grams<=0){toast('حدد كمية صحيحة بالجرام',false);return}const m=day.meals[activeMealIndex];if(selectedFood.editIndex!==null&&selectedFood.editIndex!==undefined){const it=m.items[selectedFood.editIndex];it.food_id=selectedFood.id;it.quantity_g=grams;it.household_measure=selectedFood.household||''}else m.items.push({food_id:selectedFood.id,quantity_g:grams,household_measure:selectedFood.household||'',frequency:'',includeInCalculation:true});closePicker();renderDay()}
$('mealsEditor').addEventListener('input',e=>{let x=e.target.dataset.mealName;if(x!==undefined){day.meals[+x].name=e.target.value;return}x=e.target.dataset.qty;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].quantity_g=num(e.target.value);renderSummary();const old=e.target.value;setTimeout(()=>{const input=document.querySelector(`[data-qty="${x}"]`);if(input&&document.activeElement!==input)input.value=old},0);return}x=e.target.dataset.frequency;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].frequency=e.target.value;return}x=e.target.dataset.note;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].notes=e.target.value}});
$('mealsEditor').addEventListener('change',e=>{let x=e.target.dataset.qty;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].quantity_g=Math.max(0,num(e.target.value));renderDay();return}x=e.target.dataset.frequency;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].frequency=e.target.value;return}x=e.target.dataset.toggleCalc;if(x!==undefined){const [mi,ii]=x.split(':').map(Number);day.meals[mi].items[ii].includeInCalculation=e.target.checked;renderDay()}});
$('mealsEditor').addEventListener('click',async e=>{let b=e.target.closest('[data-add-item]');if(b){await openPicker(+b.dataset.addItem);return}b=e.target.closest('[data-pick]');if(b){const [mi,ii]=b.dataset.pick.split(':').map(Number);await openPicker(mi,ii);chooseFood(day.meals[mi].items[ii].food_id);return}b=e.target.closest('[data-remove-item]');if(b){const [mi,ii]=b.dataset.removeItem.split(':').map(Number);openConfirm('حذف الصنف','هل أنت متأكد من حذف هذا الصنف من الوجبة؟',()=>{day.meals[mi].items.splice(ii,1);renderDay()});return}b=e.target.closest('[data-remove-meal]');if(b){const mi=+b.dataset.removeMeal;openConfirm('حذف الوجبة','هل أنت متأكد من حذف هذه الوجبة بكل أصنافها؟',()=>{day.meals.splice(mi,1);renderDay()});return}b=e.target.closest('[data-move-meal]');if(b){const [mi,dir]=b.dataset.moveMeal.split(':');const i=Number(mi),j=dir==='up'?i-1:i+1;if(j<0||j>=day.meals.length)return;[day.meals[i],day.meals[j]]=[day.meals[j],day.meals[i]];renderDay()}});
$('addMeal').onclick=()=>{day.meals.push({name:`وجبة ${day.meals.length+1}`,items:[]});renderDay()};
$('foodSearch').oninput=renderPicker;$('closePicker').onclick=closePicker;$('pickerList').onclick=e=>{const b=e.target.closest('[data-food]');if(b)chooseFood(b.dataset.food)};$('addSelectedFood').onclick=addSelected;
$('newBtn').onclick=openNew;$('visibility').onchange=()=>{if($('visibility').value!=='public')setDietAccess('')};$('cancelEditor').onclick=()=>toggleEditor(false);$('search').oninput=renderDiets;$('visibilityFilter').onchange=renderDiets;
async function loadPageData(){
  await loadDiets();
  if(foods.length)await loadFoods(true);
}
$('refreshBtn').onclick=loadPageData;
let deleteTarget=null,confirmAction=null;
function closeDeleteConfirm(){deleteTarget=null;confirmAction=null;$('deleteConfirmModal').classList.add('hidden');$('deleteConfirmModal').classList.remove('flex')}
function openConfirm(title,message,action){$('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmDeleteBtn').innerHTML='تأكيد';deleteTarget=null;confirmAction=action;$('deleteConfirmModal').classList.remove('hidden');$('deleteConfirmModal').classList.add('flex')}
function openDeleteConfirm(diet){deleteTarget=diet;confirmAction=null;$('confirmTitle').textContent='تأكيد حذف الدايت';$('confirmMessage').textContent='هل أنت متأكد من حذف هذا الدايت؟ لا يمكن التراجع عن الحذف.';$('confirmDeleteBtn').innerHTML='<i class="fa-solid fa-trash ml-1"></i> حذف الدايت';$('deleteConfirmModal').classList.remove('hidden');$('deleteConfirmModal').classList.add('flex')}
$('cancelDeleteBtn').onclick=closeDeleteConfirm;
$('confirmDeleteBtn').onclick=async()=>{const bt=$('confirmDeleteBtn');bt.disabled=true;bt.textContent='جاري التنفيذ...';try{if(confirmAction){const fn=confirmAction;confirmAction=null;fn()}else{const x=deleteTarget;if(!x)return;const {error}=await supabase.from('diet_templates').delete().eq('id',x.id);if(error)throw error;clearCache('diets');await loadDiets(true);toast('تم حذف الدايت')}}catch(error){toast('فشل التنفيذ: '+(error.message||error),false)}finally{bt.disabled=false;closeDeleteConfirm()}};
$('dietGrid').onclick=async e=>{const o=e.target.closest('[data-open]'),d=e.target.closest('[data-del]'),cp=e.target.closest('[data-duplicate]');if(o){await openDiet(o.dataset.open);return}if(d){const x=diets.find(a=>a.id===d.dataset.del);if(x)openDeleteConfirm(x);return}if(cp)await duplicateDiet(cp.dataset.duplicate)};
async function duplicateDiet(id){const source=diets.find(x=>x.id===id);if(!source)return;try{await loadFoods();const {data:dr,error:de}=await supabase.from('diet_template_days').select('id,day_number,day_name').eq('diet_id',id).order('day_number',{ascending:true}).limit(1);if(de)throw de;const drow=dr&&dr[0];let meals=[];if(drow){const {data:mr,error:me}=await supabase.from('diet_template_meals').select('id,meal_name,meal_order,frequency').eq('day_id',drow.id).order('meal_order',{ascending:true});if(me)throw me;const mids=(mr||[]).map(x=>x.id);let ir=[];if(mids.length){const r=await supabase.from('diet_template_items').select('meal_id,food_id,quantity_g,household_measure,frequency,notes,item_order').in('meal_id',mids).order('item_order',{ascending:true});if(r.error)throw r.error;ir=r.data||[]}meals=(mr||[]).map(m=>({name:m.meal_name||'وجبة',items:ir.filter(i=>i.meal_id===m.id).map(i=>({food_id:String(i.food_id),quantity_g:num(i.quantity_g),household_measure:i.household_measure||'',frequency:i.frequency||'',notes:i.notes||'',includeInCalculation:true}))}))}editingId=null;$('editorTitle').textContent='إنشاء نسخة من الدايت';$('dietName').value=(source.name||'دايت')+' - نسخة';$('description').value=source.description||'';$('notes').value=source.notes||'';$('visibility').value='private';setDietAccess('');syncAccessControl();day={day_number:1,day_name:'اليوم',meals};setReadOnly(false);renderDay();toggleEditor(true);toast('تم إنشاء نسخة قابلة للتعديل — اضغط حفظ لحفظها')}catch(error){toast('تعذر نسخ الدايت: '+(error.message||error),false)}}
function buildDietPayload(visibility, totals){
  const currentDiet=editingId?diets.find(d=>d.id===editingId):null;
  const publisherName=visibility==='public'
    ?(currentDiet?.publisher_name||authors[currentDiet?.created_by]||authors[user.id]||user.user_metadata?.full_name||user.user_metadata?.name||'')
    :null;

  const requiredFeature=
    isAdmin &&
    visibility==='public' &&
    $('dietAccess')?.value==='diet'
      ?'diet'
      :null;

  return {
    name:$('dietName').value.trim(),
    description:$('description').value.trim()||null,
    notes:$('notes').value.trim()||null,
    visibility,
    required_feature:requiredFeature,
    publisher_name:publisherName,
    target_calories:totals.kcal,
    target_protein:totals.protein,
    target_carb:totals.carb,
    target_fat:totals.fat,
    target_fluid:null,
    goal:null
  };
}
async function saveDietTemplateViaRpc(dietId,payload){
  const dayId=crypto.randomUUID();

  const meals=day.meals.map((meal,mi)=>({
    id:crypto.randomUUID(),
    meal_name:meal.name||('وجبة '+(mi+1)),
    meal_order:mi+1,
    frequency:null
  }));

  const items=[];
  day.meals.forEach((meal,mi)=>{
    const mealId=meals[mi].id;
    meal.items.forEach((item,ii)=>{
      if(!item.food_id)return;

      const food=foods.find(x=>x.id===String(item.food_id));
      const householdMeasure=food?.household
        ?scaleHouseholdMeasure(food.household,num(item.quantity_g))
        :(item.household_measure||null);

      items.push({
        id:crypto.randomUUID(),
        meal_id:mealId,
        food_id:String(item.food_id),
        quantity_g:num(item.quantity_g),
        household_measure:householdMeasure,
        frequency:item.frequency||null,
        notes:item.notes||null,
        item_order:ii+1
      });
    });
  });

  const {data,error}=await supabase.rpc('save_diet_template',{
    p_diet_id:dietId||null,
    p_payload:payload,
    p_day:{
      id:dayId,
      day_number:1,
      day_name:'اليوم'
    },
    p_meals:meals,
    p_items:items
  });

  if(error)throw error;
  return data;
}
async function save(){
  if(!user)return;

  const name=$('dietName').value.trim();
  if(!name){
    toast('اكتب اسم الدايت أولاً',false);
    return;
  }

  if(!day.meals.length){
    toast('أضف وجبة واحدة على الأقل',false);
    return;
  }

  const visibility=$('visibility').value;
  const isUpdate=Boolean(editingId);
  const button=$('saveDiet');

  button.disabled=true;
  button.textContent='جاري الحفظ...';

  try{
    if(day.meals.some(meal=>meal.items.length)&&!(await loadFoods()))throw new Error('تعذر تحميل مكتبة الأغذية');
    const payload=buildDietPayload(visibility,calcTotals());
    const dietId=await saveDietTemplateViaRpc(editingId,payload);

    const savedId=dietId;
    const existingDiet=isUpdate?diets.find(d=>d.id===savedId):null;
    const savedDiet={
      id:savedId,
      name:payload.name,
      description:payload.description,
      notes:payload.notes,
      target_calories:payload.target_calories,
      target_protein:payload.target_protein,
      target_carb:payload.target_carb,
      target_fat:payload.target_fat,
      target_fluid:payload.target_fluid,
      goal:payload.goal,
      visibility:payload.visibility,
      required_feature:payload.required_feature,
      created_by:existingDiet?.created_by||user.id,
      publisher_name:payload.publisher_name,
      updated_at:new Date().toISOString(),
      created_at:isUpdate?(diets.find(d=>d.id===savedId)?.created_at||null):new Date().toISOString()
    };
    const existingIndex=diets.findIndex(d=>d.id===savedId);
    if(existingIndex>=0)diets[existingIndex]=savedDiet;else diets.unshift(savedDiet);
    if(payload.publisher_name)authors[user.id]=payload.publisher_name;
    writeCache('diets',{diets,authors});
    renderDiets();
    toast(isUpdate?'تم تحديث الدايت بنجاح':'تم حفظ الدايت بنجاح');
    toggleEditor(false);
  }catch(error){
    console.error('Diet save failed:',error);
    toast('فشل حفظ الدايت: '+(error.message||error),false);
  }finally{
    button.disabled=false;
    button.textContent='حفظ الدايت';
  }
}
$('saveDiet').onclick=save;
async function initializeDietPage(){
  if(!(await getSession()))return;
  await loadPageData();
  $('loading').style.display='none';
}
initializeDietPage();
})();