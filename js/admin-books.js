(() => {
 "use strict";
 const access=window.DietPlannerAccess,sb=access?.supabaseClient;
 const $=id=>document.getElementById(id);
 const state={books:[],links:new Map(),orders:[],profiles:new Map(),settings:null,filter:"all",loaded:false,busy:false};
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const money=v=>Number(v||0).toLocaleString("ar-EG",{maximumFractionDigits:2})+" ج.م";
 const date=v=>v?new Date(v).toLocaleString("ar-EG",{dateStyle:"medium",timeStyle:"short"}):"—";
 const isValidDeliveryUrl=value=>{try{const url=new URL(value);return (url.protocol==="https:"||url.protocol==="http:")&&!!url.hostname&&!/\s/.test(value)}catch{return false}};
 const coverUrl=path=>path?sb.storage.from("book-covers").getPublicUrl(path).data.publicUrl:"";
 let toastTimer=null;
 function toast(message){const box=$("booksAdminToast");box.textContent=message;box.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove("show"),2800)}
 function setState(id,message,show=false){$(id).textContent=message;$(id).hidden=show}
 function statusLabel(status){return ({pending:"قيد المراجعة",approved:"تم التأكيد",rejected:"مرفوض"})[status]||status}
 function confirmDialog({title,message,confirmText="تأكيد",danger=false}){
  return new Promise(resolve=>{
   const previousFocus=document.activeElement;
   const overlay=document.createElement("div");
   overlay.className="books-admin-confirm-overlay";
   overlay.innerHTML='<section class="books-admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby="booksConfirmTitle" aria-describedby="booksConfirmMessage"><div class="books-admin-confirm-icon '+(danger?"is-danger":"")+'"><i class="fa-solid '+(danger?"fa-trash-can":"fa-circle-check")+'" aria-hidden="true"></i></div><span class="books-admin-confirm-kicker">DIET PLANNER</span><h2 id="booksConfirmTitle"></h2><p id="booksConfirmMessage"></p><div class="books-admin-confirm-actions"><button type="button" class="books-admin-confirm-cancel">إلغاء</button><button type="button" class="books-admin-confirm-submit '+(danger?"is-danger":"")+'"></button></div></section>';
   overlay.querySelector("#booksConfirmTitle").textContent=title;
   overlay.querySelector("#booksConfirmMessage").textContent=message;
   const cancel=overlay.querySelector(".books-admin-confirm-cancel");
   const submit=overlay.querySelector(".books-admin-confirm-submit");
   submit.textContent=confirmText;
   let settled=false;
   const finish=value=>{
    if(settled)return;
    settled=true;
    document.removeEventListener("keydown",onKeydown);
    overlay.remove();
    document.body.style.overflow=previousOverflow;
    if(previousFocus&&typeof previousFocus.focus==="function")previousFocus.focus();
    resolve(value);
   };
   const previousOverflow=document.body.style.overflow;
   const onKeydown=event=>{if(event.key==="Escape"){event.preventDefault();finish(false)}};
   cancel.addEventListener("click",()=>finish(false));
   submit.addEventListener("click",()=>finish(true));
   overlay.addEventListener("click",event=>{if(event.target===overlay)finish(false)});
   document.addEventListener("keydown",onKeydown);
   document.body.appendChild(overlay);
   document.body.style.overflow="hidden";
   submit.focus();
  });
 }
 async function createCoverVariants(source) {
  const bitmap = await createImageBitmap(source);
  const make = async (maxWidth, maxHeight, quality) => {
   const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
   const width = Math.max(1, Math.round(bitmap.width * scale));
   const height = Math.max(1, Math.round(bitmap.height * scale));
   const canvas = document.createElement("canvas");
   canvas.width = width; canvas.height = height;
   const context = canvas.getContext("2d", { alpha: true });
   if (!context) throw new Error("تعذر تجهيز صورة الغلاف في المتصفح.");
   context.drawImage(bitmap, 0, 0, width, height);
   const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", quality));
   if (!blob) throw new Error("تعذر ضغط صورة الغلاف.");
   return { blob, extension: blob.type === "image/webp" ? "webp" : "jpg", contentType: blob.type || "image/jpeg" };
  };
  try {
   const [thumbnail, detail] = await Promise.all([make(320, 420, 0.74), make(720, 960, 0.82)]);
   return { thumbnail, detail };
  } finally { bitmap.close?.(); }
 }
 async function uploadCoverVariants(bookId, source) {
  const variants = await createCoverVariants(source);
  const token = crypto.randomUUID();
  const thumbPath = "covers/optimized/" + bookId + "-" + token + "-thumb." + variants.thumbnail.extension;
  const detailPath = "covers/optimized/" + bookId + "-" + token + "-detail." + variants.detail.extension;
  const bucket = sb.storage.from("book-covers");
  const uploaded = [];
  try {
   const thumbResult = await bucket.upload(thumbPath, variants.thumbnail.blob, { contentType: variants.thumbnail.contentType, cacheControl: "31536000", upsert: false });
   if (thumbResult.error) throw thumbResult.error;
   uploaded.push(thumbPath);
   const detailResult = await bucket.upload(detailPath, variants.detail.blob, { contentType: variants.detail.contentType, cacheControl: "31536000", upsert: false });
   if (detailResult.error) throw detailResult.error;
   uploaded.push(detailPath);
   return { thumbPath, detailPath, uploaded };
  } catch (error) {
   if (uploaded.length) await bucket.remove(uploaded);
   throw error;
  }
 }
 async function removeOldCoverPaths(paths) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!unique.length) return null;
  const { error } = await sb.storage.from("book-covers").remove(unique);
  return error || null;
 }
 async function optimizeExistingCovers() {
  if (state.busy) return;
  const button = $("booksCoversOptimizeBtn");
  const pending = state.books.filter(book => book.cover_path && !book.cover_thumb_path);
  if (!pending.length) { toast("كل أغلفة الكتب الحالية محسّنة بالفعل."); return; }
  const confirmed = await confirmDialog({
   title: "تحسين أغلفة المكتبة الحالية",
   message: "سيتم تنزيل الأغلفة الحالية وضغطها إلى نسختين WebP، ثم تحديث مساراتها وحذف الملفات الأصلية بعد نجاح التحديث. لن تتغير بيانات الكتب أو روابط التسليم.",
   confirmText: "بدء التحسين"
  });
  if (!confirmed) return;
  state.busy = true;
  button.disabled = true;
  let completed = 0, failed = 0;
  try {
   for (const book of pending) {
    button.textContent = "تحسين " + (completed + failed + 1) + " / " + pending.length;
    let uploaded = [];
    try {
     const response = await fetch(coverUrl(book.cover_path), { cache: "no-store" });
     if (!response.ok) throw new Error("تعذر تنزيل الغلاف: " + book.title);
     const source = await response.blob();
     const variants = await uploadCoverVariants(book.id, source);
     uploaded = variants.uploaded;
     const { error } = await sb.from("books").update({
      cover_path: variants.detailPath,
      cover_thumb_path: variants.thumbPath,
      updated_at: new Date().toISOString()
     }).eq("id", book.id);
     if (error) throw error;
     const oldPaths = [book.cover_path, book.cover_thumb_path].filter(Boolean);
     const cleanupError = await removeOldCoverPaths(oldPaths);
     book.cover_path = variants.detailPath;
     book.cover_thumb_path = variants.thumbPath;
     completed++;
     if (cleanupError) console.warn("Old book cover cleanup needs review:", book.id, cleanupError);
    } catch (error) {
     if (uploaded.length) await sb.storage.from("book-covers").remove(uploaded);
     failed++;
     console.error("Cover optimization failed for book:", book.id, error);
    }
   }
   renderBooks();
   toast("اكتمل تحسين " + completed + " غلاف" + (failed ? "، وتعذر تحسين " + failed : "") + ".");
  } finally {
   state.busy = false;
   button.disabled = false;
   button.textContent = "تحسين الأغلفة الحالية";
  }
 }
 function renderBooks(){
  const list=$("booksAdminList");
  if(!state.books.length){list.hidden=true;setState("booksAdminState","لا توجد كتب حتى الآن. أضف أول كتاب.");return}
  setState("booksAdminState","",true);list.hidden=false;
  list.innerHTML=state.books.map(book=>{
   const url=coverUrl(book.cover_thumb_path || book.cover_path);
   return '<article class="books-admin-book">'+(url?'<img src="'+esc(url)+'" alt="">':'<div class="books-admin-book-placeholder"><i class="fa-solid fa-book"></i></div>')+
    '<div class="books-admin-book-copy"><strong>'+esc(book.title)+'</strong><small>'+esc(book.category||"بدون تصنيف")+' · '+(book.is_free?"مجاني":esc(money(book.price)))+' · '+esc(({draft:"مسودة",published:"منشور",archived:"مؤرشف"})[book.status]||book.status)+'</small>'+
    '<div class="books-admin-book-actions"><button type="button" data-book-edit="'+esc(book.id)+'">تعديل</button><button type="button" data-book-delete="'+esc(book.id)+'">حذف</button></div></div></article>';
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
    (order.status==="pending"?'<button type="button" data-order-approve="'+esc(order.id)+'" '+(!linkReady?'disabled title="أضف رابط تسليم الكتاب أولًا"':'')+'>تأكيد الدفع</button><button type="button" data-order-reject="'+esc(order.id)+'">رفض</button>':'')+
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
    sb.from("book_delivery_links").select("book_id,delivery_url"),
    sb.from("book_orders").select("id,user_id,book_id,amount,payment_proof_path,status,created_at,books(title)").order("created_at",{ascending:false}),
    sb.from("book_store_settings").select("*").eq("id",true).maybeSingle()
   ]);
   for(const result of [books,links,orders,settings])if(result.error)throw result.error;
   state.books=books.data||[];state.links=new Map((links.data||[]).map(item=>[item.book_id,item.delivery_url]));state.orders=orders.data||[];state.settings=settings.data||{};
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
  $("booksAdminDeliveryUrl").value=book?state.links.get(book.id)||"":"";
  $("booksAdminSort").value=book?.sort_order??0;$("booksAdminCover").value="";
  $("booksAdminPrice").disabled=!!book?.is_free;
  $("booksAdminModal").hidden=false;
 }
 function closeForm(){$("booksAdminModal").hidden=true}
 async function saveBook(event){
  event.preventDefault();if(state.busy)return;
  const id=$("booksAdminId").value||null,title=$("booksAdminTitle").value.trim(),isFree=$("booksAdminFree").checked;
  const telegram=$("booksAdminDeliveryUrl").value.trim(),status=$("booksAdminStatus").value,file=$("booksAdminCover").files[0];
  if(!title){toast("اكتب اسم الكتاب.");return}
  if(status==="published"&&!isValidDeliveryUrl(telegram)){toast("أضف رابط تسليم صالحًا (HTTP أو HTTPS) قبل نشر الكتاب.");return}
  if(telegram&&!isValidDeliveryUrl(telegram)){toast("الرابط غير صالح. استخدم عنوانًا يبدأ بـ https:// أو http://");return}
  if(file&&(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024)){toast("الغلاف يجب أن يكون JPG أو PNG أو WEBP وبحد أقصى 5MB.");return}
  const existing=state.books.find(book=>book.id===id);
  const payload={title,author:$("booksAdminAuthor").value.trim(),category:$("booksAdminCategory").value.trim(),description:$("booksAdminDescription").value.trim(),features:$("booksAdminFeatures").value.split("\n").map(x=>x.trim()).filter(Boolean),price:isFree?0:Number($("booksAdminPrice").value),is_free:isFree,status,sort_order:Math.max(0,Number($("booksAdminSort").value)||0),updated_at:new Date().toISOString()};
  if(!isFree&&(!Number.isFinite(payload.price)||payload.price<=0)){toast("حدد سعرًا أكبر من صفر للكتاب المدفوع.");return}
  state.busy=true;const button=$("booksAdminSave");button.disabled=true;button.textContent="جاري الحفظ...";
  let uploaded=[];
  let bookSaved=false;
  try{
   const bookStorageId=id||crypto.randomUUID();
  if(file){
    const variants=await uploadCoverVariants(bookStorageId,file);
    uploaded=variants.uploaded;
    payload.cover_path=variants.detailPath;
    payload.cover_thumb_path=variants.thumbPath;
    if(!id)payload.id=bookStorageId;
   }
   let saved;
   if(id){const result=await sb.from("books").update(payload).eq("id",id).select("*").single();if(result.error)throw result.error;saved=result.data}
   else{const result=await sb.from("books").insert(payload).select("*").single();if(result.error)throw result.error;saved=result.data}
   bookSaved=true;
   if(telegram){const linkResult=await sb.from("book_delivery_links").upsert({book_id:saved.id,delivery_url:telegram,updated_at:new Date().toISOString()},{onConflict:"book_id"});if(linkResult.error)throw linkResult.error}
   else if(id){const removed=await sb.from("book_delivery_links").delete().eq("book_id",saved.id);if(removed.error)throw removed.error}
   if(file&&existing){
    const cleanupError=await removeOldCoverPaths([existing.cover_path,existing.cover_thumb_path]);
    if(cleanupError)console.warn("Previous cover cleanup failed:",saved.id,cleanupError);
   }
   toast("تم حفظ الكتاب وضغط غلافي العرض والتفاصيل.");
   closeForm();state.loaded=false;await loadAll(true);
  }catch(error){
   if(uploaded.length&&!bookSaved)await sb.storage.from("book-covers").remove(uploaded);
   console.error("Book save failed:",error);toast(error.message||"تعذر حفظ الكتاب.")
  }finally{state.busy=false;button.disabled=false;button.textContent="حفظ الكتاب"}
 }
 async function deleteBook(id,button){
  const book=state.books.find(item=>item.id===id);
  if(!book||state.busy)return;
  const confirmed=await confirmDialog({title:"تأكيد حذف الكتاب",message:"هل تريد حذف «"+book.title+"» نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.",confirmText:"حذف الكتاب",danger:true});
  if(!confirmed)return;
  state.busy=true;
  if(button){button.disabled=true;button.textContent="جاري الحذف..."}
  try{
   const {count,error:ordersError}=await sb.from("book_orders").select("id",{count:"exact",head:true}).eq("book_id",id);
   if(ordersError)throw ordersError;
   if(count>0){
    toast("لا يمكن حذف هذا الكتاب لوجود "+count+" طلب شراء مرتبط به. غيّر حالته إلى «مؤرشف» بدلًا من الحذف.");
    return;
   }
   const {error:deleteError}=await sb.from("books").delete().eq("id",id);
   if(deleteError){
    if(deleteError.code==="23503")throw new Error("لا يمكن حذف الكتاب لوجود سجلات مرتبطة به. تم الحفاظ على السجلات.");
    throw deleteError;
   }
   let coverCleanupFailed=false;
   if(book.cover_path || book.cover_thumb_path){
    const {error:storageError}=await sb.storage.from("book-covers").remove([book.cover_path,book.cover_thumb_path].filter(Boolean));
    if(storageError){coverCleanupFailed=true;console.error("Deleted book cover cleanup failed:",storageError)}
   }
   state.books=state.books.filter(item=>item.id!==id);
   state.links.delete(id);
   renderBooks();
   toast(coverCleanupFailed?"تم حذف الكتاب، لكن تعذر حذف صورة الغلاف من التخزين.":"تم حذف الكتاب وصورة غلافه.");
  }catch(error){
   console.error("Book deletion failed:",error);
   toast(error.message||"تعذر حذف الكتاب.");
  }finally{
   state.busy=false;
   if(button){button.disabled=false;button.textContent="حذف"}
  }
 }
 async function saveSettings(){
  const button=$("booksSettingsSave");button.disabled=true;
  try{const {error}=await sb.from("book_store_settings").update({payment_method:$("booksPaymentMethod").value.trim(),payment_details:$("booksPaymentDetails").value.trim(),payment_instructions:$("booksPaymentInstructions").value.trim(),updated_at:new Date().toISOString()}).eq("id",true);if(error)throw error;toast("تم حفظ بيانات التحويل.");state.loaded=false;await loadAll(true)}
  catch(error){console.error(error);toast(error.message||"تعذر حفظ إعدادات الدفع.")}
  finally{button.disabled=false}
 }
 async function reviewOrder(id,status){
  const order=state.orders.find(item=>item.id===id);if(!order||order.status!=="pending")return;
  if(status==="approved"&&!state.links.has(order.book_id)){toast("لا يمكن التأكيد قبل إضافة رابط تسليم الكتاب.");return}
  const approved=status==="approved";
  const confirmed=await confirmDialog({title:approved?"تأكيد الدفع وإتاحة الكتاب":"تأكيد رفض الطلب",message:approved?"سيتم تسجيل استلام التحويل وإتاحة رابط الكتاب للمستخدم. هل تريد المتابعة؟":"سيتم رفض طلب الشراء ولن يتم إتاحة رابط الكتاب. هل تريد المتابعة؟",confirmText:approved?"تأكيد الدفع":"تأكيد الرفض",danger:!approved});
  if(!confirmed)return;
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
  $("booksCoversOptimizeBtn").addEventListener("click",optimizeExistingCovers);
  $("booksAdminClose").addEventListener("click",closeForm);$("booksAdminCancel").addEventListener("click",closeForm);
  $("booksAdminModal").addEventListener("click",event=>{if(event.target===$("booksAdminModal"))closeForm()});
  $("booksAdminForm").addEventListener("submit",saveBook);
  $("booksAdminFree").addEventListener("change",event=>{const price=$("booksAdminPrice");price.disabled=event.target.checked;if(event.target.checked)price.value="0";else if(Number(price.value)<=0)price.value="1"});
  $("booksSettingsSave").addEventListener("click",saveSettings);
  $("booksOrdersRefresh").addEventListener("click",()=>loadAll(true));
  document.querySelectorAll("[data-book-order-filter]").forEach(button=>button.addEventListener("click",()=>{state.filter=button.dataset.bookOrderFilter;renderOrders()}));
  $("booksAdminList").addEventListener("click",event=>{const deleteButton=event.target.closest("[data-book-delete]"),editButton=event.target.closest("[data-book-edit]");if(deleteButton)deleteBook(deleteButton.dataset.bookDelete,deleteButton);else if(editButton){const book=state.books.find(item=>item.id===editButton.dataset.bookEdit);if(book)openForm(book)}});
  $("booksOrdersList").addEventListener("click",event=>{const proof=event.target.closest("[data-order-proof]"),approve=event.target.closest("[data-order-approve]"),reject=event.target.closest("[data-order-reject]");if(proof)openProof(proof.dataset.orderProof,proof);else if(approve)reviewOrder(approve.dataset.orderApprove,"approved");else if(reject)reviewOrder(reject.dataset.orderReject,"rejected")});
  document.querySelector('[data-tab="books"]')?.addEventListener("click",()=>loadAll(true));
 }
 init().catch(error=>{console.error(error);toast("تعذر تشغيل إدارة مكتبة الكتب.")});
})();