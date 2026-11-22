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
  return '<article class="directory-card professional-conversation-card" id="connection-request-'+esc(r.request_id)+'"><div class="directory-card-heading"><strong>'+esc(r.patient_name||"مريض")+'</strong><span class="directory-chip">'+state+'</span></div><p>'+esc(r.message||"بدأت المحادثة دون رسالة افتتاحية.")+'</p><div class="professional-conversation-actions">'+activeLink+endButton+'</div>'+chat+'</article>';
 }).join("");
 root.querySelectorAll("[data-request-chat]").forEach(node=>{
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
