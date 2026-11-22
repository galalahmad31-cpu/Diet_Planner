(()=> {
"use strict";
const access=window.DietPlannerAccess;
const db=access?.supabaseClient;
const $=id=>document.getElementById(id);
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const setCommunicationStatus=message=>{const node=$("communicationStatus");if(node)node.textContent=message;};
let loading=false;
function renderIncomingRequests(requests){
 const root=$("professionalConnectionRequests");
 const incoming=requests.filter(item=>item.status==="pending");
 if(!incoming.length){root.innerHTML='<div class="directory-empty-state">لا توجد طلبات محادثة واردة حاليًا.</div>';return;}
 root.innerHTML=incoming.map(r=>'<article class="directory-card" id="connection-request-'+esc(r.request_id)+'"><div class="directory-card-heading"><strong>'+esc(r.patient_name||"مريض")+'</strong><span class="directory-chip">طلب جديد</span></div><p>'+esc(r.message||"لم يرسل المريض رسالة.")+'</p><div class="directory-card-actions"><button type="button" class="directory-primary-button" data-answer="accepted" data-id="'+esc(r.request_id)+'">قبول المحادثة</button><button type="button" class="directory-secondary-button" data-answer="declined" data-id="'+esc(r.request_id)+'">رفض الطلب</button></div></article>').join("");
 root.querySelectorAll("[data-answer]").forEach(button=>button.addEventListener("click",async()=>{
  if(button.disabled)return;
  button.disabled=true;
  try{
   const {error}=await db.rpc("respond_professional_connection_request",{p_request_id:button.dataset.id,p_decision:button.dataset.answer});
   if(error)throw error;
   await loadRequests();
  }catch(error){
   setCommunicationStatus("تعذر تنفيذ الطلب: "+(error.message||"حدث خطأ غير متوقع."));
   button.disabled=false;
  }
 }));
}

function localDateInput(date=new Date()){
 const offset=date.getTimezoneOffset();
 return new Date(date.getTime()-offset*60000).toISOString().slice(0,10);
}
function professionalAgreementMarkup(r){
 const has=Boolean(r.agreement_service_title);
 const agreed=Boolean(r.patient_agreement_at&&r.professional_agreement_at);
 const sent=Boolean(r.payment_sent_at), received=Boolean(r.payment_received_at);
 const expired=Boolean(r.agreement_end_date&&r.agreement_end_date<localDateInput());
 const money=r.agreement_amount==null?"—":Number(r.agreement_amount).toLocaleString("ar-EG")+" "+(r.agreement_currency||"EGP");
 if(r.status==="accepted"&&!has){
  const start=localDateInput();
  return '<form class="professional-agreement-form" data-agreement-form="'+esc(r.request_id)+'"><h4>إرسال اتفاق المتابعة</h4><div class="professional-agreement-fields"><label>اسم الخدمة<input name="service_title" maxlength="120" required placeholder="مثال: متابعة تغذية شهرية"></label><label>القيمة بالجنيه<input name="amount" type="number" min="0" step="0.01" required></label><label>المدة بالأيام<input name="duration" type="number" min="1" max="3660" value="30" required></label><label>تاريخ البداية<input name="start_date" type="date" value="'+start+'" required></label><label>تاريخ النهاية<input name="end_date" type="date" value="'+localDateInput(new Date(Date.now()+29*86400000))+'" required></label><label class="is-wide">وصف الخدمة<textarea name="description" maxlength="2000" rows="2"></textarea></label><label class="is-wide">الشروط المتفق عليها<textarea name="terms" maxlength="4000" rows="2"></textarea></label></div><p class="professional-agreement-help">الدفع مباشر بينك وبين المريض. لا ترسل الاتفاق إلا بعد تحديد الخدمة والقيمة والمدة بدقة.</p><button type="submit" class="directory-primary-button">إرسال الاتفاق للمريض</button><p class="professional-agreement-message" role="status"></p></form>';
 }
 if(!has)return "";
 const status=r.status==="ended"?"انتهت المتابعة":expired?"انتهت مدة الاتفاق — الملف الصحي للقراءة فقط":r.status==="active"?"المتابعة نشطة":"بانتظار تأكيد الاتفاق والدفع";
 let actions="";
 if(r.status==="accepted"&&has&&!r.professional_agreement_at) actions+='<button type="button" class="directory-primary-button" data-care-step="agreement" data-request-id="'+esc(r.request_id)+'">تأكيد موافقتي على الاتفاق</button>';
 if(r.status==="accepted"&&agreed&&sent&&!received) actions+='<button type="button" class="directory-primary-button" data-care-step="payment_received" data-request-id="'+esc(r.request_id)+'">تأكيد استلام المبلغ</button>';
 return '<section class="professional-agreement-summary"><header><strong>اتفاق المتابعة</strong><span>'+esc(status)+'</span></header><div class="professional-agreement-summary__grid"><div><small>الخدمة</small><strong>'+esc(r.agreement_service_title)+'</strong></div><div><small>القيمة</small><strong>'+esc(money)+'</strong></div><div><small>المدة</small><strong>'+esc(r.agreement_duration_days)+' يوم</strong></div><div><small>البداية</small><strong>'+esc(r.agreement_start_date||"—")+'</strong></div><div><small>النهاية</small><strong>'+esc(r.agreement_end_date||"—")+'</strong></div></div>'+(r.agreement_service_description?'<p>'+esc(r.agreement_service_description)+'</p>':"")+(r.agreement_terms?'<p>'+esc(r.agreement_terms)+'</p>':"")+'<ol><li class="'+(r.patient_agreement_at?"is-done":"")+'">موافقة المريض</li><li class="'+(r.professional_agreement_at?"is-done":"")+'">موافقة المختص</li><li class="'+(sent?"is-done":"")+'">إرسال المبلغ</li><li class="'+(received?"is-done":"")+'">استلام المبلغ وبدء المتابعة</li></ol><div class="professional-agreement-actions">'+actions+'</div></section>';
}
async function submitAgreementForm(form){
 const id=form.dataset.agreementForm;
 const read=name=>form.elements.namedItem(name)?.value?.trim()||"";
 const start=read("start_date"),end=read("end_date"),duration=Number(read("duration")),amount=Number(read("amount"));
 const msg=form.querySelector(".professional-agreement-message");
 const button=form.querySelector('button[type="submit"]');
 if(!id||!read("service_title")||!Number.isFinite(amount)||amount<0||!Number.isInteger(duration)||duration<1||!start||!end){if(msg)msg.textContent="راجع بيانات الاتفاق وأدخل القيم المطلوبة.";return;}
 button.disabled=true;if(msg)msg.textContent="جارٍ حفظ الاتفاق...";
 try{
  const {error}=await db.rpc("save_professional_care_agreement",{p_request_id:id,p_service_title:read("service_title"),p_service_description:read("description")||null,p_amount:amount,p_duration_days:duration,p_start_date:start,p_end_date:end,p_terms:read("terms")||null});
  if(error)throw error;
  await loadRequests();
 }catch(error){if(msg)msg.textContent="تعذر إرسال الاتفاق: "+(error.message||"خطأ غير متوقع");button.disabled=false;}
}
async function confirmCareStep(button){
 if(button.disabled)return;
 const step=button.dataset.careStep;
 const message=step==="agreement"?"تأكيد موافقتك على تفاصيل الخدمة والسعر والمدة؟":"هل تؤكد استلام المبلغ مباشرة من المريض؟";
 const ok=await window.DPConfirm?.ask({title:step==="agreement"?"تأكيد الاتفاق":"تأكيد استلام المبلغ",message,confirmText:"تأكيد"});
 if(!ok)return;
 button.disabled=true;
 try{
  const {error}=await db.rpc("confirm_professional_connection_step",{p_request_id:button.dataset.requestId,p_step:step});
  if(error)throw error;
  await loadRequests();
 }catch(error){setCommunicationStatus("تعذر التأكيد: "+(error.message||"حدث خطأ غير متوقع."));button.disabled=false;}
}

function renderConversationHistory(requests){
 const root=$("professionalConversationHistory");
 const conversations=requests.filter(item=>["accepted","active","ended"].includes(item.status));
 if(!conversations.length){root.innerHTML='<div class="directory-empty-state">لا توجد محادثات مقبولة حتى الآن. ستظهر المحادثات هنا بعد قبول طلب جديد.</div>';return;}
 root.innerHTML=conversations.map(r=>{
  const active=r.status==="active";
  const ended=r.status==="ended";
  const chat='<div class="professional-request-chat" data-request-chat data-request-id="'+esc(r.request_id)+'" data-patient-id="'+esc(r.patient_id)+'"></div>';
  const activeLink=active?'<a class="directory-secondary-button" href="patient-profile.html?id='+encodeURIComponent(r.patient_id)+'">فتح ملف المريض</a>':"";
  const endButton=active?'<button type="button" class="professional-end-followup-button" data-end-followup="'+esc(r.request_id)+'">إنهاء المتابعة</button>':"";
  const state=ended?"انتهت المتابعة":active?"المتابعة نشطة":"محادثة مفتوحة · بانتظار الاتفاق والدفع";
  return '<article class="directory-card professional-conversation-card" id="connection-request-'+esc(r.request_id)+'"><div class="directory-card-heading"><strong>'+esc(r.patient_name||"مريض")+'</strong><span class="directory-chip">'+state+'</span></div><p>'+esc(r.message||"بدأت المحادثة دون رسالة افتتاحية.")+'</p><div class="professional-conversation-actions">'+activeLink+endButton+'</div>'+chat+professionalAgreementMarkup(r)+'</article>';
 }).join("");

 root.querySelectorAll("[data-agreement-form]").forEach(form=>form.addEventListener("submit",event=>{event.preventDefault();void submitAgreementForm(form);}));
 root.querySelectorAll("[data-care-step]").forEach(button=>button.addEventListener("click",()=>void confirmCareStep(button)));
\n root.querySelectorAll("[data-request-chat]").forEach(node=>{
  void window.DietPlannerPatientMessages?.mount(node,{
   patientId:node.dataset.patientId,requestId:node.dataset.requestId,role:"professional"
  });
 });
 root.querySelectorAll("[data-end-followup]").forEach(button=>button.addEventListener("click",()=>{
  openEndFollowupDialog(button.dataset.endFollowup);
 }));
}
function openEndFollowupDialog(requestId){
 const dialog=$("endProfessionalFollowupDialog");
 if(!dialog||!requestId)return;
 dialog.dataset.requestId=requestId;
 $("endProfessionalFollowupReason").value="";
 $("endProfessionalFollowupStatus").textContent="";
 $("endProfessionalFollowupStatus").className="";
 $("endProfessionalFollowupDialog").showModal();
}
async function endFollowup(){
 const dialog=$("endProfessionalFollowupDialog");
 const requestId=dialog?.dataset.requestId;
 const confirmButton=dialog?.querySelector("[data-end-followup-confirm]");
 if(!requestId||confirmButton?.disabled)return;
 confirmButton.disabled=true;
 $("endProfessionalFollowupStatus").textContent="جارٍ إنهاء المتابعة...";
 try{
  const {error}=await db.rpc("end_professional_followup",{
   p_request_id:requestId,
   p_reason:$("endProfessionalFollowupReason").value.trim()||null
  });
  if(error)throw error;
  dialog.close();
  setCommunicationStatus("تم إنهاء المتابعة. تم الاحتفاظ بملف المريض وسجل المحادثة.");
  await loadRequests();
 }catch(error){
  $("endProfessionalFollowupStatus").textContent="تعذر إنهاء المتابعة: "+(error.message||"حدث خطأ غير متوقع.");
 }finally{
  confirmButton.disabled=false;
 }
}
async function loadRequests(){
 if(loading)return;
 loading=true;
 const incomingRoot=$("professionalConnectionRequests");
 const historyRoot=$("professionalConversationHistory");
 try{
  const {data,error}=await db.rpc("list_professional_connection_requests");
  if(error)throw error;
  const requests=data||[];
  renderIncomingRequests(requests);
  renderConversationHistory(requests);
  const requestedId=new URLSearchParams(location.search).get("request");
  if(requestedId){
   const target=document.getElementById("connection-request-"+requestedId);
   if(target)target.scrollIntoView({behavior:"smooth",block:"center"});
  }
 }catch(error){
  incomingRoot.textContent="تعذر تحميل طلبات المحادثة.";
  historyRoot.textContent="تعذر تحميل سجل المحادثات.";
  console.error("Professional communication data load failed:",error);
 }finally{
  loading=false;
 }
}
async function init(){
 if(!db||typeof access?.getCurrentUser!=="function"){setCommunicationStatus("تعذر تهيئة نظام الحساب.");return;}
 try{const user=await access.getCurrentUser();if(!user){location.href="login.html";return;}await loadRequests();}
 catch(error){console.error("Professional communication initialization failed:",error);setCommunicationStatus("تعذر تحميل صفحة التواصل.");}
}
document.addEventListener("DOMContentLoaded",()=>{
 const dialog=$("endProfessionalFollowupDialog");
 dialog?.querySelector("[data-end-followup-cancel]")?.addEventListener("click",()=>dialog.close());
 dialog?.querySelector("[data-end-followup-confirm]")?.addEventListener("click",endFollowup);
 dialog?.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
 void init();
});
})();
