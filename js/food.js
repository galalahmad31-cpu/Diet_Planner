(function(){
'use strict';
const supabase = window.DietPlannerAccess?.supabaseClient;
let foods=[], exchanges=[], user=null, isAdmin=false;
const FOOD_PAGE_SIZE=50;
let visibleFoodCount=FOOD_PAGE_SIZE;

const $=id=>document.getElementById(id);
const num=v=>Number(v||0);
function toast(msg,ok=true){
  const el=$('toast'); el.textContent=msg; el.className=`fixed bottom-5 left-5 z-[120] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${ok?'bg-brand-600':'bg-red-600'}`;
  el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'),3200);
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}


async function loadExchanges(){
  const {data,error}=await supabase
    .from('food_exchanges')
    .select('id,sort_order,group_name,subgroup_name,exchange_name,kcal,carb,protein,fat')
    .order('sort_order',{ascending:true,nullsFirst:false})
    .order('id',{ascending:true});

  if(error){
    console.error(error);
    toast('تعذر تحميل قائمة البدائل الغذائية: '+error.message,false);
    return;
  }

  exchanges=(data||[]).map(x=>({
    ...x,
    id:String(x.id),
    sort_order:Number(x.sort_order??0),
    group_name:String(x.group_name??''),
    subgroup_name:String(x.subgroup_name??''),
    exchange_name:String(x.exchange_name??''),
    kcal:String(x.kcal??''),
    carb:String(x.carb??''),
    protein:String(x.protein??''),
    fat:String(x.fat??'')
  }));

  const groups=[...new Set(exchanges.map(x=>x.group_name).filter(Boolean))];
  $('exchangeGroupFilter').innerHTML='<option value="all">كل المجموعات</option>'+
    groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');

  renderExchanges();
}

function renderExchanges(){
  const q=$('exchangeSearch').value.trim().toLowerCase();
  const group=$('exchangeGroupFilter').value;

  const filtered=exchanges.filter(x=>{
    const text=`${x.group_name} ${x.subgroup_name} ${x.exchange_name}`.toLowerCase();
    return (!q||text.includes(q))&&(group==='all'||x.group_name===group);
  });

  $('exchangeRows').innerHTML=filtered.map(x=>`
    <tr class="border-b border-slate-100 hover:bg-slate-50/80">
      <td class="px-4 py-4 font-extrabold text-brand-700">${esc(x.group_name)}</td>
      <td class="px-4 py-4 font-bold text-slate-800">${esc(x.subgroup_name)}</td>
      <td class="exchange-cell px-4 py-4 text-slate-800 font-medium">${esc(x.exchange_name)}</td>
      <td class="px-4 py-4 text-center font-bold text-slate-800">${esc(x.kcal)}</td>
      <td class="px-4 py-4 text-center font-bold text-slate-800">${esc(x.carb)} g</td>
      <td class="px-4 py-4 text-center font-bold text-slate-800">${esc(x.protein)} g</td>
      <td class="px-4 py-4 text-center font-bold text-slate-800">${esc(x.fat)} g</td>
    </tr>
  `).join('');

  $('exchangeEmpty').classList.toggle('hidden',filtered.length>0);
}

function switchTab(tab){
  const isFood=tab==='foods';
  const isExchange=tab==='exchanges';

  $('foodsTab').classList.toggle('active',isFood);
  $('foodsTab').classList.toggle('text-slate-600',!isFood);

  $('exchangesTab').classList.toggle('active',isExchange);
  $('exchangesTab').classList.toggle('text-slate-600',!isExchange);

  $('foodTools').classList.toggle('hidden',!isFood);
  $('foodFilters').classList.toggle('hidden',!isFood);
  $('foodSection').classList.toggle('hidden',!isFood);
  $('exchangeSection').classList.toggle('hidden',!isExchange);
}

async function loadFoods(){
  const {data,error}=await supabase.from('foods').select('id,name_ar,name_en,household,kcal,protein,carb,fat,sodium,potassium,phosphorus,water,preparation_method,is_custom,created_by').order('name_ar',{ascending:true});
  if(error){console.error(error);toast('تعذر تحميل مكتبة الأغذية: '+error.message,false);return;}
  foods=(data||[]).map(f=>({...f,id:String(f.id),kcal:num(f.kcal),protein:num(f.protein),carb:num(f.carb),fat:num(f.fat),sodium:num(f.sodium),potassium:num(f.potassium),phosphorus:num(f.phosphorus),water:num(f.water),is_custom:Boolean(f.is_custom)}));
  visibleFoodCount=FOOD_PAGE_SIZE;
  render();
}
function render(){
  const q=$('search').value.trim().toLowerCase(), type=$('typeFilter').value;
  const filtered=foods.filter(f=>{
    const text=`${f.id} ${f.name_ar||''} ${f.name_en||''}`.toLowerCase();
    return (!q||text.includes(q))&&(type==='all'||(type==='custom'?f.is_custom:!f.is_custom));
  });
  const visibleFoods=filtered.slice(0,visibleFoodCount);
  $('foodRows').innerHTML=visibleFoods.map(f=>`
  <tr class="border-b border-slate-100 hover:bg-slate-50/80">
    <td class="px-3 py-3"><div class="font-bold text-slate-800">${esc(f.name_ar)}</div>${f.name_en?`<div class="mt-0.5 text-[10px] text-slate-400" dir="ltr">${esc(f.name_en)}</div>`:''}</td>
    <td class="px-3 py-3 text-slate-600">${esc(f.household)}</td>
    <td class="px-3 py-3 text-center font-bold">${f.kcal}</td><td class="px-3 py-3 text-center">${f.carb}</td><td class="px-3 py-3 text-center">${f.protein}</td><td class="px-3 py-3 text-center">${f.fat}</td>
    <td class="px-3 py-3 text-center">${f.sodium}</td><td class="px-3 py-3 text-center">${f.potassium}</td><td class="px-3 py-3 text-center">${f.phosphorus}</td><td class="px-3 py-3 text-center">${f.water}</td>
    <td class="px-3 py-3 text-center">${f.preparation_method?`<button type="button" data-prep="${esc(f.id)}" class="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">أعرض</button>`:'—'}</td>
    <td class="px-3 py-3 text-center">${f.is_custom?'<span class="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-600">مخصص</span>':'<span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">أساسي</span>'}</td>
    <td class="px-3 py-3 text-center"><button data-action="${esc(f.id)}" class="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-brand-50">إجراء</button></td>
  </tr>`).join('');
  $('empty').classList.toggle('hidden',filtered.length>0);
  $('shownCount').textContent=`${visibleFoods.length} من ${filtered.length} معروض`;
  const loadMoreBtn=$('loadMoreFoods');
  if(loadMoreBtn){
    const hasMore=visibleFoodCount<filtered.length;
    loadMoreBtn.classList.toggle('hidden',!hasMore);
    loadMoreBtn.textContent=`عرض المزيد (${Math.min(FOOD_PAGE_SIZE,filtered.length-visibleFoodCount)} صنف)`;
  }
  $('countBadge').textContent=`${foods.length} صنف`; $('totalStat').textContent=foods.length;
  $('baseStat').textContent=foods.filter(f=>!f.is_custom).length; $('customStat').textContent=foods.filter(f=>f.is_custom).length;
}
function loadMoreFoods(){
  visibleFoodCount+=FOOD_PAGE_SIZE;
  render();
}
function openModal(food=null){
  $('modal').classList.remove('hidden');$('modal').classList.add('flex');$('foodForm').reset();
  $('editId').value=food?.id||'';$('modalTitle').textContent=food?'تعديل بيانات الصنف':(isAdmin?'إضافة صنف أساسي':'إضافة صنف مخصص');
  $('nameAr').value=food?.name_ar||'';$('nameEn').value=food?.name_en||'';$('household').value=food?.household||'';
  ['kcal','protein','carb','fat','sodium','potassium','phosphorus','water'].forEach(k=>$(k).value=food?.[k]??'');
  $('preparationMethod').value=food?.preparation_method||'';
}
let actionFood=null;
function closeFoodAction(){$('foodActionModal').classList.add('hidden');$('foodActionModal').classList.remove('flex');actionFood=null;}
function openFoodAction(food){actionFood=food;$('foodActionTitle').textContent='إجراء: '+food.name_ar;$('foodActionModal').classList.remove('hidden');$('foodActionModal').classList.add('flex');}
$('foodActionCancel').onclick=closeFoodAction;
$('foodActionEdit').onclick=()=>{const f=actionFood;closeFoodAction();if(!f)return;if(isAdmin||(f.is_custom&&f.created_by===user.id))openModal(f);else toast('يمكنك تعديل الأصناف المخصصة التي أضفتها فقط',false);};
$('foodActionDelete').onclick=()=>{const f=actionFood;closeFoodAction();if(!f)return;if(isAdmin||(f.is_custom&&f.created_by===user.id))openDeleteConfirm(f);else toast('يمكنك حذف الأصناف المخصصة التي أضفتها فقط',false);};
function openPreparationModal(food){$('prepModalTitle').textContent=food.name_ar+' — طريقة التحضير';$('prepModalText').textContent=food.preparation_method||'لا توجد طريقة تحضير مسجلة.';$('prepModal').classList.remove('hidden');$('prepModal').classList.add('flex');}
function closePreparationModal(){$('prepModal').classList.add('hidden');$('prepModal').classList.remove('flex');}
$('closePrepModal').onclick=closePreparationModal;
function closeModal(){$('modal').classList.add('hidden');$('modal').classList.remove('flex');}
$('addBtn').onclick=()=>openModal();$('closeModal').onclick=closeModal;$('cancelBtn').onclick=closeModal;
$('search').oninput=()=>{visibleFoodCount=FOOD_PAGE_SIZE;render();};
$('typeFilter').onchange=()=>{visibleFoodCount=FOOD_PAGE_SIZE;render();};
$('refreshBtn').onclick=loadFoods;
$('loadMoreFoods').onclick=loadMoreFoods;

$('foodRows').addEventListener('click',async e=>{
  const action=e.target.closest('[data-action]'), edit=e.target.closest('[data-edit]'), del=e.target.closest('[data-del]'), prep=e.target.closest('[data-prep]');
  if(action){const f=foods.find(x=>x.id===action.dataset.action);if(f)openFoodAction(f);}
  if(prep){const f=foods.find(x=>x.id===prep.dataset.prep);if(f)openPreparationModal(f);}
  if(edit){const f=foods.find(x=>x.id===edit.dataset.edit);if(f)openModal(f);}
  if(del){
    const f=foods.find(x=>x.id===del.dataset.del);
    if(!f || !isAdmin)return;
    openDeleteConfirm(f);
  }
});

let deleteTarget=null;
function closeDeleteConfirm(){
  deleteTarget=null;
  $('deleteConfirmModal').classList.add('hidden');
  $('deleteConfirmModal').classList.remove('flex');
}
function openDeleteConfirm(food){
  deleteTarget=food;
  $('deleteConfirmText').textContent=`هل تريد حذف الصنف المخصص "${food.name_ar}"؟ لا يمكن التراجع عن الحذف.`;
  $('deleteConfirmModal').classList.remove('hidden');
  $('deleteConfirmModal').classList.add('flex');
}
$('cancelDeleteBtn').onclick=closeDeleteConfirm;
$('confirmDeleteBtn').onclick=async()=>{
  const f=deleteTarget;
  if(!f || !isAdmin)return;
  const btn=$('confirmDeleteBtn');
  btn.disabled=true;
  btn.innerHTML='جاري الحذف...';
  const {error}=await supabase.from('foods').delete().eq('id',f.id);
  btn.disabled=false;
  btn.innerHTML='<i class="fa-solid fa-trash ml-1"></i> حذف الصنف';
  closeDeleteConfirm();
  if(error){toast('فشل حذف الصنف: '+error.message,false);return;}
  toast('تم حذف الصنف');await loadFoods();
};

$('foodForm').onsubmit=async e=>{
  e.preventDefault();$('saveBtn').disabled=true;$('saveBtn').textContent='جاري الحفظ...';
  const editId=$('editId').value;
  const existing=editId?foods.find(f=>f.id===editId):null;
  const payload={name_ar:$('nameAr').value.trim(),name_en:$('nameEn').value.trim(),kcal:num($('kcal').value),protein:num($('protein').value),carb:num($('carb').value),fat:num($('fat').value),sodium:num($('sodium').value),potassium:num($('potassium').value),phosphorus:num($('phosphorus').value),water:num($('water').value),household:$('household').value.trim(),preparation_method:$('preparationMethod').value.trim(),is_custom:existing?existing.is_custom:!isAdmin,created_by:existing?existing.created_by:(isAdmin?null:user.id)};\n  if(!editId && isAdmin){ payload.is_custom = false; payload.created_by = null; }
  let error=null;
  if(editId){
    ({error}=await supabase.from('foods').update(payload).eq('id',editId));
  }else{
    const id=(isAdmin?'food_base_':'food_custom_')+(crypto.randomUUID?crypto.randomUUID():(Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)));
    ({error}=await supabase.from('foods').insert({id,...payload}));
  }
  $('saveBtn').disabled=false;$('saveBtn').textContent='حفظ الصنف';
  if(error){toast('فشل الحفظ: '+error.message,false);return;}
  closeModal();toast(editId?'تم تعديل الصنف بنجاح':'تمت إضافة الصنف بنجاح');await loadFoods();
};


$('foodsTab').onclick=()=>switchTab('foods');
$('exchangesTab').onclick=()=>switchTab('exchanges');
$('exchangeSearch').oninput=renderExchanges;
$('exchangeGroupFilter').onchange=renderExchanges;

async function init(){
  if(!supabase){
    toast('تعذر تهيئة الاتصال الآمن بالتطبيق',false);
    return;
  }
  const accessStatus=await window.DietPlannerAccess?.getAccessStatus?.();
  if(!accessStatus?.authenticated || !accessStatus.user){location.replace('index.html');return;}
  user=accessStatus.user;isAdmin=accessStatus.isAdmin===true;
  try{await Promise.all([loadFoods(),loadExchanges()]);}
  catch(error){console.error('Food library initialization failed:',error);toast('حدث خطأ أثناء تحميل المكتبة: '+(error?.message||'خطأ غير معروف'),false);}
  finally{$('loading').style.display='none';}
}
init();
})();
