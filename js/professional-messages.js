(() => {
  "use strict";
  const access=window.DietPlannerAccess, db=access?.supabaseClient, $=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const state={role:"professional",rows:[],tab:"conversations",search:""};
  const isPatient=()=>state.role==="patient";
  const nameOf=row=>isPatient()?row.professional_name:row.patient_name;
  const counterpartId=row=>isPatient()?row.professional_id:row.patient_user_id;
  function empty(root,message){if(root)root.innerHTML='<p class="patient-messages-empty">'+esc(message)+'</p>';}
  function filtered(rows){const term=state.search.trim().toLocaleLowerCase("ar");return rows.filter(r=>!term||String(nameOf(r)||"").toLocaleLowerCase("ar").includes(term));}
  function renderRow(row){
    const id=esc(row.request_id),name=esc(nameOf(row)||(isPatient()?"المختص":"المريض"));
    const date=new Date(row.created_at),dateText=Number.isNaN(date.getTime())?"":date.toLocaleDateString("ar-EG");
    let actions="";
    if(isPatient()){
      if(row.status==="pending")actions='<button type="button" data-cancel="'+id+'">إلغاء الطلب</button>';
      if(row.status==="blocked")actions='<button type="button" data-restore="'+id+'">طلب استعادة التواصل</button>';
      if(row.status==="declined")actions='<button type="button" data-restore="'+id+'">إعادة إرسال الطلب</button>';
    }else if(row.status==="pending"||row.status==="restore_pending"){
      actions='<button type="button" data-accept="'+id+'">موافقة</button><button type="button" data-decline="'+id+'">رفض</button>';
    }else if(row.status==="accepted")actions='<button type="button" data-block="'+id+'">إيقاف التواصل</button>';
    const active=row.status==="accepted";
    return '<article class="dp-chat-contact-row dp-conversation-request"><div class="dp-chat-contact"><span class="dp-chat-avatar"><i class="fa-solid '+(isPatient()?"fa-user-doctor":"fa-user")+'"></i></span><span class="dp-chat-contact-copy"><strong>'+name+'</strong><small>'+({pending:"طلب جديد",restore_pending:"طلب استعادة التواصل",blocked:"التواصل موقوف",accepted:"محادثة نشطة"}[row.status]||"")+'</small></span><span class="dp-chat-contact-status">'+dateText+'</span></div><div class="dp-conversation-actions">'+(active?'<button type="button" data-open="'+esc(counterpartId(row))+'">فتح المحادثة</button>':"")+actions+'</div></article>';
  }
  function openConversationRow(row){
    if(!row||row.status!=="accepted")return;
    const name=nameOf(row)||(isPatient()?"المختص":"المريض");
    window.DietPlannerPatientMessages?.openConversation({name,subtitle:"محادثة نشطة"},isPatient()
      ?{role:"patient",professionalId:row.professional_id,counterpartName:name,allowStandalone:true}
      :{role:"professional",patientUserId:row.patient_user_id,patientName:name,allowStandalone:true});
  }
  function bindRows(root){
    root.querySelectorAll("[data-accept]").forEach(b=>b.addEventListener("click",()=>act(b,"accepted")));
    root.querySelectorAll("[data-decline]").forEach(b=>b.addEventListener("click",()=>act(b,"declined")));
    root.querySelectorAll("[data-block]").forEach(b=>b.addEventListener("click",()=>act(b,"blocked")));
    root.querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>patientAction(b,false)));
    root.querySelectorAll("[data-restore]").forEach(b=>b.addEventListener("click",()=>patientAction(b,true)));
    root.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>{
      const row=state.rows.find(r=>counterpartId(r)===b.dataset.open&&r.status==="accepted");
      openConversationRow(row);
    }));
  }
  function render(){
    const requests=$("professionalConversationRequests"),conversations=$("professionalConversationList");if(!requests||!conversations)return;
    const active=filtered(state.rows.filter(r=>r.status==="accepted"));
    const pending=filtered(state.rows.filter(r=>["pending","restore_pending","blocked","declined"].includes(r.status)));
    const requestCount=$("communicationsRequestCount"),conversationCount=$("communicationsConversationCount");
    if(requestCount)requestCount.textContent=String(state.rows.filter(r=>["pending","restore_pending","blocked","declined"].includes(r.status)).length);
    if(conversationCount)conversationCount.textContent=String(active.length);
    requests.innerHTML=pending.length?pending.map(renderRow).join(""):'<p class="patient-messages-empty">'+(state.search?"لا توجد نتائج مطابقة.":"لا توجد طلبات أو محادثات موقوفة.")+'</p>';
    conversations.innerHTML=active.length?active.map(renderRow).join(""):'<p class="patient-messages-empty">'+(state.search?"لا توجد نتائج مطابقة.":"لا توجد محادثات نشطة حتى الآن.")+'</p>';
    requests.hidden=state.tab!=="requests";conversations.hidden=state.tab!=="conversations";
    const a=$("communicationsTabConversations"),b=$("communicationsTabRequests");
    a.setAttribute("aria-selected",String(state.tab==="conversations"));b.setAttribute("aria-selected",String(state.tab==="requests"));
    a.classList.toggle("is-active",state.tab==="conversations");
    b.classList.toggle("is-active",state.tab==="requests");
    bindRows(requests);bindRows(conversations);
  }
  async function act(button,decision){
    if(button.disabled)return;button.disabled=true;
    try{const {error}=await db.rpc("respond_professional_connection_request",{p_request_id:button.dataset[decision==="accepted"?"accept":decision==="declined"?"decline":"block"],p_decision:decision});if(error)throw error;await load();}
    catch(error){console.error("Communication action failed:",error);button.disabled=false;window.alert(error.message||"تعذر تنفيذ الإجراء.");}
  }
  async function patientAction(button,restore){
    if(button.disabled)return;button.disabled=true;
    try{
      const row=state.rows.find(r=>r.request_id===button.dataset[restore?"restore":"cancel"]);
      const result=restore?await db.rpc("request_professional_connection",{p_professional_id:row.professional_id,p_message:null}):await db.rpc("cancel_professional_connection_request",{p_request_id:row.request_id});
      if(result.error)throw result.error;await load();
    }catch(error){console.error("Patient communication action failed:",error);button.disabled=false;window.alert(error.message||"تعذر تنفيذ الإجراء.");}
  }
  async function load(){
    const refresh=$("professionalConversationsRefresh");if(refresh)refresh.disabled=true;
    empty($("professionalConversationRequests"),"جاري تحميل الطلبات...");empty($("professionalConversationList"),"جاري تحميل المحادثات...");
    try{const {data,error}=await db.rpc(isPatient()?"list_my_professional_connection_requests":"list_professional_connection_requests");if(error)throw error;state.rows=Array.isArray(data)?data:[];render();}
    catch(error){console.error("Communications load failed:",error);empty($("professionalConversationRequests"),error.message||"تعذر تحميل الطلبات.");empty($("professionalConversationList"),error.message||"تعذر تحميل المحادثات.");}
    finally{if(refresh)refresh.disabled=false;}
  }
  async function initialize(){
    if(!db){empty($("professionalConversationRequests"),"تعذر تهيئة التواصل.");return;}
    try{
      const status=await access?.getAccessStatus?.();state.role=status?.accountType==="patient"?"patient":"professional";
      $("communicationsTitle").textContent=isPatient()?"التواصل مع المختص":"التواصل مع المرضى";
      $("communicationsEyebrow").textContent=isPatient()?"PROFESSIONAL COMMUNICATIONS":"PATIENT COMMUNICATIONS";
      $("communicationsDescription").textContent=isPatient()?"تابع محادثاتك وطلبات التواصل مع المختصين من مكان واحد.":"إدارة محادثات المرضى وطلبات التواصل والاستعادة من مكان واحد.";
      $("communicationsSearch").placeholder=isPatient()?"ابحث باسم المختص...":"ابحث باسم المريض...";
      $("communicationsRequestLabel").textContent=isPatient()?"الطلبات والموقوفة":"طلبات التواصل";
      await load();
      const patientId=new URLSearchParams(window.location.search).get("patient_id");
      if(!isPatient()&&patientId){
        const row=state.rows.find(r=>r.status==="accepted"&&r.patient_user_id===patientId);
        if(row)openConversationRow(row);
      }
    }catch(error){console.error("Communications initialization failed:",error);empty($("professionalConversationList"),"تعذر تهيئة صفحة التواصل.");}
  }
  document.addEventListener("DOMContentLoaded",()=>{
    $("communicationsTabConversations")?.addEventListener("click",()=>{state.tab="conversations";render();});
    $("communicationsTabRequests")?.addEventListener("click",()=>{state.tab="requests";render();});
    $("communicationsSearch")?.addEventListener("input",e=>{state.search=e.target.value;render();});
    $("professionalConversationsRefresh")?.addEventListener("click",load);void initialize();
  },{once:true});
})();