/* =========================================================

 * GRAM-BASED DIET PLAN MODULE
 * Kept isolated in its own IIFE to protect its internal state.
 * ========================================================= */

/* Embedded diet-plan module. Kept isolated in an IIFE to avoid global/spaghetti collisions. */
(function(){

const sb=window.DietPlannerAccess?.supabaseClient;
if (!sb) { console.error("Diet Planner access layer is unavailable to the gram-based diet module."); return; }
const params=new URLSearchParams(location.search);
const initialUrlVisitId=params.get('visit_id') || params.get('id');
const initialUrlPatientId=params.get('patient_id');
let visitId=initialUrlVisitId;
let patientId=initialUrlPatientId;

let activeCloudPlanId=null, patientInfo={}, foodDatabase=[], daysData=[], savedDaysData=[], dayEditModes={};
let fixedMealsDatabase=[], fixedMealsTargetDayId=null, currentModalContext={dayId:null,mealId:null}, targetMealDayId=null, confirmCallback=null;

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

 /*
  * When this module is embedded in visit.html, visit.js already owns
  * and validates the patient/visit context. Re-querying patients here
  * creates an unnecessary dependency and can fail under a valid RLS setup.
  * Consume the trusted page context instead.
  */
 const pageContext=window.visitContext||{};
 if(pageContext.patient_id){
  visitId=pageContext.id||visitId;
  patientId=pageContext.patient_id;
  window.currentPatientId=patientId;

  patientInfo={
   id:patientId,
   name:document.getElementById('patientName')?.textContent||'',
   targetCal:'',
   targetPro:'',
   targetCarb:'',
   targetFat:'',
   goal:'loss'
  };
  return true;
 }

 let resolvedPatientId=patientId;

 if(visitId){
  const {data:v,error:ve}=await sb.from('patient_visits')
   .select('id,patient_id,visit_number,visit_date')
   .eq('id',visitId).eq('user_id',user.id).maybeSingle();

  if(ve||!v){showToast('تعذر تحميل الزيارة','error');return false;}
  resolvedPatientId=v.patient_id;
 }

 if(!resolvedPatientId){location.href='patient.html';return false;}

 const {data:p,error}=await sb.from('patients').select('*')
  .eq('id',resolvedPatientId).eq('user_id',user.id).maybeSingle();

 if(error||!p){showToast('تعذر تحميل ملف المريض','error');return false;}

 window.currentPatientId=resolvedPatientId;
 patientInfo={...p,targetCal:'',targetPro:'',targetCarb:'',targetFat:'',goal:'loss'};
 return true;
}

async function loadFoods(){
 /*
  * Ask Supabase for the exact current row count, then request that full
  * range. No fixed client-side limit such as 1000 is used.
  */
 const {data,error,count}=await sb.from('foods')
  .select('*',{count:'exact'})
  .order('name_ar',{ascending:true});

 if(error){
  console.error('Foods load failed:',error);
  showToast('تعذر تحميل مكتبة الأغذية','error');
  return false;
 }

 const rows=data||[];
 foodDatabase=rows.map(f=>({
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

 console.info(`Foods loaded: ${foodDatabase.length}`);
 return true;
}

async function loadPlan(){
 let query=sb.from('nutrition_plans').select('id,patient_id,visit_id,plan_name,start_date,target_calories,target_protein,target_carb,target_fat,target_fluid,goal,notes,created_at,updated_at').eq('patient_id',window.currentPatientId||patientId);
 if(visitId) query=query.eq('visit_id',visitId);
 const {data:plans,error}=await query.order('updated_at',{ascending:false}).order('created_at',{ascending:false}).limit(1);
 if(error){showToast('تعذر تحميل الخطة الغذائية','error');return;}
 const plan=plans?.[0];
 if(!plan){daysData=[];savedDaysData=[];updateTargets();renderDays();return;}
 activeCloudPlanId=plan.id;
 patientInfo.targetCal=plan.target_calories??''; patientInfo.targetPro=plan.target_protein??''; patientInfo.targetCarb=plan.target_carb??''; patientInfo.targetFat=plan.target_fat??''; patientInfo.goal=plan.goal||'loss';
 const {data:dayRows}=await sb.from('plan_days').select('id,plan_id,day_number,day_name').eq('plan_id',plan.id).order('day_number',{ascending:true});
 const ids=(dayRows||[]).map(x=>x.id);
 let meals=[]; if(ids.length){const r=await sb.from('plan_meals').select('id,day_id,meal_order,meal_name').in('day_id',ids).order('meal_order',{ascending:true});meals=r.data||[];}
 const mids=meals.map(x=>x.id); let items=[]; if(mids.length){const r=await sb.from('plan_items').select('id,meal_id,food_id,quantity_g,frequency,notes').in('meal_id',mids);items=r.data||[];}
 daysData=(dayRows||[]).map(d=>({id:d.id,title:d.day_name||`اليوم ${d.day_number}`,notes:'',isCollapsed:false,meals:meals.filter(m=>m.day_id===d.id).map(m=>({id:m.id,name:m.meal_name||'وجبة',description:'',items:items.filter(i=>i.meal_id===m.id).map(i=>({itemId:i.id,foodId:String(i.food_id),grams:Number(i.quantity_g)||0,includeInCalculation:true,...(i.frequency!=null?{repeat:i.frequency}:{}),...(i.notes!=null?{notes:i.notes}:{})}))}))}));
 savedDaysData=cloneDays(daysData); dayEditModes={}; updateTargets(); renderDays();
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
 if(!isDayEditing(id))return; const committed=cloneDays(savedDaysData),idx=committed.findIndex(d=>String(d.id)===String(id)),day=daysData.find(d=>String(d.id)===String(id)); if(!day)return;
 if(idx>=0)committed[idx]=cloneDays([day])[0];else committed.push(cloneDays([day])[0]);
 const old=cloneDays(savedDaysData);savedDaysData=committed;daysData=cloneDays(committed);
 const ok=await savePlan();
 if(!ok){savedDaysData=old;showToast('تعذر حفظ اليوم في قاعدة البيانات','error');daysData=cloneDays(old);renderDays();return;}
 dayEditModes[String(id)]=false;renderDays();showToast('تم حفظ بيانات اليوم بنجاح');
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

function openFoodModal(did,mid){
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

function confirmAddFoodItem(){
 const id=document.getElementById('selectedFoodId').value,g=parseFloat(document.getElementById('foodGramsInput').value);
 if(!id){showToast('يرجى اختيار صنف من القائمة أولاً','error');return}if(!g||g<=0){showToast('يرجى تحديد كمية صحيحة بالجرام','error');return}
 const {dayId,mealId}=currentModalContext,d=daysData.find(x=>x.id===dayId),m=d?.meals.find(x=>x.id===mealId);
 if(m&&isDayEditing(dayId)){m.items.push({itemId:'it_'+Date.now()+'_'+Math.random().toString(36).slice(2),foodId:id,grams:g,includeInCalculation:true});renderDays();closeFoodModal();showToast('تم إضافة الصنف إلى الوجبة بنجاح');}
}
function updateMealItemGrams(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.grams=Math.max(0,Number(v)||0);renderDays();}}
function updateMealItemRepeat(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.repeat=String(v??'').trim();renderDays();}}
function updateMealItemNotes(did,mid,iid,v){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.notes=String(v??'');}}
function deleteFoodItemFromMeal(did,mid,iid){openConfirmModal('حذف الصنف','هل أنت متأكد من حذف هذا الصنف من الوجبة؟',()=>{const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid);if(m&&isDayEditing(did)){m.items=m.items.filter(x=>x.itemId!==iid);renderDays();showToast('تم إزالة الصنف من الوجبة')}});}
function updateMealItemCalculation(did,mid,iid,checked){const d=daysData.find(x=>x.id===did),m=d?.meals.find(x=>x.id===mid),it=m?.items.find(x=>x.itemId===iid);if(it&&isDayEditing(did)){it.includeInCalculation=!!checked;renderDays();}}

function renderDays(){
 const c=document.getElementById('daysContainer'),empty=document.getElementById('emptyState');
 if(!daysData.length){c.innerHTML='';empty.classList.remove('hidden');return}empty.classList.add('hidden');
 const tc=num(patientInfo.targetCal),tp=num(patientInfo.targetPro),tcarb=num(patientInfo.targetCarb),tf=num(patientInfo.targetFat);
 c.innerHTML=daysData.map((d,di)=>{
  let cal=0,pro=0,carb=0,fat=0,sod=0,pot=0,pho=0;
  (d.meals||[]).forEach(m=>(m.items||[]).forEach(it=>{if(it.includeInCalculation===false)return;const f=foodDatabase.find(x=>String(x.id)===String(it.foodId));if(!f)return;const k=num(it.grams)/100;cal+=f.calories*k;pro+=f.protein*k;carb+=f.carbs*k;fat+=f.fat*k;sod+=f.sodium*k;pot+=f.potassium*k;pho+=f.phosphorus*k;}));
  const pct=(v,t)=>t?Math.min(Math.round(v/t*100),100):0,cc=pct(cal,tc),pp=pct(pro,tp),cp=pct(carb,tcarb),fp=pct(fat,tf),col=d.isCollapsed;
  return `<div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden page-break day-card day-locked" data-day-id="${escapeHtml(d.id)}">
   <div class="p-4 bg-slate-900 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-3 meal-header">
    <div class="flex items-center gap-3 w-full md:w-auto justify-between">
     <div class="flex items-center gap-2">
      <button class="day-action-always w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center" onclick="window.dietPlan.toggleDayCollapse('${escapeHtml(d.id)}')"><i class="fa-solid fa-chevron-down ${col?'':'rotate-180'}"></i></button>
      <span class="w-7 h-7 rounded-lg bg-slate-800 text-emerald-400 border border-slate-700 flex items-center justify-center font-black text-xs">${di+1}</span>
      <input type="text" value="${escapeHtml(d.title)}" onchange="window.dietPlan.updateDayTitle('${escapeHtml(d.id)}',this.value)" class="font-black text-base sm:text-lg text-white bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none w-36 sm:w-auto">
     </div>
    </div>
    <div class="flex items-center gap-1.5 no-print flex-wrap justify-end">
     <button type="button" onclick="window.dietPlan.editDay('${escapeHtml(d.id)}')" class="day-action-always day-edit-btn text-white bg-sky-600 hover:bg-sky-500 px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5"><i class="fa-solid fa-pen"></i><span>تعديل</span></button>
     <button type="button" onclick="window.dietPlan.saveDay('${escapeHtml(d.id)}')" class="day-action-always day-save-btn text-white bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5"><i class="fa-solid fa-floppy-disk"></i><span>حفظ</span></button>
     <button type="button" onclick="window.dietPlan.deleteDay('${escapeHtml(d.id)}')" class="day-action-always text-white bg-rose-600 hover:bg-rose-500 px-2.5 py-1.5 rounded-lg text-[10px] font-bold"><i class="fa-solid fa-trash"></i><span class="mr-1">حذف</span></button>
    </div>
   </div>
   <div class="p-4 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200 collapsible-body ${col?'hidden':''}">
    <div class="flex items-center justify-between mb-3"><h3 class="font-black text-slate-800 text-sm"><i class="fa-solid fa-chart-pie text-emerald-600 ml-1"></i>ملخص إجمالي اليوم</h3>${tc?`<span class="text-xs font-extrabold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">${cc}% من المستهدف</span>`:''}</div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
     ${metricCard('🔥 السعرات',cal.toFixed(0),'kcal',tc,cc,'amber')}
     ${metricCard('🥩 البروتين',pro.toFixed(1),'جرام',tp,pp,'slate')}
     ${metricCard('🍞 الكارب',carb.toFixed(1),'جرام',tcarb,cp,'sky')}
     ${metricCard('🥑 الدهون',fat.toFixed(1),'جرام',tf,fp,'emerald')}
    </div>
    <div class="mt-3 bg-white border border-slate-200 rounded-xl p-2.5 flex flex-wrap justify-between gap-2 text-[11px] font-bold">
     <span>🧂 الصوديوم: <b>${sod.toFixed(0)}</b> mg</span><span>🍌 البوتاسيوم: <b>${pot.toFixed(0)}</b> mg</span><span>🦴 الفسفور: <b>${pho.toFixed(0)}</b> mg</span>
    </div>
   </div>
   <div class="p-4 space-y-4 collapsible-body ${col?'hidden':''}">
    <div class="text-xs"><label class="block font-bold text-slate-600 mb-1">ملاحظات اليوم:</label><input type="text" value="${escapeHtml(d.notes||'')}" onchange="window.dietPlan.updateDayNotes('${escapeHtml(d.id)}',this.value)" class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2"></div>
    ${(d.meals||[]).map(m=>`<div class="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
     <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border-b border-slate-100 pb-2">
      <input type="text" value="${escapeHtml(m.name||'')}" onchange="window.dietPlan.updateMealName('${escapeHtml(d.id)}','${escapeHtml(m.id)}',this.value)" class="w-full max-w-md bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-black text-sm">
      <div class="flex items-center gap-1 no-print">
       <button onclick="window.dietPlan.moveMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}',-1)" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600"><i class="fa-solid fa-chevron-up text-xs"></i></button>
       <button onclick="window.dietPlan.moveMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}',1)" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-600"><i class="fa-solid fa-chevron-down text-xs"></i></button>
       <button onclick="window.dietPlan.deleteMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}')" class="w-8 h-8 rounded-lg bg-rose-50 text-rose-500"><i class="fa-solid fa-xmark"></i></button>
      </div>
     </div>
     <div class="overflow-x-auto custom-scrollbar"><table class="w-full min-w-[900px] table-fixed text-right text-[11px] sm:text-xs">
      <thead><tr class="text-slate-500 font-bold border-b border-slate-100"><th class="py-1.5 px-2 w-[30%]">اسم الصنف</th><th class="py-1.5 px-2 text-center w-[14%]">الكمية بالجم</th><th class="py-1.5 px-2 text-center w-[23%]">المقياس المنزلي</th><th class="py-1.5 px-2 text-center w-[15%]">التكرار</th><th class="py-1.5 px-2 text-center w-[22%]">ملاحظة</th><th class="py-1.5 px-2 text-center no-print w-[12%]">إجراء</th></tr></thead>
      <tbody>${m.items?.length?m.items.map(it=>{const f=foodDatabase.find(x=>String(x.id)===String(it.foodId));if(!f)return'';return `<tr class="border-b border-slate-50 last:border-0"><td class="py-1.5 px-2 font-bold text-slate-800">${escapeHtml(f.name)}</td><td class="py-1.5 px-2 text-center"><input type="number" min="0" step="1" value="${num(it.grams)}" onchange="window.dietPlan.updateMealItemGrams('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" class="w-24 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 text-center font-extrabold text-emerald-700"><span class="text-[9px] text-slate-400 mr-1">جم</span></td><td class="py-1.5 px-2 text-center text-emerald-700 font-bold">${f.household?escapeHtml(scaleHouseholdMeasure(f.household,num(it.grams))):'—'}</td><td class="py-1.5 px-2 text-center"><input type="text" value="${escapeHtml(it.repeat??'')}" onchange="window.dietPlan.updateMealItemRepeat('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" placeholder="7/7" class="w-20 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1 text-center font-extrabold text-sky-700"></td><td class="py-1.5 px-2"><input type="text" value="${escapeHtml(it.notes??'')}" onchange="window.dietPlan.updateMealItemNotes('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.value)" placeholder="ملاحظة" class="w-full min-w-[120px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-right font-semibold text-amber-800" title="ملاحظة خاصة بهذا الصنف"></td><td class="py-1.5 px-2 text-center no-print"><input type="checkbox" ${it.includeInCalculation!==false?'checked':''} onchange="window.dietPlan.updateMealItemCalculation('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}',this.checked)" class="w-4 h-4 cursor-pointer"><button onclick="window.dietPlan.deleteFoodItemFromMeal('${escapeHtml(d.id)}','${escapeHtml(m.id)}','${escapeHtml(it.itemId)}')" class="text-rose-400 mr-2"><i class="fa-solid fa-trash"></i></button></td></tr>`}).join(''):'<tr><td colspan="6" class="py-3 text-center text-slate-400 font-semibold">لا توجد أصناف مضافة لهذه الوجبة بعد</td></tr>'}</tbody>
     </table></div>
     <div class="mt-2 no-print"><button onclick="window.dietPlan.openFoodModal('${escapeHtml(d.id)}','${escapeHtml(m.id)}')" class="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1.5 rounded-lg">+ إضافة صنف للوجبة</button></div>
    </div>`).join('')}
    <div class="no-print mt-3 p-3 rounded-xl border border-sky-200 bg-sky-50/60 flex flex-wrap gap-2">
     <button onclick="window.dietPlan.openFixedMeals('${escapeHtml(d.id)}')" class="text-xs bg-sky-600 text-white px-3 py-2 rounded-lg font-extrabold"><i class="fa-solid fa-utensils ml-1"></i>الوجبات الثابتة لهذا اليوم</button>
     <button onclick="window.dietPlan.openAddMealModal('${escapeHtml(d.id)}')" class="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-bold"><i class="fa-solid fa-plus ml-1"></i>إضافة وجبة جديدة</button>
    </div>
   </div>
  </div>`;
 }).join('');
 daysData.forEach(d=>setDayEditMode(d.id,!!dayEditModes[String(d.id)]));
}
function metricCard(label,value,unit,target,pctv,kind){
 const bg={amber:'bg-amber-50 border-amber-200 text-amber-900',slate:'bg-slate-50 border-slate-200 text-slate-800',sky:'bg-sky-50 border-sky-200 text-sky-900',emerald:'bg-emerald-50 border-emerald-200 text-emerald-900'}[kind];
 return `<div class="${bg} border rounded-xl p-3"><div class="flex justify-between items-center mb-1"><span class="text-[11px] font-black">${label}</span>${target?`<span class="text-[10px] font-bold opacity-70">الهدف: ${target}g</span>`:''}</div><div class="flex items-baseline gap-1"><span class="text-xl font-black">${value}</span><span class="text-[10px] font-extrabold">${unit}</span></div>${target?`<div class="w-full bg-white/60 h-1.5 rounded-full mt-2 overflow-hidden"><div class="bg-current h-full rounded-full" style="width:${pctv}%"></div></div>`:''}</div>`;
}

async function syncFixedMeals(){
 const user=await currentUser();if(!user)return;
 const [pub,own]=await Promise.all([
  sb.from('diet_templates').select('*').eq('visibility','public').order('created_at',{ascending:false}),
  sb.from('diet_templates').select('*').eq('created_by',user.id).order('created_at',{ascending:false})
 ]);
 if(pub.error||own.error){console.error('Fixed diets load failed:',pub.error||own.error);fixedMealsDatabase=[];return}
 const map=new Map();[...(pub.data||[]),...(own.data||[])].forEach(d=>map.set(d.id,d));const diets=[...map.values()];
 const ids=diets.map(d=>d.id);if(!ids.length){fixedMealsDatabase=[];return}

 const days=[];
 for(let i=0;i<ids.length;i+=100){
  const chunk=ids.slice(i,i+100);
  const r=await sb.from('diet_template_days').select('*').in('diet_id',chunk).order('day_number',{ascending:true});
  if(r.error){console.error('Fixed diet days load failed:',r.error);fixedMealsDatabase=[];return}
  days.push(...(r.data||[]));
 }

 const dayIds=days.map(x=>x.id);
 const meals=[];
 for(let i=0;i<dayIds.length;i+=100){
  const chunk=dayIds.slice(i,i+100);
  const r=await sb.from('diet_template_meals').select('*').in('day_id',chunk).order('meal_order',{ascending:true});
  if(r.error){console.error('Fixed diet meals load failed:',r.error);fixedMealsDatabase=[];return}
  meals.push(...(r.data||[]));
 }

 const mids=meals.map(x=>x.id);
 const items=[];
 for(let i=0;i<mids.length;i+=100){
  const chunk=mids.slice(i,i+100);
  const r=await sb.from('diet_template_items').select('*').in('meal_id',chunk).order('item_order',{ascending:true});
  if(r.error){console.error('Fixed diet items load failed:',r.error);fixedMealsDatabase=[];return}
  items.push(...(r.data||[]));
 }

 fixedMealsDatabase=diets.map(d=>{const day=days.find(x=>x.diet_id===d.id);return{id:d.id,name:d.name||'دايت ثابت',description:d.description||'',created_by:d.created_by,target_calories:d.target_calories,target_protein:d.target_protein,target_carb:d.target_carb,target_fat:d.target_fat,meals:day?meals.filter(m=>m.day_id===day.id).map(m=>({name:m.meal_name||'وجبة',frequency:m.frequency||'',items:items.filter(i=>i.meal_id===m.id).map(i=>({foodId:String(i.food_id),grams:Number(i.quantity_g)||0,repeat:i.frequency??'',notes:i.notes??'',household_measure:i.household_measure||''}))})):[]}}).filter(d=>d.meals.length);
 fixedMealsDatabase.sort((a,b)=>(a.created_by===user.id?0:1)-(b.created_by===user.id?0:1));
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
   <div class="mt-3 space-y-2">
    ${d.meals.map((m,mi)=>`<div class="rounded-xl bg-slate-50 border border-slate-100 p-3">
     <h5 class="font-black text-slate-700 text-xs">${mi+1}. ${escapeHtml(m.name)}</h5>
     <div class="mt-2 overflow-x-auto"><table class="w-full text-[11px]"><tbody>
      ${m.items.map(it=>{const f=foodDatabase.find(x=>String(x.id)===String(it.foodId));return`<tr class="border-b border-slate-100">
       <td class="py-1.5 font-bold">${f?escapeHtml(f.name):escapeHtml(it.foodId)}</td>
       <td class="py-1.5 text-center">${num(it.grams)} جم</td>
       <td class="py-1.5 text-center">${f?.household?escapeHtml(scaleHouseholdMeasure(f.household,num(it.grams))):'—'}</td>
       <td class="py-1.5 text-center">${escapeHtml(it.repeat||'')}</td>
      </tr>`}).join('')}
     </tbody></table></div>
    </div>`).join('')}
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
function applyFixedDiet(i){
 const diet=fixedMealsDatabase[i],day=daysData.find(d=>d.id===fixedMealsTargetDayId);if(!diet||!day||!isDayEditing(day.id)){showToast('افتح اليوم بوضع التعديل أولاً','error');return}
 const install=()=>{day.meals=diet.meals.map((m,mi)=>({id:'m_'+Date.now()+'_'+mi+'_'+Math.random().toString(36).slice(2),name:m.name||`وجبة ${mi+1}`,description:'',items:m.items.map((it,ii)=>({itemId:'it_'+Date.now()+'_'+mi+'_'+ii+'_'+Math.random().toString(36).slice(2),foodId:String(it.foodId),grams:num(it.grams),includeInCalculation:true,repeat:it.repeat||'',notes:it.notes||''}))}));day.appliedFixedDietKey=diet.id;day.appliedFixedDietName=diet.name;renderDays();closeFixedMeals();showToast(`تم تطبيق «${diet.name}» على اليوم بالكامل`)}
 const has=day.meals.some(m=>m.items?.length);has?openConfirmModal('استبدال محتوى اليوم',`هذا اليوم يحتوي بالفعل على أصناف. تطبيق «${diet.name}» سيستبدل وجبات اليوم الحالية بالكامل. هل تريد المتابعة؟`,install):install();
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

    const planId=activeCloudPlanId || null;

    const planData={
      id:planId,
      patient_id:window.currentPatientId||patientId,
      visit_id:visitId||null,
      plan_name:'الخطة الغذائية',
      start_date:new Date().toISOString().slice(0,10),
      target_calories:Number(patientInfo.targetCal)||null,
      target_protein:Number(patientInfo.targetPro)||null,
      target_carb:Number(patientInfo.targetCarb)||null,
      target_fat:Number(patientInfo.targetFat)||null,
      target_fluid:null,
      goal:patientInfo.goal||null,
      notes:null
    };

    const daysPayload=localDays.map(day=>({
      title:day.title||'',
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

function goBack(){
 if(visitId){location.href=`visit.html?id=${encodeURIComponent(visitId)}`;return;}
 location.href=`patient-profile.html?id=${encodeURIComponent(window.currentPatientId||patientId)}`
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
  const ctx=window.visitContext||{};
  visitId=ctx.id || params.get('visit_id') || params.get('id') || null;
  patientId=ctx.patient_id || params.get('patient_id') || null;

  initFoodSearchInteraction();

  const ok=await loadPatient();
  if(!ok){dietInitPromise=null;return false;}

  const foodsLoaded=await loadFoods();
  if(!foodsLoaded){dietInitPromise=null;return false;}

  await loadPlan();
  return true;
 })().catch(error=>{
  console.error('Diet plan initialization failed:',error);
  dietInitPromise=null;
  showToast('تعذر تهيئة الخطة الغذائية','error');
  return false;
 });

 return dietInitPromise;
}

window.dietPlan = {confirmAction,escapeHtml, num, cloneDays, showToast, openConfirmModal, closeConfirmModal, scaleHouseholdMeasure, formatHouseholdNumber, currentUser, loadPatient, loadFoods, loadPlan, updateTargets, isDayEditing, setDayEditMode, editDay, saveDay, addNewDay, toggleDayCollapse, updateDayTitle, updateDayNotes, updateMealName, moveMeal, deleteDay, openAddMealModal, closeAddMealModal, confirmCreateMeal, deleteMeal, openFoodModal, closeFoodModal, updateFoodModalHousehold, filterFoodList, selectFoodForMeal, confirmAddFoodItem, updateMealItemGrams, updateMealItemRepeat, deleteFoodItemFromMeal, updateMealItemCalculation, renderDays, metricCard, syncFixedMeals, renderFixedMealsList, initFixedMealsSearch, openFixedMeals, closeFixedMeals, applyFixedDiet, newCloudUuid, savePlan, openPrintSettingsModal, closePrintSettingsModal, executePrint, goBack, init};
})();