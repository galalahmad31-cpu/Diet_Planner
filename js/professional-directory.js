(()=>{
"use strict";
const db=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const PAGE_SIZE=20;
const state={profiles:[],offset:0,loading:false,selectedProfile:null,requestSent:new Set()};
const modeLabels={online:"متابعة أونلاين",in_person:"متابعة حضورية",phone:"متابعة هاتفية"};
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const arr=value=>Array.isArray(value)?value:[];
const field=(label,value,icon)=>'<div class="directory-detail-field"><span><i class="fa-solid '+icon+'" aria-hidden="true"></i>'+label+'</span><strong>'+esc(value||"غير محدد")+'</strong></div>';

function filteredProfiles(){
 const q=$("directorySearch").value.trim().toLocaleLowerCase();
 const gov=$("directoryGovernorate").value,mode=$("directoryMode").value;
 return state.profiles.filter(p=>{
  const haystack=[p.display_name,p.professional_title,p.bio,p.city,p.governorate,...arr(p.specialties)].filter(Boolean).join(" ").toLocaleLowerCase();
  return (!q||haystack.includes(q))&&(!gov||p.governorate===gov)&&(!mode||arr(p.service_modes).includes(mode));
 });
}
function renderProfiles(){
 const list=filteredProfiles();
 $("directoryCards").innerHTML=list.map(p=>{
  const specialties=arr(p.specialties);
  const modes=arr(p.service_modes).map(m=>modeLabels[m]||m);
  return '<article class="directory-card">'
   +'<div class="directory-card-heading"><div><h2>'+esc(p.display_name||"مختص تغذية")+'</h2><p class="directory-professional-title">'+esc(p.professional_title||"")+'</p></div><span class="directory-verified"><i class="fa-solid fa-circle-check"></i> معتمد</span></div>'
   +'<div class="directory-card-facts">'
   +field("الموقع",[p.city,p.governorate].filter(Boolean).join("، "),"fa-location-dot")
   +field("سنوات الخبرة",p.experience_years==null?"غير محددة":p.experience_years+" سنة","fa-briefcase")
   +field("طرق المتابعة",modes.join("، "),"fa-video")
   +'</div>'
   +'<div class="directory-card-specialties"><span class="directory-field-label">التخصصات</span><div class="directory-chips">'+(specialties.length?specialties.map(s=>'<span class="directory-chip">'+esc(s)+'</span>').join(""):'<span class="directory-muted">غير محددة</span>')+'</div></div>'
   +'<p class="directory-card-bio">'+esc(p.bio||"لم يضف المختص نبذة تعريفية بعد.")+'</p>'
   +'<div class="directory-card-actions"><button type="button" class="directory-secondary-button" data-view-profile="'+esc(p.user_id)+'">عرض الملف</button><button type="button" class="directory-primary-button" data-request-profile="'+esc(p.user_id)+'" '+(state.requestSent.has(p.user_id)?'disabled':'')+'>'+(state.requestSent.has(p.user_id)?"تم إرسال الطلب":"طلب متابعة")+'</button></div>'
   +'</article>';
 }).join("");
 $("directoryStatus").textContent=list.length?"عدد النتائج المحمّلة: "+list.length:"لا توجد ملفات مهنية مطابقة لمعايير البحث.";
}
function renderGovernorates(){
 const select=$("directoryGovernorate"),selected=select.value;
 const values=[...new Set(state.profiles.map(p=>p.governorate).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
 select.innerHTML='<option value="">كل المحافظات</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 select.value=values.includes(selected)?selected:"";
}
async function loadProfiles(){
 if(state.loading)return;
 if(!db){$("directoryStatus").textContent="تعذر تهيئة الاتصال بقاعدة البيانات.";return;}
 state.loading=true;
 const more=$("directoryMore");more.disabled=true;
 $("directoryStatus").textContent=state.profiles.length?"جاري تحميل المزيد...":"جاري تحميل المتخصصين...";
 try{
  const {data,error}=await db.from("professional_directory_profiles")
   .select("user_id,display_name,professional_title,bio,specialties,city,governorate,experience_years,service_modes")
   .order("governorate").range(state.offset,state.offset+PAGE_SIZE-1);
  if(error)throw error;
  const page=Array.isArray(data)?data:[];
  state.profiles.push(...page);state.offset+=page.length;
  renderGovernorates();renderProfiles();
  more.hidden=page.length<PAGE_SIZE;
 }catch(error){
  console.error("[Professional Directory] Load failed:",error);
  $("directoryStatus").textContent="تعذر تحميل المتخصصين. أعد المحاولة بعد التحقق من الاتصال.";
  more.hidden=state.profiles.length===0;
 }finally{state.loading=false;more.disabled=false;}
}
function openProfile(profileId){
 const profile=state.profiles.find(p=>p.user_id===profileId);
 if(!profile)return;
 state.selectedProfile=profile;
 $("directoryModalTitle").textContent=profile.display_name||"ملف المختص";
 $("directoryModalSubtitle").textContent=profile.professional_title||"";
 $("directoryModalDetails").innerHTML=
  field("الموقع",[profile.city,profile.governorate].filter(Boolean).join("، "),"fa-location-dot")+
  field("سنوات الخبرة",profile.experience_years==null?"غير محددة":profile.experience_years+" سنة","fa-briefcase")+
  field("طرق المتابعة",arr(profile.service_modes).map(m=>modeLabels[m]||m).join("، "),"fa-video");
 $("directoryModalSpecialties").innerHTML=arr(profile.specialties).map(s=>'<span class="directory-chip">'+esc(s)+'</span>').join("")||'<span class="directory-muted">لم تُحدد تخصصات</span>';
 $("directoryModalBio").textContent=profile.bio||"لم يضف المختص نبذة تعريفية بعد.";
 $("directoryRequestMessage").value="";
 $("directoryModalStatus").textContent="";
 const send=$("directorySendRequest");
 send.disabled=state.requestSent.has(profileId);
 send.textContent=state.requestSent.has(profileId)?"تم إرسال الطلب":"إرسال طلب المتابعة";
 $("directoryModal").hidden=false;
 document.body.classList.add("directory-modal-open");
 $("directoryModalClose").focus();
}
function closeModal(){
 $("directoryModal").hidden=true;
 document.body.classList.remove("directory-modal-open");
 state.selectedProfile=null;
}
async function submitRequest(){
 const profile=state.selectedProfile;
 if(!profile)return;
 const user=await window.DietPlannerAccess?.getCurrentUser();
 if(!user){window.location.href="login.html?next="+encodeURIComponent("patient-portal.html");return;}
 const send=$("directorySendRequest"),message=$("directoryRequestMessage").value.trim();
 if(message.length>1000){$("directoryModalStatus").textContent="الرسالة يجب ألا تتجاوز 1000 حرف.";return;}
 send.disabled=true;$("directoryModalStatus").textContent="جاري إرسال طلب المتابعة...";
 try{
  const accountType=await window.DietPlannerAccess?.getUserAccountType(user.id);
  if(accountType!=="patient")throw new Error("patient_account_required");
  const {error}=await db.rpc("request_professional_connection",{p_professional_id:profile.user_id,p_message:message||null});
  if(error)throw error;
  state.requestSent.add(profile.user_id);
  $("directoryModalStatus").textContent="تم إرسال طلبك بنجاح. سيظهر للمختص لمراجعته والرد عليه.";
  $("directoryModalStatus").className="directory-modal-status is-success";
  send.textContent="تم إرسال الطلب";send.disabled=true;
  renderProfiles();
 }catch(error){
  console.error("[Professional Directory] Request failed:",error);
  const messages={
   patient_account_required:"هذه الخدمة متاحة لحسابات المرضى فقط.",
   patient_account_revoked:"حالة ملفك الصحي تحتاج مراجعة إدارة المنصة.",
   professional_not_available:"هذا الملف لم يعد متاحًا لاستقبال الطلبات.",
   already_in_care_team:"أنت مرتبط بالفعل بهذا المختص.",
   connection_request_already_processed:"يوجد طلب سابق تمت معالجته لهذا المختص.",
   message_too_long:"الرسالة أطول من الحد المسموح."
  };
  $("directoryModalStatus").textContent=messages[error.message]||"تعذر إرسال الطلب. حاول مرة أخرى.";
  $("directoryModalStatus").className="directory-modal-status is-error";
  send.disabled=false;
 }
}
document.addEventListener("DOMContentLoaded",()=>{
 $("directoryMore").addEventListener("click",loadProfiles);
 ["directorySearch","directoryGovernorate","directoryMode"].forEach(id=>$(id).addEventListener(id==="directorySearch"?"input":"change",renderProfiles));
 $("directoryCards").addEventListener("click",event=>{
  const view=event.target.closest("[data-view-profile]");
  const request=event.target.closest("[data-request-profile]");
  if(view)openProfile(view.dataset.viewProfile);
  if(request)openProfile(request.dataset.requestProfile);
 });
 $("directoryModalClose").addEventListener("click",closeModal);
 $("directoryModal").addEventListener("click",event=>{if(event.target===$("directoryModal"))closeModal();});
 document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("directoryModal").hidden)closeModal();});
 $("directorySendRequest").addEventListener("click",submitRequest);
 loadProfiles();
});
})();
