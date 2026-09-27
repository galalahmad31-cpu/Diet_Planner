from pathlib import Path
import re

path = Path('js/visit-diet-plan.js')
text = path.read_text(encoding='utf-8')

if 'FIXED_DIET_CACHE_V1' in text:
    raise SystemExit(0)

needle = "let fixedMealsDatabase=[], fixedMealsTargetDayId=null, currentModalContext={dayId:null,mealId:null}, targetMealDayId=null, confirmCallback=null;"
replacement = needle + "\nlet fixedMealsLoadPromise=null;\nconst FIXED_DIET_CACHE_V1='fixed-diet-cache-v1';\nconst FIXED_DIET_CACHE_TTL=5*60*1000;"
text = text.replace(needle, replacement, 1)

new_sync = r'''async function syncFixedMeals(){
 const user=await currentUser();
 if(!user)return;

 // FIXED_DIET_CACHE_V1: user-scoped session cache, expires after 5 minutes.
 const cacheKey=`${FIXED_DIET_CACHE_V1}:${user.id}`;
 const readCache=()=>{
  try{
   const raw=sessionStorage.getItem(cacheKey);
   if(!raw)return null;
   const parsed=JSON.parse(raw);
   if(!parsed || !Number.isFinite(parsed.savedAt) || Date.now()-parsed.savedAt>FIXED_DIET_CACHE_TTL)return null;
   return Array.isArray(parsed.data)?parsed.data:null;
  }catch{return null;}
 };
 const writeCache=data=>{
  try{sessionStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now(),data}));}catch{}
 };

 const cached=readCache();
 if(cached){
  fixedMealsDatabase=cached;
  return;
 }

 if(fixedMealsLoadPromise)return fixedMealsLoadPromise;
 fixedMealsLoadPromise=(async()=>{
  const [pub,own]=await Promise.all([
   sb.from('diet_templates').select('*').eq('visibility','public').order('created_at',{ascending:false}),
   sb.from('diet_templates').select('*').eq('created_by',user.id).order('created_at',{ascending:false})
  ]);
  if(pub.error||own.error){
   console.error('Fixed diets load failed:',pub.error||own.error);
   fixedMealsDatabase=[];
   return;
  }

  const map=new Map();
  [...(pub.data||[]),...(own.data||[])].forEach(d=>map.set(d.id,d));
  const diets=[...map.values()];
  const ids=diets.map(d=>d.id);
  if(!ids.length){fixedMealsDatabase=[];writeCache([]);return;}

  const days=[];
  for(let i=0;i<ids.length;i+=100){
   const chunk=ids.slice(i,i+100);
   const r=await sb.from('diet_template_days').select('*').in('diet_id',chunk).order('day_number',{ascending:true});
   if(r.error){console.error('Fixed diet days load failed:',r.error);fixedMealsDatabase=[];return;}
   days.push(...(r.data||[]));
  }

  const dayIds=days.map(x=>x.id);
  const meals=[];
  for(let i=0;i<dayIds.length;i+=100){
   const chunk=dayIds.slice(i,i+100);
   const r=await sb.from('diet_template_meals').select('*').in('day_id',chunk).order('meal_order',{ascending:true});
   if(r.error){console.error('Fixed diet meals load failed:',r.error);fixedMealsDatabase=[];return;}
   meals.push(...(r.data||[]));
  }

  const mids=meals.map(x=>x.id);
  const items=[];
  for(let i=0;i<mids.length;i+=100){
   const chunk=mids.slice(i,i+100);
   const r=await sb.from('diet_template_items').select('*').in('meal_id',chunk).order('item_order',{ascending:true});
   if(r.error){console.error('Fixed diet items load failed:',r.error);fixedMealsDatabase=[];return;}
   items.push(...(r.data||[]));
  }

  fixedMealsDatabase=diets.map(d=>{
   const day=days.find(x=>x.diet_id===d.id);
   return {
    id:d.id,
    name:d.name||'دايت ثابت',
    description:d.description||'',
    created_by:d.created_by,
    target_calories:d.target_calories,
    target_protein:d.target_protein,
    target_carb:d.target_carb,
    target_fat:d.target_fat,
    meals:day?meals.filter(m=>m.day_id===day.id).map(m=>({
     name:m.meal_name||'وجبة',
     frequency:m.frequency||'',
     items:items.filter(i=>i.meal_id===m.id).map(i=>({
      foodId:String(i.food_id),
      grams:Number(i.quantity_g)||0,
      repeat:i.frequency??'',
      notes:i.notes??'',
      household_measure:i.household_measure||''
     }))
    })):[]
   };
  }).filter(d=>d.meals.length);

  fixedMealsDatabase.sort((a,b)=>(a.created_by===user.id?0:1)-(b.created_by===user.id?0:1));
  writeCache(fixedMealsDatabase);
 })();

 try{await fixedMealsLoadPromise;}
 finally{fixedMealsLoadPromise=null;}
}'''

pattern = r"async function syncFixedMeals\(\)\{.*?\n\}\nfunction renderFixedMealsList"
patched, count = re.subn(pattern, new_sync + "\nfunction renderFixedMealsList", text, count=1, flags=re.S)
if count != 1:
    raise SystemExit('Could not locate syncFixedMeals() safely; no changes made.')

path.write_text(patched, encoding='utf-8')
print('fixed diet cache applied')
