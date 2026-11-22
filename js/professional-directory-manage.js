(()=> {
"use strict";
const db=window.DietPlannerAccess?.supabaseClient,$=id=>document.getElementById(id);
let user=null,profileStatus="draft",profileExists=false,offers=[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const val=id=>$(id).value.trim();
const setStatus=t=>$("professionalProfileStatus").textContent=t;
function setEditorLocked(locked){
 const form=$("professionalProfileForm");
 form.querySelectorAll("input,textarea,select").forEach(el=>el.disabled=locked);
 $("addProfessionalOffer").disabled=locked;
 $("professionalOffersList").querySelectorAll("input,textarea,button").forEach(el=>el.disabled=locked);
}
function updateProfileActions(){
 const editable=["draft","rejected"].includes(profileStatus);
 const form=$("professionalProfileForm");
 form.querySelector('button[type="submit"]').hidden=!editable;
 $("saveAndSubmitForReview").hidden=!editable;
 $("deleteProfessionalProfile").hidden=!(editable&&profileExists);
 const withdrawButton=$("withdrawDirectoryProfile");
 withdrawButton.hidden=![ "pending_review","published" ].includes(profileStatus);
 withdrawButton.textContent=profileStatus==="pending_review"?"إلغاء الإرسال":"إيقاف الظهور في الدليل";
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
 profileExists=true;
 if(!await saveOffers())return false;
 setStatus("تم حفظ الملف المهني والخدمات والأسعار.");
 return true;
}
async function load(){
 user=await window.DietPlannerAccess?.getCurrentUser();if(!user){location.href="login.html";return;}
 const {data,error}=await db.from("professional_directory_profiles").select("*").eq("user_id",user.id).maybeSingle();
 if(error){setStatus("تعذر تحميل الملف: "+error.message);return;}
 if(data){
  profileExists=true;
  $("professionalDisplayName").value=data.display_name||"";$("professionalTitle").value=data.professional_title||"";$("professionalBio").value=data.bio||"";
  $("professionalSpecialties").value=(data.specialties||[]).join("، ");$("professionalGovernorate").value=data.governorate||"";$("professionalCity").value=data.city||"";
  $("professionalExperience").value=data.experience_years??"";$("professionalPhoto").value=data.photo_url||"";
  document.querySelectorAll("[name=serviceMode]").forEach(x=>x.checked=(data.service_modes||[]).includes(x.value));
  profileStatus=data.listing_status||"draft";
  setStatus("حالة الملف: "+({draft:"مسودة",pending_review:"قيد المراجعة — لا يمكن التعديل حتى انتهاء المراجعة",published:"منشور ومعتمد — أوقف الظهور أولًا قبل التعديل",rejected:"يحتاج إلى تعديل",suspended:"موقوف — تواصل مع إدارة المنصة"}[profileStatus]||profileStatus)+(data.moderation_note?" — ملاحظة: "+data.moderation_note:""));
  await loadOffers();
  setEditorLocked(["pending_review","published","suspended"].includes(profileStatus));
  updateProfileActions();
 }else{
  profileExists=false;profileStatus="draft";offers=[];renderOfferRows();setStatus("لم تنشئ ملفًا مهنيًا بعد. الظهور اختياري.");
  setEditorLocked(false);updateProfileActions();
 }
}
document.addEventListener("DOMContentLoaded",()=>{
 $("addProfessionalOffer").addEventListener("click",addOffer);
 $("professionalProfileForm").addEventListener("submit",async e=>{e.preventDefault();if(await save())await load();});
 $("saveAndSubmitForReview").addEventListener("click",async()=>{
  const form=$("professionalProfileForm");
  if(!form.reportValidity())return;
  const button=$("saveAndSubmitForReview");
  button.disabled=true;
  try{
   if(!await save())return;
   const {error}=await db.rpc("submit_professional_directory_profile");
   if(error){
    await load();
    setStatus("تم حفظ الملف كمسودة، لكن تعذر إرساله للاعتماد: "+error.message);
    return;
   }
   await load();
   setStatus("تم حفظ الملف وإرساله للمراجعة. لن يظهر للعامة حتى تعتمد إدارة المنصة الملف.");
  }finally{
   button.disabled=false;
  }
 });
 $("deleteProfessionalProfile").addEventListener("click",async()=>{
  const confirmed=await window.DPConfirm?.ask({title:"حذف الملف المهني؟",message:"سيتم حذف الملف المهني وخدماته وأسعاره. لن تتأثر بيانات حسابك أو المرضى.",confirmText:"حذف",variant:"danger"});if(!confirmed)return;
  const button=$("deleteProfessionalProfile");button.disabled=true;setStatus("جارٍ حذف الملف المهني...");
  try{
   const {error}=await db.rpc("delete_my_professional_directory_profile");if(error)throw error;
   offers=[];profileExists=false;profileStatus="draft";$("professionalProfileForm").reset();renderOfferRows();
   setEditorLocked(false);updateProfileActions();setStatus("تم حذف الملف المهني وخدماته.");
  }catch(error){
   const messages={profile_must_be_withdrawn_before_delete:"أوقف ظهور الملف أولًا قبل حذفه.",profile_has_connection_history:"لا يمكن حذف الملف لوجود سجل طلبات تواصل مرتبط به. يمكنك إيقاف ظهوره بدلًا من ذلك.",profile_has_patient_relationships:"لا يمكن حذف الملف لوجود علاقات متابعة مع مرضى. يمكنك إيقاف ظهوره بدلًا من ذلك.",profile_not_found:"الملف المهني غير موجود."};
   setStatus(messages[error.message]||"تعذر حذف الملف: "+(error.message||"حدث خطأ غير متوقع."));
  }finally{button.disabled=false;}
 });
 $("withdrawDirectoryProfile").addEventListener("click",async()=>{
  const isPending=profileStatus==="pending_review";
  const message=isPending
   ?"سيتم إلغاء إرسال الملف وإعادته إلى مسودة. ستظل بيانات الملف والخدمات محفوظة. هل تريد المتابعة؟"
   :"سيتم إلغاء نشر الملف وإخفاؤه من دليل الأطباء. ستظل بيانات الملف وسجلات التواصل والمتابعة محفوظة، ولن تُحذف بيانات المرضى. هل تريد المتابعة؟";
  const confirmed=await window.DPConfirm?.ask({title:isPending?"إلغاء إرسال الملف؟":"إيقاف ظهور الملف؟",message,confirmText:isPending?"إلغاء الإرسال":"إيقاف الظهور",variant:"danger"});if(!confirmed)return;
  const button=$("withdrawDirectoryProfile");button.disabled=true;
  try{
   const {error}=await db.rpc("withdraw_professional_directory_profile");
   if(error)throw error;
   await load();
   setStatus(isPending?"تم إلغاء الإرسال وإعادة الملف إلى المسودات.":"تم إلغاء النشر وإخفاء الملف من الدليل. يمكنك تعديله أو حذفه إذا لم توجد سجلات مرتبطة به.");
  }catch(error){
   setStatus((isPending?"تعذر إلغاء الإرسال: ":"تعذر إلغاء النشر: ")+(error.message||"حدث خطأ غير متوقع."));
  }finally{button.disabled=false;}
 });
 load();
});
})();