(() => {
"use strict";
const client=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);
const SPECIALTIES={medicine:"الطب",pharmacy:"الصيدلة",nursing:"التمريض",clinical_nutrition:"التغذية العلاجية",laboratory:"المعامل والتحاليل",radiology:"الأشعة",dentistry:"طب الأسنان",physiotherapy:"العلاج الطبيعي",healthcare_management:"الإدارة الصحية",other:"تخصصات صحية أخرى"};
const EMPLOYMENT={full_time:"دوام كامل",part_time:"دوام جزئي",contract:"تعاقد",temporary:"مؤقت",internship:"تدريب",freelance:"عمل حر"};
const WORKPLACE={on_site:"من مقر العمل",hybrid:"هجين",remote:"عن بُعد"};
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function formatDate(value){if(!value)return"";const d=new Date(value);return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("ar-EG",{dateStyle:"long"}).format(d);}
function paragraphs(value){return String(value??"").trim().split(/\n{2,}/).filter(Boolean).map(p=>"<p>"+escapeHtml(p).replace(/\n/g,"<br>")+"</p>").join("");}
function showState(message){$("jobDetailCard").hidden=true;$("jobDetailState").hidden=false;$("jobDetailState").innerHTML='<i class="fa-solid fa-circle-exclamation"></i><p>'+escapeHtml(message)+'</p>';}
function render(job){
 const title=String(job.title||"فرصة عمل").trim(),company=String(job.organization_name||"").trim(),city=String(job.location_city||"").trim();
 const location=[city,job.workplace_type==="remote"?"عن بُعد":""].filter(Boolean).join(" · "),published=job.published_at||job.created_at;
 document.title=title+" | وظائف طبية وصحية - Diet Planner";
 const meta=document.querySelector('meta[name="description"]');if(meta)meta.content=(title+" لدى "+company+". "+String(job.description||"").replace(/\s+/g," ")).slice(0,155);
 const canonical=new URL("job.html",window.location.href);canonical.searchParams.set("id",job.id);const canonicalTag=document.querySelector('link[rel="canonical"]');if(canonicalTag)canonicalTag.href=canonical.href;
 $("jobTitle").textContent=title;$("jobCompany").textContent=company;
 $("jobMeta").innerHTML=[
 '<span><i class="fa-solid fa-stethoscope"></i>'+escapeHtml(SPECIALTIES[job.specialty]||"تخصص صحي")+'</span>',
 '<span><i class="fa-solid fa-location-dot"></i>'+escapeHtml(location||"الموقع يحدد عند التواصل")+'</span>',
 '<span><i class="fa-regular fa-clock"></i>'+escapeHtml(EMPLOYMENT[job.employment_type]||"")+'</span>',
 '<span><i class="fa-solid fa-building"></i>'+escapeHtml(WORKPLACE[job.workplace_type]||"")+'</span>'
 ].join("");
 const hasSalary=job.salary_min!=null||job.salary_max!=null;$("jobSalary").hidden=!hasSalary;
 $("jobSalary").textContent=hasSalary?"الراتب: "+[job.salary_min,job.salary_max].filter(v=>v!=null).map(v=>Number(v).toLocaleString("ar-EG")).join(" – ")+" "+(job.salary_currency||"EGP")+(job.salary_period?" / "+job.salary_period:""):"";
 $("jobDescription").innerHTML=paragraphs(job.description);const requirements=String(job.requirements||"").trim();
 $("jobRequirementsSection").hidden=!requirements;$("jobRequirements").innerHTML=requirements?paragraphs(requirements):"";
 const applicationUrl=/^https?:\/\//i.test(job.application_url||"")?job.application_url:"",email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.contact_email||"")?job.contact_email:"",phone=String(job.contact_phone||"").replace(/[^+\d]/g,"");
 $("jobApply").className="job-detail-apply";
 if(applicationUrl)$("jobApply").innerHTML='<a class="job-apply" href="'+escapeHtml(applicationUrl)+'" target="_blank" rel="noopener noreferrer">التقديم على الوظيفة <i class="fa-solid fa-arrow-up-right-from-square"></i></a>';
 else if(email)$("jobApply").innerHTML='<a class="job-apply" href="mailto:'+escapeHtml(email)+'">إرسال السيرة الذاتية بالبريد <i class="fa-regular fa-envelope"></i></a>';
 else if(phone)$("jobApply").innerHTML='<a class="job-apply" href="tel:'+escapeHtml(phone)+'">التواصل للتقديم <i class="fa-solid fa-phone"></i></a>';
 else{$("jobApply").className="job-contact-note";$("jobApply").textContent="يرجى مراجعة تفاصيل الإعلان للتواصل مع جهة العمل.";}
 $("jobDate").textContent="تاريخ النشر: "+(formatDate(published)||"غير محدد")+(job.expires_at?" · آخر موعد للتقديم: "+(formatDate(job.expires_at+"T00:00:00")||""):"");
 const structured={"@context":"https://schema.org","@type":"JobPosting",title,description:String(job.description||"")+(requirements?"\n\nالمتطلبات:\n"+requirements:""),datePosted:published,...(job.expires_at?{validThrough:job.expires_at}:{}),employmentType:({full_time:"FULL_TIME",part_time:"PART_TIME",contract:"CONTRACTOR",temporary:"TEMPORARY",internship:"INTERN",freelance:"CONTRACTOR"})[job.employment_type]||"OTHER",hiringOrganization:{"@type":"Organization",name:company},...(job.workplace_type==="remote"?{jobLocationType:"TELECOMMUTE",applicantLocationRequirements:{"@type":"Country",name:job.country_code==="EG"?"Egypt":(job.country_code||"Egypt")}}:city?{jobLocation:{"@type":"Place",address:{"@type":"PostalAddress",addressLocality:city,addressCountry:job.country_code||"EG"}}}:{}),...(hasSalary?{baseSalary:{"@type":"MonetaryAmount",currency:job.salary_currency||"EGP",value:{"@type":"QuantitativeValue",...(job.salary_min!=null?{minValue:Number(job.salary_min)}:{}),...(job.salary_max!=null?{maxValue:Number(job.salary_max)}:{}),...(job.salary_period?{unitText:job.salary_period.toUpperCase()}:{})}}}:{}),directApply:Boolean(applicationUrl)};
 let schema=$("jobPostingSchema");if(!schema){schema=document.createElement("script");schema.id="jobPostingSchema";schema.type="application/ld+json";document.head.appendChild(schema);}schema.textContent=JSON.stringify(structured).replace(/</g,"\\u003c");
 $("jobDetailState").hidden=true;$("jobDetailCard").hidden=false;
}
async function init(){
 const id=new URLSearchParams(window.location.search).get("id")||"";
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return showState("رابط الوظيفة غير صحيح. ارجع إلى قائمة الوظائف واختر إعلانًا متاحًا.");
 if(!client)return showState("تعذر الاتصال بقاعدة البيانات. حاول تحديث الصفحة.");
 try{
  const {data,error}=await client.from("job_posts").select("id,title,specialty,organization_name,location_city,country_code,employment_type,workplace_type,description,requirements,salary_min,salary_max,salary_currency,salary_period,application_url,contact_email,contact_phone,status,published_at,expires_at,created_at").eq("id",id).eq("status","published").not("published_at","is",null).lte("published_at",new Date().toISOString()).or("expires_at.is.null,expires_at.gte."+new Date().toISOString().slice(0,10)).maybeSingle();
  if(error)throw error;if(!data)return showState("هذه الوظيفة غير متاحة حاليًا أو انتهى موعد التقديم.");render(data);
 }catch(error){console.error("Job detail load failed:",error);showState("تعذر تحميل تفاصيل الوظيفة حاليًا. حاول مرة أخرى.");}
}
init();
})();