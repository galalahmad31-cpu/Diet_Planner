/* =========================================================

 * EXCHANGE-BASED DIET PLAN MODULE
 * Kept isolated in its own IIFE to protect its internal state.
 * ========================================================= */

(function(){
const G=[{k:'fruit',n:'الفاكهة',m:1,kcal:60,carb:15,pro:0,fat:0},{k:'veg',n:'الخضروات غير النشوية',m:1,kcal:25,carb:5,pro:2,fat:0},{k:'milk',n:'اللبن والزبادي',m:1,subs:['خالى الدسم','متوسط الدسم','غني الدسم'],v:{'خالى الدسم':[100,12,8,2],'متوسط الدسم':[120,12,8,5],'غني الدسم':[160,12,8,8]}},{k:'legumes',n:'البقوليات',m:1,kcal:115,carb:15,pro:7,fat:0},{k:'starch',n:'النشويات',m:0,kcal:80,carb:15,pro:2,fat:0},{k:'meat',n:'اللحوم',m:0,subs:['خالية الدهون','متوسطة الدهون','غنية الدهون'],v:{'خالية الدهون':[45,0,7,3],'متوسطة الدهون':[75,0,7,5],'غنية الدهون':[100,0,7,8]}},{k:'fat',n:'الدهون',m:0,kcal:45,carb:0,pro:0,fat:5}];
const S={ready:false,plan:null,saved:false,editing:false,t:{cal:0,pro:0,carb:0,fat:0},r:{},days:[],savedDays:[],dayEditing:{},itemContext:null,confirm:null};
G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});
const dbx=window.DietPlannerSupabase?.client;
  if (!dbx) console.error("Diet Planner access layer is unavailable to the exchange-plan module.");
const n=v=>Number.isFinite(Number(v))?Number(v):0,rnd=(v,d=2)=>Number(n(v).toFixed(d)),esc=escapeHtml;
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v??''));
async function currentExchangeUser(){return await window.DietPlannerCoreAuth?.getCurrentUser?.()||null;}
async function canWriteExchangePlan(){
  const user=await currentExchangeUser();
  if(!user)return false;
  return (await window.DietPlannerCoreAccess?.canWrite?.(user.id))===true;
}

function ctx(){return window.visitContext||{}}
function status(s,e=false){const x=document.getElementById('exchangePlanStatus');if(x){x.textContent=s;x.className='text-[10px] font-bold '+(e?'text-rose-600':'text-emerald-600')}}
function vals(g){const a=S.r[g.k];if(g.v){const x=g.v[a.sub]||Object.values(g.v)[0];return{kcal:x[0],carb:x[1],pro:x[2],fat:x[3]}}return{kcal:g.kcal,carb:g.carb,pro:g.pro,fat:g.fat}}
function manual(){return ['fruit','veg','milk','legumes'].reduce((a,k)=>{const g=G.find(x=>x.k===k),r=S.r[k],v=vals(g),c=n(r.count);a.carb+=c*v.carb;a.pro+=c*v.pro;a.fat+=c*v.fat;a.kcal+=c*v.kcal;return a},{kcal:0,carb:0,pro:0,fat:0})}
function calc(){const m=manual();S.r.starch.count=Math.max(0,rnd((S.t.carb-m.carb)/15,2));const mp=m.pro+S.r.starch.count*2;const mv=vals(G.find(g=>g.k==='meat'));S.r.meat.count=Math.max(0,rnd((S.t.pro-mp)/7,2));S.r.fat.count=Math.max(0,rnd((S.t.fat-m.fat-S.r.meat.count*mv.fat)/5,2))}
function total(){return G.reduce((a,g)=>{const r=S.r[g.k],v=vals(g),c=n(r.count);a.kcal+=c*v.kcal;a.carb+=c*v.carb;a.pro+=c*v.pro;a.fat+=c*v.fat;return a},{kcal:0,carb:0,pro:0,fat:0})}
function setButtons(){const has=!!S.plan;document.getElementById('exchangeSaveBtn').disabled=!S.editing;document.getElementById('exchangeEditBtn').disabled=!has||S.editing;document.getElementById('exchangeDeleteBtn').disabled=!has||S.editing}
function updateDisplay(){calc();const t=total();document.getElementById('exchangeTotalCal').textContent=rnd(t.kcal,0);document.getElementById('exchangeTotalPro').textContent=rnd(t.pro,1);document.getElementById('exchangeTotalCarb').textContent=rnd(t.carb,1);document.getElementById('exchangeTotalFat').textContent=rnd(t.fat,1);G.forEach(g=>{const row=document.querySelector('[data-ex-row="'+g.k+'"]');if(!row)return;const r=S.r[g.k],v=vals(g),c=n(r.count),els=row.querySelectorAll('[data-val]');[c*v.kcal,c*v.carb,c*v.pro,c*v.fat].forEach((v,i)=>{if(els[i])els[i].textContent=rnd(v,1)});const inp=row.querySelector('[data-count]');if(inp&&document.activeElement!==inp)inp.value=r.count})}
function render(){calc();document.getElementById('exchangeTargetCal').textContent=S.t.cal?rnd(S.t.cal,0)+' kcal':'—';document.getElementById('exchangeTargetPro').textContent=S.t.pro?rnd(S.t.pro,1)+' g':'—';document.getElementById('exchangeTargetCarb').textContent=S.t.carb?rnd(S.t.carb,1)+' g':'—';document.getElementById('exchangeTargetFat').textContent=S.t.fat?rnd(S.t.fat,1)+' g':'—';const b=document.getElementById('exchangeValuesBody');b.innerHTML=G.map(g=>{const r=S.r[g.k],v=vals(g),c=n(r.count);let sub='—';if(g.subs)sub='<select data-sub="'+g.k+'" '+(S.editing?'':'disabled')+' class="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-bold">'+g.subs.map(s=>'<option value="'+esc(s)+'" '+(r.sub===s?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';const cnt=g.m?'<input data-count="'+g.k+'" '+(S.editing?'':'disabled')+' type="number" min="0" step="0.5" inputmode="decimal" value="'+r.count+'" class="w-20 mx-auto block text-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-extrabold text-violet-700">':'<span class="font-black text-violet-700">'+rnd(r.count,2)+'</span>';return '<tr data-ex-row="'+g.k+'" class="border-b border-slate-100 last:border-0"><td class="py-2.5 px-3 font-black">'+esc(g.n)+'</td><td class="py-2.5 px-3">'+sub+'</td><td class="py-2.5 px-3 text-center">'+cnt+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.kcal,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.carb,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.pro,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.fat,1)+'</td></tr>'}).join('');updateDisplay();setButtons()}
async function findPlans(){const c=ctx();if(!c.patient_id)return[];let q=dbx.from('nutrition_plans').select('id,patient_id,visit_id,target_calories,target_protein,target_carb,target_fat,goal,created_at,updated_at').eq('patient_id',c.patient_id);if(c.id)q=q.eq('visit_id',c.id);const {data,error}=await q.order('updated_at',{ascending:false}).order('created_at',{ascending:false});return error?[]:(data||[])}
async function loadExchangeValues(){if(!S.plan)return;const r=await dbx.from('exchange_values').select('group_name,subgroup_name,exchange_count').eq('plan_id',S.plan);if(!r.error)(r.data||[]).forEach(x=>{const g=G.find(y=>y.n===x.group_name);if(g){S.r[g.k].count=n(x.exchange_count);if(x.subgroup_name)S.r[g.k].sub=x.subgroup_name}});S.saved=(r.data||[]).length>0}
async function ensureExchangePlan(skipAuth=false){
  if(!skipAuth && !(await canWriteExchangePlan())){status('إنشاء خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return null;}

 if(S.plan && isUuid(S.plan))return S.plan;

 const c=ctx();
 if(!c.patient_id){
  status('لم يتم تحديد المريض لخطة البدائل',true);
  return null;
 }

 const plans=await findPlans();
 const base=plans.find(p=>p.plan_name==='الخطة الغذائية');

 if(base){
  S.t={
   cal:n(base.target_calories),
   pro:n(base.target_protein),
   carb:n(base.target_carb),
   fat:n(base.target_fat)
  };
 }else{
  S.t={cal:0,pro:0,carb:0,fat:0};
 }

 const id=crypto.randomUUID();
 const payload={
  id,
  patient_id:c.patient_id,
  visit_id:c.id||null,
  plan_name:'الخطة الغذائية باستخدام البدائل',
  start_date:new Date().toISOString().slice(0,10),
  target_calories:base?.target_calories??null,
  target_protein:base?.target_protein??null,
  target_carb:base?.target_carb??null,
  target_fat:base?.target_fat??null,
  target_fluid:base?.target_fluid??null,
  goal:base?.goal??null,
  notes:base?.notes??null
 };

 const r=await dbx.from('nutrition_plans').insert(payload).select('id').single();
 if(r.error){
  status('تعذر إنشاء خطة البدائل: '+r.error.message,true);
  return null;
 }

 S.plan=r.data.id;
 return S.plan;
}
async function loadDays(){if(!S.plan){S.days=[];S.savedDays=[];renderDays();return}const {data:dr,error:de}=await dbx.from('plan_days').select('id,plan_id,day_number,day_name').eq('plan_id',S.plan).order('day_number',{ascending:true});if(de){status('تعذر تحميل أيام خطة البدائل: '+de.message,true);return}const ids=(dr||[]).map(x=>x.id);let ms=[];if(ids.length){const r=await dbx.from('plan_meals').select('id,day_id,meal_order,meal_name').in('day_id',ids).order('meal_order',{ascending:true});if(r.error){status('تعذر تحميل وجبات الخطة: '+r.error.message,true);return}ms=r.data||[]}const mids=ms.map(x=>x.id);let its=[];if(mids.length){const r=await dbx.from('plan_items').select('id,meal_id,food_id,quantity_g,household_measure,frequency,item_name').in('meal_id',mids);if(r.error){status('تعذر تحميل أصناف الخطة: '+r.error.message,true);return}its=r.data||[]}S.days=(dr||[]).map(d=>({id:d.id,title:d.day_name||'اليوم',meals:ms.filter(m=>m.day_id===d.id).map(m=>({id:m.id,name:m.meal_name||'وجبة',items:its.filter(i=>i.meal_id===m.id).map(i=>({id:i.id,name:i.item_name||'',measure:i.household_measure||'',repeat:i.frequency||''}))}))}));S.savedDays=clone(S.days);S.dayEditing={};renderDays()}
function clone(v){return JSON.parse(JSON.stringify(v||[]))}
function dayEditing(id){return!!S.dayEditing[String(id)]}
function renderDays(){
 const c=document.getElementById('exchangeDaysContainer'),e=document.getElementById('exchangeDaysEmpty');
 if(!S.days.length){c.innerHTML='';e.classList.remove('hidden');return}
 e.classList.add('hidden');
 c.innerHTML=S.days.map((d,di)=>`<div data-xday="${esc(d.id)}" class="border border-slate-200 rounded-2xl overflow-hidden bg-white">
  <div class="p-3 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
   <div class="flex items-center gap-2 flex-1 min-w-0">
    <span class="text-[10px] text-slate-400 font-bold shrink-0">اليوم ${di+1}</span>
    <input value="${esc(d.title)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-day-title" data-day-id="${esc(d.id)}" class="bg-transparent border-b border-slate-600 focus:border-violet-400 outline-none font-black text-sm w-full sm:w-48">
   </div>
   <div class="flex items-center gap-1.5 no-print">
    <button data-xaction="edit-day" data-day-id="${esc(d.id)}" class="px-2.5 py-1.5 rounded-lg bg-sky-600 text-white text-[10px] font-bold"><i class="fa-solid fa-pen ml-1"></i>تعديل</button>
    <button data-xaction="save-day" data-day-id="${esc(d.id)}" ${dayEditing(d.id)?'':'disabled'} class="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold disabled:opacity-40"><i class="fa-solid fa-floppy-disk ml-1"></i>حفظ</button>
    <button data-xaction="delete-day" data-day-id="${esc(d.id)}" class="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[10px] font-bold"><i class="fa-solid fa-trash ml-1"></i>حذف</button>
   </div>
  </div>
  <div class="p-3 space-y-3">
   ${(d.meals||[]).map((m,mi)=>`<div class="border border-slate-200 rounded-xl p-3">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
     <input value="${esc(m.name)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-meal-name" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-black text-xs w-full sm:w-56">
     <div class="flex gap-1 no-print flex-wrap">
      <button data-xaction="move-meal-up" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" ${dayEditing(d.id)||mi===0?'':'disabled'} class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-40" title="تحريك لأعلى"><i class="fa-solid fa-arrow-up"></i></button>
      <button data-xaction="move-meal-down" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" ${dayEditing(d.id)||mi===(d.meals.length-1)?'':'disabled'} class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-40" title="تحريك لأسفل"><i class="fa-solid fa-arrow-down"></i></button>
      <button data-xaction="delete-meal" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600"><i class="fa-solid fa-trash"></i></button>
     </div>
    </div>
    <div class="mt-2 space-y-2">
     ${(m.items||[]).map(i=>`<div class="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-2 items-center">
      <input value="${esc(i.name)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-name" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(i.id)}" class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold">
      <input value="${esc(i.measure)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-measure" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(i.id)}" class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
      <input value="${esc(i.repeat)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-repeat" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(i.id)}" class="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs">
      <button data-xaction="delete-item" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(i.id)}" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 no-print"><i class="fa-solid fa-trash"></i></button>
     </div>`).join('')}
     <button data-xaction="add-item" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" class="px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-[10px] font-bold no-print"><i class="fa-solid fa-plus ml-1"></i>إضافة صنف</button>
    </div>
   </div>`).join('')}
   <button data-xaction="add-meal" data-day-id="${esc(d.id)}" class="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-[10px] font-black no-print"><i class="fa-solid fa-plus ml-1"></i>إضافة وجبة</button>
  </div>
 </div>`).join('');
}
function newDay(){S.days.push({id:'local-'+Date.now(),title:'يوم جديد',meals:[]});renderDays()}
async function persistDay(d){const c=ctx();if(!c.patient_id||!S.plan)return false;const isNew=!isUuid(d.id);let dayId=d.id;if(isNew){const {data,error}=await dbx.from('plan_days').insert({plan_id:S.plan,day_number:S.days.indexOf(d)+1,day_name:d.title}).select('id').single();if(error){status('تعذر حفظ اليوم: '+error.message,true);return false}dayId=data.id;d.id=dayId}else{const {error}=await dbx.from('plan_days').update({day_name:d.title,day_number:S.days.indexOf(d)+1}).eq('id',dayId);if(error){status('تعذر تحديث اليوم: '+error.message,true);return false}}
 const existingMeals=(await dbx.from('plan_meals').select('id').eq('day_id',dayId)).data||[];const existingIds=new Set(existingMeals.map(x=>x.id));const currentIds=new Set();
 for(let mi=0;mi<d.meals.length;mi++){const m=d.meals[mi],newM=!isUuid(m.id);let mid=m.id;if(newM){const {data,error}=await dbx.from('plan_meals').insert({day_id:dayId,meal_order:mi+1,meal_name:m.name}).select('id').single();if(error){status('تعذر حفظ الوجبة: '+error.message,true);return false}mid=data.id;m.id=mid}else{const {error}=await dbx.from('plan_meals').update({meal_order:mi+1,meal_name:m.name}).eq('id',mid);if(error){status('تعذر تحديث الوجبة: '+error.message,true);return false}}currentIds.add(mid);const existingItems=(await dbx.from('plan_items').select('id').eq('meal_id',mid)).data||[];const existingItemIds=new Set(existingItems.map(x=>x.id));const currentItemIds=new Set();for(const i of m.items||[]){const newI=!isUuid(i.id);let iid=i.id;const payload={meal_id:mid,item_name:i.name,household_measure:i.measure,frequency:i.repeat};if(newI){const {data,error}=await dbx.from('plan_items').insert(payload).select('id').single();if(error){status('تعذر حفظ الصنف: '+error.message,true);return false}iid=data.id;i.id=iid}else{const {error}=await dbx.from('plan_items').update(payload).eq('id',iid);if(error){status('تعذر تحديث الصنف: '+error.message,true);return false}}currentItemIds.add(iid)}const deleteItems=[...existingItemIds].filter(x=>!currentItemIds.has(x));if(deleteItems.length){const {error}=await dbx.from('plan_items').delete().in('id',deleteItems);if(error){status('تعذر حذف الأصناف القديمة: '+error.message,true);return false}}}
 const deleteMeals=[...existingIds].filter(x=>!currentIds.has(x));if(deleteMeals.length){const {error}=await dbx.from('plan_meals').delete().in('id',deleteMeals);if(error){status('تعذر حذف الوجبات القديمة: '+error.message,true);return false}}return true}
async function saveDays(){if(!(await canWriteExchangePlan())){status('الحفظ متاح أثناء الاشتراك المدفوع فقط',true);return}for(const d of S.days){if(!(await persistDay(d)))return}S.savedDays=clone(S.days);S.dayEditing={};renderDays();status('تم حفظ الخطة الغذائية بنجاح')}
function openModal(type,data){S.confirm={type,data};const m=document.getElementById('exchangeConfirmModal');if(m){m.classList.remove('hidden');m.classList.add('flex')}}
function closeModal(){const m=document.getElementById('exchangeConfirmModal');if(m){m.classList.add('hidden');m.classList.remove('flex')}S.confirm=null}
async function confirmAction(){const c=S.confirm;if(!c)return;closeModal();if(c.type==='delete-day'){const d=S.days.find(x=>String(x.id)===String(c.data));if(d&&isUuid(d.id)){const {error}=await dbx.from('plan_days').delete().eq('id',d.id);if(error){status('تعذر حذف اليوم: '+error.message,true);return}}S.days=S.days.filter(x=>String(x.id)!==String(c.data));renderDays();return}if(c.type==='delete-meal'){const d=S.days.find(x=>String(x.id)===String(c.data.dayId)),m=d?.meals.find(x=>String(x.id)===String(c.data.mealId));if(m&&isUuid(m.id)){const {error}=await dbx.from('plan_meals').delete().eq('id',m.id);if(error){status('تعذر حذف الوجبة: '+error.message,true);return}}if(d)d.meals=d.meals.filter(x=>String(x.id)!==String(c.data.mealId));renderDays();return}if(c.type==='delete-item'){const d=S.days.find(x=>String(x.id)===String(c.data.dayId)),m=d?.meals.find(x=>String(x.id)===String(c.data.mealId));const i=m?.items.find(x=>String(x.id)===String(c.data.itemId));if(i&&isUuid(i.id)){const {error}=await dbx.from('plan_items').delete().eq('id',i.id);if(error){status('تعذر حذف الصنف: '+error.message,true);return}}if(m)m.items=m.items.filter(x=>String(x.id)!==String(c.data.itemId));renderDays();return}}
async function deleteExchangePlan(){if(!(await canWriteExchangePlan())){status('الحذف متاح أثناء الاشتراك المدفوع فقط',true);return}if(!S.plan){status('لا توجد خطة بدائل لحذفها',true);return}const {error}=await dbx.from('nutrition_plans').delete().eq('id',S.plan);if(error){status('تعذر حذف خطة البدائل: '+error.message,true);return}S.plan=null;S.saved=false;S.editing=false;S.days=[];S.savedDays=[];S.dayEditing={};render();renderDays();status('تم حذف خطة البدائل')}
async function saveExchange(){if(!(await canWriteExchangePlan())){status('الحفظ متاح أثناء الاشتراك المدفوع فقط',true);return}const id=await ensureExchangePlan(true);if(!id)return;const rows=G.map(g=>{const r=S.r[g.k];return{plan_id:id,group_name:g.n,subgroup_name:g.subs?r.sub:null,exchange_count:n(r.count)}});const del=await dbx.from('exchange_values').delete().eq('plan_id',id);if(del.error){status('تعذر تحديث البدائل: '+del.error.message,true);return}const ins=await dbx.from('exchange_values').insert(rows);if(ins.error){status('تعذر حفظ قيم البدائل: '+ins.error.message,true);return}S.saved=true;S.editing=false;render();status('تم حفظ حساب البدائل')}
async function init(){
 const c=ctx();
 if(!c.patient_id){status('لم يتم تحديد المريض لهذه الزيارة',true);return}
 const plans=await findPlans();
 const p=plans.find(x=>x.plan_name==='الخطة الغذائية باستخدام البدائل');
 if(p){S.plan=p.id;S.t={cal:n(p.target_calories),pro:n(p.target_protein),carb:n(p.target_carb),fat:n(p.target_fat)};await loadExchangeValues();await loadDays();S.editing=false;S.ready=true;render();return}
 const base=plans.find(x=>x.plan_name==='الخطة الغذائية');
 if(base)S.t={cal:n(base.target_calories),pro:n(base.target_protein),carb:n(base.target_carb),fat:n(base.target_fat)};
 S.editing=true;S.ready=true;render();await loadDays();
}
function bind(){
 document.getElementById('exchangeEditBtn')?.addEventListener('click',async()=>{if(!(await canWriteExchangePlan())){status('التعديل متاح أثناء الاشتراك المدفوع فقط',true);return}S.editing=true;render()});
 document.getElementById('exchangeSaveBtn')?.addEventListener('click',saveExchange);
 document.getElementById('exchangeDeleteBtn')?.addEventListener('click',()=>openModal('delete-plan',null));
 document.getElementById('exchangeAddDayBtn')?.addEventListener('click',async()=>{if(!(await canWriteExchangePlan())){status('الإضافة متاحة أثناء الاشتراك المدفوع فقط',true);return}newDay()});
 document.getElementById('exchangeSaveDaysBtn')?.addEventListener('click',saveDays);
 document.getElementById('exchangeConfirmCancel')?.addEventListener('click',closeModal);
 document.getElementById('exchangeConfirmOk')?.addEventListener('click',async()=>{if(S.confirm?.type==='delete-plan')await deleteExchangePlan();else await confirmAction()});
 document.getElementById('exchangeDaysContainer')?.addEventListener('click',async e=>{const b=e.target.closest('[data-xaction]');if(!b)return;const a=b.dataset.xaction,d=S.days.find(x=>String(x.id)===String(b.dataset.dayId));if(a==='edit-day'){if(!(await canWriteExchangePlan())){status('التعديل متاح أثناء الاشتراك المدفوع فقط',true);return}S.dayEditing[String(d.id)]=!dayEditing(d.id);renderDays();return}if(a==='save-day'){await persistDay(d);S.dayEditing[String(d.id)]=false;S.savedDays=clone(S.days);renderDays();status('تم حفظ اليوم');return}if(a==='delete-day'){openModal('delete-day',d.id);return}if(a==='add-meal'){d.meals.push({id:'local-'+Date.now(),name:'وجبة جديدة',items:[]});renderDays();return}const m=d.meals.find(x=>String(x.id)===String(b.dataset.mealId));if(a==='delete-meal'){openModal('delete-meal',{dayId:d.id,mealId:m.id});return}if(a==='move-meal-up'||a==='move-meal-down'){const i=d.meals.findIndex(x=>String(x.id)===String(m.id)),j=a==='move-meal-up'?i-1:i+1;if(j>=0&&j<d.meals.length){[d.meals[i],d.meals[j]]=[d.meals[j],d.meals[i]];renderDays()}return}if(a==='add-item'){m.items.push({id:'local-'+Date.now(),name:'',measure:'',repeat:''});renderDays();return}if(a==='delete-item'){openModal('delete-item',{dayId:d.id,mealId:m.id,itemId:b.dataset.itemId});return}});
 document.getElementById('exchangeValuesBody')?.addEventListener('input',e=>{const inp=e.target.closest('[data-count]');if(inp){S.r[inp.dataset.count].count=n(inp.value);updateDisplay()}});
 document.getElementById('exchangeValuesBody')?.addEventListener('change',e=>{const sub=e.target.closest('[data-sub]');if(sub){S.r[sub.dataset.sub].sub=sub.value;updateDisplay()}});
 document.getElementById('exchangeDaysContainer')?.addEventListener('input',e=>{const x=e.target.closest('[data-xaction]');if(!x)return;const d=S.days.find(v=>String(v.id)===String(x.dataset.dayId));if(!d)return;if(x.dataset.xaction==='set-day-title')d.title=x.value;if(x.dataset.xaction==='set-meal-name'){const m=d.meals.find(v=>String(v.id)===String(x.dataset.mealId));if(m)m.name=x.value}if(x.dataset.xaction==='set-item-name'||x.dataset.xaction==='set-item-measure'||x.dataset.xaction==='set-item-repeat'){const m=d.meals.find(v=>String(v.id)===String(x.dataset.mealId)),i=m?.items.find(v=>String(v.id)===String(x.dataset.itemId));if(i){if(x.dataset.xaction==='set-item-name')i.name=x.value;if(x.dataset.xaction==='set-item-measure')i.measure=x.value;if(x.dataset.xaction==='set-item-repeat')i.repeat=x.value}}});
}
window.ExchangePlan={init,render,save:saveExchange,delete:deleteExchangePlan,getState:()=>S};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bind();init()},{once:true});else{bind();init()}
})();
