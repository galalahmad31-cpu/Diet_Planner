/* =========================================================
   Diet Planner — Diet Library
   Feature logic only. Authentication/Supabase client is centralized
   in js/auth-access.js.
   ========================================================= */
(function(){
'use strict';

const supabase = window.DietPlannerAccess?.supabaseClient;
if(!supabase){
  console.error('Diet Library: js/auth-access.js must load before this file.');
}

let user=null,isAdmin=false,foods=[],diets=[],authors={},editingId=null,day={day_number:1,day_name:'اليوم',meals:[]};
let dietRenderLimit=40;
const $=id=>document.getElementById(id), num=v=>Number(v||0);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toast(msg,ok=true){const e=$('toast');e.textContent=msg;e.className=`fixed bottom-5 left-5 z-[150] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${ok?'bg-brand-600':'bg-red-600'}`;e.classList.remove('hidden');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.add('hidden'),3200)}
function withTimeout(promise,ms,label='الطلب'){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`انتهت مهلة ${label} (${Math.round(ms/1000)} ثوانٍ)`)),ms)})]).finally(()=>clearTimeout(timer));
}
async function getSession(){
  const access=window.DietPlannerAccess;
  if(!supabase||!access?.getCurrentUser){$('statusStat').textContent='تعذر تهيئة الاتصال';toast('تعذر تهيئة الاتصال بالتطبيق',false);return false;}
  user=await withTimeout(access.getCurrentUser(),5000,'التحقق من الجلسة');
  if(!user){window.DietPlannerAccess?.showAccessPrompt?.({title:'تسجيل الدخول مطلوب',message:'مكتبة الدايت تتطلب تسجيل الدخول.',actionLabel:'تسجيل الدخول',actionHref:'login.html'});$('loading')&&( $('loading').style.display='none');return false;}
  const accessStatus=await withTimeout(access.getAccessStatus(),5000,'التحقق من الاشتراك');
  if(!accessStatus?.authenticated || !accessStatus.user){location.replace('index.html');return false;}
  isAdmin=accessStatus.isAdmin===true;
  if(!isAdmin && accessStatus.hasActiveSubscription!==true){
    access.showAccessPrompt?.({title:'اشتراك فعال مطلوب',message:'مكتبة الدايت متاحة للمشتركين ذوي الاشتراك الفعال.',actionLabel:'عرض الاشتراكات',actionHref:'subscription-plans.html'});
    $('loading')&&($('loading').style.display='none');
    return false;
  }
  return true;
}
const CACHE_TTL=5*60*1000;
const cacheKey=(type)=>`diet-library:${type}:${user?.id||'guest'}`;
function readCache(type){
  try{
    const raw=localStorage.getItem(cacheKey(type));
    if(!raw)return null;
    const cached=JSON.parse(raw);
    if(!cached?.timestamp||Date.now()-cached.timestamp>CACHE_TTL)return null;
    return cached.data;
  }catch{return null}
}
function writeCache(type,data){
  try{localStorage.setItem(cacheKey(type),JSON.stringify({timestamp:Date.now(),data}))}catch{}
}
function clearCache(type){
  try{localStorage.removeItem(cacheKey(type))}catch{}
}
async function loadFoods(force=false){
  if(!force&&foods.length)return true;
  if(!force){
    const cached=readCache('foods');
    if(cached){
      foods=cached;
      return true;
    }
  }
  const {data,error}=await supabase.from('foods').select('id,name_ar,name_en,is_custom,household,kcal,protein,carb,fat,sodium,potassium,phosphorus').order('name_ar',{ascending:true});
  if(error){
    toast('تعذر تحميل مكتبة الأغذية: '+error.message,false);
    return false;
  }
  foods=(data||[]).map(f=>({...f,id:String(f.id),is_custom:Boolean(f.is_custom),kcal:num(f.kcal),protein:num(f.protein),carb:num(f.carb),fat:num(f.fat),sodium:num(f.sodium),potassium:num(f.potassium),phosphorus:num(f.phosphorus)}));
  writeCache('foods',foods);
  return true;
}
async function fetchDietTemplates(){
  const columns='id,name,description,notes,target_calories,target_protein,target_carb,target_fat,target_fluid,goal,visibility,created_by,publisher_name,created_at,updated_at';
  const pageSize=50;
  const rows=[];
  for(let from=0; ; from+=pageSize){
    let pageData=null,lastError=null;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const result=await withTimeout(
          supabase.from('diet_templates')
            .select(columns)
            .order('updated_at',{ascending:false})
            .range(from,from+pageSize-1),
          7000,
          'تحميل قوالب الدايت'
        );
        if(result.error)throw result.error;
        pageData=result.data||[];
        lastError=null;
        break;
      }catch(error){
        lastError=error;
        const message=String(error?.message||error||'');
        const permanent=error?.status===400||error?.status===401||error?.status===403||error?.status===404;
        if(permanent||attempt===2)break;
        console.warn('Diet templates read retry', {page:from/pageSize+1,attempt:attempt+1,message});
        await new Promise(resolve=>setTimeout(resolve,350*(attempt+1)));
      }
    }
    if(lastError)throw lastError;
    rows.push(...pageData);
    if(pageData.length<pageSize)break;
  }
  return rows;
}
async function loadDiets(force=false){
  $('statusStat').textContent='جاري التحميل...';

  if(!force){
    const cached=readCache('diets');
    if(cached?.diets){
      diets=cached.diets;
      authors=cached.authors||{};
      $('statusStat').textContent='بيانات محفوظة — جاري التحديث';
      $('statusStat').className='mt-1 text-sm font-extrabold text-brand-600';
      renderDiets();
    }
  }

  let freshDiets;
  try{
    freshDiets=await fetchDietTemplates();
  }catch(error){
    console.error('Diet templates could not be read after retries:',error);
    $('statusStat').textContent=diets.length?'بيانات محفوظة — تعذر التحديث':'تعذر تحميل البيانات';
    $('statusStat').className='mt-1 text-sm font-extrabold text-amber-600';
    if(!diets.length)toast('تعذر قراءة بيانات مكتبة الدايت بعد عدة محاولات. تحقق من الاتصال ثم أعد المحاولة.',false);
    return false;
  }

  diets=freshDiets;
  authors={};
  const ids=[...new Set([...diets.filter(d=>d.visibility==='public').map(d=>d.created_by).filter(Boolean),user.id].filter(Boolean))];
  if(ids.length){
    try{
      const pr=await withTimeout(
        supabase.from('profiles').select('id,full_name').in('id',ids),
        5000,
        'تحميل أسماء الناشرين'
      );
      if(!pr.error)(pr.data||[]).forEach(p=>{authors[p.id]=p.full_name||''});
      else console.warn('Publisher names query failed:',pr.error);
    }catch(error){
      console.warn('Publisher names skipped:',error?.message||error);
    }
  }
  if(!authors[user.id])authors[user.id]=user.user_metadata?.full_name||user.user_metadata?.name||'';
  diets.forEach(d=>{if(d.publisher_name)authors[d.created_by]=d.publisher_name});
  writeCache('diets',{diets,authors});
  $('statusStat').textContent='متصل';
  $('statusStat').className='mt-1 text-sm font-extrabold text-brand-600';
  renderDiets();
  return true;
}
function renderDiets(){
  const q=$('search').value.trim().toLowerCase(),f=$('visibilityFilter').value;
  const filtered=diets.filter(d=>(!q||`${d.name} ${d.description||''} ${d.notes||''}`.toLowerCase().includes(q))&&(f==='all'||(f==='mine'&&d.created_by===user.id)||(f==='public'&&d.visibility==='public')));
  const arr=filtered.slice(0,dietRenderLimit);
  $('dietGrid').innerHTML=arr.map(d=>{
    const mine=d.created_by===user.id,canEdit=mine||isAdmin,pub=d.visibility==='public';
    const author=authors[d.created_by]||d.publisher_name||'';
    const publisher=mine?'أنت':(author?`د. ${esc(author)}`:'غير محدد');
    return `<article class="diet-list-item">
      <div class="diet-list-main">
        <div class="diet-list-title-row">
          <span class="diet-list-logo" aria-hidden="true"><i class="fa-solid fa-utensils"></i></span>
          <h3 class="diet-list-title">${esc(d.name)}</h3>
          <span class="diet-list-status ${pub?'is-public':'is-private'}">${pub?'منشور':'خاص'}</span>
        </div>
        <p class="diet-list-publisher">نشر بواسطة <strong>${publisher}</strong></p>
      </div>
      <div class="diet-list-actions">
        <button type="button" data-open="${d.id}" class="diet-list-btn diet-list-view"><i class="fa-solid fa-eye" aria-hidden="true"></i><span>عرض الدايت</span></button>
        <button type="button" data-duplicate="${d.id}" class="diet-list-btn diet-list-copy"><i class="fa-solid fa-copy" aria-hidden="true"></i><span>نسخ</span></button>
        ${canEdit?`<button type="button" data-open="${d.id}" class="diet-list-btn diet-list-edit"><i class="fa-solid fa-pen" aria-hidden="true"></i><span>تعديل</span></button><button type="button" data-del="${d.id}" class="diet-list-icon-btn" aria-label="حذف الدايت" title="حذف"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`:''}
      </div>
    </article>`;
  }).join('');
  $('empty').classList.toggle('hidden',arr.length>0);
  // The page uses the three dedicated statistic cards; there is no countBadge node.
  // Keep this optional for older layouts without making library rendering fail.
  const countBadge=$('countBadge');
  if(countBadge) countBadge.textContent=`${diets.length} دايت`;
  $('totalStat').textContent=diets.length;
  $('mineStat').textContent=diets.filter(d=>d.created_by===user.id).length;
  $('publicStat').textContent=diets.filter(d=>d.visibility==='public').length;
  const oldButton=$('loadMoreDiets');
  if(oldButton)oldButton.remove();
  if(arr.length<filtered.length){
    const button=document.createElement('button');
    button.id='loadMoreDiets';button.type='button';
    button.className='mx-auto mt-5 block rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50';
    button.innerHTML='<i class="fa-solid fa-chevron-down ml-1"></i> عرض المزيد';
    button.onclick=()=>{dietRenderLimit+=40;renderDiets()};
    $('dietGrid').insertAdjacentElement('afterend',button);
  }
}
function scaleHouseholdMeasure(measure,grams){if(!measure)return '—';const g=num(grams);if(!Number.isFinite(g)||g<0)return measure;const factor=g/100;const arabic={'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};const frac={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875};let text=String(measure).replace(/[٠-٩]/g,d=>arabic[d]);Object.keys(frac).forEach(ch=>text=text.replaceAll(ch,formatHouseholdNumber(frac[ch]*factor)));text=text.replace(/(^|[^\d.])(\d+(?:\.\d+)?)(?=\s|$|[^\d.])/g,(m,b,n)=>b+formatHouseholdNumber(parseFloat(n)*factor));if(text===String(measure).replace(/[٠-٩]/g,d=>arabic[d]))return `${formatHouseholdNumber(factor)} × ${text}`;return text}
function formatHouseholdNumber(v){if(!Number.isFinite(v))return '—';if(Math.abs(v-Math.round(v))<.0001)return String(Math.round(v));return String(Math.round(v*100)/100).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1')}
function calcTotals(){const t={kcal:0,protein:0,carb:0,fat:0,sodium:0,potassium:0,phosphorus:0};day.meals.forEach(m=>m.items.forEach(it=>{const f=foods.find(x=>x.id===String(it.food_id));if(!f)return;const factor=num(it.quantity_g)/100;t.kcal+=f.kcal*factor;t.protein+=f.protein*factor;t.carb+=f.carb*factor;t.fat+=f.fat*factor;t.sodium+=f.sodium*factor;t.potassium+=f.potassium*factor;t.phosphorus+=f.phosphorus*factor}));return t}
function renderSummary(){const t=calcTotals();$('dailySummary').innerHTML=window.DietPlannerNutritionSummary.renderTotals(t,{title:'إجمالي اليوم',subtitle:'إجمالي القيم الغذائية المحسوبة من الأصناف والكميات'});}
function openNew(){editingId=null;day={day_number:1,day_name:'اليوم',meals:[]};$('editorTitle').textContent='إنشاء دايت جديد';$('dietName').value='';$('description').value='';$('notes').value='';$('visibility').value='private';setReadOnly(false);renderDay();toggleEditor(true)}
async function openDiet(id){const d=diets.find(x=>x.id===id);if(!d)return;await loadFoods();editingId=id;$('editorTitle').textContent=d.created_by===user.id?'تعديل الدايت':'معاينة الدايت';$('dietName').value=d.name||'';$('description').value=d.description||'';$('notes').value=d.notes||'';$('visibility').value=d.visibility||'private';const {data:dr,error}=await supabase.from('diet_template_days').select('id,diet_id,day_number,day_name').eq('diet_id',id).order('day_number',{ascending:true}).limit(1);if(error){toast('تعذر تحميل اليوم',false);return}const drow=dr?.[0];if(!drow){day={day_number:1,day_name:'اليوم',meals:[]}}else{const {data:mr,error:me}=await supabase.from('diet_template_meals').select('id,day_id,meal_name,meal_order').eq('day_id',drow.id).order('meal_order',{ascending:true});if(me){toast('تعذر تحميل الوجبات: '+(me.message||me),false);return}const mids=(mr||[]).map(x=>x.id);let ir=[];if(mids.length){const r=await supabase.from('diet_template_items').select('id,meal_id,food_id,quantity_g,household_measure,notes,item_order').in('meal_id',mids).order('item_order',{ascending:true});if(r.error){toast('تعذر تحميل الأصناف',false);return}ir=r.data||[];}day={id:drow.id,day_number:1,day_name:drow.day_name||'اليوم',meals:(mr||[]).map(m=>({id:m.id,name:m.meal_name||'وجبة',items:ir.filter(i=>i.meal_id===m.id).map(i=>({id:i.id,food_id:String(i.food_id),quantity_g:num(i.quantity_g),household_measure:i.household_measure||'',notes:i.notes||'',}))}))} }const canEdit=d.created_by===user.id||isAdmin;renderDay();toggleEditor(true);setReadOnly(!canEdit);if(!canEdit)toast('هذا قالب منشور — وضع العرض فقط')}
function buildDietPreview(){
 const d=diets.find(x=>x.id===editingId)||{};
 const t=calcTotals();
 const primary=[['السعرات',t.kcal.toFixed(0),'kcal'],['البروتين',t.protein.toFixed(1),'جم'],['الكربوهيدرات',t.carb.toFixed(1),'جم'],['الدهون',t.fat.toFixed(1),'جم']];
 const minerals=[['الصوديوم',t.sodium.toFixed(0),'mg'],['البوتاسيوم',t.potassium.toFixed(0),'mg'],['الفسفور',t.phosphorus.toFixed(0),'mg']];
 let h='<article class="diet-preview" dir="rtl">';
 h+='<header class="dp-cover"><div class="dp-brand"><span>DIET PLANNER</span><span class="dp-tag">خطة غذائية</span></div><h1>'+esc(d.name||$('dietName').value)+'</h1>';
 if(d.description||$('description').value)h+='<p>'+esc(d.description||$('description').value)+'</p>';
 h+='</header><section class="dp-summary"><h2 class="dp-section-title">ملخص القيم الغذائية اليومية</h2><div class="dp-macros dp-macros-primary">';
 primary.forEach(x=>h+='<div class="dp-macro"><span>'+x[0]+'</span><strong>'+x[1]+'</strong><small>'+x[2]+'</small></div>');
 h+='</div><details class="dp-minerals"><summary>عرض المعادن</summary><div class="dp-minerals-grid">';
 minerals.forEach(x=>h+='<div class="dp-mineral"><span>'+x[0]+'</span><strong>'+x[1]+' <small>'+x[2]+'</small></strong></div>');
 h+='</div></details></section><section class="dp-menu"><div class="dp-section-head"><h2 class="dp-section-title">الوجبات</h2><span>'+day.meals.length+' وجبات</span></div>';
 day.meals.forEach((m,i)=>{
  h+='<details class="dp-meal" '+(i===0?'open':'')+'><summary class="dp-meal-head"><span class="dp-meal-num">'+(i+1)+'</span><h3>'+esc(m.name||('وجبة '+(i+1)))+'</h3><span class="dp-count">'+m.items.length+' أصناف</span><span class="dp-meal-chevron" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span></summary>';
  if(!m.items.length)h+='<p class="dp-empty">لم تتم إضافة أصناف لهذه الوجبة.</p>';
  else {h+='<div class="dp-food-list">';
   m.items.forEach(it=>{
    const f=foods.find(x=>String(x.id)===String(it.food_id));
    const household=f?.household?scaleHouseholdMeasure(f.household,num(it.quantity_g)):(it.household_measure||'—');
    h+='<div class="dp-food"><div class="dp-food-main"><strong>'+esc(f?.name_ar||'صنف غير موجود')+'</strong>'+(f?.name_en?'<small>'+esc(f.name_en)+'</small>':'')+'</div>';
    h+='<div class="dp-food-detail"><span class="dp-label">الكمية</span><b>'+num(it.quantity_g)+' جم</b></div>';
    h+='<div class="dp-food-detail"><span class="dp-label">المقياس المنزلي</span><b>'+esc(household)+'</b></div>';
    if(it.notes)h+='<div class="dp-food-note"><span class="dp-label">ملاحظة</span><p>'+esc(it.notes)+'</p></div>';
    h+='</div>';
   });
   h+='</div>';
  }
  h+='</details>';
 });
 h+='</section>';
 if($('notes').value.trim())h+='<section class="dp-notes"><h2 class="dp-section-title">ملاحظات وتعليمات</h2><p>'+esc($('notes').value).replace(/\n/g,'<br>')+'</p></section>';
 h+='<footer class="dp-footer"><span>Diet Planner</span><span>خطة غذائية منظمة</span></footer></article>';
 return h;
}
function prepareDietPrint(){
  const preview=document.querySelector('#editor .diet-preview-host .diet-preview');
  if(!preview)return;
  const itemCount=preview.querySelectorAll('.dp-food').length;
  const mealCount=preview.querySelectorAll('.dp-meal').length;
  const printZoom=Math.max(.72,Math.min(.9,.9-Math.max(0,itemCount-22)*.012-Math.max(0,mealCount-5)*.015));
  const printWidth=(198/printZoom).toFixed(2);
  const style=document.getElementById('diet-print-styles')||document.createElement('style');
  style.id='diet-print-styles';
  document.head.appendChild(style);
  style.textContent=`@page{size:A4 portrait;margin:6mm}
  @media print{
    html,body{margin:0!important;padding:0!important;width:198mm!important;min-width:0!important;background:#fff!important;overflow:visible!important}
    body *{visibility:hidden!important}
    #editor,#editor .diet-preview-host,#editor .diet-preview-host .diet-preview,
    #editor .diet-preview-host .diet-preview *{visibility:visible!important}
    #editor{position:absolute!important;top:0!important;left:0!important;width:${printWidth}mm!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;background:#fff!important;overflow:visible!important}
    #editor .diet-preview-host{display:block!important;position:static!important;width:${printWidth}mm!important;max-width:none!important;margin:0!important;padding:0!important;overflow:visible!important}
    #editor .diet-preview-host .diet-preview{
      display:block!important;position:static!important;width:${printWidth}mm!important;max-width:none!important;min-height:0!important;height:auto!important;
      margin:0!important;padding:0!important;transform:none!important;zoom:${printZoom}!important;overflow:visible!important;
      background:#fff!important;color:#263640!important;font:7.5pt Cairo,sans-serif!important;line-height:1.25!important;
      direction:rtl!important;text-align:right!important;box-shadow:none!important
    }
    .dp-cover{padding:0 0 2mm!important;margin:0 0 2.5mm!important;border:0!important;border-bottom:1px solid #b9c8ce!important;border-radius:0!important;background:#fff!important;color:#17384b!important}
    .dp-brand{font-size:6pt!important;color:#71828c!important}.dp-tag{padding:0!important;border:0!important;border-radius:0!important;font-size:6pt!important;color:#71828c!important}
    .dp-cover h1{font-size:13pt!important;line-height:1.25!important;font-weight:800!important;margin:1.5mm 0!important;color:#17384b!important}
    .dp-cover p{font-size:7pt!important;line-height:1.25!important;color:#596c76!important;margin:0!important}
    .dp-summary{margin:0 0 2.5mm!important}.dp-section-title{font-size:8pt!important;font-weight:800!important;margin:0 0 1mm!important;color:#17384b!important}
    .dp-macros{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:1mm!important}
    .dp-macro{display:flex!important;flex-direction:row!important;justify-content:center!important;align-items:baseline!important;gap:1.5mm!important;padding:1mm!important;border:0!important;border-bottom:1px solid #e3eaed!important;border-radius:0!important;background:#fff!important}
    .dp-macro span,.dp-macro small{font-size:6pt!important;color:#71828c!important}.dp-macro strong{font-size:8pt!important;line-height:1.1!important;color:#176f73!important}
    .dp-section-head{margin:0 0 1mm!important;padding-bottom:1mm!important;border-bottom:1px solid #b9c8ce!important}
    .dp-section-head .dp-section-title{font-size:9pt!important;margin:0!important}.dp-section-head>span{font-size:6pt!important}
    .dp-meal{display:block!important;margin:0 0 1.8mm!important;padding:0!important;border:0!important;border-bottom:1px solid #dfe7eb!important;border-radius:0!important;background:#fff!important;overflow:visible!important;break-inside:auto!important;page-break-inside:auto!important}
    .dp-meal>summary{list-style:none!important}.dp-meal>summary::-webkit-details-marker{display:none!important}.dp-meal:not([open])>.dp-food-list{display:block!important}.dp-meal-head{display:flex!important;gap:1.5mm!important;padding:1mm 1.5mm!important;background:#f2f6f7!important;border:0!important;border-bottom:1px solid #e3eaee!important;break-after:avoid!important;page-break-after:avoid!important}
    .dp-meal-num{height:4mm!important;flex:0 0 4mm!important;border-radius:1mm!important;font-size:6pt!important}
    .dp-meal-head h3{font-size:8pt!important;line-height:1.2!important;color:#17384b!important}.dp-count{font-size:6pt!important}
    .dp-food-list{padding:0 1mm!important}
    .dp-food{display:grid!important;direction:rtl!important;grid-template-columns:minmax(0,1.5fr) minmax(13mm,.65fr) minmax(0,1fr)!important;gap:1.2mm!important;align-items:center!important;padding:.8mm 0!important;border-bottom:.25mm solid #edf1f3!important;break-inside:avoid!important;page-break-inside:avoid!important}
    .dp-food-main,.dp-food-detail,.dp-food-note{grid-column:auto!important;grid-row:auto!important;min-width:0!important;width:auto!important}
    .dp-food-main strong,.dp-food-detail b{font-size:6.8pt!important;line-height:1.15!important;font-weight:700!important}
    .dp-food-main small,.dp-label{font-size:5.5pt!important;line-height:1.1!important}
    .dp-food-detail{display:flex!important;flex-direction:column!important;gap:.3mm!important;align-items:flex-start!important}
    .dp-food-note{grid-column:1/-1!important;display:flex!important;flex-direction:row!important;gap:1mm!important;align-items:baseline!important;padding:0!important;background:transparent!important;border-radius:0!important}
    .dp-food-note p{margin:0!important;font-size:6pt!important;line-height:1.15!important;color:#80612d!important;overflow-wrap:anywhere!important}
    .dp-empty{padding:1.5mm!important;font-size:6pt!important}
    .dp-notes{margin-top:2mm!important;padding:1.5mm 2mm!important;border:1px solid #e7d9b8!important;border-radius:1mm!important;background:#fffaf0!important;break-inside:avoid!important}
    .dp-notes .dp-section-title{font-size:7pt!important;margin-bottom:.5mm!important}.dp-notes p{font-size:6pt!important;line-height:1.3!important}
    .dp-footer{margin-top:2mm!important;padding:1mm 0!important;font-size:5.5pt!important}
    #editor button,#editor input,#editor select,#editor textarea,#editor .editor-toolbar{display:none!important}
  }`;
}
function setReadOnly(ro){
  $('editor').classList.toggle('is-viewing',ro);
  let printBtn=$('printDietPreview');if(ro&&isAdmin){if(!printBtn){printBtn=document.createElement('button');printBtn.id='printDietPreview';printBtn.type='button';printBtn.className='rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-white';printBtn.innerHTML='<i class="fa-solid fa-print ml-1"></i> طباعة';printBtn.onclick=()=>{prepareDietPrint();window.print();};$('cancelEditor').before(printBtn)}}else if(printBtn)printBtn.remove();
  const content=$('editor').querySelector(':scope > div > .p-4');if(content){let host=content.querySelector('.diet-preview-host');if(ro){if(!host){host=document.createElement('div');host.className='diet-preview-host';content.appendChild(host)}host.innerHTML=buildDietPreview();host.classList.remove('hidden');content.querySelectorAll(':scope > section').forEach(s=>s.classList.add('hidden'))}else{host?.classList.add('hidden');content.querySelectorAll(':scope > section').forEach(s=>s.classList.remove('hidden'))}}
  ['dietName','description','notes','visibility','addMeal','saveDiet'].forEach(id=>{const el=$(id);if(el)el.disabled=ro});
  $('saveDiet').classList.toggle('hidden',ro);$('addMeal').classList.toggle('hidden',ro);
  document.querySelectorAll('[data-meal-name],[data-dpb-field]').forEach(e=>{e.disabled=ro;e.readOnly=ro});
  document.querySelectorAll('[data-add-item],[data-remove-meal],[data-pick],[data-dpb-delete],[data-move-meal]').forEach(e=>e.classList.toggle('hidden',ro));
}
function toggleEditor(show){$('editor').classList.toggle('hidden',!show);$('editor').classList.toggle('flex',show)}
function renderDay(){renderSummary();$('mealsEditor').innerHTML=day.meals.length?day.meals.map((m,mi)=>mealHTML(mi,m)).join(''):`<div class="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center"><div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><i class="fa-solid fa-utensils text-xl"></i></div><p class="mt-3 font-extrabold text-slate-600">لم تتم إضافة أي وجبة</p><p class="mt-1 text-xs text-slate-400">ابدأ بإضافة وجبة ثم اختر الأصناف والكميات.</p></div>`;document.querySelectorAll('.food-name-text').forEach(el=>{const f=foods.find(x=>String(x.id)===String(el.dataset.foodId));el.textContent=f?.name_ar||'صنف غير موجود';if(f?.name_en){const en=document.createElement('span');en.className='food-name-en';en.textContent=f.name_en;el.appendChild(en)}});if($('saveDiet').classList.contains('hidden'))setReadOnly(true)}
function mealHTML(mi,m){
 const rows=m.items.map((it,ii)=>{const f=foods.find(x=>String(x.id)===String(it.food_id));return {key:mi+':'+ii,pickKey:mi+':'+ii,name:f?.name_ar||'صنف غير موجود',grams:num(it.quantity_g),household:f?.household?scaleHouseholdMeasure(f.household,num(it.quantity_g)):(it.household_measure||'—'),notes:it.notes||''};});
 return `<article class="meal-card">
  <header class="meal-card-header">
   <div class="meal-title-wrap"><span class="meal-order">${String(mi+1).padStart(2,'0')}</span><input data-meal-name="${mi}" value="${esc(m.name)}" aria-label="اسم الوجبة" class="meal-title-input"></div>
   <div class="meal-card-actions no-print">
    <button type="button" data-move-meal="${mi}:up" class="meal-order-btn" title="تحريك لأعلى" aria-label="تحريك لأعلى"><i class="fa-solid fa-arrow-up"></i></button>
    <button type="button" data-move-meal="${mi}:down" class="meal-order-btn" title="تحريك لأسفل" aria-label="تحريك لأسفل"><i class="fa-solid fa-arrow-down"></i></button>
    <button type="button" data-add-item="${mi}" class="meal-add-food-btn"><i class="fa-solid fa-plus"></i> إضافة صنف</button>
    <button type="button" data-remove-meal="${mi}" class="meal-delete-btn" title="حذف الوجبة" aria-label="حذف الوجبة"><i class="fa-solid fa-trash"></i></button>
   </div>
  </header>
  ${window.DietPlannerDietBuilder.renderTable(rows,{editable:true,caption:'أصناف '+(m.name||'الوجبة')})}
 </article>`;
}
async function openPicker(mealIndex,itemIndex=null){
 if(!(await loadFoods()))return;
 const meal=day.meals[mealIndex];if(!meal)return;
 const existing=itemIndex===null?null:meal.items[itemIndex],picker=window.DietPlannerFoodPicker;
 if(!picker){toast('مكوّن اختيار الأغذية غير متاح. أعد تحميل الصفحة.',false);return;}
 picker.open({foods,title:existing?'تعديل صنف في '+(meal.name||'الوجبة'):'إضافة صنف إلى '+(meal.name||'الوجبة'),
  selectedFoodId:existing?.food_id??null,grams:existing?.quantity_g??100,notes:existing?.notes??'',
  confirmText:existing?'حفظ التعديل':'إضافة للوجبة',
  onConfirm:({normalizedFood,grams,notes})=>{
   const target=day.meals[mealIndex];if(!target)return false;
   if(itemIndex!==null){const item=target.items[itemIndex];if(!item)return false;item.food_id=String(normalizedFood.id);item.quantity_g=grams;item.household_measure=normalizedFood.household||'';item.notes=notes;}
   else target.items.push({food_id:String(normalizedFood.id),quantity_g:grams,household_measure:normalizedFood.household||'',notes});
   renderDay();return true;
  }
 });
}
$('mealsEditor').addEventListener('input',e=>{const x=e.target.dataset.mealName;if(x!==undefined)day.meals[+x].name=e.target.value});
window.DietPlannerDietBuilder.bind($('mealsEditor'),{onInput:({key,field,value})=>{const [mi,ii]=String(key).split(':').map(Number);const it=day.meals[mi]?.items[ii];if(it&&field==='notes')it.notes=value},onChange:({key,field,value})=>{const [mi,ii]=String(key).split(':').map(Number);const it=day.meals[mi]?.items[ii];if(!it)return;if(field==='grams'){it.quantity_g=Math.max(0,num(value));renderDay()}else if(field==='notes')it.notes=value},onDelete:({key})=>{const [mi,ii]=String(key).split(':').map(Number);if(!day.meals[mi]?.items[ii])return;openConfirm('حذف الصنف','هل أنت متأكد من حذف هذا الصنف من الوجبة؟',()=>{day.meals[mi].items.splice(ii,1);renderDay()})}});
$('mealsEditor').addEventListener('click',async e=>{let b=e.target.closest('[data-add-item]');if(b){await openPicker(+b.dataset.addItem);return}b=e.target.closest('[data-pick]');if(b){const [mi,ii]=b.dataset.pick.split(':').map(Number);await openPicker(mi,ii);return}b=e.target.closest('[data-remove-item]');if(b){const [mi,ii]=b.dataset.removeItem.split(':').map(Number);openConfirm('حذف الصنف','هل أنت متأكد من حذف هذا الصنف من الوجبة؟',()=>{day.meals[mi].items.splice(ii,1);renderDay()});return}b=e.target.closest('[data-remove-meal]');if(b){const mi=+b.dataset.removeMeal;openConfirm('حذف الوجبة','هل أنت متأكد من حذف هذه الوجبة بكل أصنافها؟',()=>{day.meals.splice(mi,1);renderDay()});return}b=e.target.closest('[data-move-meal]');if(b){const [mi,dir]=b.dataset.moveMeal.split(':');const i=Number(mi),j=dir==='up'?i-1:i+1;if(j<0||j>=day.meals.length)return;[day.meals[i],day.meals[j]]=[day.meals[j],day.meals[i]];renderDay()}});
$('addMeal').onclick=()=>{day.meals.push({name:`وجبة ${day.meals.length+1}`,items:[]});renderDay()};

$('newBtn').onclick=openNew;$('cancelEditor').onclick=()=>toggleEditor(false);
$('search').oninput=()=>{
  dietRenderLimit=40;
  renderDiets();
};
$('visibilityFilter').onchange=()=>{
  dietRenderLimit=40;
  renderDiets();
};
async function loadPageData(){
  await loadDiets();
}

function openConfirm(title,message,action){
 if(typeof action!=="function")return;
 void window.DPConfirm?.ask({title,message,confirmText:"تأكيد",variant:"danger"}).then(confirmed=>{if(confirmed)return action();});
}
async function openDeleteConfirm(diet){
 if(!diet)return;
 const confirmed=await window.DPConfirm?.ask({title:"حذف الدايت؟",message:"هل أنت متأكد من حذف هذا الدايت؟ لا يمكن التراجع عن الحذف.",confirmText:"حذف",variant:"danger"});
 if(!confirmed)return;
 try{
  const {error}=await supabase.from('diet_templates').delete().eq('id',diet.id);
  if(error)throw error;
  clearCache('diets');await loadDiets(true);toast('تم حذف الدايت');
 }catch(error){toast('فشل التنفيذ: '+(error.message||error),false)}
}
$('dietGrid').onclick=async e=>{const o=e.target.closest('[data-open]'),d=e.target.closest('[data-del]'),cp=e.target.closest('[data-duplicate]');if(o){await openDiet(o.dataset.open);return}if(d){const x=diets.find(a=>a.id===d.dataset.del);if(x)openDeleteConfirm(x);return}if(cp)await duplicateDiet(cp.dataset.duplicate)};
async function duplicateDiet(id){const source=diets.find(x=>x.id===id);if(!source)return;try{await loadFoods();const {data:dr,error:de}=await supabase.from('diet_template_days').select('id,day_number,day_name').eq('diet_id',id).order('day_number',{ascending:true}).limit(1);if(de)throw de;const drow=dr&&dr[0];let meals=[];if(drow){const {data:mr,error:me}=await supabase.from('diet_template_meals').select('id,meal_name,meal_order').eq('day_id',drow.id).order('meal_order',{ascending:true});if(me)throw me;const mids=(mr||[]).map(x=>x.id);let ir=[];if(mids.length){const r=await supabase.from('diet_template_items').select('meal_id,food_id,quantity_g,household_measure,notes,item_order').in('meal_id',mids).order('item_order',{ascending:true});if(r.error)throw r.error;ir=r.data||[]}meals=(mr||[]).map(m=>({name:m.meal_name||'وجبة',items:ir.filter(i=>i.meal_id===m.id).map(i=>({food_id:String(i.food_id),quantity_g:num(i.quantity_g),household_measure:i.household_measure||'',notes:i.notes||'',}))}))}editingId=null;$('editorTitle').textContent='إنشاء نسخة من الدايت';$('dietName').value=(source.name||'دايت')+' - نسخة';$('description').value=source.description||'';$('notes').value=source.notes||'';$('visibility').value='private';day={day_number:1,day_name:'اليوم',meals};setReadOnly(false);renderDay();toggleEditor(true);toast('تم إنشاء نسخة قابلة للتعديل — اضغط حفظ لحفظها')}catch(error){toast('تعذر نسخ الدايت: '+(error.message||error),false)}}
function buildDietPayload(visibility, totals){
  const currentDiet=editingId?diets.find(d=>d.id===editingId):null;
  const publisherName=visibility==='public'
    ?(currentDiet?.publisher_name||authors[currentDiet?.created_by]||authors[user.id]||user.user_metadata?.full_name||user.user_metadata?.name||'')
    :null;

  return {
    name:$('dietName').value.trim(),
    description:$('description').value.trim()||null,
    notes:$('notes').value.trim()||null,
    visibility,
    publisher_name:publisherName,
    target_calories:totals.kcal,
    target_protein:totals.protein,
    target_carb:totals.carb,
    target_fat:totals.fat,
    target_fluid:null,
    goal:null
  };
}
async function saveDietTemplateViaRpc(dietId,payload){
  const dayId=crypto.randomUUID();

  const meals=day.meals.map((meal,mi)=>({
    id:crypto.randomUUID(),
    meal_name:meal.name||('وجبة '+(mi+1)),
    meal_order:mi+1,
  }));

  const items=[];
  day.meals.forEach((meal,mi)=>{
    const mealId=meals[mi].id;
    meal.items.forEach((item,ii)=>{
      if(!item.food_id)return;

      const food=foods.find(x=>x.id===String(item.food_id));
      const householdMeasure=food?.household
        ?scaleHouseholdMeasure(food.household,num(item.quantity_g))
        :(item.household_measure||null);

      items.push({
        id:crypto.randomUUID(),
        meal_id:mealId,
        food_id:String(item.food_id),
        quantity_g:num(item.quantity_g),
        household_measure:householdMeasure,
        
        notes:item.notes||null,
        item_order:ii+1
      });
    });
  });

  const {data,error}=await supabase.rpc('save_diet_template',{
    p_diet_id:dietId||null,
    p_payload:payload,
    p_day:{
      id:dayId,
      day_number:1,
      day_name:'اليوم'
    },
    p_meals:meals,
    p_items:items
  });

  if(error)throw error;
  return data;
}
async function save(){
  if(!user)return;

  const name=$('dietName').value.trim();
  if(!name){
    toast('اكتب اسم الدايت أولاً',false);
    return;
  }

  if(!day.meals.length){
    toast('أضف وجبة واحدة على الأقل',false);
    return;
  }

  const visibility=$('visibility').value;
  const isUpdate=Boolean(editingId);
  const button=$('saveDiet');

  button.disabled=true;
  button.textContent='جاري الحفظ...';

  try{
    if(day.meals.some(meal=>meal.items.length)&&!(await loadFoods()))throw new Error('تعذر تحميل مكتبة الأغذية');
    const payload=buildDietPayload(visibility,calcTotals());
    const dietId=await saveDietTemplateViaRpc(editingId,payload);

    const savedId=dietId;
    const existingDiet=isUpdate?diets.find(d=>d.id===savedId):null;
    const savedDiet={
      id:savedId,
      name:payload.name,
      description:payload.description,
      notes:payload.notes,
      target_calories:payload.target_calories,
      target_protein:payload.target_protein,
      target_carb:payload.target_carb,
      target_fat:payload.target_fat,
      target_fluid:payload.target_fluid,
      goal:payload.goal,
      visibility:payload.visibility,
      created_by:existingDiet?.created_by||user.id,
      publisher_name:payload.publisher_name,
      updated_at:new Date().toISOString(),
      created_at:isUpdate?(diets.find(d=>d.id===savedId)?.created_at||null):new Date().toISOString()
    };
    const existingIndex=diets.findIndex(d=>d.id===savedId);
    if(existingIndex>=0)diets[existingIndex]=savedDiet;else diets.unshift(savedDiet);
    if(payload.publisher_name)authors[user.id]=payload.publisher_name;
    writeCache('diets',{diets,authors});
    renderDiets();
    toast(isUpdate?'تم تحديث الدايت بنجاح':'تم حفظ الدايت بنجاح');
    toggleEditor(false);
  }catch(error){
    console.error('Diet save failed:',error);
    toast('فشل حفظ الدايت: '+(error.message||error),false);
  }finally{
    button.disabled=false;
    button.textContent='حفظ الدايت';
  }
}
$('saveDiet').onclick=save;
async function initializeDietPage(){
  const loader=$('loading');
  let completed=false;
  // Fail-safe: auth/network requests may remain pending indefinitely.
  const watchdog=setTimeout(()=>{
    if(completed)return;
    if(loader)loader.style.display='none';
    $('statusStat').textContent='استجابة بطيئة';
    $('statusStat').className='mt-1 text-sm font-extrabold text-amber-600';
  },1500);
  try{
    if(!(await getSession()))return;
    await loadPageData();
  }catch(error){
    console.error('Diet Library initialization failed:',error);
    $('statusStat').textContent='تعذر الاتصال';
    $('statusStat').className='mt-1 text-sm font-extrabold text-red-600';
    toast('تعذر تحميل مكتبة الدايت: '+(error?.message||'خطأ غير معروف'),false);
  }finally{
    completed=true;
    clearTimeout(watchdog);
    if(loader)loader.style.display='none';
  }
}
initializeDietPage();
})();
