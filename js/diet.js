/* =========================================================
   Diet Planner — Diet Library
   Feature logic only. Authentication/Supabase client is centralized
   in js/auth.js and access control is centralized in js/access.js.
   ========================================================= */
(function(){
'use strict';

const supabase = window.DietPlannerAccess?.supabaseClient;
if(!supabase){
  console.error('Diet Library: js/auth.js and js/access.js must load before this file.');
}

let user=null,isAdmin=false,foods=[],diets=[],authors={},editingId=null,activeMealIndex=null,selectedFood=null,day={day_number:1,day_name:'اليوم',meals:[]};
let dietRenderLimit=40;
const $=id=>document.getElementById(id), num=v=>Number(v||0);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toast(msg,ok=true){const e=$('toast');e.textContent=msg;e.className=`fixed bottom-5 left-5 z-[150] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${ok?'bg-brand-600':'bg-red-600'}`;e.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.add('hidden'),3200)}
async function getSession(){
  if(!supabase){
    toast('تعذر تهيئة الاتصال الآمن بالتطبيق',false);
    return false;
  }
  const access=await window.DietPlannerAccess?.getAccessStatus?.();
  if(!access?.authenticated){
    location.replace('index.html');
    return false;
  }
  user=access.user;
  isAdmin=access.isAdmin;

  return true;
}
