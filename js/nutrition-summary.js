(function(){
'use strict';
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
const fmt=(v,d=0)=>n(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function heading(title,subtitle){return '<div class="dpn-heading"><div><strong>'+esc(title)+'</strong><span>'+esc(subtitle)+'</span></div></div>';}
function totalCard(label,value,unit,kind,decimals=0){return '<article class="dpn-total-card dpn-'+kind+'"><strong>'+esc(label)+'</strong><div><b>'+fmt(value,decimals)+'</b><small>'+esc(unit)+'</small></div></article>';}
function micros(t){return '<div class="dpn-micros" aria-label="المعادن">'+[['الصوديوم',t.sod??t.sodium],['البوتاسيوم',t.pot??t.potassium],['الفوسفور',t.pho??t.phosphorus]].map(([label,value])=>'<span><b>'+label+'</b><strong>'+fmt(value)+'</strong><small>mg</small></span>').join('')+'</div>';}
function renderTotals(t,{title='إجمالي اليوم',subtitle='إجمالي القيم الغذائية المحسوبة من الأصناف والكميات'}={}){
 t=t||{};
 return '<section class="dpn-summary" aria-label="إجمالي القيم الغذائية">'+heading(title,subtitle)+'<div class="dpn-total-grid">'+totalCard('السعرات',t.cal??t.kcal??0,'kcal','calories')+totalCard('الكربوهيدرات',t.carb??0,'g','carbs',1)+totalCard('البروتين',t.pro??t.protein??0,'g','protein',1)+totalCard('الدهون',t.fat??0,'g','fat',1)+'</div>'+micros(t)+'</section>';
}
function ring(label,value,unit,target,kind){const goal=n(target),actual=n(value),has=goal>0,percent=has?Math.round(actual/goal*100):0,progress=has?Math.min(100,Math.max(0,percent)):0;return '<article class="dpn-ring-card dpn-'+kind+'"><strong class="dpn-ring-label">'+esc(label)+'</strong><div class="dpn-ring" role="img" aria-label="'+esc(label)+': '+fmt(actual)+' '+esc(unit)+(has?', '+percent+'% من الهدف '+fmt(goal)+' '+esc(unit):', لم يحدد الهدف')+'" style="--dpn-progress:'+progress+'%"><div><b>'+fmt(actual)+'</b><small>'+esc(unit)+'</small></div></div><div class="dpn-ring-meta"><strong>'+(has?percent+'%':'—')+'</strong><small>'+(has?'من <b>'+fmt(goal)+'</b> '+esc(unit):'لم يحدد الهدف')+'</small></div></article>';}
function renderTargets(t,targets,{title='ملخص اليوم',subtitle='متابعة الإنجاز مقارنة بالهدف الغذائي'}={}){t=t||{};targets=targets||{};return '<section class="dpn-summary" aria-label="ملخص القيمة الغذائية لليوم">'+heading(title,subtitle)+'<div class="dpn-ring-grid">'+ring('السعرات',t.cal,'kcal',targets.cal,'calories')+ring('الكربوهيدرات',t.carb,'g',targets.carb,'carbs')+ring('البروتين',t.pro,'g',targets.pro,'protein')+ring('الدهون',t.fat,'g',targets.fat,'fat')+'</div>'+micros(t)+'</section>';}
window.DietPlannerNutritionSummary=Object.freeze({renderTotals,renderTargets});
})();