(function(){
"use strict";

const db=window.DietPlannerAccess?.supabaseClient;
const contentNode=document.getElementById("privacyPolicyContent");
const emptyNode=document.getElementById("privacyPolicyEmpty");
const updatedNode=document.getElementById("privacyPolicyUpdatedAt");

function showMessage(message){
  if(contentNode)contentNode.hidden=true;
  if(emptyNode){emptyNode.hidden=false;emptyNode.textContent=message;}
}

function formatDate(value){
  if(!value)return "—";
  const date=new Date(value+"T00:00:00");
  if(Number.isNaN(date.getTime()))return "—";
  return date.toLocaleDateString("ar-EG",{year:"numeric",month:"long",day:"numeric"});
}

async function loadPrivacyPolicy(){
  if(!contentNode||!emptyNode||!updatedNode)return;
  if(!db){showMessage("تعذر الاتصال بقاعدة البيانات حاليًا.");return;}

  try{
    const {data,error}=await db
      .from("privacy_policy")
      .select("content,updated_at")
      .eq("id",1)
      .maybeSingle();

    if(error)throw error;
    if(!data){
      showMessage("لم يتم نشر سياسة الخصوصية بعد.");
      updatedNode.textContent="—";
      return;
    }

    const content=String(data.content??"");
    contentNode.textContent=content;
    contentNode.hidden=content.length===0;
    emptyNode.hidden=content.length>0;
    if(!content.length)emptyNode.textContent="لم يتم نشر سياسة الخصوصية بعد.";
    updatedNode.textContent=formatDate(data.updated_at);
  }catch(error){
    console.error("Privacy policy load failed:",error);
    showMessage("تعذر تحميل سياسة الخصوصية حاليًا. يرجى المحاولة مرة أخرى لاحقًا.");
  }
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",loadPrivacyPolicy,{once:true});
}else{
  loadPrivacyPolicy();
}
})();