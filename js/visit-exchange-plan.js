/* =========================================================

 * EXCHANGE-BASED DIET PLAN MODULE
 * Kept isolated in its own IIFE to protect its internal state.
 * ========================================================= */

(function(){
const G=[{k:'fruit',n:'الفاكهة',m:1,kcal:60,carb:15,pro:0,fat:0},{k:'veg',n:'الخضروات غير النشوية',m:1,kcal:25,carb:5,pro:2,fat:0},{k:'milk',n:'اللبن والزبادي',m:1,subs:['خالى الدسم','متوسط الدسم','غني الدسم'],v:{'خالى الدسم':[100,12,8,2],'متوسط الدسم':[120,12,8,5],'غني الدسم':[160,12,8,8]}},{k:'legumes',n:'البقوليات',m:1,kcal:115,carb:15,pro:7,fat:0},{k:'starch',n:'النشويات',m:0,kcal:80,carb:15,pro:2,fat:0},{k:'meat',n:'اللحوم',m:0,subs:['خالية الدهون','متوسطة الدهون','غنية الدهون'],v:{'خالية الدهون':[45,0,7,3],'متوسطة الدهون':[75,0,7,5],'غنية الدهون':[100,0,7,8]}},{k:'fat',n:'الدهون',m:0,kcal:45,carb:0,pro:0,fat:5}];
const S={ready:false,plan:null,saved:false,editing:false,t:{cal:0,pro:0,carb:0,fat:0},r:{},days:[],savedDays:[],dayEditing:{},itemContext:null,confirm:null};
G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});
const dbx=window.DietPlannerAccess?.supabaseClient;
  if (!dbx) console.error("Diet Planner access layer is unavailable to the exchange-plan module.");
const n=v=>Number.isFinite(Number(v))?Number(v):0,rnd=(v,d=2)=>Number(n(v).toFixed(d)),esc=escapeHtml;
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v??''));
async function canVisitContent(action){
  return (await window.DietPlannerPageAccess?.can?.('visitContent',action))===true;
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
async function findPlans(){const c=ctx();if(!c.patient_id)return[];let q=dbx.from('nutrition_plans').select('id,patient_id,visit_id,plan_name,target_calories,target_protein,target_carb,target_fat,goal,created_at,updated_at').eq('patient_id',c.patient_id);if(c.id)q=q.eq('visit_id',c.id);const {data,error}=await q.order('updated_at',{ascending:false}).order('created_at',{ascending:false});return error?[]:(data||[])}
async function loadExchangeValues(){if(!S.plan)return;const r=await dbx.from('exchange_values').select('group_name,subgroup_name,exchange_count').eq('plan_id',S.plan);if(!r.error)(r.data||[]).forEach(x=>{const g=G.find(y=>y.n===x.group_name);if(g){S.r[g.k].count=n(x.exchange_count);if(x.subgroup_name)S.r[g.k].sub=x.subgroup_name}});S.saved=(r.data||[]).length>0}
async function ensureExchangePlan(skipAuth=false){
  if(!skipAuth && !(await canVisitContent('add'))){status('إضافة خطة البدائل متاحة أثناء الاشتراك الفعال فقط',true);return null;}

 if(S.plan && isUuid(S.plan))return S.plan;

 const c=ctx();
 if(!c.patient_id){
  status('لم يتم تحديد المريض لخطة البدائل',true);
  return null;
 }

 const plans=await findPlans();
 const exchange=plans.find(p=>p.plan_name==='الخطة الغذائية باستخدام البدائل');
 const base=plans.find(p=>p.plan_name==='الخطة الغذائية باستخدام الجرامات');

 if(exchange){
  S.t={
   cal:n(exchange.target_calories),
   pro:n(exchange.target_protein),
   carb:n(exchange.target_carb),
   fat:n(exchange.target_fat)
  };
  S.plan=exchange.id;
  return S.plan;
 }

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
      <button data-xaction="add-item" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" ${dayEditing(d.id)?'':'disabled'} class="px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-bold disabled:opacity-40"><i class="fa-solid fa-plus ml-1"></i>إضافة صنف</button>
      <button data-xaction="delete-meal" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" ${dayEditing(d.id)?'':'disabled'} class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 disabled:opacity-40" title="حذف الوجبة"><i class="fa-solid fa-trash"></i></button>
     </div>
    </div>
    <div class="overflow-x-auto mt-2">
     <table class="w-full min-w-[720px] text-[10px]">
      <thead><tr class="text-slate-500 border-b border-slate-100"><th class="py-2 text-right">اسم الصنف</th><th class="py-2 text-center">المقياس المنزلي</th><th class="py-2 text-center">التكرار</th><th class="py-2 text-center no-print w-20">إجراء</th></tr></thead>
      <tbody>${(m.items||[]).length?(m.items||[]).map(it=>`<tr class="border-b border-slate-50 last:border-0">
       <td class="py-2 px-1"><input data-xitem-name="${esc(it.id)}" value="${esc(it.name)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-name" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(it.id)}" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold outline-none focus:border-violet-400"></td>
       <td class="py-2 px-1"><input value="${esc(it.measure)}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-measure" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(it.id)}" placeholder="مثال: كوب / ½ رغيف" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold text-center outline-none focus:border-violet-400"></td>
       <td class="py-2 px-1"><input value="${esc(it.repeat||'')}" ${dayEditing(d.id)?'':'disabled'} data-xaction="set-item-repeat" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(it.id)}" placeholder="يوميًا / 3 مرات أسبوعيًا" class="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold text-center outline-none focus:border-violet-400"></td>
       <td class="py-2 text-center no-print"><button data-xaction="delete-item" data-day-id="${esc(d.id)}" data-meal-id="${esc(m.id)}" data-item-id="${esc(it.id)}" ${dayEditing(d.id)?'':'disabled'} class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 disabled:opacity-40" title="حذف الصنف"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join(''):'<tr><td colspan="4" class="py-5 text-center text-slate-400 font-bold">لا توجد أصناف مضافة. اضغط «إضافة صنف» لإضافة صف جديد.</td></tr>'}</tbody>
     </table>
    </div>

   </div>`).join('')}
   <button data-xaction="add-meal" data-day-id="${esc(d.id)}" ${dayEditing(d.id)?'':'disabled'} class="w-full border border-dashed border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 rounded-xl py-2 text-xs font-extrabold disabled:opacity-40 no-print"><i class="fa-solid fa-plus ml-1"></i>إضافة وجبة</button>
  </div>
 </div>`).join('');
}
async function addDay(){
 if(!S.plan){const idp=await ensureExchangePlan();if(!idp){status('تعذر إنشاء خطة البدائل لهذا المريض',true);return}}
 const id='local-day-'+Date.now();S.days.push({id,title:`اليوم ${S.days.length+1}`,meals:[{id:'local-meal-'+Date.now()+'-1',name:'وجبة الإفطار',items:[]},{id:'local-meal-'+Date.now()+'-2',name:'وجبة الغداء',items:[]},{id:'local-meal-'+Date.now()+'-3',name:'وجبة العشاء',items:[]}]});S.dayEditing[id]=true;renderDays();status('تمت إضافة اليوم — اضغط حفظ لتخزينه')}
async function editDay(id){if(!(await canVisitContent('update'))){status('تعديل محتوى الزيارة متاح أثناء الاشتراك الفعال فقط',true);return;}S.dayEditing[String(id)]=true;renderDays()}
function setDayTitle(id,v){const d=S.days.find(x=>String(x.id)===String(id));if(d&&dayEditing(id))d.title=String(v).trim()||d.title}
function setMealName(did,mid,v){const d=S.days.find(x=>String(x.id)===String(did)),m=d?.meals.find(x=>String(x.id)===String(mid));if(m&&dayEditing(did))m.name=String(v).trim()||m.name}
function moveMeal(did,mid,dir){const d=S.days.find(x=>String(x.id)===String(did));if(!d||!dayEditing(did))return;const i=d.meals.findIndex(m=>String(m.id)===String(mid)),n=i+Number(dir);if(i<0||n<0||n>=d.meals.length)return;const [m]=d.meals.splice(i,1);d.meals.splice(n,0,m);renderDays()}
async function addMeal(did){if(!(await canVisitContent('add'))){status('إضافة وجبة متاحة أثناء الاشتراك الفعال فقط',true);return;}const d=S.days.find(x=>String(x.id)===String(did));if(d&&dayEditing(did)){d.meals.push({id:'local-meal-'+Date.now()+'-'+Math.random().toString(36).slice(2),name:`وجبة ${d.meals.length+1}`,items:[]});renderDays()}}
function deleteMeal(did,mid){openConfirm('حذف الوجبة','هل أنت متأكد من حذف الوجبة بكل أصنافها؟',()=>{const d=S.days.find(x=>String(x.id)===String(did));if(d&&dayEditing(did)){d.meals=d.meals.filter(m=>String(m.id)!==String(mid));renderDays()}})}
function openConfirm(title,text,cb){document.getElementById('confirmTitle').textContent=title;document.getElementById('confirmText').textContent=text;S.confirm=cb;document.getElementById('confirmModal').classList.remove('hidden')}
function closeConfirm(){document.getElementById('confirmModal').classList.add('hidden');S.confirm=null}
async function saveDay(id){if(!dayEditing(id))return;if(!(await canVisitContent('update'))){status('تعديل محتوى الزيارة متاح أثناء الاشتراك الفعال فقط',true);return;}const ok=await saveDaysToDb();if(ok){S.savedDays=clone(S.days);S.dayEditing[String(id)]=false;renderDays();status('تم حفظ اليوم بنجاح')}}
async function deleteRemovedDays(removed){
 if(!removed.length)return;
 const mr=await dbx.from('plan_meals').select('id').in('day_id',removed);
 if(mr.error)throw mr.error;
 const mealIds=(mr.data||[]).map(x=>x.id);
 if(mealIds.length){
  let r=await dbx.from('plan_items').delete().in('meal_id',mealIds);
  if(r.error)throw r.error;
  r=await dbx.from('plan_meals').delete().in('day_id',removed);
  if(r.error)throw r.error;
 }
 const r=await dbx.from('plan_days').delete().in('id',removed);
 if(r.error)throw r.error;
}

async function prepareDayRecord(day,index){
 let dayId=String(day.id).startsWith('local-day-')?null:day.id;
 if(!dayId){
  const r=await dbx.from('plan_days').insert({plan_id:S.plan,day_number:index+1,day_name:day.title}).select('id').single();
  if(r.error)throw r.error;
  dayId=r.data.id;
  day.id=dayId;
 }else{
  const r=await dbx.from('plan_days').update({day_number:index+1,day_name:day.title}).eq('id',dayId);
  if(r.error)throw r.error;
 }
 return dayId;
}

async function clearDayMeals(dayId){
 const oldM=await dbx.from('plan_meals').select('id').eq('day_id',dayId);
 if(oldM.error)throw oldM.error;
 const mealIds=(oldM.data||[]).map(x=>x.id);
 if(!mealIds.length)return;
 let r=await dbx.from('plan_items').delete().in('meal_id',mealIds);
 if(r.error)throw r.error;
 r=await dbx.from('plan_meals').delete().in('day_id',dayId);
 if(r.error)throw r.error;
}

async function saveDayMeals(day,dayId){
 const mealRows=(day.meals||[]).map((m,mi)=>({id:crypto.randomUUID(),day_id:dayId,meal_name:m.name||('وجبة '+(mi+1)),meal_order:mi+1}));
 if(mealRows.length){
  const r=await dbx.from('plan_meals').insert(mealRows);
  if(r.error)throw r.error;
 }
 const itemRows=[];
 (day.meals||[]).forEach((m,mi)=>(m.items||[]).forEach(it=>{
  if(String(it.name||'').trim())itemRows.push({id:crypto.randomUUID(),meal_id:mealRows[mi].id,food_id:null,item_name:String(it.name).trim(),quantity_g:0,household_measure:String(it.measure||'').trim()||null,frequency:String(it.repeat||'').trim()||null});
 }));
 if(itemRows.length){
  const r=await dbx.from('plan_items').insert(itemRows);
  if(r.error)throw r.error;
 }
}

async function saveSingleDay(day,index){
 const dayId=await prepareDayRecord(day,index);
 await clearDayMeals(dayId);
 await saveDayMeals(day,dayId);
}

async function saveDaysToDb(){
 if(!S.plan)return false;
 try{
  const oldIds=S.savedDays.filter(d=>!String(d.id).startsWith('local-day-')).map(d=>d.id);
  const currentIds=S.days.filter(d=>!String(d.id).startsWith('local-day-')).map(d=>d.id);
  const removed=oldIds.filter(id=>!currentIds.includes(id));
  await deleteRemovedDays(removed);
  for(let i=0;i<S.days.length;i++)await saveSingleDay(S.days[i],i);
  return true;
 }catch(e){
  status('تعذر حفظ أيام الخطة: '+(e.message||e),true);
  return false;
 }
}
function deleteDay(id){openConfirm('حذف اليوم','هل أنت متأكد من حذف هذا اليوم بكل وجباته وأصنافه؟',async()=>{const old=clone(S.days),idx=S.days.findIndex(x=>String(x.id)===String(id));if(idx<0)return;S.days.splice(idx,1);if(await saveDaysToDb()){S.savedDays=clone(S.days);renderDays();status('تم حذف اليوم بنجاح')}else{S.days=old;renderDays()}})}
function addItem(did,mid){
 const d=S.days.find(x=>String(x.id)===String(did)),m=d?.meals.find(x=>String(x.id)===String(mid));
 if(!m||!dayEditing(did))return;
 const id='local-item-'+Date.now()+'-'+Math.random().toString(36).slice(2);
 m.items.push({id,name:'',measure:'',repeat:''});
 renderDays();
 requestAnimationFrame(()=>{const el=document.querySelector(`[data-xday="${CSS.escape(String(did))}"] [data-xitem-name="${CSS.escape(String(id))}"]`);if(el){el.focus();el.scrollIntoView({block:'nearest',inline:'nearest'});}});
}
function setItemField(did,mid,iid,field,value){
 const d=S.days.find(x=>String(x.id)===String(did)),m=d?.meals.find(x=>String(x.id)===String(mid)),it=m?.items.find(x=>String(x.id)===String(iid));
 if(it&&dayEditing(did))it[field]=String(value??'');
}
function deleteItem(did,mid,iid){openConfirm('حذف الصنف','هل أنت متأكد من حذف هذا الصنف؟',()=>{const d=S.days.find(x=>String(x.id)===String(did)),m=d?.meals.find(x=>String(x.id)===String(mid));if(m&&dayEditing(did)){m.items=m.items.filter(x=>String(x.id)!==String(iid));renderDays()}})}
function openPrintSettings(){
  const modal=document.getElementById('printSettingsModal');
  const pb=document.getElementById('executePrintBtn');
  if(!modal||!pb)return;
  pb.dataset.printMode='exchange';
  modal.classList.remove('hidden');
}
function printAll(){
 if(!S.days.length){status('لا توجد أيام غذائية للطباعة',true);return;}
 openPrintSettings();
}
function buildPrintAll(){
 const container=document.getElementById('printPlanContent');
 if(!container)return;
 if(!S.days.length){container.innerHTML='<p class="print-note">لا توجد أيام غذائية مسجلة.</p>';return;}
 container.innerHTML=S.days.map((d,di)=>`<section class="print-day"><h2 class="print-day-title">${esc(d.title||`اليوم ${di+1}`)}</h2>${(d.meals||[]).length?(d.meals||[]).map(m=>`<div class="print-meal"><h3 class="print-meal-title">${esc(m.name||'وجبة')}</h3><table><thead><tr><th>الصنف</th><th style="width:28%;text-align:center">المقياس المنزلي</th><th style="width:24%;text-align:center">التكرار</th></tr></thead><tbody>${(m.items||[]).length?(m.items||[]).map(it=>`<tr><td>${esc(it.name||'—')}</td><td style="text-align:center">${esc(it.measure||'—')}</td><td style="text-align:center">${esc(it.repeat||'—')}</td></tr>`).join(''):'<tr><td colspan="3" style="text-align:center">لا توجد أصناف مسجلة.</td></tr>'}</tbody></table></div>`).join(''):'<p class="print-note">لا توجد وجبات مسجلة.</p>'}</section>`).join('');
}
function executePrintAll(){
 const docName=document.getElementById('settingDocName')?.value?.trim()||'';
 const docSpec=document.getElementById('settingDocSpec')?.value?.trim()||'';
 const hospitalName=document.getElementById('settingClinicName')?.value?.trim()||'';
 const address=document.getElementById('settingAddress')?.value?.trim()||'';
 document.getElementById('printHospitalName').textContent=hospitalName;
 document.getElementById('printDoctorName').textContent=docName;
 document.getElementById('printDoctorSpecialty').textContent=docSpec;
 document.getElementById('printClinicAddress').textContent=address;
 document.getElementById('printReportDate').textContent='تاريخ التقرير: '+new Date().toLocaleDateString('ar-EG');
 const patientName=document.getElementById('patientName')?.textContent?.trim()||'';
 document.getElementById('printPatientName').textContent=patientName&&patientName!=='—'?'لـ : '+patientName:'';
 buildPrintAll();
 document.getElementById('printSettingsModal').classList.add('hidden');
 setTimeout(()=>window.print(),200);
}

async function save(options={}){
 if(!options.skipAuth && !(await canWriteExchangePlan())){status('حفظ خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return false;}

 if(!S.editing)return true;
 const planId=await ensureExchangePlan(true);
 if(!planId){status('اعتمد السعرات والماكروز أولاً من الحاسبة',true);return false}
 render();
 const rows=G.map(g=>{
  const r=S.r[g.k],v=vals(g),c=n(r.count);
  return {plan_id:planId,group_name:g.n,subgroup_name:g.subs?(r.sub||null):null,exchange_count:c,kcal:rnd(c*v.kcal),carb:rnd(c*v.carb),protein:rnd(c*v.pro),fat:rnd(c*v.fat)};
 });
 const del=await dbx.from('exchange_values').delete().eq('plan_id',planId);
 if(del.error){status('تعذر تحديث خطة البدائل: '+del.error.message,true);return false}
 const ins=await dbx.from('exchange_values').insert(rows);
 if(ins.error){status('تعذر حفظ خطة البدائل: '+ins.error.message,true);return false}
 S.plan=planId;S.saved=true;S.editing=false;render();await loadDays();setButtons();status('تم حفظ خطة البدائل بنجاح');return true;
}
async function saveAndPrintFromSettings(){
 const pb=document.getElementById('executePrintBtn');
 if(pb)pb.disabled=true;
 try{
  if(!(await canWriteExchangePlan())){status('حفظ وطباعة خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return false}
  const planId=await ensureExchangePlan(true);
  if(!planId){status('اعتمد السعرات والماكروز أولاً من الحاسبة',true);return false}

  const hasDayChanges=S.days.some(d=>String(d.id).startsWith('local-day-'))||Object.values(S.dayEditing).some(Boolean);
  if(hasDayChanges){
   if(!(await saveDaysToDb()))return false;
   S.savedDays=clone(S.days);
   Object.keys(S.dayEditing).forEach(k=>S.dayEditing[k]=false);
   renderDays();
  }

  if(S.editing){
   if(!(await save({skipAuth:true})))return false;
  }

  executePrintAll();
  return true;
 }catch(error){
  console.error('Exchange print error:',error);
  status('تعذر حفظ وطباعة خطة البدائل: '+(error?.message||error),true);
  return false;
 }finally{
  if(pb)pb.disabled=false;
 }
}
async function edit(){if(!S.plan)return;if(!(await canVisitContent('update'))){status('تعديل خطة البدائل متاح أثناء الاشتراك الفعال فقط',true);return;}S.editing=true;render();status('وضع التعديل')}
async function deletePlan(){if(!S.plan)return;if(!(await canVisitContent('delete'))){status('تعذر حذف خطة البدائل',true);return;}openConfirm('حذف خطة البدائل','هل أنت متأكد من حذف خطة البدائل بالكامل؟',async()=>{try{const dr=await dbx.from('plan_days').select('id').eq('plan_id',S.plan);if(dr.error)throw dr.error;const dids=(dr.data||[]).map(x=>x.id);if(dids.length){const mr=await dbx.from('plan_meals').select('id').in('day_id',dids);if(mr.error)throw mr.error;const mids=(mr.data||[]).map(x=>x.id);if(mids.length){let r=await dbx.from('plan_items').delete().in('meal_id',mids);if(r.error)throw r.error;r=await dbx.from('plan_meals').delete().in('day_id',dids);if(r.error)throw r.error}let r=await dbx.from('plan_days').delete().in('id',dids);if(r.error)throw r.error}let r=await dbx.from('exchange_values').delete().eq('plan_id',S.plan);if(r.error)throw r.error;r=await dbx.from('nutrition_plans').delete().eq('id',S.plan);if(r.error)throw r.error;S.plan=null;S.saved=false;S.editing=true;S.days=[];S.savedDays=[];S.r={};G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});render();renderDays();setButtons();status('تم حذف خطة البدائل بنجاح')}catch(e){status('تعذر حذف خطة البدائل: '+(e.message||e),true)}})}
function setupExchangePlanEvents(){
 const container=document.getElementById('exchangeDaysContainer');
 if(!container||container.dataset.eventsReady==='1')return;
 container.dataset.eventsReady='1';
 container.addEventListener('click',event=>{
  const el=event.target.closest('[data-xaction]');
  if(!el||!container.contains(el))return;
  const action=el.dataset.xaction,dayId=el.dataset.dayId,mealId=el.dataset.mealId,itemId=el.dataset.itemId;
  if(action==='edit-day')editDay(dayId);
  else if(action==='save-day')saveDay(dayId);
  else if(action==='delete-day')deleteDay(dayId);
  else if(action==='move-meal-up')moveMeal(dayId,mealId,-1);
  else if(action==='move-meal-down')moveMeal(dayId,mealId,1);
  else if(action==='add-item')addItem(dayId,mealId);
  else if(action==='delete-meal')deleteMeal(dayId,mealId);
  else if(action==='delete-item')deleteItem(dayId,mealId,itemId);
  else if(action==='add-meal')addMeal(dayId);
 });
 const valuesBody=document.getElementById('exchangeValuesBody');
 if(valuesBody&&valuesBody.dataset.eventsReady!=='1'){
  valuesBody.dataset.eventsReady='1';
  valuesBody.addEventListener('input',event=>{
   const el=event.target.closest('[data-count]');
   if(!el)return;
   S.r[el.dataset.count].count=Math.max(0,n(el.value));
   updateDisplay();
  });
  valuesBody.addEventListener('change',event=>{
   const el=event.target.closest('[data-sub]');
   if(!el)return;
   S.r[el.dataset.sub].sub=el.value;
   updateDisplay();
  });
 }
 container.addEventListener('input',event=>{
  const el=event.target.closest('[data-xaction]');
  if(!el||!container.contains(el))return;
  const {xaction:action,dayId,mealId,itemId}=el.dataset;
  if(action==='set-day-title')setDayTitle(dayId,el.value);
  else if(action==='set-meal-name')setMealName(dayId,mealId,el.value);
  else if(action==='set-item-name')setItemField(dayId,mealId,itemId,'name',el.value);
  else if(action==='set-item-measure')setItemField(dayId,mealId,itemId,'measure',el.value);
  else if(action==='set-item-repeat')setItemField(dayId,mealId,itemId,'repeat',el.value);
 });
}
async function init(){
 if(S.ready)return;
 S.ready=true;
 setupExchangePlanEvents();

 const plans=await findPlans();
 const ex=plans.find(p=>p.plan_name==='الخطة الغذائية باستخدام البدائل');
 const gram=plans.find(p=>p.plan_name==='الخطة الغذائية باستخدام الجرامات');

 /*
  * The exchange plan uses the targets saved by calculator approval.
  * Prefer its own saved targets, then fall back to the gram plan for
  * older records where the exchange row exists without targets.
  */
 if(ex){
  S.t={
   cal:n(ex.target_calories),
   pro:n(ex.target_protein),
   carb:n(ex.target_carb),
   fat:n(ex.target_fat)
  };
 }else if(gram){
  S.t={
   cal:n(gram.target_calories),
   pro:n(gram.target_protein),
   carb:n(gram.target_carb),
   fat:n(gram.target_fat)
  };
 }else{
  S.t={cal:0,pro:0,carb:0,fat:0};
 }

 if(ex && isUuid(ex.id)){
  S.plan=ex.id;
  S.editing=false;
  await loadExchangeValues();
  await loadDays();
 }else{
  S.plan=null;
  S.editing=true;
 }

 render();
 renderDays();
 setButtons();
}
async function confirmAction(){const cb=S.confirm;if(!cb)return false;closeConfirm();await cb();return true}
window.exchangePlan={init,confirmAction,save,saveAndPrintFromSettings,edit,deletePlan,addDay,editDay,saveDay,deleteDay,setDayTitle,setMealName,addMeal,deleteMeal,moveMeal,addItem,setItemField,deleteItem,printAll,openPrintSettings,buildPrintAll,executePrintAll,renderDays,closeConfirmModal:closeConfirm};
})();
