(()=> {
"use strict";
const db=window.DietPlannerAccess?.supabaseClient,$=id=>document.getElementById(id);
let user=null,profileStatus="draft",offers=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=id=>$(id).value.trim();
const setStatus=t=>$("professionalProfileStatus").textContent=t;
function setEditorLocked(locked){
 const offersLocked=["pending_review","suspended"].includes(profileStatus);
 $("professionalProfileForm").querySelectorAll("input,textarea,button[type=submit]").forEach(el=>el.disabled=locked);
 $("submitForReview").disabled=locked;
 $("addProfessionalOffer").disabled=offersLocked;
 $("saveProfessionalOffers").disabled=offersLocked;
 $("professionalOffersList").querySelectorAll("input,textarea,button").forEach(el=>el.disabled=offersLocked);
}
function renderOfferRows(){
 const root=$("professionalOffersList");
 root.innerHTML=offers.map((o,i)=>'<article class="professional-offer-row" data-offer-index="'+i+'">'
 +'<label>اسم الخدمة أو الباقة<input data-offer="service_name" maxlength="100" value="'+esc(o.service_name)+'" placeholder="مثال: متابعة شهرية"></label>'
 +'<label>وصف مختصر<textarea data-offer="description" maxlength="500" rows="2" placeholder="ما الذي تتضمنه الخدمة؟">'+esc(o.description)+'</textarea></label>'
 +'<label>السعر الحالي (جنيه)<input data-offer="price" type="number" min="0" step="0.01" value="'+esc(o.price)+'" required></label>'
 +'<label>السعر قبل العرض (اختياري)<input data-offer="original_price" type="number" min="0" step="0.01" value="'+esc(o.original_price??"")+'"></label>'
 +'<label>مدة أو نوع الخدمة<input data-offer="duration_label" maxlength="60" value="'+esc(o.duration_label||"للمتابعة")+'" placeholder="جلسة واحدة / شهر / 3 أشهر"></label>'
 +'<label class="offer-active"><input data-offer="is_active" type="checkbox" '+(o.is_active!==false?"checked":"")+'> عرض الخدمة في الدليل</label>'
 +'<button type="button" class="professional-offer-remove" data-remove-offer="'+i+'">حذف هذه الخدمة</button></article>').join("");
 root.querySelectorAll("[data-offer]").forEach(el=>el.addEventListener("input",()=>{
  const row=el.closest("[data-offer-index]"),item=offers[Number(row.dataset.offerIndex)];
  item[el.dataset.offer]=el.type==="checkbox"?el.checked:el.value;
 }));
 root.querySelectorAll("[data-remove-offer]").forEach(btn=>btn.addEventListener("click",()=>{
  offers.splice(Number(btn.dataset.removeOffer),1);renderOfferRows();
 }));
 setEditorLocked(["pending_review","published","suspended"].includes(profileStatus));
}
function addOffer(){
 if(offers.length>=10){$("professionalOffersStatus").textContent="يمكن إضافة 10 خدمات كحد أقصى.";return;}
 offers.push({service_name:"",description:"",price:"",original_price:"",duration_label:"للمتابعة",is_active:true});
 $("professionalOffersStatus").textContent="";renderOfferRows();
}
async function loadOffers(){
 const {data,error}=await db.from("professional_directory_offers").select("service_name,description,price,original_price,duration_label,is_active,sort_order").eq("professional_id",user.id).order("sort_order").order("created_at");
 if(error){$("professionalOffersStatus").textContent="تعذر تحميل الخدمات والأسعار.";return;}
 offers=(data||[]).map(o=>({...o,price:String(o.price),original_price:o.original_price==null?"":String(o.original_price)}));
 renderOfferRows();
}
function profilePayload(){
 return {display_name:val("professionalDisplayName"),professional_title:val("professionalTitle"),bio:val("professionalBio"),specialties:val("professionalSpecialties").split(/[،,]/).map(x=>x.trim()).filter(Boolean),governorate:val("professionalGovernorate"),city:val("professionalCity"),experience_years:$("professionalExperience").value?Number($("professionalExperience").value):null,photo_url:val("professionalPhoto")||null,service_modes:[...document.querySelectorAll("[name=serviceMode]:checked")].map(x=>x.value)};
}
function offersPayload(){
 const payload=offers.map((o,i)=>({service_name:String(o.service_name||"").trim(),description:String(o.description||"").trim(),price:String(o.price??"").trim(),original_price:String(o.original_price??"").trim(),duration_label:String(o.duration_label||"").trim(),is_active:o.is_active!==false,sort_order:i}));
 for(const o of payload){
  if(o.service_name.length<2||!o.price||!Number.isFinite(Number(o.price))||Number(o.price)<0||o.duration_label.length<2){throw new Error("تحقق من اسم الخدمة والسعر والمدة.");}
  if(o.original_price&&( !Number.isFinite(Number(o.original_price))||Number(o.original_price)<Number(o.price))){throw new Error("السعر قبل العرض يجب أن يكون أكبر من أو يساوي السعر الحالي.");}
 }
 return payload;
}
async function saveOffers(){
 let pricing;
 try{pricing=offersPayload();}catch(error){$("professionalOffersStatus").textContent=error.message;return false;}
 const {data:count,error}=await db.rpc("save_professional_directory_offers",{p_offers:pricing});
 if(error){$("professionalOffersStatus").textContent="تعذر حفظ الخدمات والأسعار: "+error.message;return false;}
 $("professionalOffersStatus").textContent="تم حفظ "+count+" خدمة/عرض بنجاح.";
 return true;
}
async function save(){
 const profile=profilePayload();
 if(!profile.specialties.length||!profile.service_modes.length){setStatus("أضف تخصصًا واحدًا على الأقل وحدد طريقة تقديم خدمة.");return false;}
 const {data:existing,error:readError}=await db.from("professional_directory_profiles").select("user_id").eq("user_id",user.id).maybeSingle();
 if(readError){setStatus("تعذر التحقق من الملف: "+readError.message);return false;}
 const result=existing?await db.from("professional_directory_profiles").update(profile).eq("user_id",user.id):await db.from("professional_directory_profiles").insert(profile);
 if(result.error){setStatus("تعذر حفظ البيانات المهنية: "+result.error.message);return false;}
 if(!await saveOffers())return false;
 setStatus("تم حفظ الملف المهني والخدمات والأسعار.");
 return true;
}
async function loadRequests(){
 const {data,error}=await db.rpc("list_professional_connection_requests"),root=$("professionalConnectionRequests");
 if(error){root.textContent="تعذر تحميل الطلبات.";return;}
 if(!data?.length){root.textContent="لا توجد طلبات متابعة حتى الآن.";return;}
 root.innerHTML=data.map(r=>'<article class="directory-card"><strong>'+esc(r.patient_name||"مريض")+'</strong><p>'+esc(r.message||"لم يرسل المريض رسالة.")+'</p><span class="directory-chip">'+({pending:"قيد الانتظار",accepted:"مقبول",declined:"مرفوض",cancelled:"ملغي"}[r.status]||esc(r.status))+'</span>'+(r.status==="pending"?'<div class="directory-card-actions"><button type="button" class="directory-primary-button" data-answer="accepted" data-id="'+esc(r.request_id)+'">قبول</button><button type="button" class="directory-secondary-button" data-answer="declined" data-id="'+esc(r.request_id)+'">رفض</button></div>':"")+'</article>').join("");
 root.querySelectorAll("[data-answer]").forEach(btn=>btn.addEventListener("click",async()=>{
  btn.disabled=true;
  const {error}=await db.rpc("respond_professional_connection_request",{p_request_id:btn.dataset.id,p_decision:btn.dataset.answer});
  if(error){$("professionalProfileStatus").textContent="تعذر تنفيذ الطلب: "+error.message;btn.disabled=false;return;}
  await loadRequests();
 }));
}
async function load(){
 user=await window.DietPlannerAccess?.getCurrentUser();if(!user){location.href="login.html";return;}
 const {data,error}=await db.from("professional_directory_profiles").select("*").eq("user_id",user.id).maybeSingle();
 if(error){setStatus("تعذر تحميل الملف: "+error.message);return;}
 if(data){
  $("professionalDisplayName").value=data.display_name||"";$("professionalTitle").value=data.professional_title||"";$("professionalBio").value=data.bio||"";
  $("professionalSpecialties").value=(data.specialties||[]).join("، ");$("professionalGovernorate").value=data.governorate||"";$("professionalCity").value=data.city||"";
  $("professionalExperience").value=data.experience_years??"";$("professionalPhoto").value=data.photo_url||"";
  document.querySelectorAll("[name=serviceMode]").forEach(x=>x.checked=(data.service_modes||[]).includes(x.value));
  profileStatus=data.listing_status||"draft";
  setStatus("حالة الملف: "+({draft:"مسودة",pending_review:"قيد المراجعة — لا يمكن التعديل حتى انتهاء المراجعة",published:"منشور ومعتمد — أوقف الظهور أولًا قبل التعديل",rejected:"يحتاج إلى تعديل",suspended:"موقوف — تواصل مع إدارة المنصة"}[profileStatus]||profileStatus)+(data.moderation_note?" — ملاحظة: "+data.moderation_note:""));
  $("withdrawDirectoryProfile").hidden=!["pending_review","published"].includes(profileStatus);
 }else{profileStatus="draft";setStatus("لم تنشئ ملفًا مهنيًا بعد. الظهور اختياري.");}
 await loadOffers();setEditorLocked(["pending_review","published","suspended"].includes(profileStatus));await loadRequests();
}
document.addEventListener("DOMContentLoaded",()=>{
 $("addProfessionalOffer").addEventListener("click",addOffer);
 $("saveProfessionalOffers").addEventListener("click",saveOffers);
 $("professionalProfileForm").addEventListener("submit",async e=>{e.preventDefault();if(await save()){}});
 $("submitForReview").addEventListener("click",async()=>{
  if(!await save())return;
  const {error}=await db.rpc("submit_professional_directory_profile");
  if(error){setStatus("تعذر إرسال الملف: "+error.message);return;}
  setStatus("تم إرسال الملف للمراجعة. لن يظهر للعامة حتى يعتمد من إدارة المنصة.");await load();
 });
 $("withdrawDirectoryProfile").addEventListener("click",async()=>{
  if(!confirm("سيختفي ملفك من الدليل، لكن علاقات الرعاية الحالية لن تُحذف. هل تريد المتابعة؟"))return;
  const {error}=await db.rpc("withdraw_professional_directory_profile");
  if(error){setStatus("تعذر إيقاف الظهور: "+error.message);return;}
  setStatus("تم إيقاف ظهور الملف. يمكنك تعديله وحفظه كمسودة.");await load();
 });
 load();
});
})();