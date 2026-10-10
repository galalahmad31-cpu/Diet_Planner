(function(){
'use strict';
const access=window.DietPlannerAccess, sb=access?.supabaseClient;
const PLAN_FEATURES=[{key:'nutrition_support',label:'الدعم الغذائي'},{key:'diet',label:'الدايت المتقدم'},{key:'article',label:'المقال المتقدم'},{key:'product',label:'المنتجات الغذائية'}];
const state={plans:[],subs:[],profiles:[],patients:[],activeTab:'requests'};
let confirmAction=null;

const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const money=v=>v==null?'—':Number(v).toLocaleString('ar-EG',{maximumFractionDigits:2})+' ج.م';
const date=v=>v?new Date(v+'T00:00:00').toLocaleDateString('ar-EG',{year:'numeric',month:'2-digit',day:'2-digit'}):'—';
const dateTime=v=>v?new Date(v).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';
const planName=id=>state.plans.find(p=>p.id===id)?.name||'خطة غير معروفة';
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
function setState(prefix,msg,showTable=false){$(prefix+'State').textContent=msg;$(prefix+'State').style.display=showTable?'none':'block';$(prefix+'Wrap').style.display=showTable?'block':'none'}
function statusBadge(s,expiry){
 if(s==='paid'&&expiry&&expiry<new Date().toISOString().slice(0,10))return '<span class="badge expired">منتهية</span>';
 if(s==='paid')return '<span class="badge paid">مفعّلة</span>';
 if(s==='pending')return '<span class="badge pending">قيد المراجعة</span>';
 return '<span class="badge canceled">ملغاة</span>';
}
function closeModal(){ $('modalBg').style.display='none' }
function openModal(title,html){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalBg').style.display='flex'}
function askConfirm(title,text,action){$('confirmTitle').textContent=title;$('confirmText').innerHTML=text;$('confirmBg').style.display='flex';confirmAction=action}
function closeConfirm(){ $('confirmBg').style.display='none';confirmAction=null }

async function requireAdmin(){
 if(!sb||!access){location.replace('index.html');return false}
 const accessStatus=await access.getAccessStatus();
 if(!accessStatus?.authenticated || !accessStatus.isAdmin){location.replace('index.html');return false}
 $('adminContent').style.display='block';return true
}

async function loadAll(){
 const [p,s,prof,pat]=await Promise.all([
  sb.from('subscription_plans').select('*').order('created_at',{ascending:true}),
  sb.from('subscriptions').select('id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path,duration_days_snapshot,max_patients_snapshot,features_snapshot').order('created_at',{ascending:false}),
  sb.from('profiles').select('id,full_name,email,phone,role,created_at').eq('role','user').order('created_at',{ascending:false}),
  sb.from('patients').select('id,user_id,subscription_id')
 ]);
 if(p.error)throw p.error;if(s.error)throw s.error;if(prof.error)throw prof.error;if(pat.error)throw pat.error;
 state.plans=p.data||[];state.subs=s.data||[];state.profiles=prof.data||[];state.patients=pat.data||[];
  renderRequests();renderPlans();renderDoctors();
}
function renderRequests(){
 const body=$('requestsBody');$('totalCount').textContent=state.subs.length;$('pendingCount').textContent=state.subs.filter(s=>s.status==='pending').length;$('paidCount').textContent=state.subs.filter(s=>s.status==='paid').length;$('canceledCount').textContent=state.subs.filter(s=>s.status==='canceled').length;
 if(!state.subs.length){setState('request','لا توجد طلبات اشتراك حاليًا.');return}
 body.innerHTML=state.subs.map(s=>`<tr>
 <td><span class="name">${esc(s.full_name||'بدون اسم')}</span><span class="meta">${esc(state.profiles.find(p=>p.id===s.user_id)?.email||'')}</span></td>
 <td>${esc(planName(s.plan_id))}</td><td>${money(state.plans.find(p=>p.id===s.plan_id)?.price)}</td><td>${dateTime(s.created_at)}</td>
 <td>${date(s.start_date)}<br>${date(s.expiry_date)}</td><td>${statusBadge(s.status,s.expiry_date)}</td>
 <td>${s.payment_proof_path?'<button class="icon-btn" title="عرض الإثبات" data-proof="'+esc(s.id)+'"><i class="fa-solid fa-image"></i></button>':'—'}</td>
 <td class="actions-cell"><button class="icon-btn" title="تعديل" data-edit-sub="${esc(s.id)}"><i class="fa-solid fa-pen"></i></button>
 <button class="icon-btn danger" title="حذف" data-del-sub="${esc(s.id)}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
 setState('request','',true)
}
const featureLabel=k=>PLAN_FEATURES.find(x=>x.key===k)?.label||k;
function featuresText(f){const a=PLAN_FEATURES.filter(x=>f?.[x.key]===true).map(x=>x.label);return a.length?a.join('، '):'—'}
function renderPlans(){
 $('planCount').textContent=state.plans.length;$('activePlanCount').textContent=state.plans.filter(p=>p.is_active).length;
 const body=$('plansBody');if(!state.plans.length){setState('plan','لا توجد خطط.');return}
 body.innerHTML=state.plans.map(p=>`<tr>
 <td><span class="name">${esc(p.name)}</span>${p.is_free_trial?'<span class="meta">تجربة مجانية</span>':''}</td>
 <td>${money(p.price)}</td><td>${esc(p.duration_days)} يوم</td><td>${p.max_patients==null?'غير محدود':esc(p.max_patients)}</td><td>${esc(p.payment_method||'—')}</td>
 <td>${esc(featuresText(p.features))}</td><td><span class="badge ${p.is_active?'active':'off'}">${p.is_active?'متاحة':'غير متاحة'}</span></td>
 <td class="actions-cell"><button class="icon-btn" title="تعديل" data-edit-plan="${esc(p.id)}"><i class="fa-solid fa-pen"></i></button><button class="icon-btn danger" title="حذف" data-del-plan="${esc(p.id)}"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
 setState('plan','',true)
}
function latestSub(userId){return state.subs.filter(s=>s.user_id===userId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null}
function patientCountForSub(sub){return sub?state.patients.filter(p=>p.subscription_id===sub.id).length:state.patients.filter(p=>p.user_id===sub?.user_id).length}
function renderDoctors(){
 const q=($('doctorSearch').value||'').trim().toLowerCase();
 const doctors=state.profiles.filter(p=>!q||[p.full_name,p.email,p.phone].some(v=>String(v||'').toLowerCase().includes(q)));
 $('doctorCount').textContent=state.profiles.length;$('doctorActiveCount').textContent=state.profiles.filter(p=>{const s=latestSub(p.id);return s?.status==='paid'&&s.expiry_date>=new Date().toISOString().slice(0,10)}).length;
 const body=$('doctorsBody');if(!doctors.length){setState('doctor','لا توجد نتائج.');return}
 body.innerHTML=doctors.map(p=>{const s=latestSub(p.id),count=patientCountForSub(s);const max=s?.max_patients_snapshot;
 return `<tr><td><span class="name">${esc(p.full_name||'بدون اسم')}</span><span class="meta">${esc(p.email||'')}</span></td>
 <td>${s?esc(planName(s.plan_id)):'—'}</td><td>${date(s?.start_date)}</td><td>${date(s?.expiry_date)}</td>
 <td>${count} / ${max==null?'∞':esc(max)}</td><td>${s?statusBadge(s.status,s.expiry_date):'<span class="badge off">بدون اشتراك</span>'}</td>
 <td class="actions-cell">${s?'<button class="icon-btn" title="تعديل الاشتراك" data-edit-sub="'+esc(s.id)+'"><i class="fa-solid fa-pen"></i></button><button class="icon-btn danger" title="حذف الاشتراك" data-del-sub="'+esc(s.id)+'"><i class="fa-solid fa-trash"></i></button>':'—'}</td></tr>`}).join('');
 setState('doctor','',true)
}

function planForm(p){
 const f=p?.features||{},keys=PLAN_FEATURES.map(x=>x.key);
 return `<form id="planForm"><div class="grid">
 <div class="field"><label>اسم الخطة *</label><input id="f_name" required value="${esc(p?.name||'')}"></div>
 <div class="field"><label>السعر (جنيه) *</label><input id="f_price" type="number" min="0" step="0.01" required value="${p?.price??0}"></div>
 <div class="field"><label>المدة بالأيام *</label><input id="f_duration" type="number" min="1" required value="${p?.duration_days??30}"></div>
 <div class="field"><label>الحد الأقصى للمرضى</label><input id="f_max" type="number" min="1" placeholder="اتركه فارغًا = غير محدود" value="${p?.max_patients??''}"></div>
 <div class="field"><label>طريقة الدفع</label><input id="f_payment" placeholder="مثال: Instapay / Vodafone Cash / تحويل بنكي" value="${esc(p?.payment_method||'')}"></div>
 <div class="field"><label>الحالة</label><select id="f_active"><option value="true" ${p?.is_active!==false?'selected':''}>متاحة للاشتراك</option><option value="false" ${p?.is_active===false?'selected':''}>غير متاحة</option></select></div>
 <div class="field"><label class="check"><input id="f_trial" type="checkbox" ${p?.is_free_trial?'checked':''}> خطة تجربة مجانية</label></div>
 <div class="field full"><label>الوصف</label><textarea id="f_desc">${esc(p?.description||'')}</textarea></div>
 <div class="field full"><label>المميزات</label><div class="check-grid">${keys.map(k=>{const meta=PLAN_FEATURES.find(x=>x.key===k);return '<label class="check"><input type="checkbox" class="feature-check" data-key="'+esc(k)+'" '+(f[k]===true?'checked':'')+'> '+esc(meta?.label||k)+'</label>'}).join('')}</div></div>
 </div><div class="modal-foot"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ الخطة</button><button class="btn btn-outline" type="button" id="cancelModal">إلغاء</button></div></form>`
}
function openPlan(p){openModal(p?'تعديل الخطة':'إنشاء خطة جديدة',planForm(p));$('planForm').addEventListener('submit',async e=>{e.preventDefault();await savePlan(p?.id||null)});$('cancelModal').onclick=closeModal}
async function savePlan(id){
 const features={};document.querySelectorAll('.feature-check:checked').forEach(x=>features[x.dataset.key]=true);
 const payload={name:$('f_name').value.trim(),price:Number($('f_price').value),duration_days:Number($('f_duration').value),max_patients:$('f_max').value?Number($('f_max').value):null,payment_method:$('f_payment').value.trim(),description:$('f_desc').value.trim()||null,is_active:$('f_active').value==='true',is_free_trial:$('f_trial').checked,features};
 if(!payload.name||payload.duration_days<1||payload.price<0||payload.max_patients===0){toast('راجع بيانات الخطة');return}
 let r=id?await sb.from('subscription_plans').update(payload).eq('id',id):await sb.from('subscription_plans').insert(payload);
 if(r.error){toast(r.error.message||'تعذر حفظ الخطة');return}
 closeModal();toast('تم حفظ الخطة');await loadAll()
}
function subForm(s){
 return `<form id="subForm"><div class="grid">
 <div class="field"><label>اسم الطبيب في سجل الاشتراك</label><input id="s_name" value="${esc(s.full_name||'')}"></div>
 <div class="field"><label>الخطة</label><select id="s_plan">${state.plans.map(p=>`<option value="${p.id}" ${p.id===s.plan_id?'selected':''}>${esc(p.name)} — ${money(p.price)}</option>`).join('')}</select></div>
 <div class="field"><label>الحالة</label><select id="s_status"><option value="pending" ${s.status==='pending'?'selected':''}>قيد المراجعة</option><option value="paid" ${s.status==='paid'?'selected':''}>مفعّلة</option><option value="canceled" ${s.status==='canceled'?'selected':''}>ملغاة</option></select></div>
 <div class="field"><label>تاريخ الطلب</label><input value="${esc(dateTime(s.created_at))}" disabled></div>
 <div class="field full"><label>ملاحظات</label><textarea id="s_notes">${esc(s.notes||'')}</textarea></div>
 <div class="field full"><div style="font-size:11px;color:#718683;background:#f7faf9;border-radius:9px;padding:9px">عند تفعيل الاشتراك، يقوم النظام تلقائيًا بحساب تاريخ البداية والنهاية وأخذ Snapshot من الخطة.</div></div>
 </div><div class="modal-foot"><button class="btn btn-primary" type="submit">حفظ التعديل</button><button class="btn btn-outline" type="button" id="cancelModal">إلغاء</button></div></form>`
}
function openSub(s){openModal('تعديل الاشتراك',subForm(s));$('subForm').addEventListener('submit',async e=>{e.preventDefault();await saveSub(s)});$('cancelModal').onclick=closeModal}
async function saveSub(s){
 const selectedPlan=state.plans.find(p=>p.id===$('s_plan').value);
 if(!selectedPlan){toast('الخطة المحددة غير موجودة');return}
 const payload={
  full_name:$('s_name').value.trim()||null,
  plan_id:selectedPlan.id,
  status:$('s_status').value,
  notes:$('s_notes').value.trim()||null
 };
 // If the admin changes the plan, explicitly refresh the entitlement snapshot
 // so the existing paid/pending subscription receives the selected plan's terms.
 if(selectedPlan.id!==s.plan_id){
  payload.duration_days_snapshot=selectedPlan.duration_days;
  payload.max_patients_snapshot=selectedPlan.max_patients;
  payload.features_snapshot=selectedPlan.features||{};
 }
 const r=await sb.from('subscriptions').update(payload).eq('id',s.id);
 if(r.error){toast(r.error.message||'تعذر تعديل الاشتراك');return}
 closeModal();toast('تم تعديل الاشتراك');await loadAll()
}
function deleteSubscription(s){
 askConfirm('حذف الاشتراك','هل أنت متأكد من حذف اشتراك <b>'+esc(s.full_name||'هذا الطبيب')+'</b>؟<br>سيتم حذف سجل الاشتراك نهائيًا. هذه العملية لا تحذف حساب الطبيب أو مرضاه.',async()=>{
  const r=await sb.from('subscriptions').delete().eq('id',s.id);if(r.error){toast(r.error.message||'تعذر حذف الاشتراك');return}toast('تم حذف الاشتراك');await loadAll()
 })
}
function deletePlan(p){
 const used=state.subs.some(s=>s.plan_id===p.id);
 if(used){toast('لا يمكن حذف خطة مرتبطة باشتراكات. عطّلها بدلًا من حذفها.');return}
 askConfirm('حذف الخطة','هل أنت متأكد من حذف خطة <b>'+esc(p.name)+'</b>؟<br>لن يمكن التراجع عن هذه العملية.',async()=>{
  const r=await sb.from('subscription_plans').delete().eq('id',p.id);if(r.error){toast(r.error.message||'تعذر حذف الخطة');return}toast('تم حذف الخطة');await loadAll()
 })
}
async function proof(id){
 const s=state.subs.find(x=>x.id===id);if(!s?.payment_proof_path)return;
 $('proofBody').innerHTML='جاري تحميل إثبات الدفع...';$('proofBg').style.display='flex';
 const r=await sb.storage.from('subscription-proofs').createSignedUrl(s.payment_proof_path,300);
 if(r.error||!r.data?.signedUrl){$('proofBody').innerHTML='<div class="state">تعذر عرض إثبات الدفع.</div>';return}
 $('proofBody').innerHTML='<img src="'+esc(r.data.signedUrl)+'" style="max-width:100%;max-height:70vh;display:block;margin:auto;border-radius:12px" alt="إثبات الدفع">'
}
function switchTab(tab){
 state.activeTab=tab;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 ['requests','plans','doctors'].forEach(x=>{$('tab-'+x).style.display=x===tab?'block':'none'});if(tab==='doctors')renderDoctors()
}

document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
$('newPlanBtn').onclick=()=>openPlan(null);$('refreshBtn').onclick=()=>loadAll();$('refreshDoctorsBtn').onclick=()=>loadAll();$('doctorSearch').oninput=renderDoctors;
$('dashboardBtn').onclick=()=>location.href='app.html';$('logoutBtn').onclick=async()=>{await sb.auth.signOut();location.replace('index.html')};
$('modalClose').onclick=closeModal;$('modalBg').onclick=e=>{if(e.target===e.currentTarget)closeModal()};
$('confirmClose').onclick=closeConfirm;$('confirmNo').onclick=closeConfirm;$('confirmYes').onclick=async()=>{const a=confirmAction;if(!a)return;confirmAction=null;$('confirmBg').style.display='none';await a()};
$('confirmBg').onclick=e=>{if(e.target===e.currentTarget)closeConfirm()};$('proofClose').onclick=()=>{$('proofBg').style.display='none'};$('proofBg').onclick=e=>{if(e.target===e.currentTarget)$('proofBg').style.display='none'};

$('requestsBody').onclick=e=>{
 const proofBtn=e.target.closest('[data-proof]'),edit=e.target.closest('[data-edit-sub]'),del=e.target.closest('[data-del-sub]');
 if(proofBtn)proof(proofBtn.dataset.proof);else if(edit){const s=state.subs.find(x=>x.id===edit.dataset.editSub);if(s)openSub(s)}else if(del){const s=state.subs.find(x=>x.id===del.dataset.delSub);if(s)deleteSubscription(s)}
};
$('plansBody').onclick=e=>{
 const edit=e.target.closest('[data-edit-plan]'),del=e.target.closest('[data-del-plan]');
 if(edit){const p=state.plans.find(x=>x.id===edit.dataset.editPlan);if(p)openPlan(p)}else if(del){const p=state.plans.find(x=>x.id===del.dataset.delPlan);if(p)deletePlan(p)}
};
$('doctorsBody').onclick=e=>{
 const edit=e.target.closest('[data-edit-sub]'),del=e.target.closest('[data-del-sub]');
 if(edit){const s=state.subs.find(x=>x.id===edit.dataset.editSub);if(s)openSub(s)}else if(del){const s=state.subs.find(x=>x.id===del.dataset.delSub);if(s)deleteSubscription(s)}
};

(async function init(){try{if(await requireAdmin())await loadAll()}catch(e){console.error(e);['request','plan','doctor'].forEach(x=>setState(x,e.message||'حدث خطأ'))}})();
})();
