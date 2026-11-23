(()=> {
"use strict";
const db=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const PAGE_SIZE=20;
const state={profiles:[],offers:new Map(),offset:0,loading:false};
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
   +'<div class="directory-card-actions"><button type="button" class="directory-secondary-button" data-view-profile="'+esc(p.user_id)+'">عرض الملف</button></div></article>';
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
function openProfile(profileId){
 const p=state.profiles.find(x=>x.user_id===profileId);if(!p)return;
 $("directoryModalTitle").textContent=p.display_name||"ملف المختص";$("directoryModalSubtitle").textContent=p.professional_title||"";
 $("directoryModalDetails").innerHTML=field("الموقع",[p.city,p.governorate].filter(Boolean).join("، "),"fa-location-dot")+field("سنوات الخبرة",p.experience_years==null?"غير محددة":p.experience_years+" سنة","fa-briefcase")+field("طرق المتابعة",arr(p.service_modes).map(m=>modeLabels[m]||m).join("، "),"fa-video");
 $("directoryModalSpecialties").innerHTML=arr(p.specialties).map(s=>'<span class="directory-chip">'+esc(s)+'</span>').join("")||'<span class="directory-muted">لم تُحدد تخصصات</span>';
 $("directoryModalOffers").innerHTML=renderOffers(profileId);
 $("directoryModalBio").textContent=p.bio||"لم يضف المختص نبذة تعريفية بعد.";
 $("directoryModalStatus").textContent="لربط ملف صحي، احصل على كود ربط مباشر من المختص.";
 $("directoryModalStatus").className="directory-modal-status";
 $("directoryModal").hidden=false;document.body.classList.add("directory-modal-open");$("directoryModalClose").focus();
}
function closeModal(){$("directoryModal").hidden=true;document.body.classList.remove("directory-modal-open");state.selectedProfile=null;}
document.addEventListener("DOMContentLoaded",()=>{
 $("directoryMore").addEventListener("click",loadProfiles);
 ["directorySearch","directoryGovernorate","directoryMode"].forEach(id=>$(id).addEventListener(id==="directorySearch"?"input":"change",renderProfiles));
 $("directoryCards").addEventListener("click",e=>{const v=e.target.closest("[data-view-profile]");if(v)openProfile(v.dataset.viewProfile);});
 $("directoryModalClose").addEventListener("click",closeModal);
 $("directoryModal").addEventListener("click",e=>{if(e.target===$("directoryModal"))closeModal();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("directoryModal").hidden)closeModal();});
 void loadProfiles();
});
})();