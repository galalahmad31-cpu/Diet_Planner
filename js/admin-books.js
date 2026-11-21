(() => {
 "use strict";
 const access=window.DietPlannerAccess,sb=access?.supabaseClient;
 const $=id=>document.getElementById(id);
 const state={books:[],links:new Map(),orders:[],profiles:new Map(),settings:null,filter:"all",loaded:false,busy:false};
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const money=v=>Number(v||0).toLocaleString("ar-EG",{maximumFractionDigits:2})+" ج.م";
 const date=v=>v?new Date(v).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"}):"—";
 const isValidTelegramUrl=value=>/^https:\/\/(?:t\.me|telegram\.me)\/(?:\+(?:[A-Za-z0-9_-]+)|joinchat\/[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_]{4,31})\/?$/i.test(value);
 const coverUrl=path=>path?sb.storage.from("book-covers").getPublicUrl(path).data.publicUrl:"";
 let toastTimer=null;
 function toast(message){const box=$("booksAdminToast");box.textContent=message;box.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove("show"),2800)}
 function setState(id,message,show=false){$(id).textContent=message;$(id).hidden=show}
 function statusLabel(status){return ({pending:"قيد المراجعة",approved:"تم التأكيد",rejected:"مرفوض"})[status]||status}
 function renderBooks(){
  const list=$("booksAdminList");
  if(!state.books.length){list.hidden=true;setState("booksAdminState","لا توجد كتب حتى الآن. أضف أول كتاب.");return}
  setState("booksAdminState","",true);list.hidden=false;
  list.innerHTML=state.books.map(book=>{
   const url=coverUrl(book.cover_path);
   return '<article class="books-admin-book">'+(url?'<img src="'+esc(url)+'" alt="">':'<div class="books-admin-book-placeholder"><i class="fa-solid fa-book"></i></div>')+
    '<div class="books-admin-book-copy"><strong>'+esc(book.title)+'</strong><small>'+esc(book.category||"بدون تصنيف")+' · '+(book.is_free?"مجاني":esc(money(book.price)))+' · '+esc(({draft:"مسودة",published:"منشور",archived:"مؤرشف"})[book.status]||book.status)+'</small>'+
    '<div class="books-admin-book-actions"><button type="button" data-book-edit="'+esc(book.id)+'">تعديل</button></div></div></article>';
  }).join("");
 }
 function renderOrders(){
  const filtered=state.orders.filter(order=>state.filter==="all"||order.status===state.filter);
  const list=$("booksOrdersList");
  document.querySelectorAll("[data-book-order-filter]").forEach(button=>button.classList.toggle("active",button.dataset.bookOrderFilter===state.filter));
  if(!filtered.length){list.hidden=true;setState("booksOrdersState","لا توجد طلبات في هذا التصنيف.");return}
  setState("booksOrdersState","",true);list.hidden=false;
  list.innerHTML=filtered.map(order=>{
   const profile=state.profiles.get(order.user_id)||{};
   const linkReady=state.links.has(order.book_id);
   return '<article class="books-admin-order"><div class="books-admin-order-main"><strong>'+esc(order.books?.title||"كتاب محذوف")+'</strong>'+
    '<p>المستخدم: '+esc(profile.full_name||"مستخدم")+' · '+esc(profile.email||"")+'</p><p>القيمة: '+esc(money(order.amount))+' · '+esc(date(order.created_at))+'</p>'+
    '<span class="books-admin-status '+esc(order.status)+'">'+esc(statusLabel(order.status))+'</span></div><div class="books-admin-order-actions">'+
    '<button type="button" data-order-proof="'+esc(order.payment_proof_path)+'">عرض الإيصال</button>'+
    (order.status==="pending"?'<button type="button" data-order-approve="'+esc(order.id)+'" '+(!linkReady?'disabled title="أضف رابط Telegram للكتاب أولًا"':'')+'>تأكيد الدفع</button><button type="button" data-order-reject="'+esc(order.id)+'">رفض</button>':'')+
    '</div></article>';
  }).join("");
 }
 async function loadAll(force=false){
  if(state.busy||state.loaded&&!force)return;
  state.busy=true;$("booksAdminState").hidden=false;$("booksAdminState").textContent="جاري تحميل الكتب...";
  $("booksOrdersState").hidden=false;$("booksOrdersState").textContent="جاري تحميل الطلبات...";
  try{
   const [books,links,orders,settings]=await Promise.all([
    sb.from("books").select("*").order("sort_order",{ascending:true}).order("created_at",{ascending:false}),
    sb.from("book_delivery_links").select("book_id,telegram_url"),
    sb.from("book_orders").select("id,user_id,book_id,amount,payment_proof_path,status,created_at,books(title)").order("created_at",{ascending:false}),
    sb.from("book_store_settings").select("*").eq("id",true).maybeSingle()
   ]);
   for(const result of [books,links,orders,settings])if(result.error)throw result.error;
   state.books=books.data||[];state.links=new Map((links.data||[]).map(item=>[item.book_id,item.telegram_url]));state.orders=orders.data||[];state.settings=settings.data||{};
   const ids=[...new Set(state.orders.map(order=>order.user_id))];
   state.profiles.clear();
   if(ids.length){const profiles=await sb.from("profiles").select("id,full_name,email").in("id",ids);if(profiles.error)throw profiles.error;(profiles.data||[]).forEach(profile=>state.profiles.set(profile.id,profile))}
   $("booksPaymentMethod").value=state.settings.payment_method||"";
   $("booksPaymentDetails").value=state.settings.payment_details||"";
   $("booksPaymentInstructions").value=state.settings.payment_instructions||"";
   renderBooks();renderOrders();state.loaded=true;
  }catch(error){console.error("Books admin load failed:",error);setState("booksAdminState","تعذر تحميل بيانات الكتب: "+(error.message||"خطأ غير معروف"));setState("booksOrdersState","تعذر تحميل طلبات الشراء.");}
  finally{state.busy=false}
 }
 function openForm(book=null){
  $("booksAdminForm").reset();$("booksAdminId").value=book?.id||"";
  $("booksAdminDialogTitle").textContent=book?"تعديل الكتاب":"إضافة كتاب";
  $("booksAdminTitle").value=book?.title||"";$("booksAdminAuthor").value=book?.author||"";
  $("booksAdminCategory").value=book?.category||"";$("booksAdminPrice").value=book?.price??0;
  $("booksAdminFree").checked=book?.is_free===true;$("booksAdminStatus").value=book?.status||"draft";
  $("booksAdminDescription").value=book?.description||"";
  $("booksAdminFeatures").value=Array.isArray(book?.features)?book.features.join("\n"):"";
  $("booksAdminTelegram").value=book?state.links.get(book.id)||"":"";
  $("booksAdminSort").value=book?.sort_order??0;$("booksAdminCover").value="";
  $("booksAdminPrice").disabled=!!book?.is_free;
  $("booksAdminModal").hidden=false;
 }
 function closeForm(){$("booksAdminModal").hidden=true}
 async function saveBook(event){
  event.preventDefault();if(state.busy)return;
  const id=$("booksAdminId").value||null,title=$("booksAdminTitle").value.trim(),isFree=$("booksAdminFree").checked;
  const telegram=$("booksAdminTelegram").value.trim(),status=$("booksAdminStatus").value,file=$("booksAdminCover").files[0];
  if(!title){toast("اكتب اسم الكتاب.");return}
  if(status==="published"&&!isValidTelegramUrl(telegram)){toast("أضف رابط Telegram صحيحًا قبل نشر الكتاب.");return}
  if(telegram&&!isValidTelegramUrl(telegram)){toast("رابط Telegram غير صحيح.");return}
  if(file&&(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024)){toast("الغلاف يجب أن يكون JPG أو PNG أو WEBP وبحد أقصى 5MB.");return}
  const existing=state.books.find(book=>book.id===id);
  const payload={title,author:$("booksAdminAuthor").value.trim(),category:$("booksAdminCategory").value.trim(),description:$("booksAdminDescription").value.trim(),features:$("booksAdminFeatures").value.split("\n").map(x=>x.trim()).filter(Boolean),price:isFree?0:Number($("booksAdminPrice").value),is_free:isFree,status,sort_order:Math.max(0,Number($("booksAdminSort").value)||0),updated_at:new Date().toISOString()};
  if(!isFree&&(!Number.isFinite(payload.price)||payload.price<=0)){toast("حدد سعرًا أكبر من صفر للكتاب المدفوع.");return}
  state.busy=true;const button=$("booksAdminSave");button.disabled=true;button.textContent="جاري الحفظ...";
  let uploadedPath=null;
  try{
   if(file){const ext=({ "image/jpeg":"jpg","image/png":"png","image/webp":"webp" })[file.type];uploadedPath="covers/"+crypto.randomUUID()+"."+ext;const {error}=await sb.storage.from("book-covers").upload(uploadedPath,file,{contentType:file.type,upsert:false});if(error)throw error;payload.cover_path=uploadedPath}
   let saved;
   if(id){const result=await sb.from("books").update(payload).eq("id",id).select("*").single();if(result.error)throw result.error;saved=result.data}
   else{const result=await sb.from("books").insert(payload).select("*").single();if(result.error)throw result.error;saved=result.data}
   if(telegram){const linkResult=await sb.from("book_delivery_links").upsert({book_id:saved.id,telegram_url:telegram,updated_at:new Date().toISOString()},{onConflict:"book_id"});if(linkResult.error)throw linkResult.error}
   else if(id){const removed=await sb.from("book_delivery_links").delete().eq("book_id",saved.id);if(removed.error)throw removed.error}
   if(file&&existing?.cover_path)await sb.storage.from("book-covers").remove([existing.cover_path]);
   toast("تم حفظ بيانات الكتاب.");closeForm();state.loaded=false;await loadAll(true);
  }catch(error){if(uploadedPath)await sb.storage.from("book-covers").remove([uploadedPath]);console.error("Book save failed:",error);toast(error.message||"تعذر حفظ الكتاب.")}
  finally{state.busy=false;button.disabled=false;button.textContent="حفظ الكتاب"}
 }
 async function saveSettings(){
  const button=$("booksSettingsSave");button.disabled=true;
  try{const {error}=await sb.from("book_store_settings").update({payment_method:$("booksPaymentMethod").value.trim(),payment_details:$("booksPaymentDetails").value.trim(),payment_instructions:$("booksPaymentInstructions").value.trim(),updated_at:new Date().toISOString()}).eq("id",true);if(error)throw error;toast("تم حفظ بيانات التحويل.");state.loaded=false;await loadAll(true)}
  catch(error){console.error(error);toast(error.message||"تعذر حفظ إعدادات الدفع.")}
  finally{button.disabled=false}
 }
 async function reviewOrder(id,status){
  const order=state.orders.find(item=>item.id===id);if(!order||order.status!=="pending")return;
  if(status==="approved"&&!state.links.has(order.book_id)){toast("لا يمكن التأكيد قبل إضافة رابط Telegram للكتاب.");return}
  const prompt=status==="approved"?"تأكيد استلام التحويل وإتاحة رابط الكتاب للمستخدم؟":"رفض طلب الشراء؟";
  if(!window.confirm(prompt))return;
  try{const user=await access.getCurrentUser();const {error}=await sb.from("book_orders").update({status,reviewed_by:user.id,reviewed_at:new Date().toISOString()}).eq("id",id).eq("status","pending");if(error)throw error;toast(status==="approved"?"تم تأكيد الدفع وإتاحة رابط الكتاب.":"تم رفض الطلب.");state.loaded=false;await loadAll(true)}
  catch(error){console.error(error);toast(error.message||"تعذر تحديث حالة الطلب.")}
 }
 async function openProof(path,button){
  const popup=window.open("about:blank","_blank");
  if(popup)popup.opener=null;
  button.disabled=true;
  try{
   const {data,error}=await sb.storage.from("book-payment-proofs").createSignedUrl(path,300);
   if(error)throw error;
   if(popup)popup.location.replace(data.signedUrl);
   else window.location.assign(data.signedUrl);
  }catch(error){popup?.close();console.error(error);toast("تعذر فتح إيصال التحويل.")}
  finally{button.disabled=false}
 }
 async function init(){
  if(!sb)return;
  const status=await access.getAccessStatus();
  if(!status.authenticated||!status.isAdmin)return;
  await loadAll(true);
  $("booksNewBtn").addEventListener("click",()=>openForm());
  $("booksAdminClose").addEventListener("click",closeForm);$("booksAdminCancel").addEventListener("click",closeForm);
  $("booksAdminModal").addEventListener("click",event=>{if(event.target===$("booksAdminModal"))closeForm()});
  $("booksAdminForm").addEventListener("submit",saveBook);
  $("booksAdminFree").addEventListener("change",event=>{const price=$("booksAdminPrice");price.disabled=event.target.checked;if(event.target.checked)price.value="0";else if(Number(price.value)<=0)price.value="1"});
  $("booksSettingsSave").addEventListener("click",saveSettings);
  $("booksOrdersRefresh").addEventListener("click",()=>loadAll(true));
  document.querySelectorAll("[data-book-order-filter]").forEach(button=>button.addEventListener("click",()=>{state.filter=button.dataset.bookOrderFilter;renderOrders()}));
  $("booksAdminList").addEventListener("click",event=>{const button=event.target.closest("[data-book-edit]");if(button){const book=state.books.find(item=>item.id===button.dataset.bookEdit);if(book)openForm(book)}});
  $("booksOrdersList").addEventListener("click",event=>{const proof=event.target.closest("[data-order-proof]"),approve=event.target.closest("[data-order-approve]"),reject=event.target.closest("[data-order-reject]");if(proof)openProof(proof.dataset.orderProof,proof);else if(approve)reviewOrder(approve.dataset.orderApprove,"approved");else if(reject)reviewOrder(reject.dataset.orderReject,"rejected")});
  document.querySelector('[data-tab="books"]')?.addEventListener("click",()=>loadAll(true));
 }
 init().catch(error=>{console.error(error);toast("تعذر تشغيل إدارة مكتبة الكتب.")});
})();