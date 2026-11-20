/* =========================================================

 * EXCHANGE-BASED DIET PLAN MODULE
 * Kept isolated in its own IIFE to protect its internal state.
 * ========================================================= */

(function(){
const G=[{k:'fruit',n:'الفاكهة',m:1,kcal:60,carb:15,pro:0,fat:0},{k:'veg',n:'الخضروات غير النشوية',m:1,kcal:25,carb:5,pro:2,fat:0},{k:'milk',n:'اللبن والزبادي',m:1,subs:['خالى الدسم','متوسط الدسم','غني الدسم'],v:{'خالى الدسم':[100,12,8,2],'متوسط الدسم':[120,12,8,5],'غني الدسم':[160,12,8,8]}},{k:'legumes',n:'البقوليات',m:1,kcal:115,carb:15,pro:7,fat:0},{k:'starch',n:'النشويات',m:0,kcal:80,carb:15,pro:2,fat:0},{k:'meat',n:'اللحوم',m:0,subs:['خالية الدهون','متوسطة الدهون','غنية الدهون'],v:{'خالية الدهون':[45,0,7,3],'متوسطة الدهون':[75,0,7,5],'غنية الدهون':[100,0,7,8]}},{k:'fat',n:'الدهون',m:0,kcal:45,carb:0,pro:0,fat:5}];
const S={ready:false,plan:null,saved:false,editing:false,notes:'',t:{cal:0,pro:0,carb:0,fat:0},r:{},confirm:null};
G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});
const dbx=window.DietPlannerAccess?.supabaseClient;
  if (!dbx) console.error("Diet Planner access layer is unavailable to the exchange-plan module.");
function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}
function normalizePlanNotes(value){return String(value??'').replace(/\r\n?/g,'\n').replace(/(?:\\\\n|\\n|\/n)/gi,'\n');}
const n=v=>Number.isFinite(Number(v))?Number(v):0,rnd=(v,d=2)=>Number(n(v).toFixed(d)),esc=escapeHtml;
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v??''));
async function currentExchangeUser(){return await window.DietPlannerAccess?.getCurrentUser?.()||null;}
async function canWriteExchangePlan(){
  const user=await currentExchangeUser();
  if(!user)return false;
  return (await window.DietPlannerAccess?.canWrite?.(user.id))===true;
}

function ctx(){return {patient_id:window.currentPatientId||new URLSearchParams(location.search).get('patient_id')||new URLSearchParams(location.search).get('id')}}
function status(s,e=false){const x=document.getElementById('exchangePlanStatus');if(x){x.textContent=s;x.className='text-[10px] font-bold '+(e?'text-rose-600':'text-emerald-600')}}
function vals(g){const a=S.r[g.k];if(g.v){const x=g.v[a.sub]||Object.values(g.v)[0];return{kcal:x[0],carb:x[1],pro:x[2],fat:x[3]}}return{kcal:g.kcal,carb:g.carb,pro:g.pro,fat:g.fat}}
function manual(){return ['fruit','veg','milk','legumes'].reduce((a,k)=>{const g=G.find(x=>x.k===k),r=S.r[k],v=vals(g),c=n(r.count);a.carb+=c*v.carb;a.pro+=c*v.pro;a.fat+=c*v.fat;a.kcal+=c*v.kcal;return a},{kcal:0,carb:0,pro:0,fat:0})}
function calc(){const m=manual();S.r.starch.count=Math.max(0,rnd((S.t.carb-m.carb)/15,2));const mp=m.pro+S.r.starch.count*2;const mv=vals(G.find(g=>g.k==='meat'));S.r.meat.count=Math.max(0,rnd((S.t.pro-mp)/7,2));S.r.fat.count=Math.max(0,rnd((S.t.fat-m.fat-S.r.meat.count*mv.fat)/5,2))}
function setButtons(){const has=!!S.plan;const save=document.getElementById('exchangeSaveBtn'),edit=document.getElementById('exchangeEditBtn'),del=document.getElementById('exchangeDeleteBtn'),note=document.getElementById('exchangePlanNotes');if(save)save.disabled=!S.editing;if(edit)edit.disabled=!has||S.editing;if(del)del.disabled=!has||S.editing;if(note){note.disabled=!S.editing;if(document.activeElement!==note)note.value=normalizePlanNotes(S.notes)}}
function updateDisplay(){
 calc();
 G.forEach(g=>{
  const row=document.querySelector('[data-ex-row="'+g.k+'"]');
  if(!row)return;
  const r=S.r[g.k],v=vals(g),c=n(r.count),els=row.querySelectorAll('[data-val]');
  [c*v.kcal,c*v.carb,c*v.pro,c*v.fat].forEach((value,i)=>{if(els[i])els[i].textContent=rnd(value,1)});
  const inp=row.querySelector('[data-count]');
  if(inp&&document.activeElement!==inp)inp.value=r.count;
 });
}
function render(){
 calc();
 const root=document.getElementById('exchangePlanContent');
 if(!root)throw new Error('مكوّن خطة البدائل غير موجود في صفحة المريض (exchangePlanContent).');
 let body=root.querySelector('#exchangeValuesBody');
 if(!body){
  const table=root.querySelector('.exchange-scroll table');
  if(!table)throw new Error('جدول حصص البدائل غير موجود داخل مكوّن الخطة.');
  body=table.tBodies[0]||table.createTBody();
  body.id='exchangeValuesBody';
 }
 body.innerHTML=G.map(g=>{
  const r=S.r[g.k],v=vals(g),c=n(r.count);
  let sub='—';
  if(g.subs)sub='<select data-sub="'+g.k+'" '+(S.editing?'':'disabled')+' class="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-bold">'+g.subs.map(s=>'<option value="'+esc(s)+'" '+(r.sub===s?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select>';
  const cnt=g.m?'<input data-count="'+g.k+'" '+(S.editing?'':'disabled')+' type="number" min="0" step="0.5" inputmode="decimal" value="'+r.count+'" class="exchange-value-emphasis w-20 mx-auto block text-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-extrabold">':'<span class="exchange-value-emphasis font-black">'+rnd(r.count,2)+'</span>';
  return '<tr data-ex-row="'+g.k+'" class="border-b border-slate-100 last:border-0"><td class="py-2.5 px-3 font-black">'+esc(g.n)+'</td><td class="py-2.5 px-3">'+sub+'</td><td class="py-2.5 px-3 text-center">'+cnt+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.kcal,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.carb,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.pro,1)+'</td><td data-val class="py-2.5 px-3 text-center font-bold">'+rnd(c*v.fat,1)+'</td></tr>';
 }).join('');
 updateDisplay();
 setButtons();
}
async function findPlans(){
 const c=ctx();
 if(!c.patient_id)throw new Error('لم يتم تحديد المريض لخطة البدائل.');
 if(!dbx)throw new Error('تعذر الاتصال بقاعدة البيانات.');
 const {data,error}=await dbx.from('nutrition_plans')
  .select('id,patient_id,plan_name,start_date,notes,created_at,updated_at')
  .eq('patient_id',c.patient_id)
  .order('updated_at',{ascending:false})
  .order('created_at',{ascending:false});
 if(error)throw error;
 return data||[];
}
async function loadExchangeValues(){
 if(!S.plan)return;
 const r=await dbx.from('exchange_values').select('group_name,subgroup_name,exchange_count').eq('plan_id',S.plan);
 if(r.error)throw r.error;
 (r.data||[]).forEach(x=>{const g=G.find(y=>y.n===x.group_name);if(g){S.r[g.k].count=n(x.exchange_count);if(x.subgroup_name)S.r[g.k].sub=x.subgroup_name}});
 S.saved=(r.data||[]).length>0;
}
async function ensureExchangePlan(skipAuth=false){
  if(!skipAuth && !(await canWriteExchangePlan())){status('إنشاء خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return null;}

 if(S.plan && isUuid(S.plan))return S.plan;

 const c=ctx();
 if(!c.patient_id){
  status('لم يتم تحديد المريض لخطة البدائل',true);
  return null;
 }

 const {data:createdPlanId,error:createError}=await dbx.rpc('create_nutrition_plan',{p_patient_id:c.patient_id});
 if(createError||!createdPlanId){status('تعذر إنشاء خطة البدائل: '+(createError?.message||'لم يتم استلام معرّف الخطة'),true);return null;}
 S.plan=createdPlanId;
 return S.plan;
}
function closeConfirm(){S.confirm=null;if(window.Swal&&typeof window.Swal.close==='function')window.Swal.close();}
function openConfirm(title,message,onConfirm){
 S.confirm=typeof onConfirm==='function'?onConfirm:null;
 if(window.Swal&&typeof window.Swal.fire==='function'){
  window.Swal.fire({icon:'warning',title,text:message,showCancelButton:true,confirmButtonText:'تأكيد الحذف',cancelButtonText:'إلغاء',reverseButtons:true,focusCancel:true}).then(async result=>{
   const action=S.confirm;S.confirm=null;
   if(result.isConfirmed&&action)await action();
  });
  return;
 }
 const action=S.confirm;S.confirm=null;
 if(action&&window.confirm(message))void action();
}
function renderDays(){/* Legacy day-based editor removed: exchange plans use free-form notes. */}
function openPrintSettings(){
  const modal=document.getElementById('printSettingsModal');
  const pb=document.getElementById('executePrintBtn');
  if(!modal||!pb)return;
  pb.dataset.printMode='exchange';
  modal.classList.remove('hidden');
}
function printAll(){
 openPrintSettings();
}
function buildPrintAll(){
 const container=document.getElementById('printPlanContent');
 if(!container)return;
 container.innerHTML=`<section class="print-day"><h2 class="print-day-title">تفاصيل الخطة الغذائية</h2><div class="print-plan-notes">${esc(normalizePlanNotes(S.notes)||'لا توجد تفاصيل مسجلة.').replace(/\n/g,'<br>')}</div></section>`;
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
 const note=document.getElementById('exchangePlanNotes');
 const normalizedNotes=normalizePlanNotes(note?.value??S.notes).trim();
 const noteUpdate=await dbx.from('nutrition_plans').update({notes:normalizedNotes}).eq('id',planId);
 if(noteUpdate.error){status('تعذر حفظ نص الخطة: '+noteUpdate.error.message,true);return false}
 S.notes=normalizedNotes;
 const del=await dbx.from('exchange_values').delete().eq('plan_id',planId);
 if(del.error){status('تعذر تحديث خطة البدائل: '+del.error.message,true);return false}
 const ins=await dbx.from('exchange_values').insert(rows);
 if(ins.error){status('تعذر حفظ خطة البدائل: '+ins.error.message,true);return false}
 S.plan=planId;S.saved=true;S.editing=false;render();setButtons();status('تم حفظ خطة البدائل بنجاح');return true;
}
async function saveAndPrintFromSettings(){
 const pb=document.getElementById('executePrintBtn');
 if(pb)pb.disabled=true;
 try{
  if(!(await canWriteExchangePlan())){status('حفظ وطباعة خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return false}
  const planId=await ensureExchangePlan(true);
  if(!planId){status('اعتمد السعرات والماكروز أولاً من الحاسبة',true);return false}

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
function edit(){if(!S.plan)return;S.editing=true;render();status('وضع التعديل')}
async function deletePlan(){if(!(await canWriteExchangePlan())){status('حذف خطة البدائل متاح أثناء الاشتراك المدفوع فقط',true);return;}if(!S.plan)return;const deletedPlanId=S.plan;openConfirm('حذف خطة البدائل','هل أنت متأكد من حذف خطة البدائل بالكامل؟',async()=>{try{const dr=await dbx.from('plan_days').select('id').eq('plan_id',deletedPlanId);if(dr.error)throw dr.error;const dids=(dr.data||[]).map(x=>x.id);if(dids.length){const mr=await dbx.from('plan_meals').select('id').in('day_id',dids);if(mr.error)throw mr.error;const mids=(mr.data||[]).map(x=>x.id);if(mids.length){let r=await dbx.from('plan_items').delete().in('meal_id',mids);if(r.error)throw r.error;r=await dbx.from('plan_meals').delete().in('day_id',dids);if(r.error)throw r.error}let r=await dbx.from('plan_days').delete().in('id',dids);if(r.error)throw r.error}let r=await dbx.from('exchange_values').delete() .eq('plan_id',deletedPlanId);if(r.error)throw r.error;r=await dbx.from('nutrition_plans').delete().eq('id',deletedPlanId);if(r.error)throw r.error;S.plan=null;S.saved=false;S.editing=true;S.r={};G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});render();setButtons();status('تم حذف خطة البدائل بنجاح');window.dispatchEvent(new CustomEvent('dp-exchange-plan-deleted',{detail:{planId:deletedPlanId}}))}catch(e){status('تعذر حذف خطة البدائل: '+(e.message||e),true)}})}
function setupExchangePlanEvents(){
 const notes=document.getElementById('exchangePlanNotes');
 if(notes&&notes.dataset.eventsReady!=='1'){
  notes.dataset.eventsReady='1';
  const resize=()=>{notes.style.height='auto';notes.style.height=Math.max(notes.scrollHeight,300)+'px'};
  notes.addEventListener('input',()=>{S.notes=notes.value;resize()});
  resize();
 }
 const valuesBody=document.getElementById('exchangeValuesBody');
 if(valuesBody&&valuesBody.dataset.eventsReady!=='1'){
  valuesBody.dataset.eventsReady='1';
  valuesBody.addEventListener('input',event=>{
   const el=event.target.closest('[data-count]');
   if(!el||!S.r[el.dataset.count])return;
   S.r[el.dataset.count].count=Math.max(0,n(el.value));
   updateDisplay();
  });
  valuesBody.addEventListener('change',event=>{
   const el=event.target.closest('[data-sub]');
   if(!el||!S.r[el.dataset.sub])return;
   S.r[el.dataset.sub].sub=el.value;
   updateDisplay();
  });
 }
}
async function init(requestedPlanId=null){
 S.ready=false;
 S.plan=null;S.saved=false;S.editing=false;S.notes='';S.t={cal:0,pro:0,carb:0,fat:0};S.confirm=null;
 G.forEach(g=>S.r[g.k]={count:0,sub:g.k==='milk'?'خالى الدسم':g.k==='meat'?'خالية الدهون':''});
 setupExchangePlanEvents();
 try{
  if(!dbx)throw new Error('تعذر الاتصال بقاعدة البيانات.');
  const c=ctx();
  if(!c.patient_id)throw new Error('لم يتم تحديد المريض.');
  const plans=await findPlans();
  const selectedPlan=requestedPlanId ? plans.find(p=>String(p.id)===String(requestedPlanId))
   : plans.find(p=>String(p.plan_name||'').includes('البدائل'));
  if(requestedPlanId&&!selectedPlan)throw new Error('الخطة المطلوبة غير موجودة لهذا المريض أو لا تملك صلاحية عرضها.');
  const patientEnergy=window.currentPatientEnergy||{};
  S.t={cal:n(patientEnergy.energy_target_calories),pro:n(patientEnergy.energy_target_protein),carb:n(patientEnergy.energy_target_carb),fat:n(patientEnergy.energy_target_fat)};
  if(selectedPlan&&isUuid(selectedPlan.id)){
   const selectedName=String(selectedPlan.plan_name||'');
   if(selectedName.includes('الجرامات'))throw new Error('هذه الخطة مخصصة للجرامات وليست خطة البدائل.');
   const isFreshNumberedPlan=/^الخطة\s+\d+\s+-/.test(selectedName);
   S.plan=selectedPlan.id;
   S.notes=normalizePlanNotes(selectedPlan.notes);
   await loadExchangeValues();
   S.editing=isFreshNumberedPlan || !S.saved;
  }else{S.plan=null;S.notes='';S.editing=true;}
  render();renderDays();setButtons();
  S.ready=true;
 }catch(error){
  S.ready=false;
  console.error('Exchange plan initialization failed:',error);
  status('تعذر تحميل خطة البدائل: '+(error?.message||String(error)),true);
  throw error;
 }
}
async function confirmAction(){const cb=S.confirm;if(!cb)return false;S.confirm=null;await cb();return true}
window.exchangePlan={init,hasPendingConfirm:()=>typeof S.confirm==='function',confirmAction,save,saveAndPrintFromSettings,edit,deletePlan,printAll,openPrintSettings,buildPrintAll,executePrintAll,renderDays,closeConfirmModal:closeConfirm};
})();
