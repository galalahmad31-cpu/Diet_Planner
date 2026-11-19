/* =========================================================

 * GRAM-BASED DIET PLAN MODULE
 * Kept isolated in its own IIFE to protect its internal state.
 * ========================================================= */

/* Embedded diet-plan module. Kept isolated in an IIFE to avoid global/spaghetti collisions. */
(function(){

const sb=window.DietPlannerAccess?.supabaseClient;
if (!sb) { console.error("Diet Planner access layer is unavailable to the gram-based diet module."); return; }
const params=new URLSearchParams(location.search);
const initialUrlPatientId=params.get('patient_id') || params.get('id');
const initialUrlPlanId=params.get('plan_id');
const isNewPlan=params.get('new_plan')==='1';
let patientId=initialUrlPatientId;
let activePlanStartDate=null, activePlanName=null;

let activeCloudPlanId=null, patientInfo={}, foodDatabase=[], daysData=[], savedDaysData=[], dayEditModes={};
let fixedMealsDatabase=[], fixedMealsTargetDayId=null, currentModalContext={dayId:null,mealId:null}, targetMealDayId=null, confirmCallback=null;
let fixedMealsLoadPromise=null, foodsLoadPromise=null, foodsFullyLoaded=false;
const FIXED_DIET_CACHE_V2='fixed-diet-cache-v2';
const FIXED_DIET_CACHE_TTL=5*60*1000;

function num(v){return Number.isFinite(Number(v))?Number(v):0;}
function cloneDays(v){try{return JSON.parse(JSON.stringify(v||[]));}catch{return[];}}
function showToast(msg,type='success'){
 const c=document.getElementById('toastContainer'); if(!c)return;
 const t=document.createElement('div'); t.className=(type==='error'?'bg-rose-600':'bg-emerald-600')+' text-white font-bold text-xs px-4 py-3 rounded-xl shadow-lg';
 t.innerHTML='<i class="fa-solid '+(type==='error'?'fa-circle-exclamation':'fa-circle-check')+'"></i> <span class="mr-2">'+escapeHtml(msg)+'</span>';
 c.appendChild(t); setTimeout(()=>t.remove(),3000);
}
function openConfirmModal(title,text,callback){
 document.getElementById('confirmTitle').textContent=title; document.getElementById('confirmText').textContent=text;
 confirmCallback=callback; document.getElementById('confirmModal').classList.remove('hidden');
}
function closeConfirmModal(){document.getElementById('confirmModal').classList.add('hidden');confirmCallback=null;}
function scaleHouseholdMeasure(measure,grams){
 if(!measure)return'—'; const g=Number(grams); if(!Number.isFinite(g)||g<0)return measure;
 const factor=g/100, arabic={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
 const fractions={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};
 let text=String(measure).replace(/[٠-٩]/g,d=>arabic[d]);
 Object.keys(fractions).forEach(ch=>text=text.replaceAll(ch,formatHouseholdNumber(fractions[ch]*factor)));
 text=text.replace(/(^|[^\d.])(\d+(?:\.\d+)?)(?=\s|$|[^\d.])/g,(m,b,n)=>b+formatHouseholdNumber(parseFloat(n)*factor));
 return text===String(measure).replace(/[٠-٩]/g,d=>arabic[d])?`${formatHouseholdNumber(factor)} × ${text}`:text;
}
function formatHouseholdNumber(v){if(!Number.isFinite(v))return'—';if(Math.abs(v-Math.round(v))<.0001)return String(Math.round(v));return String(Math.round(v*100)/100).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');}

async function currentUser(){return await window.DietPlannerAccess?.getCurrentUser?.()||null;}
async function canWriteVisitData(){
  const user=await currentUser();
  if(!user)return false;
  return (await window.DietPlannerAccess?.canWrite?.(user.id))===true;
}

async function loadPatient(){
 const user=await currentUser();
 if(!user){location.href='index.html';return false;}
 const resolvedPatientId=patientId||window.currentPatientId;
 if(!resolvedPatientId){showToast('لم يتم تحديد المريض','error');return false;}
 const {data:p,error}=await sb.from('patients').select('*').eq('id',resolvedPatientId).maybeSingle();
 const role=await window.DietPlannerAccess?.getUserRole?.(user.id);
  if(error||!p||(p.user_id!==user.id&&role!=='admin')){showToast('تعذر تحميل ملف المريض أو لا تملك صلاحية الوصول إليه','error');return false;}
 window.currentPatientId=resolvedPatientId; patientId=resolvedPatientId;
 patientInfo={...p,targetCal:p.energy_target_calories??'',targetPro:p.energy_target_protein??'',targetCarb:p.energy_target_carb??'',targetFat:p.energy_target_fat??'',goal:'loss'};
 return true;
}

async function loadFoods(options={}){
 const ids=Array.isArray(options.ids)?[...new Set(options.ids.map(String).filter(Boolean))]:null;
 const isFullLoad=!ids;

 if(isFullLoad && foodsFullyLoaded)return true;
 if(foodsLoadPromise)return foodsLoadPromise;

 foodsLoadPromise=(async()=>{
  let query=sb.from('foods').select('*',{count:'exact'}).order('name_ar',{ascending:true});
  if(ids?.length)query=query.in('id',ids);
  else if(ids){
   foodDatabase=[];
   return true;
  }

  const {data,error}=await query;
  if(error){
   console.error('Foods load failed:',error);
   showToast('تعذر تحميل مكتبة الأغذية','error');
   return false;
  }

  const rows=data||[];
  const mapped=rows.map(f=>({
   id:String(f.id),
   name:String(f.name_ar??'').trim(),
   household:f.household||'',
   calories:Number(f.kcal||0),
   protein:Number(f.protein||0),
   carbs:Number(f.carb||0),
   fat:Number(f.fat||0),
   sodium:Number(f.sodium||0),
   potassium:Number(f.potassium||0),
   phosphorus:Number(f.phosphorus||0)
  }));

  if(isFullLoad){
   foodDatabase=mapped;
   foodsFullyLoaded=true;
  }else{
   const existing=new Map(foodDatabase.map(f=>[String(f.id),f]));
   mapped.forEach(f=>existing.set(String(f.id),f));
   foodDatabase=[...existing.values()];
  }

  console.info(`Foods loaded: ${mapped.length}${isFullLoad?' (full library)':' (plan references)'}`);
  return true;
 })().finally(()=>{foodsLoadPromise=null;});

 return foodsLoadPromise;
}

async function ensureAllFoods(){
 return loadFoods();
}

async function loadPlan(shouldRender=true){
  if(isNewPlan && !initialUrlPlanId){
    activeCloudPlanId=null; activePlanStartDate=null; activePlanName=null;
    daysData=[]; savedDaysData=[];
    patientInfo.targetCal=patientInfo.energy_target_calories??'';
    patientInfo.targetPro=patientInfo.energy_target_protein??'';
    patientInfo.targetCarb=patientInfo.energy_target_carb??'';
    patientInfo.targetFat=patientInfo.energy_target_fat??'';
    updateTargets(); if(shouldRender)renderDays();
    return;
  }
  let query=sb.from('nutrition_plans').select('id,patient_id,plan_name,start_date,target_fluid,notes,created_at,updated_at')
    .eq('patient_id',window.currentPatientId||patientId);
  if(initialUrlPlanId) query=query.eq('id',initialUrlPlanId);
  else query=query.eq('plan_name','الخطة الغذائية باستخدام الجرامات');
  const {data:plans,error}=await query.order('updated_at',{ascending:false}).order('created_at',{ascending:false}).limit(1);
  if(error){showToast('تعذر تحميل الخطة الغذائية','error');return;}
  const plan=plans?.[0];
  if(!plan){daysData=[];savedDaysData=[];activeCloudPlanId=null;activePlanStartDate=null;activePlanName=null;updateTargets();if(shouldRender)renderDays();return;}
  activeCloudPlanId=plan.id; activePlanStartDate=plan.start_date||null;
  activePlanName=plan.plan_name||'الخطة الغذائية باستخدام الجرامات';
  if(activePlanName.includes('البدائل')){
    throw new Error('هذه الخطة مخصصة للبدائل وليست خطة الجرامات.');
  }
  patientInfo.targetCal=patientInfo.energy_target_calories??'';
  patientInfo.targetPro=patientInfo.energy_target_protein??'';
  patientInfo.targetCarb=patientInfo.energy_target_carb??'';
  patientInfo.targetFat=patientInfo.energy_target_fat??'';
  const {data:dayRows}=await sb.from('plan_days').select('id,plan_id,day_number,day_name,notes').eq('plan_id',plan.id).order('day_number',{ascending:true});
  const ids=(dayRows||[]).map(x=>x.id);
  let meals=[]; if(ids.length){const r=await sb.from('plan_meals').select('id,day_id,meal_order,meal_name').in('day_id',ids).order('meal_order',{ascending:true});meals=r.data||[];}
  const mids=meals.map(x=>x.id); let items=[]; if(mids.length){const r=await sb.from('plan_items').select('id,meal_id,food_id,quantity_g,frequency,notes').in('meal_id',mids);items=r.data||[];}
  daysData=(dayRows||[]).map(d=>({id:d.id,title:d.day_name||`اليوم ${d.day_number}`,notes:d.notes||'',isCollapsed:false,meals:meals.filter(m=>m.day_id===d.id).map(m=>({id:m.id,name:m.meal_name||'وجبة',description:'',items:items.filter(i=>i.meal_id===m.id).map(i=>({itemId:i.id,foodId:String(i.food_id),grams:Number(i.quantity_g)||0,includeInCalculation:true,...(i.frequency!=null?{repeat:i.frequency}:{}),...(i.notes!=null?{notes:i.notes}:{})}))}))}));
  savedDaysData=cloneDays(daysData); dayEditModes={}; updateTargets(); if(shouldRender)renderDays();
}

function getPlanFoodIds(){
 const ids=new Set();
 daysData.forEach(day=>(day.meals||[]).forEach(meal=>(meal.items||[]).forEach(item=>{
  if(item.foodId)ids.add(String(item.foodId));
 })));
 return [...ids];
}

function updateTargets(){
 document.getElementById('targetCal').textContent=patientInfo.targetCal?`${patientInfo.targetCal} kcal`:'—';
 document.getElementById('targetPro').textContent=patientInfo.targetPro?`${patientInfo.targetPro} g`:'—';
 document.getElementById('targetCarb').textContent=patientInfo.targetCarb?`${patientInfo.targetCarb} g`:'—';
 document.getElementById('targetFat').textContent=patientInfo.targetFat?`${patientInfo.targetFat} g`:'—';
}

function isDayEditing(id){return!!dayEditModes[String(id)];}
function setDayEditMode(id,editing){
 dayEditModes[String(id)]=!!editing; const card=document.querySelector(`[data-day-id="${CSS.escape(String(id))}"]`); if(!card)return;
 card.classList.toggle('day-locked',!editing);
 card.querySelectorAll('input,select,textarea').forEach(e=>e.disabled=!editing);
 card.querySelectorAll('button').forEach(b=>{if(b.classList.contains('day-action-always'))return;b.disabled=!editing;});
 const e=card.querySelector('.day-edit-btn'),s=card.querySelector('.day-save-btn'); if(e)e.disabled=editing;if(s)s.disabled=!editing;
}
function editDay(id){if(daysData.find(d=>String(d.id)===String(id)))setDayEditMode(id,true);}
async function saveDay(id){
 if(!(window.currentPatientId||patientId))return;
 if(!isDayEditing(id))return;
 if(!daysData.some(day=>String(day.id)===String(id)))return;

 // Save the complete in-memory plan, not only the day whose button was clicked.
 // This includes every newly added day and any other edits currently in the plan.
 const planSnapshot=cloneDays(daysData);
 const previousSavedDays=cloneDays(savedDaysData);
 savedDaysData=planSnapshot;

 const ok=await savePlan();
 if(!ok){
  // Keep the user's edits on screen so they can correct the issue and retry.
  savedDaysData=previousSavedDays;
  showToast('تعذر حفظ الخطة بالكامل؛ لم يتم اعتماد التغييرات','error');
  return;
 }

 savedDaysData=cloneDays(planSnapshot);
 daysData=cloneDays(planSnapshot);
 dayEditModes={};
 renderDays();
 showToast('تم حفظ جميع أيام الخطة بنجاح');
}
async function addNewDay(){
 // The tab initializes asynchronously. Waiting here prevents the first click
 // from racing with loadPlan(), which could otherwise replace the new local day.
 if(!(await init()))return;

 const n=daysData.length+1,stamp=Date.now();
 const day={
  id:'d_'+stamp,
  title:`اليوم ${n}`,
  notes:'',
  isCollapsed:false,
  meals:[
   {id:'m_'+stamp+'_1',name:'وجبة الإفطار',items:[]},
   {id:'m_'+stamp+'_2',name:'وجبة الغداء',items:[]},
   {id:'m_'+stamp+'_3',name:'وجبة العشاء',items:[]}
  ]
 };

 daysData.push(day);
 dayEditModes[String(day.id)]=true;
 renderDays();
 showToast(`تمت إضافة اليوم ${n} — اضغط حفظ لتخزينه`);
}
function duplicateDay(id){
 const source=daysData.find(d=>String(d.id)===String(id));if(!source)return;
 const stamp=Date.now(),copy=cloneDays([source])[0];
 copy.id='d_'+stamp;copy.title=(source.title||'اليوم')+' — نسخة';copy.isCollapsed=false;
 copy.meals=(copy.meals||[]).map((m,mi)=>({...m,id:'m_'+stamp+'_'+mi,items:(m.items||[]).map((it,ii)=>({...it,itemId:'it_'+stamp+'_'+mi+'_'+ii}))}));
 daysData.push(copy);dayEditModes[String(copy.id)]=true;renderDays();showToast('تم نسخ اليوم. عدّل النسخة ثم اضغط حفظ');
}
function toggleDayCollapse(id){const d=daysData.find(x=>x.id===id);if(d){d.isCollapsed=!d.isCollapsed;renderDays();}}
function updateDayTitle(id,v){const d=daysData.find(x=>String(x.id)===String(id));if(d&&isDayEditing(id))d.title=v;}
function updateDayNotes(id,v){const d=daysData.find(x=>String(x.id)===String(id));if(d&&isDayEditing(id))d.notes=v;}
function updateMealName(did,mid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid);if(!m||!isDayEditing(did))return;if(!String(v).trim()){showToast('اسم الوجبة لا يمكن أن يكون فارغًا','error');renderDays();return}m.name=String(v).trim();}
function moveMeal(did,mid,dir){const d=daysData.find(x=>x.id===did);if(!d||!isDayEditing(did))return;const i=d.meals.findIndex(x=>x.id===mid),n=i+Number(dir);if(i<0||n<0||n>=d.meals.length)return;const [m]=d.meals.splice(i,1);d.meals.splice(n,0,m);renderDays();}
function deleteDay(id){openConfirmModal('حذف اليوم','هل أنت متأكد من حذف هذا اليوم بالكامل؟',async()=>{const old=cloneDays(savedDaysData);savedDaysData=savedDaysData.filter(d=>String(d.id)!==String(id));daysData=cloneDays(savedDaysData);const ok=await savePlan();if(!ok){savedDaysData=old;daysData=cloneDays(old);showToast('تعذر حذف اليوم من قاعدة البيانات','error')}else{delete dayEditModes[String(id)];showToast('تم حذف اليوم بنجاح')}renderDays();});}

function openAddMealModal(id){targetMealDayId=id;document.getElementById('newMealNameInput').value='';document.getElementById('addMealModal').classList.remove('hidden');}
function closeAddMealModal(){document.getElementById('addMealModal').classList.add('hidden');targetMealDayId=null;}
function confirmCreateMeal(){const n=document.getElementById('newMealNameInput').value.trim();if(!n){showToast('يرجى كتابة اسم الوجبة','error');return}const d=daysData.find(x=>x.id===targetMealDayId);if(d&&isDayEditing(d.id)){d.meals.push({id:'m_'+Date.now()+'_'+Math.random().toString(36).slice(2),name:n,items:[]});renderDays();closeAddMealModal();showToast(`تمت إضافة ${n} بنجاح`);}}
function deleteMeal(did,mid){openConfirmModal('حذف الوجبة','هل أنت متأكد من حذف هذه الوجبة بجميع عناصرها؟',()=>{const d=daysData.find(x=>x.id===did);if(d&&isDayEditing(did)){d.meals=d.meals.filter(m=>m.id!==mid);renderDays();showToast('تم حذف الوجبة بنجاح')}});}

async function openFoodModal(did,mid){
 await ensureAllFoods();
 currentModalContext={dayId:did,mealId:mid};const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid);
 document.getElementById('modalMealTitle').textContent=m?`إضافة صنف لـ (${m.name})`:'إضافة صنف للوجبة';
 document.getElementById('foodSearchInput').value='';document.getElementById('selectedFoodId').value='';document.getElementById('foodGramsInput').value='100';document.getElementById('foodModalHouseholdBox').classList.add('hidden');
 filterFoodList();document.getElementById('foodModal').classList.remove('hidden');
}
function closeFoodModal(){document.getElementById('foodModal').classList.add('hidden');currentModalContext={dayId:null,mealId:null};}
function updateFoodModalHousehold(){const f=foodDatabase.find(x=>x.id===document.getElementById('selectedFoodId').value),g=parseFloat(document.getElementById('foodGramsInput').value),box=document.getElementById('foodModalHouseholdBox');if(f?.household&&Number.isFinite(g)){document.getElementById('foodModalHousehold').textContent=scaleHouseholdMeasure(f.household,g);box.classList.remove('hidden')}else box.classList.add('hidden');}
function normalizeFoodSearch(value){
 return String(value??'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[ًٌٍَُِّْـ]/g,'')
  .replace(/[أإآٱ]/g,'ا')
  .replace(/ى/g,'ي')
  .replace(/ة/g,'ه')
  .replace(/ؤ/g,'و')
  .replace(/ئ/g,'ي')
  .replace(/[ًٌٍَُِّْ]/g,'')
  .toLocaleLowerCase('ar-EG')
  .trim();
}

function filterFoodList(){
 const input=document.getElementById('foodSearchInput');
 const drop=document.getElementById('foodDropdownList');
 if(!input||!drop)return;

 const q=normalizeFoodSearch(input.value);
 const selectedId=String(document.getElementById('selectedFoodId')?.value||'');
 const list=q
  ? foodDatabase.filter(f=>normalizeFoodSearch(f.name).includes(q))
  : foodDatabase;

 if(!list.length){
  drop.innerHTML='<div class="p-3 text-xs text-slate-400 text-center font-bold">لا توجد نتائج مطابقة</div>';
  return;
 }

 drop.innerHTML=list.map(f=>{
  const id=String(f.id),selected=id===selectedId;
  return `<button type="button" class="food-result w-full text-right p-2.5 hover:bg-emerald-50 cursor-pointer flex justify-between items-center text-xs ${selected?'bg-emerald-100/70 border-r-4 border-emerald-600':''}" data-food-id="${escapeHtml(id)}">
   <span>
    <span class="font-extrabold text-slate-800 block">${escapeHtml(f.name)}</span>
    <span class="text-[10px] text-slate-500 font-semibold">${num(f.calories)} kcal | بروتين ${num(f.protein)}g | كارب ${num(f.carbs)}g | دهون ${num(f.fat)}g | Na ${num(f.sodium)}mg | K ${num(f.potassium)}mg | P ${num(f.phosphorus)}mg</span>
    ${f.household?`<span class="text-[10px] text-emerald-700 font-bold block mt-0.5">100 جم ≈ ${escapeHtml(f.household)}</span>`:''}
   </span>
   ${selected?'<i class="fa-solid fa-circle-check text-emerald-600"></i>':'<i class="fa-solid fa-plus text-slate-300"></i>'}
  </button>`;
 }).join('');
}
function selectFoodForMeal(id){
 const f=foodDatabase.find(x=>String(x.id)===String(id)); if(!f)return;
 const selected=document.getElementById('selectedFoodId'),search=document.getElementById('foodSearchInput'); if(!selected||!search)return;
 selected.value=String(f.id); search.value=f.name; updateFoodModalHousehold(); filterFoodList();
}
function initFoodSearchInteraction(){
 const input=document.getElementById('foodSearchInput');
 const drop=document.getElementById('foodDropdownList');
 if(!input||!drop||input.dataset.bound==='1')return;

 input.addEventListener('input',filterFoodList);
 input.addEventListener('focus',filterFoodList);

 drop.addEventListener('click',event=>{
  const result=event.target.closest('.food-result');
  if(!result||!drop.contains(result))return;
  event.preventDefault();
  event.stopPropagation();
  selectFoodForMeal(result.dataset.foodId);
 });
 input.dataset.bound='1';
}

function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function confirmAddFoodItem(){
 const foodId=document.getElementById('selectedFoodId').value,grams=parseFloat(document.getElementById('foodGramsInput').value);
 const repeat=document.getElementById('foodRepeatInput')?.value?.trim()||'';
 const notes=document.getElementById('foodNotesInput')?.value?.trim()||'';
 if(!foodId||!Number.isFinite(grams)||grams<=0){showToast('اختر صنفًا وأدخل كمية صحيحة','error');return;}
 const d=daysData.find(x=>x.id===currentModalContext.dayId),m=d?.meals.find(x=>x.id===currentModalContext.mealId);
 if(!d||!m||!isDayEditing(d.id))return;
 m.items.push({itemId:'it_'+Date.now()+'_'+Math.random().toString(36).slice(2),foodId:String(foodId),grams:Number(grams),includeInCalculation:true,repeat,notes});
 renderDays();closeFoodModal();showToast('تمت إضافة الصنف بنجاح');
}
function updateMealItemGrams(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.grams=Number(v)||0;renderDays();}}
function updateMealItemRepeat(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did))it.repeat=v;}
function updateMealItemNotes(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did))it.notes=v;}
function deleteFoodItemFromMeal(did,mid,iid){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid);if(m&&isDayEditing(did)){m.items=m.items.filter(x=>x.itemId!==iid);renderDays();}}
function updateMealItemCalculation(did,mid,iid,checked){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.includeInCalculation=!!checked;renderDays();}}

function calculateDay(day){
 let cal=0,pro=0,carb=0,fat=0,sod=0,pot=0,pho=0;
 (day.meals||[]).forEach(m=>(m.items||[]).forEach(it=>{if(it.includeInCalculation===false)return;const f=foodDatabase.find(x=>String(x.id)===String(it.foodId));if(!f)return;const k=num(it.grams)/100;cal+=f.calories*k;pro+=f.protein*k;carb+=f.carbs*k;fat+=f.fat*k;sod+=f.sodium*k;pot+=f.potassium*k;pho+=f.phosphorus*k;}));
 return {cal,pro,carb,fat,sod,pot,pho};
}
function metricCard(label,value,unit,target,pctv,kind){
 const bg={amber:'bg-amber-50 border-amber-200 text-amber-900',slate:'bg-slate-50 border-slate-200 text-slate-800',sky:'bg-sky-50 border-sky-200 text-sky-900',emerald:'bg-emerald-50 border-emerald-200 text-emerald-900'}[kind];
 return `<div class="${bg} border rounded-md px-1.5 py-1 min-w-0"><div class="flex items-center justify-center gap-1"><span class="text-[8px] sm:text-[9px] font-bold leading-tight whitespace-nowrap">${label}</span>${target?`<span class="text-[8px] opacity-70">/${target}</span>`:''}</div><div class="flex items-baseline justify-center gap-0.5 leading-tight"><span class="text-[12px] sm:text-[14px] font-black tabular-nums">${value}</span><span class="text-[8px] font-bold">${unit}</span></div>${target?`<div class="w-full bg-white/60 h-1 rounded-full mt-1 overflow-hidden"><div class="bg-current h-full rounded-full" style="width:${pctv}%"></div></div>`:''}</div>`;
}

async function syncFixedMeals(){
 const user=await currentUser();
 if(!user)return;

 const cacheKey=`${FIXED_DIET_CACHE_V2}:${user.id}`;
 const readCache=()=>{
  try{
   const raw=sessionStorage.getItem(cacheKey);
   if(!raw)return null;
   const parsed=JSON.parse(raw);
   if(!parsed || !Number.isFinite(parsed.savedAt) || Date.now()-parsed.savedAt>FIXED_DIET_CACHE_TTL)return null;
   return Array.isArray(parsed.data)?parsed.data:null;
  }catch{return null;}
 };
 const writeCache=data=>{
  try{sessionStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now(),data}));}catch{}
 };

 const cached=readCache();
 if(cached){
  fixedMealsDatabase=cached;
  return;
 }

 if(fixedMealsLoadPromise)return fixedMealsLoadPromise;
 fixedMealsLoadPromise=(async()=>{
  const [pub,own]=await Promise.all([
   sb.from('diet_templates').select('id,name,description,created_by,target_calories,target_protein,target_carb,target_fat,visibility,created_at').eq('visibility','public').order('created_at',{ascending:false}),
   sb.from('diet_templates').select('id,name,description,created_by,target_calories,target_protein,target_carb,target_fat,visibility,created_at').eq('created_by',user.id).order('created_at',{ascending:false})
  ]);
  if(pub.error||own.error){
   console.error('Fixed diets load failed:',pub.error||own.error);
   fixedMealsDatabase=[];
   return;
  }

  const map=new Map();
  [...(pub.data||[]),...(own.data||[])].forEach(d=>map.set(d.id,d));
  fixedMealsDatabase=[...map.values()]
   .sort((a,b)=>(a.created_by===user.id?0:1)-(b.created_by===user.id?0:1))
   .map(d=>({
    id:d.id,
    name:d.name||'دايت ثابت',
    description:d.description||'',
    created_by:d.created_by,
    target_calories:d.target_calories,
    target_protein:d.target_protein,
    target_carb:d.target_carb,
    target_fat:d.target_fat
   }));
  writeCache(fixedMealsDatabase);
 })();

 try{await fixedMealsLoadPromise;}
 finally{fixedMealsLoadPromise=null;}
}

async function loadFixedDietDetails(dietId){
 const dayResult=await sb.from('diet_template_days')
  .select('id,day_number,day_name')
  .eq('diet_id',dietId)
  .order('day_number',{ascending:true})
  .limit(1);
 if(dayResult.error)throw dayResult.error;
 const day=dayResult.data?.[0];
 if(!day)return null;

 const mealResult=await sb.from('diet_template_meals')
  .select('id,meal_name,meal_order,frequency')
  .eq('day_id',day.id)
  .order('meal_order',{ascending:true});
 if(mealResult.error)throw mealResult.error;
 const meals=mealResult.data||[];
 const mealIds=meals.map(m=>m.id);

 let items=[];
 if(mealIds.length){
  const itemResult=await sb.from('diet_template_items')
   .select('id,meal_id,food_id,quantity_g,frequency,notes,household_measure')
   .in('meal_id',mealIds)
   .order('item_order',{ascending:true});
  if(itemResult.error)throw itemResult.error;
  items=itemResult.data||[];
 }

 return {
  id:dietId,
  meals:meals.map(m=>({
   name:m.meal_name||'وجبة',
   frequency:m.frequency||'',
   items:items.filter(i=>i.meal_id===m.id).map(i=>({
    foodId:String(i.food_id),
    grams:Number(i.quantity_g)||0,
    repeat:i.frequency??'',
    notes:i.notes??'',
    household_measure:i.household_measure||''
   }))
  }))
 };
}

function renderFixedMealsList(){
 const list=document.getElementById('fixedMealsList');
 if(!list)return;
 const q=normalizeFoodSearch(document.getElementById('fixedMealsSearch')?.value||'');
 const filtered=fixedMealsDatabase.filter(d=>{
  if(!q)return true;
  return normalizeFoodSearch(d.name).includes(q) || normalizeFoodSearch(d.description).includes(q);
 });
 if(!filtered.length){
  list.innerHTML='<div class="text-center py-8 text-slate-400 font-bold">لا توجد دايتات مطابقة للبحث</div>';
  return;
 }
 list.innerHTML=filtered.map(d=>{
  const i=fixedMealsDatabase.indexOf(d);
  return `<div class="border border-slate-200 rounded-2xl p-4 bg-white">
   <div class="flex items-start justify-between gap-3">
    <div>
     <h4 class="font-black text-slate-800">${escapeHtml(d.name)}</h4>
     ${d.description?`<p class="text-xs text-slate-500 mt-1">${escapeHtml(d.description)}</p>`:''}
    </div>
    <button onclick="window.dietPlan.applyFixedDiet(${i})" class="bg-sky-600 text-white text-xs font-extrabold px-3 py-2 rounded-xl whitespace-nowrap">تطبيق اليوم</button>
   </div>
  </div>`;
 }).join('');
}
function initFixedMealsSearch(){
 const input=document.getElementById('fixedMealsSearch');
 if(!input||input.dataset.bound==='1')return;
 input.addEventListener('input',renderFixedMealsList);
 input.dataset.bound='1';
}

async function openFixedMeals(dayId){
 fixedMealsTargetDayId=dayId;
 const search=document.getElementById('fixedMealsSearch');
 if(search)search.value='';
 document.getElementById('fixedMealsList').innerHTML='<div class="text-center py-8 text-slate-400 font-bold">جاري تحميل مكتبة الدايت...</div>';
 document.getElementById('fixedMealsModal').classList.remove('hidden');
 initFixedMealsSearch();
 await syncFixedMeals();
 const list=document.getElementById('fixedMealsList');
 if(!fixedMealsDatabase.length){
  list.innerHTML='<div class="text-center py-8 text-slate-400 font-bold">لا توجد دايتات منشورة أو دايتات خاصة بك في مكتبة الدايت</div>';
  return;
 }
 renderFixedMealsList();
}
function closeFixedMeals(){document.getElementById('fixedMealsModal').classList.add('hidden');fixedMealsTargetDayId=null;}
async function applyFixedDiet(i){
 const diet=fixedMealsDatabase[i],day=daysData.find(d=>d.id===fixedMealsTargetDayId);
 if(!diet||!day||!isDayEditing(day.id)){showToast('افتح اليوم بوضع التعديل أولاً','error');return;}

 const install=details=>{
  if(!details?.meals?.length){showToast('هذا الدايت لا يحتوي على وجبات','error');return;}
  day.meals=details.meals.map((m,mi)=>({
   id:'m_'+Date.now()+'_'+mi+'_'+Math.random().toString(36).slice(2),
   name:m.name||`وجبة ${mi+1}`,
   description:'',
   items:m.items.map((it,ii)=>({
    itemId:'it_'+Date.now()+'_'+mi+'_'+ii+'_'+Math.random().toString(36).slice(2),
    foodId:String(it.foodId),
    grams:num(it.grams),
    includeInCalculation:true,
    repeat:it.repeat||'',
    notes:it.notes||''
   }))
  }));
  day.appliedFixedDietKey=diet.id;
  day.appliedFixedDietName=diet.name;
  renderDays();
  closeFixedMeals();
  showToast(`تم تطبيق «${diet.name}» على اليوم بالكامل`);
 };

 const loadAndInstall=async()=>{
  try{
   const details=await loadFixedDietDetails(diet.id);
   if(!details){showToast('تعذر العثور على تفاصيل هذا الدايت','error');return;}
   const foodIds=[...new Set(details.meals.flatMap(m=>m.items.map(it=>String(it.foodId)).filter(Boolean)))];
   if(foodIds.length && !(await loadFoods({ids:foodIds}))){return;}
   install(details);
  }catch(error){
   console.error('Fixed diet details load failed:',error);
   showToast('تعذر تحميل تفاصيل الدايت','error');
  }
 };

 const has=day.meals.some(m=>m.items?.length);
 if(has){
  openConfirmModal('استبدال محتوى اليوم',`هذا اليوم يحتوي بالفعل على أصناف. تطبيق «${diet.name}» سيستبدل وجبات اليوم الحالية بالكامل. هل تريد المتابعة؟`,loadAndInstall);
 }else{
  await loadAndInstall();
 }
}

function newCloudUuid(){
  return (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
        const r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);
        return v.toString(16);
      });
}

async function savePlan(){
  if(!(await canWriteVisitData())){
    showToast('حفظ الخطة الغذائية متاح أثناء الاشتراك المدفوع فقط','error');
    return false;
  }

  const user=await currentUser();
  if(!user||!(window.currentPatientId||patientId)){
    showToast('لم يتم تحديد المريض أو المستخدم','error');
    return false;
  }

  try{
    const localDays=Array.isArray(savedDaysData)
      ? savedDaysData
      : (Array.isArray(daysData)?daysData:[]);

    // Validate food references before starting the atomic database operation.
    const missingFoods=[];
    localDays.forEach(day=>(day.meals||[]).forEach(meal=>(meal.items||[]).forEach(item=>{
      if(!item.foodId)return;
      if(!foodDatabase.some(f=>String(f.id)===String(item.foodId))){
        missingFoods.push(String(item.foodId));
      }
    })));

    if(missingFoods.length){
      throw new Error(
        'الصنف غير موجود في مكتبة الأغذية: '+
        [...new Set(missingFoods)].join(', ')
      );
    }

    const currentPatientId=window.currentPatientId||patientId;
    let planId=activeCloudPlanId || null;

    // Never send a stale plan id to the RPC. The database accepts an id only
    // when it belongs to this patient and this exact plan type.
    if(planId){
      const {data:matchingPlan,error:matchingPlanError}=await sb.from('nutrition_plans').select('id,plan_name')
        .eq('id',planId).eq('patient_id',currentPatientId).maybeSingle();
      if(matchingPlanError)throw matchingPlanError;
      if(!matchingPlan){
        if(isNewPlan){activeCloudPlanId=null;activePlanName=null;planId=null;}
        else throw new Error('معرّف الخطة لا يطابق المريض الحالي. أعد فتح الخطة من شريط الخطط قبل الحفظ.');
      }else{
        if(String(matchingPlan.plan_name||'').includes('البدائل'))throw new Error('هذه الخطة مخصصة للبدائل وليست خطة الجرامات.');
        activePlanName=matchingPlan.plan_name;
      }
    }

    const planData={
      id:planId,
      patient_id:currentPatientId,
      plan_name:activePlanName || 'الخطة الغذائية باستخدام الجرامات',
      start_date:activePlanStartDate || new Date().toISOString().slice(0,10),
      notes:null
    };

    const daysPayload=localDays.map(day=>({
      title:day.title||'',
      notes:day.notes||'',
      meals:(day.meals||[]).map(meal=>({
        name:meal.name||'',
        items:(meal.items||[]).map(item=>{
          const food=foodDatabase.find(f=>String(f.id)===String(item.foodId));
          return {
            foodId:item.foodId?String(item.foodId):null,
            grams:num(item.grams),
            household_measure:food?.household
              ? scaleHouseholdMeasure(food.household,num(item.grams))
              : null,
            repeat:item.repeat??null,
            notes:item.notes??null
          };
        })
      }))
    }));

    const {data:savedPlanId,error}=await sb.rpc('save_nutrition_plan',{
      p_plan:planData,
      p_days:daysPayload
    });

    if(error) throw new Error('فشل حفظ الخطة: '+error.message);
    activeCloudPlanId=savedPlanId;
    return true;
  }catch(e){
    console.error('Nutrition plan save failed:',e);
    window.__lastNutritionPlanSaveError=e?.message||String(e);
    showToast(window.__lastNutritionPlanSaveError,'error');
    return false;
  }
}

function renderDays(){
 const container=document.getElementById('daysContainer');
 if(!container)return;

 container.innerHTML=daysData.length?daysData.map((d,di)=>{
  const calc=calculateDay(d);
  const calPct=patientInfo.targetCal?Math.min(100,calc.cal/Number(patientInfo.targetCal)*100):0;
  const proPct=patientInfo.targetPro?Math.min(100,calc.pro/Number(patientInfo.targetPro)*100):0;
  const carbPct=patientInfo.targetCarb?Math.min(100,calc.carb/Number(patientInfo.targetCarb)*100):0;
  const fatPct=patientInfo.targetFat?Math.min(100,calc.fat/Number(patientInfo.targetFat)*100):0;
  const meals=d.meals||[];
  const itemCount=meals.reduce((sum,meal)=>sum+(meal.items||[]).length,0);

  return `<section class="day-card bg-white border border-slate-200 rounded-2xl overflow-hidden" data-day-id="${escapeHtml(d.id)}">
   <header class="day-card-header">
    <div class="day-card-heading">
     <button type="button" class="day-collapse-btn day-action-always" onclick="window.dietPlan.toggleDayCollapse('${escapeHtml(d.id)}')" aria-label="${d.isCollapsed?'فتح':'طي'} اليوم">
      <i class="fa-solid ${d.isCollapsed?'fa-chevron-down':'fa-chevron-up'}" aria-hidden="true"></i>
     </button>
     <div class="day-title-group">
      <input value="${escapeHtml(d.title||`اليوم ${di+1}`)}" onchange="window.dietPlan.updateDayTitle('${escapeHtml(d.id)}',this.value)" aria-label="اسم اليوم" class="day-title-input">
      <span class="day-card-meta">${itemCount} أصناف</span>
     </div>
    </div>
    <div class="day-card-actions no-print">
     <button type="button" class="day-edit-btn" onclick="window.dietPlan.editDay('${escapeHtml(d.id)}')"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>تعديل</span></button>
     <button type="button" class="day-save-btn" onclick="window.dietPlan.saveDay('${escapeHtml(d.id)}')"><i class="fa-solid fa-check" aria-hidden="true"></i><span>حفظ</span></button>
     <button type="button" class="day-action-always day-copy-btn" onclick="window.dietPlan.duplicateDay('${escapeHtml(d.id)}')" title="نسخ اليوم" aria-label="نسخ اليوم"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
     <button type="button" class="day-action-always day-delete-btn" onclick="window.dietPlan.deleteDay('${escapeHtml(d.id)}')" title="حذف اليوم" aria-label="حذف اليوم"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
    </div>
   </header>

   ${d.isCollapsed?'':`<div class="day-card-body">
    <section class="day-summary" aria-label="ملخص القيمة الغذائية لليوم">
     <div class="day-summary-heading"><strong>ملخص اليوم</strong><span>القيم المحسوبة من الأصناف المضافة</span></div>
     <div class="day-macros-grid">
      ${metricCard('السعرات',Math.round(calc.cal),'kcal',patientInfo.targetCal,calPct,'amber')}
      ${metricCard('البروتين',Math.round(calc.pro),'g',patientInfo.targetPro,proPct,'slate')}
      ${metricCard('الكربوهيدرات',Math.round(calc.carb),'g',patientInfo.targetCarb,carbPct,'sky')}
      ${metricCard('الدهون',Math.round(calc.fat),'g',patientInfo.targetFat,fatPct,'emerald')}
     </div>
     <div class="day-micros-row" aria-label="المعادن">
      <span><b>Na</b><strong>${Math.round(calc.sod)}</strong><small>mg</small></span>
      <span><b>K</b><strong>${Math.round(calc.pot)}</strong><small>mg</small></span>
      <span><b>P</b><strong>${Math.round(calc.pho)}</strong><small>mg</small></span>
     </div>
    </section>

    <section class="day-tools" aria-label="أدوات اليوم">
     <div class="day-primary-actions no-print">
      <button type="button" onclick="window.dietPlan.openAddMealModal('${escapeHtml(d.id)}')" class="day-add-meal-btn"><i class="fa-solid fa-plus" aria-hidden="true"></i> إضافة وجبة</button>
      <button type="button" onclick="window.dietPlan.openFixedMeals('${escapeHtml(d.id)}')" class="day-fixed-meal-btn"><i class="fa-solid fa-book-open" aria-hidden="true"></i> تطبيق دايت ثابت</button>
     </div>
     <label class="day-notes-wrap"><span>ملاحظات اليوم</span><textarea rows="1" oninput="window.dietPlan.updateDayNotes('${escapeHtml(d.id)}',this.value);this.style.height='auto';this.style.height=this.scrollHeight+'px'" placeholder="أضف ملاحظة خاصة بهذا اليوم" class="day-note-input">${escapeHtml(d.notes||'')}</textarea></label>
    </section>

    <section class="day-meals-list" aria-label="وجبات اليوم">
     ${meals.map((m,mi)=>{
      const foods=(m.items||[]).map(it=>({item:it,food:foodDatabase.find(x=>String(x.id)===String(it.foodId))})).filter(x=>x.food);
      return `<article class="meal-card">
       <header class="meal-card-header">
        <div class="meal-title-wrap"><span class="meal-order">${String(mi+1).padStart(2,'0')}</span><input value="${escapeHtml(m.name||`وجبة ${mi+1}`)}" onchange="window.dietPlan.updateMealName('${escapeHtml(d.id)}','${escapeHtml(m.id)}',this.value)" aria-label="اسم الوجبة" class="meal-title-input"><span class="meal-items-count">${foods.length} أصناف</span></div>
        <div class="meal-card-actions no-print">
         <button type="button" onclick="window.dietPlan.moveMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}',-1)" ${mi===0?'disabled':''} class="meal-order-btn" title="تحريك لأعلى" aria-label="تحريك لأعلى"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>
         <button type="button" onclick="window.dietPlan.moveMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}',1)" ${mi===meals.length-1?'disabled':''} class="meal-order-btn" title="تحريك لأسفل" aria-label="تحريك لأسفل"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>
         <button type="button" onclick="window.dietPlan.openFoodModal('${escapeHtml(d.id)}','${escapeHtml(m.id)}')" class="meal-add-food-btn"><i class="fa-solid fa-plus" aria-hidden="true"></i> إضافة صنف</button>
         <button type="button" onclick="window.dietPlan.deleteMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}')" class="meal-delete-btn" title="حذف الوجبة" aria-label="حذف الوجبة"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
        </div>
       </header>
       <div class="meal-table-wrap">
        <table class="meal-items-table">
         <thead><tr><th>الصنف</th><th>الكمية</th><th>المقياس المنزلي</th><th>التكرار</th><th>ملاحظة</th><th class="no-print">حساب</th></tr></thead>
         <tbody>${foods.length?foods.map(({item:it,food:f})=>`<tr>
          <td class="meal-food-name">${escapeHtml(f.name)}</td>
          <td class="meal-quantity"><input type="number" min="0" step="1" value="${num(it.grams)}" onchange="window.dietPlan.updateMealItemGrams('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" aria-label="الكمية بالجرام"><span>جم</span></td>
          <td class="meal-household">${f.household?escapeHtml(scaleHouseholdMeasure(f.household,num(it.grams))):'—'}</td>
          <td><input type="text" value="${escapeHtml(it.repeat??'')}" onchange="window.dietPlan.updateMealItemRepeat('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" placeholder="7/7" aria-label="التكرار" class="meal-repeat-input"></td>
          <td><input type="text" value="${escapeHtml(it.notes??'')}" onchange="window.dietPlan.updateMealItemNotes('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" placeholder="ملاحظة" aria-label="ملاحظة الصنف" class="meal-item-note"></td>
          <td class="meal-calc-cell no-print"><input type="checkbox" ${it.includeInCalculation!==false?'checked':''} onchange="window.dietPlan.updateMealItemCalculation('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.checked)" aria-label="إدراج الصنف في الحساب"><button type="button" onclick="window.dietPlan.deleteFoodItemFromMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}')" class="meal-item-delete" title="حذف الصنف" aria-label="حذف الصنف"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td>
         </tr>`).join(''):'<tr><td colspan="6" class="meal-empty-state">لا توجد أصناف في هذه الوجبة. استخدم «إضافة صنف» للبدء.</td></tr>'}</tbody>
        </table>
       </div>
      </article>`;
     }).join('')}
    </section>
   </div>`}
  </section>`;
 }).join(''):'<div class="day-empty-state">لا توجد أيام غذائية بعد. أضف يومًا جديدًا للبدء.</div>';

 daysData.forEach(d=>setDayEditMode(d.id,!!dayEditModes[String(d.id)]));
 container.querySelectorAll('.day-note-input').forEach(el=>{
  el.style.height='auto';
  el.style.height=el.scrollHeight+'px';
 });
}
function openPrintSettingsModal(){
 const modal=document.getElementById('printSettingsModal');
 const pb=document.getElementById('executePrintBtn');
 if(pb)pb.dataset.printMode='diet';
 if(modal)modal.classList.remove('hidden');
}
function closePrintSettingsModal(){document.getElementById('printSettingsModal').classList.add('hidden')}
function buildPrintPlan(){
 const container=document.getElementById('printPlanContent');if(!container)return;
 const rows=daysData||[];
 container.innerHTML=rows.length?rows.map((day,di)=>{
   const meals=(day.meals||[]).filter(m=>(m.items||[]).some(it=>foodDatabase.some(f=>String(f.id)===String(it.foodId))));
   return `<section class="print-day"><h2 class="print-day-title">${escapeHtml(day.title||`اليوم ${di+1}`)}</h2>
   ${meals.length?meals.map(meal=>`<div class="print-meal"><h3 class="print-meal-title">${escapeHtml(meal.name||'وجبة')}</h3><table><thead><tr><th>الصنف</th><th style="width:18%;text-align:center">الكمية</th><th style="width:28%;text-align:center">المقياس المنزلي</th><th style="width:15%;text-align:center">التكرار</th><th style="width:22%;text-align:center">ملاحظة</th></tr></thead><tbody>${(meal.items||[]).map(it=>{const f=foodDatabase.find(x=>String(x.id)===String(it.foodId));if(!f)return'';return `<tr><td>${escapeHtml(f.name)}</td><td style="text-align:center">${num(it.grams)} جم</td><td style="text-align:center">${f.household?escapeHtml(scaleHouseholdMeasure(f.household,num(it.grams))):'—'}</td><td style="text-align:center">${escapeHtml(it.repeat||'—')}</td><td>${escapeHtml(it.notes||'—')}</td></tr>`}).join('')}</tbody></table></div>`).join(''):`<p class="print-note">لا توجد أصناف مسجلة لهذا اليوم.</p>`}
   ${day.notes?`<p class="print-note">ملاحظات اليوم: ${escapeHtml(day.notes)}</p>`:''}</section>`;
 }).join(''):`<p class="print-note">لا توجد أيام غذائية مسجلة.</p>`;
}
function executePrint(){
 const docName=document.getElementById('settingDocName')?.value?.trim()||'';
 const docSpec=document.getElementById('settingDocSpec')?.value?.trim()||'';
 const hospitalName=document.getElementById('settingClinicName')?.value?.trim()||'';
 const address=document.getElementById('settingAddress')?.value?.trim()||'';
 document.getElementById('printHospitalName').textContent=hospitalName;document.getElementById('printDoctorName').textContent=docName;document.getElementById('printDoctorSpecialty').textContent=docSpec;document.getElementById('printClinicAddress').textContent=address;document.getElementById('printReportDate').textContent='تاريخ التقرير: '+new Date().toLocaleDateString('ar-EG');const visitPatientName = (document.getElementById('patientName')?.textContent || '').trim();
 document.getElementById('printPatientName').textContent = visitPatientName && visitPatientName !== '—' ? 'لـ : ' + visitPatientName : '';
 buildPrintPlan();closePrintSettingsModal();setTimeout(()=>window.print(),200);
}

function goBack(){location.href=`patient-profile.html?id=${encodeURIComponent(window.currentPatientId||patientId)}`;
}

async function confirmAction(){
 if(!confirmCallback)return false;
 const callback=confirmCallback;
 closeConfirmModal();
 await callback();
 return true;
}
let dietInitPromise=null;
function init(){
 if(dietInitPromise)return dietInitPromise;

 dietInitPromise=(async()=>{
   patientId=params.get('patient_id') || params.get('id') || window.currentPatientId || null;

   initFoodSearchInteraction();

   const ok=await loadPatient();
   if(!ok){dietInitPromise=null;return false;}

   await loadPlan(false);

   const planFoodIds=getPlanFoodIds();
   const foodsLoaded=planFoodIds.length
     ? await loadFoods({ids:planFoodIds})
     : true;

   if(!foodsLoaded){dietInitPromise=null;return false;}

   renderDays();
   return true;
 })().catch(error=>{
   console.error('Diet plan initialization failed:',error);
   dietInitPromise=null;
   showToast('تعذر تهيئة الخطة الغذائية','error');
   return false;
 });

 return dietInitPromise;
}

window.dietPlan = {confirmAction,escapeHtml, num, cloneDays, showToast, openConfirmModal, closeConfirmModal, scaleHouseholdMeasure, formatHouseholdNumber, currentUser, loadPatient, loadFoods, ensureAllFoods, loadPlan, updateTargets, isDayEditing, setDayEditMode, editDay, saveDay, addNewDay, toggleDayCollapse, duplicateDay, updateDayTitle, updateDayNotes, updateMealName, moveMeal, deleteDay, openAddMealModal, closeAddMealModal, confirmCreateMeal, deleteMeal, openFoodModal, closeFoodModal, updateFoodModalHousehold, filterFoodList, selectFoodForMeal, confirmAddFoodItem, updateMealItemGrams, updateMealItemRepeat, deleteFoodItemFromMeal, updateMealItemCalculation, renderDays, metricCard, syncFixedMeals, renderFixedMealsList, initFixedMealsSearch, openFixedMeals, closeFixedMeals, applyFixedDiet, newCloudUuid, savePlan, openPrintSettingsModal, closePrintSettingsModal, executePrint, goBack, init};
})();
