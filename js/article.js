(function(){
'use strict';
const supabase=window.DietPlannerAccess?.supabaseClient;
const $=id=>document.getElementById(id);let user=null,profile=null,isAdmin=false,articles=[],editingId=null,timer;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const date=v=>v?new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
function toast(m,error=false){const t=$('toast');t.textContent=m;t.className='fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-xl toast '+(error?'bg-red-600':'bg-brand-600');clearTimeout(timer);timer=setTimeout(()=>t.classList.add('hidden'),2800)}
function safe(html){const d=document.createElement('div');d.innerHTML=html;d.querySelectorAll('script,iframe,object,embed,style,form,input,button,textarea').forEach(x=>x.remove());d.querySelectorAll('*').forEach(x=>[...x.attributes].forEach(a=>{if(/^on/i.test(a.name))x.removeAttribute(a.name);if((a.name==='href'||a.name==='src')&&/^\s*javascript:/i.test(a.value))x.removeAttribute(a.name)}));return d.innerHTML}

/* =========================================================
 * ARTICLE TEXT DIRECTION
 * ========================================================= */
function getTextDirection(text){
  const value=String(text||'').trim();
  if(!value)return null;
  const firstStrong=value.match(/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]|[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/);
  if(!firstStrong)return 'ltr';
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(firstStrong[0])?'rtl':'ltr';
}
function syncTextDirection(root){
  if(!root)return;
  const blocks=root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th');
  blocks.forEach(block=>{
    const direction=getTextDirection(block.textContent);
    if(direction)block.setAttribute('dir',direction);
  });
}

async function load(){const{data,error}=await supabase.from('articles').select('id,created_by,title,author_name,content,visibility,required_feature,published_at,created_at,updated_at').order('updated_at',{ascending:false});if(error)throw error;articles=data||[];render()}
function render(){const q=$('search').value.trim().toLowerCase(),f=$('filter').value,v=articles.filter(a=>(!q||[a.title,a.author_name].some(x=>String(x||'').toLowerCase().includes(q)))&&(f==='all'||a.visibility===f));$('grid').innerHTML='';$('empty').classList.toggle('hidden',v.length>0);v.forEach(a=>{const mine=a.created_by===user.id,pub=a.visibility==='public',el=document.createElement('article');el.className='card glass rounded-3xl p-5 shadow-sm';el.innerHTML=`<div class="flex justify-between"><span class="rounded-full px-3 py-1 text-[11px] font-bold ${pub?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}">${pub?'🌐 عام':'🔒 خاص'}</span>${mine?`<div><button data-a="edit" data-id="${a.id}" class="h-9 w-9 text-slate-500 hover:text-brand-700"><i class="fa-solid fa-pen"></i></button><button data-a="delete" data-id="${a.id}" class="h-9 w-9 text-slate-500 hover:text-red-600"><i class="fa-solid fa-trash"></i></button></div>`:''}</div><button data-a="view" data-id="${a.id}" class="mt-5 block w-full text-right"><h3 class="text-xl font-extrabold leading-8">${esc(a.title)}</h3><p class="mt-2 text-sm font-semibold text-slate-500">بقلم: ${esc(a.author_name)}</p></button><div class="mt-5 border-t pt-4 text-xs text-slate-400">النشر: ${date(a.published_at)} · آخر تعديل: ${date(a.updated_at)}</div>`; $('grid').appendChild(el)})}
function syncAccessControl(){const wrap=$('articleAccessWrap');if(wrap)wrap.classList.toggle('hidden',!isAdmin)}
function setArticleAccess(value){const el=$('articleAccess');if(el)el.value=value||''}
function openEditor(a=null){editingId=a?.id||null;$('modalTitle').textContent=a?'تعديل المقال':'إضافة مقال';$('title').value=a?.title||'';$('author').value=a?.author_name||profile?.full_name||'';$('editor').innerHTML=a?.content||'';syncTextDirection($('editor'));$('public').checked=a?.visibility==='public';setArticleAccess(a?.required_feature||'');syncAccessControl();$('pubDate').textContent=a?.published_at?date(a.published_at):'سيُحدد عند النشر';$('updDate').textContent=a?.updated_at?date(a.updated_at):'عند الحفظ';state();$('editModal').classList.remove('hidden');document.body.classList.add('overflow-hidden')}
function closeEditor(){$('editModal').classList.add('hidden');document.body.classList.remove('overflow-hidden');editingId=null}
function state(){$('toggleText').textContent=$('public').checked?'عام':'خاص';$('state').textContent=$('public').checked?'عام — متاح للمستخدمين':'خاص — ظاهر لك فقط'}
async function save(){syncTextDirection($('editor'));const title=$('title').value.trim(),author=$('author').value.trim(),content=$('editor').innerHTML.trim(),visibility=$('public').checked?'public':'private';const requiredFeature=isAdmin&&visibility==='public'&&$('articleAccess')?.value==='article'?'article':null;if(!title)return toast('اكتب اسم المقال أولًا.','error');if(!author)return toast('اكتب اسم المؤلف.','error');if(!content||content==='<br>')return toast('اكتب محتوى المقال أولًا.','error');$('save').disabled=true;try{if(editingId){const old=articles.find(a=>a.id===editingId),p={title,author_name:author,content,visibility,required_feature:requiredFeature};if(visibility==='public'&&!old?.published_at)p.published_at=new Date().toISOString();const{error}=await supabase.from('articles').update(p).eq('id',editingId).eq('created_by',user.id);if(error)throw error;toast('تم تعديل المقال.')}else{const p={created_by:user.id,title,author_name:author,content,visibility,required_feature:requiredFeature};if(visibility==='public')p.published_at=new Date().toISOString();const{error}=await supabase.from('articles').insert(p);if(error)throw error;toast('تم إنشاء المقال.')}closeEditor();await load()}catch(e){console.error(e);toast(e.message||'حدث خطأ أثناء الحفظ.','error')}finally{$('save').disabled=false}}
function view(a){$('viewTitle').textContent=a.title;$('viewAuthor').textContent='المؤلف: '+a.author_name;$('viewPub').textContent='النشر: '+date(a.published_at);$('viewUpd').textContent='آخر تعديل: '+date(a.updated_at);$('viewState').textContent=a.visibility==='public'?'🌐 مقال عام':'🔒 مقال خاص';$('viewContent').innerHTML=safe(a.content);syncTextDirection($('viewContent'));$('viewModal').classList.remove('hidden');document.body.classList.add('overflow-hidden')}
function closeConfirm(){$('confirmModal').classList.add('hidden');document.body.classList.remove('overflow-hidden')}function confirmDelete(){return new Promise(resolve=>{const m=$('confirmModal');m.classList.remove('hidden');document.body.classList.add('overflow-hidden');const finish=v=>{closeConfirm();$('confirmDelete').onclick=null;$('confirmCancel').onclick=null;resolve(v)};$('confirmDelete').onclick=()=>finish(true);$('confirmCancel').onclick=()=>finish(false);m.onclick=e=>{if(e.target===m)finish(false)}})}async function del(id){const a=articles.find(x=>x.id===id);if(!a||a.created_by!==user.id)return;if(!await confirmDelete())return;const{error}=await supabase.from('articles').delete().eq('id',id).eq('created_by',user.id);if(error)return toast(error.message,'error');toast('تم حذف المقال.');load()}
$('addBtn').onclick=()=>openEditor();$('closeEdit').onclick=$('cancel').onclick=closeEditor;$('save').onclick=save;$('closeView').onclick=()=>{$('viewModal').classList.add('hidden');document.body.classList.remove('overflow-hidden')};$('public').onchange=()=>{state();if(!$('public').checked)setArticleAccess('')};$('search').oninput=render;$('filter').onchange=render;
$('toolbar').onmousedown=e=>{const b=e.target.closest('.tool');if(b){e.preventDefault();$('editor').focus();document.execCommand(b.dataset.cmd,false,null)}};$('format').onchange=e=>{$('editor').focus();document.execCommand('formatBlock',false,e.target.value);syncTextDirection($('editor'))};$('size').onchange=e=>{$('editor').focus();document.execCommand('fontSize',false,e.target.value);syncTextDirection($('editor'))};$('color').oninput=e=>{$('editor').focus();document.execCommand('foreColor',false,e.target.value)};$('highlight').oninput=e=>{$('editor').focus();document.execCommand('hiliteColor',false,e.target.value)};$('link').onclick=()=>{const u=prompt('أدخل الرابط:');if(u){$('editor').focus();document.execCommand('createLink',false,u)}};

function getSelectedTableCell(){
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount)return null;
  let n=sel.anchorNode;
  if(n&&n.nodeType===3)n=n.parentElement;
  return n?.closest?.('#editor td, #editor th')||null;
}
function selectCell(cell){
  document.querySelectorAll('#editor .selected-cell').forEach(x=>x.classList.remove('selected-cell'));
  if(cell)cell.classList.add('selected-cell');
}
function addTable(){
  const table=document.createElement('table');
  const tbody=document.createElement('tbody');
  for(let r=0;r<3;r++){
    const tr=document.createElement('tr');
    for(let c=0;c<3;c++){
      const td=document.createElement('td');
      td.innerHTML='<br>';
      td.contentEditable='true';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  $('editor').appendChild(table);
  const first=table.querySelector('td');
  if(first){selectCell(first);first.focus();}
}
function tableAction(type){
  const cell=getSelectedTableCell();
  if(!cell)return toast('حدد خلية داخل الجدول أولًا.','error');
  const row=cell.parentElement, table=cell.closest('table');
  if(type==='addRow'){
    const tr=document.createElement('tr');
    const count=row.children.length;
    for(let i=0;i<count;i++){const td=document.createElement('td');td.innerHTML='<br>';td.contentEditable='true';tr.appendChild(td)}
    row.after(tr);selectCell(tr.children[Math.min(cell.cellIndex,count-1)]);
  }
  if(type==='deleteRow'){
    if(table.rows.length<=1)return toast('لا يمكن حذف الصف الأخير.','error');
    const idx=row.rowIndex;row.remove();const next=table.rows[Math.min(idx,table.rows.length-1)];selectCell(next?.cells[Math.min(cell.cellIndex,(next?.cells.length||1)-1)]);
  }
  if(type==='addCol'){
    const idx=cell.cellIndex;
    [...table.rows].forEach(tr=>{const td=document.createElement('td');td.innerHTML='<br>';td.contentEditable='true';tr.insertBefore(td,tr.children[idx]||null)});
    selectCell(table.rows[cell.parentElement.rowIndex]?.cells[idx]);
  }
  if(type==='deleteCol'){
    if((table.rows[0]?.cells.length||0)<=1)return toast('لا يمكن حذف العمود الأخير.','error');
    const idx=cell.cellIndex;[...table.rows].forEach(tr=>{if(tr.cells[idx])tr.deleteCell(idx)});
    const next=table.rows[Math.min(cell.parentElement.rowIndex,table.rows.length-1)];selectCell(next?.cells[Math.min(idx,(next?.cells.length||1)-1)]);
  }
}
$('insertTable').onclick=addTable;
$('addRow').onclick=()=>tableAction('addRow');
$('deleteRow').onclick=()=>tableAction('deleteRow');
$('addCol').onclick=()=>tableAction('addCol');
$('deleteCol').onclick=()=>tableAction('deleteCol');
$('deleteTable').onclick=()=>{
  const cell=getSelectedTableCell(), table=cell?.closest('table');
  if(!table)return toast('حدد خلية داخل الجدول أولًا.','error');
  table.remove();
};
$('cellBgColor').oninput=e=>{
  const cell=getSelectedTableCell();
  if(!cell)return toast('حدد خلية داخل الجدول أولًا.','error');
  cell.style.backgroundColor=e.target.value;
};
$('editor').addEventListener('input',()=>syncTextDirection($('editor')));
$('editor').addEventListener('click',e=>{
  const cell=e.target.closest('#editor td,#editor th');
  selectCell(cell);
});
$('editor').addEventListener('focusin',e=>{
  const cell=e.target.closest('#editor td,#editor th');
  if(cell)selectCell(cell);
});
$('grid').onclick=e=>{const b=e.target.closest('[data-a]');if(!b)return;const a=articles.find(x=>x.id===b.dataset.id);if(!a)return;if(b.dataset.a==='view')view(a);if(b.dataset.a==='edit'&&a.created_by===user.id)openEditor(a);if(b.dataset.a==='delete')del(a.id)};
$('editModal').onclick=e=>{if(e.target===$('editModal'))closeEditor()};$('viewModal').onclick=e=>{if(e.target===$('viewModal')){$('viewModal').classList.add('hidden');document.body.classList.remove('overflow-hidden')}};document.onkeydown=e=>{if(e.key==='Escape'){closeEditor();$('viewModal').classList.add('hidden');document.body.classList.remove('overflow-hidden')}};
(async()=>{try{
  if(!supabase){throw new Error('تعذر تهيئة الاتصال الآمن بالتطبيق')}
  const accessStatus=await window.DietPlannerAccess?.getAccessStatus?.();
  user=accessStatus?.user||null;
  if(!user)return location.replace('index.html');
  const{data:p,error:profileError}=await supabase.from('profiles').select('full_name').eq('id',user.id).maybeSingle();
  if(profileError)throw profileError;
  profile=p||{};
  isAdmin=accessStatus?.isAdmin===true;
  await load();
  $('loading').style.display='none';
}catch(e){
  console.error(e);
  $('loading').innerHTML='<div class="rounded-2xl bg-white p-6 text-center"><div class="text-red-600 font-bold">تعذر تحميل المقالات</div><div class="mt-2 text-xs text-slate-400">'+esc(e.message)+'</div></div>';
}})();
})();
