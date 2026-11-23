(()=> {
"use strict";
const db=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const PAGE_SIZE=20;
const state={profiles:[],offers:new Map(),offset:0,loading:false,user:null,requests:new Map(),selectedProfileId:null};
const modeLabels={online:"متابعة أونلاين",in_person:"متابعة حضورية",phone:"متابعة هاتفية"};
const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const arr=value=>Array.isArray(value)?value:[];
const field=(label,value,icon)=>'<div class="directory-detail-field"><span><i class="fa-solid '+icon+'" aria-hidden="true"></i>'+label+'</span><strong>'+esc(value||"غير محدد")+'</strong></div>';
function specialtyField(profile){
 const chips=arr(profile.specialties).map(s=>'<span class="directory-chip">'+esc(s)+'</span>').join("");
 return '<div class="directory-detail-field directory-specialty-field"><span><i class="fa-solid fa-stethoscope" aria-hidden="true"></i>التخصصات</span><div class="directory-chips">'+(chips||'<span class="directory-muted">غير محددة</span>')+'</div></div>';
}
function renderOffers(profileId,compact=false){
 const offers=state.offers.get(profileId)||[];
 if(!offers.length)return '<p class="directory-offers-empty">لم يحدد المختص أسعار الخدمات بعد.</p>';
 return '<div class="directory-offers-list">'+offers.map(o=>'<article class="directory-offer"><div class="directory-offer-copy"><strong>'+esc(o.service_name)+'</strong><span>'+esc(o.duration_label||"للمتابعة")+'</span>'+(o.description?'<p>'+esc(o.description)+'</p>':"")+'</div><div class="directory-offer-price">'+(o.original_price?'<del>'+Number(o.original_price).toLocaleString("ar-EG")+' ج.م</del>':"")+'<strong>'+Number(o.price).toLocaleString("ar-EG")+' ج.م</strong></div></article>').join("")+'</div>';
}
function filteredProfiles(){
 const q=$("directorySearch").value.trim().toLocaleLowerCase(),gov=$("directoryGovernorate").value,mode=$("directoryMode").value;
 return state.profiles.filter(p=>{
  const haystack=[p.display_name,p.professional_title,p.bio,p.city,p.governorate,...arr(p.specialties)].filter(Boolean).join(" ").toLocaleLowerCase();
  return (!q||haystack.includes(q))&&(!gov||p.governorate===gov)&&(!mode||arr(p.service_modes).includes(mode));
 });
}
function renderProfiles(){
 const list=filteredProfiles();
 $("directoryCards").innerHTML=list.map(p=>{
  const modes=arr(p.service_modes).map(m=>modeLabels[m]||m);
  return '<article class="directory-card"><div class="directory-card-heading"><div><h2>'+esc(p.display_name||"مختص تغذية")+'</h2><p class="directory-professional-title">'+esc(p.professional_title||"")+'</p></div><span class="directory-verified"><i class="fa-solid fa-circle-check"></i> معتمد</span></div><div class="directory-card-facts">'
   +field("الموقع",[p.city,p.governorate].filter(Boolean).join("، "),"fa-location-dot")
   +field("سنوات الخبرة",p.experience_years==null?"غير محددة":p.experience_years+" سنة","fa-briefcase")
   +field("طرق المتابعة",modes.join("، "),"fa-video")
   +specialtyField(p)+'</div><p class="directory-card-bio">'+esc(p.bio||"لم يضف المختص نبذة تعريفية بعد.")+'</p>'
   +'<section class="directory-card-offers"><h3>الخدمات والأسعار</h3>'+renderOffers(p.user_id,true)+'</section>'
   +'<div class="directory-card-actions"><button type="button" class="directory-secondary-button" data-view-profile="'+esc(p.user_id)+'">عرض الملف</button><button type="button" class="directory-primary-button" data-request-profile="'+esc(p.user_id)+'">طلب محادثة</button></div></article>';
 }).join("");
 $("directoryStatus").textContent=list.length?"عدد النتائج المحمّلة: "+list.length:"لا توجد ملفات مهنية مطابقة لمعايير البحث.";
}
function renderGovernorates(){
 const select=$("directoryGovernorate"),selected=select.value;
 const values=[...new Set(state.profiles.map(p=>p.governorate).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
 select.innerHTML='<option value="">كل المحافظات</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join("");
 select.value=values.includes(selected)?selected:"";
}
async function loadOffers(profiles){
 const ids=profiles.map(p=>p.user_id);
 if(!ids.length)return;
 const {data,error}=await db.from("professional_directory_offers").select("professional_id,service_name,description,price,original_price,duration_label,currency,sort_order").in("professional_id",ids).eq("is_active",true).order("sort_order").order("created_at");
 if(error){console.error("[Professional Directory] Offers load failed:",error);return;}
 for(const id of ids)state.offers.set(id,[]);
 for(const offer of data||[])state.offers.get(offer.professional_id)?.push(offer);
}
async function loadProfiles(){
 if(state.loading)return;
 if(!db){$("directoryStatus").textContent="تعذر تهيئة الاتصال بقاعدة البيانات.";return;}
 state.loading=true;const more=$("directoryMore");more.disabled=true;
 $("directoryStatus").textContent=state.profiles.length?"جاري تحميل المزيد...":"جاري تحميل المتخصصين...";
 try{
  let query=db.from("professional_directory_profiles").select("user_id,display_name,professional_title,bio,specialties,city,governorate,experience_years,service_modes").eq("listing_status","published").eq("is_verified",true).order("governorate");
  const {data,error}=await query.range(state.offset,state.offset+PAGE_SIZE-1);
  if(error)throw error;
  const page=Array.isArray(data)?data:[];
  await loadOffers(page);
  state.profiles.push(...page);state.offset+=page.length;renderGovernorates();renderProfiles();more.hidden=page.length<PAGE_SIZE;
 }catch(error){console.error("[Professional Directory] Load failed:",error);$("directoryStatus").textContent="تعذر تحميل المتخصصين. أعد المحاولة بعد التحقق من الاتصال.";more.hidden=state.profiles.length===0;}
 finally{state.loading=false;more.disabled=false;}
}
function requestKey(patientId,professionalId){return String(patientId)+":"+String(professionalId);}
function currentRequest(professionalId){
 const matches=[...state.requests.values()].filter(item=>item.professional_id===professionalId);
 return matches.find(item=>item.status==="accepted")||matches.find(item=>item.status==="pending")||matches.find(item=>item.status==="restore_pending")||matches.find(item=>item.status==="blocked")||matches[0]||null;
}
function renderRequestPanel(){
 const section=$("directoryRequestSection"),button=$("directoryRequestSubmit"),cancel=$("directoryRequestCancel"),status=$("directoryModalStatus");
 if(!section||!button||!cancel||!status)return;
 section.hidden=false;cancel.hidden=true;cancel.disabled=false;button.hidden=false;button.disabled=false;
 if(!state.user){button.textContent="تسجيل الدخول لطلب المحادثة";status.textContent="سجّل الدخول بحساب المريض لإرسال طلب المحادثة.";status.className="directory-modal-status is-error";return;}
 const request=currentRequest(state.selectedProfileId);
 if(request?.status==="accepted"){
  button.textContent="فتح المحادثة";status.textContent="وافق المختص على طلبك. يمكنك بدء المحادثة الآن.";status.className="directory-modal-status is-success";return;
 }
 if(request?.status==="blocked"){button.textContent="طلب استعادة التواصل";status.textContent="التواصل موقوف. يمكنك إرسال طلب استعادة للمختص.";status.className="directory-modal-status is-error";return;}
 if(request?.status==="restore_pending"){button.textContent="طلب الاستعادة قيد الانتظار";button.disabled=true;status.textContent="تم إرسال طلب استعادة التواصل وينتظر موافقة المختص.";status.className="directory-modal-status";return;}
 if(request?.status==="pending"){
  button.textContent="تم إرسال طلب المحادثة";button.disabled=true;cancel.hidden=false;
  status.textContent="طلبك لدى المختص وفي انتظار الموافقة. يمكنك إلغاء الطلب قبل قبوله.";status.className="directory-modal-status";return;
 }
 button.textContent="إرسال طلب المحادثة";
 status.textContent="لا يشترط وجود ملف صحي لإرسال طلب المحادثة. ربط الملف الصحي اختياري ويمكن إجراؤه لاحقًا.";
 status.className="directory-modal-status";
}
async function loadPatientContext(){
 try{
  state.user=await window.DietPlannerAccess?.getCurrentUser?.()||null;
  if(!state.user)return;
  const {data,error}=await db.from("professional_connection_requests")
   .select("id,patient_id,professional_id,status").eq("requested_by",state.user.id);
  if(error)throw error;
  (data||[]).forEach(r=>state.requests.set(requestKey(r.patient_id,r.professional_id),{...r,request_id:r.id}));
 }catch(error){console.error("[Professional Directory] Conversation context failed:",error);}
}
async function requestConversation(){
 const button=$("directoryRequestSubmit"),professionalId=state.selectedProfileId;
 if(!state.user){window.location.href="login.html?next="+encodeURIComponent("professional-directory.html");return;}
 if(!professionalId||button?.disabled)return;
 const message=$("directoryRequestMessage")?.value.trim()||"";
 const restoring=currentRequest(professionalId)?.status==="blocked";
 button.disabled=true;button.textContent=restoring?"جاري إرسال طلب الاستعادة...":"جاري إرسال الطلب...";
 try{
  const {data,error}=await db.rpc("request_professional_connection",{p_professional_id:professionalId,p_patient_id:null,p_message:message});
  if(error)throw error;
  state.requests.set(requestKey(null,professionalId),{id:data,request_id:data,patient_id:null,professional_id:professionalId,status:restoring?"restore_pending":"pending"});
  renderRequestPanel();
  $("directoryModalStatus").textContent=restoring?"تم إرسال طلب استعادة التواصل، في انتظار موافقة المختص.":"تم إرسال طلب المحادثة، في انتظار موافقة المختص. يمكنك إلغاء الطلب قبل قبوله.";
  $("directoryModalStatus").className="directory-modal-status is-success";
 }catch(error){
  console.error("[Professional Directory] Conversation request failed:",error);
  $("directoryModalStatus").textContent=error.message==="conversation_already_accepted"?"المحادثة مقبولة بالفعل. حدّث حالة الطلب لفتح المحادثة.":error.message||"تعذر إرسال طلب المحادثة.";
  $("directoryModalStatus").className="directory-modal-status is-error";
  button.disabled=false;button.textContent="إعادة إرسال الطلب";
 }
}
async function cancelConversationRequest(){
 const professionalId=state.selectedProfileId;
 const request=currentRequest(professionalId);
 const button=$("directoryRequestCancel");
 if(!request?.id||request.status!=="pending"||!button||button.disabled)return;
 button.disabled=true;button.textContent="جاري إلغاء الطلب...";
 try{
  const {error}=await db.rpc("cancel_professional_connection_request",{p_request_id:request.id});
  if(error)throw error;
  state.requests.set(requestKey(request.patient_id,professionalId),{...request,status:"cancelled"});
  renderRequestPanel();
  $("directoryModalStatus").textContent="تم إلغاء طلب المحادثة. يمكنك إرسال طلب جديد لاحقًا.";
  $("directoryModalStatus").className="directory-modal-status is-success";
 }catch(error){
  console.error("[Professional Directory] Conversation request cancellation failed:",error);
  button.disabled=false;button.textContent="إلغاء الطلب";
  $("directoryModalStatus").textContent=error.message==="request_not_pending"?"تم تغيير حالة الطلب بالفعل. حدّث الصفحة لمعرفة حالته الحالية.":error.message||"تعذر إلغاء طلب المحادثة.";
  $("directoryModalStatus").className="directory-modal-status is-error";
 }
}
function openProfile(profileId){
 const p=state.profiles.find(x=>x.user_id===profileId);if(!p)return;
 state.selectedProfileId=profileId;
 $("directoryModalTitle").textContent=p.display_name||"ملف المختص";$("directoryModalSubtitle").textContent=p.professional_title||"";
 $("directoryModalDetails").innerHTML=field("الموقع",[p.city,p.governorate].filter(Boolean).join("، "),"fa-location-dot")+field("سنوات الخبرة",p.experience_years==null?"غير محددة":p.experience_years+" سنة","fa-briefcase")+field("طرق المتابعة",arr(p.service_modes).map(m=>modeLabels[m]||m).join("، "),"fa-video");
 $("directoryModalSpecialties").innerHTML=arr(p.specialties).map(s=>'<span class="directory-chip">'+esc(s)+'</span>').join("")||'<span class="directory-muted">لم تُحدد تخصصات</span>';
 $("directoryModalOffers").innerHTML=renderOffers(profileId);
 $("directoryModalBio").textContent=p.bio||"لم يضف المختص نبذة تعريفية بعد.";
 $("directoryModal").hidden=false;document.body.classList.add("directory-modal-open");
 renderRequestPanel();$("directoryModalClose").focus();
}
function closeModal(){$("directoryModal").hidden=true;document.body.classList.remove("directory-modal-open");state.selectedProfileId=null;}
document.addEventListener("DOMContentLoaded",()=>{
 $("directoryMore").addEventListener("click",loadProfiles);
 ["directorySearch","directoryGovernorate","directoryMode"].forEach(id=>$(id).addEventListener(id==="directorySearch"?"input":"change",renderProfiles));
 $("directoryCards").addEventListener("click",e=>{const request=e.target.closest("[data-request-profile]");if(request){openProfile(request.dataset.requestProfile);return;}const v=e.target.closest("[data-view-profile]");if(v)openProfile(v.dataset.viewProfile);});

 $("directoryRequestSubmit")?.addEventListener("click",()=>{
  const request=currentRequest(state.selectedProfileId);
  if(request?.status==="accepted"){
   const profile=state.profiles.find(x=>x.user_id===state.selectedProfileId);
   window.DietPlannerPatientMessages?.openConversation({name:profile?.display_name||"المختص",subtitle:"محادثة مقبولة"},{patientId:null,role:"patient",professionalId:state.selectedProfileId,counterpartName:profile?.display_name||"المختص",allowStandalone:true});
   return;
  }
  void requestConversation();
 });
 $("directoryRequestCancel")?.addEventListener("click",cancelConversationRequest);
 $("directoryModalClose").addEventListener("click",closeModal);
 $("directoryModal").addEventListener("click",e=>{if(e.target===$("directoryModal"))closeModal();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("directoryModal").hidden)closeModal();});
 void (async()=>{await loadPatientContext();await loadProfiles();})();
});
})();