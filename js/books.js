(() => {
  "use strict";
  const access = window.DietPlannerAccess;
  const sb = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { books: [], settings: null, user: null, activeBook: null, orders: new Map(), loading: false };
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[ch]));
  const money = value => Number(value || 0).toLocaleString("ar-EG",{maximumFractionDigits:2}) + " جنيه";
  const coverUrl = path => path ? sb.storage.from("book-covers").getPublicUrl(path).data.publicUrl : "";
  function showCatalogError(message) { $("booksGrid").innerHTML = ""; $("booksEmpty").hidden = false; $("booksEmpty").textContent = message; }
  function render() {
    const query = $("booksSearch").value.trim().toLocaleLowerCase();
    const category = $("booksCategory").value;
    const rows = state.books.filter(book => {
      if (category && book.category !== category) return false;
      return !query || [book.title,book.author,book.category,book.description].join(" ").toLocaleLowerCase().includes(query);
    });
    $("booksCount").textContent = rows.length + " كتاب";
    $("booksEmpty").hidden = rows.length > 0;
    $("booksGrid").innerHTML = rows.map(book => {
      const image = coverUrl(book.cover_path);
      return '<article class="book-card"><div class="book-cover">' +
        (image ? '<img src="' + esc(image) + '" alt="غلاف ' + esc(book.title) + '" loading="lazy">' : '<div class="book-cover-placeholder"><i class="fa-solid fa-book-open"></i></div>') +
        '<span class="book-price-tag">' + (book.is_free ? "مجاني" : esc(money(book.price))) + '</span></div>' +
        '<div class="book-card-copy"><span class="book-category">' + esc(book.category || "مرجع علمي") + '</span><h3>' + esc(book.title) + '</h3>' +
        (book.author ? '<span class="book-author">' + esc(book.author) + '</span>' : '<span class="book-author">Diet Planner</span>') +
        '<button class="book-card-action" type="button" data-book-view="' + esc(book.id) + '">عرض التفاصيل <i class="fa-solid fa-arrow-left"></i></button></div></article>';
    }).join("");
  }
  function closeModal() { $("bookModalBackdrop").hidden = true; $("bookModalBody").replaceChildren(); state.activeBook = null; }
  function loginPrompt() { location.href = "login.html?next=books.html"; }
  function renderBookDetails(book) {
    state.activeBook = book;
    const image = coverUrl(book.cover_path);
    $("bookModalTitle").textContent = book.title;
    const features = Array.isArray(book.features) ? book.features.filter(Boolean) : [];
    $("bookModalBody").innerHTML =
      '<div class="book-detail-layout">' +
      (image ? '<img class="book-detail-cover" src="' + esc(image) + '" alt="غلاف ' + esc(book.title) + '">' : '<div class="book-detail-cover book-cover-placeholder"><i class="fa-solid fa-book-open"></i></div>') +
      '<div class="book-detail-copy"><h3>' + esc(book.title) + '</h3><div class="book-detail-meta">' + esc(book.author || "Diet Planner") + (book.category ? " · " + esc(book.category) : "") + '</div>' +
      '<p class="book-detail-description">' + esc(book.description || "لا يوجد وصف إضافي لهذا الكتاب.") + '</p>' +
      (features.length ? '<ul class="book-detail-features">' + features.map(item => '<li><i class="fa-solid fa-check"></i><span>' + esc(item) + '</span></li>').join("") + '</ul>' : '') +
      '<div class="book-detail-price">' + (book.is_free ? "مجاني" : esc(money(book.price))) + '<small>' + (book.is_free ? "بدون رسوم" : "دفع مرة واحدة") + '</small></div>' +
      '<div id="bookAccessArea"></div></div></div>';
    $("bookModalBackdrop").hidden = false;
    if (!state.user) {
      $("bookAccessArea").innerHTML = '<button class="book-primary-action" type="button" data-book-login><i class="fa-solid fa-right-to-bracket"></i> تسجيل الدخول للحصول على الكتاب</button><p class="book-secondary-note">يمكنك تصفح المكتبة والتفاصيل دون تسجيل، ويلزم تسجيل الدخول للحصول على الكتاب.</p>';
      return;
    }
    if (book.is_free) {
      $("bookAccessArea").innerHTML = '<button class="book-primary-action" type="button" data-book-free><i class="fa-brands fa-telegram"></i> الحصول على الكتاب مجانًا</button>';
      return;
    }
    renderPaidAccess(book);
  }
  async function renderPaidAccess(book) {
    const area = $("bookAccessArea");
    area.innerHTML = '<div class="book-status"><i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق من حالة طلبك...</div>';
    const { data, error } = await sb.from("book_orders").select("id,status,created_at").eq("book_id", book.id).eq("user_id", state.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
    if (error) { area.innerHTML = '<div class="book-status">تعذر التحقق من الطلب. حاول تحديث الصفحة.</div>'; console.error(error); return; }
    if (data?.status === "approved") {
      area.innerHTML = '<div class="book-status approved"><i class="fa-solid fa-circle-check"></i> تم تأكيد الدفع. يمكنك الحصول على الكتاب الآن.</div><button class="book-primary-action" type="button" data-book-delivery><i class="fa-brands fa-telegram"></i> فتح الكتاب على Telegram</button>';
      return;
    }
    if (data?.status === "pending") {
      area.innerHTML = '<div class="book-status pending"><i class="fa-solid fa-clock"></i> طلبك قيد المراجعة. سيظهر رابط الكتاب هنا بعد تأكيد التحويل من الإدارة.</div>';
      return;
    }
    renderPaymentForm(book, data?.status === "rejected");
  }
  function renderPaymentForm(book, rejected) {
    const settings = state.settings || {};
    const area = $("bookAccessArea");
    area.innerHTML = '<div class="book-payment-panel"><h4><i class="fa-solid fa-money-bill-transfer"></i> بيانات التحويل</h4>' +
      '<p><strong>' + esc(settings.payment_method || "طريقة التحويل") + '</strong></p><p>' + esc(settings.payment_details || "لم تُضف الإدارة بيانات التحويل بعد.") + '</p>' +
      (settings.payment_instructions ? '<p>' + esc(settings.payment_instructions) + '</p>' : '') +
      '<label for="bookPaymentProof">صورة إيصال التحويل</label><input id="bookPaymentProof" type="file" accept="image/jpeg,image/png,image/webp" required>' +
      '<button class="book-primary-action" type="button" data-book-submit><i class="fa-solid fa-paper-plane"></i> ' + (rejected ? "إعادة إرسال الإيصال" : "إرسال طلب تأكيد الدفع") + '</button>' +
      '<p class="book-secondary-note">بعد مراجعة الإيصال وتأكيد التحويل، سيظهر رابط الكتاب في هذه الصفحة.</p></div>';
  }
  async function submitPayment(book, button) {
    const file = $("bookPaymentProof")?.files?.[0];
    if (!file) { alert("اختر صورة إيصال التحويل أولًا."); return; }
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      alert("يرجى اختيار صورة JPG أو PNG أو WEBP لا يتجاوز حجمها 5 ميجابايت."); return;
    }
    button.disabled = true; button.textContent = "جاري إرسال الطلب...";
    const extension = ({ "image/jpeg":"jpg","image/png":"png","image/webp":"webp" })[file.type];
    const path = state.user.id + "/" + crypto.randomUUID() + "." + extension;
    try {
      const { error: uploadError } = await sb.storage.from("book-payment-proofs").upload(path,file,{contentType:file.type,upsert:false});
      if (uploadError) throw uploadError;
      const { error } = await sb.from("book_orders").insert({ user_id:state.user.id,book_id:book.id,amount:book.price,payment_proof_path:path,status:"pending" });
      if (error) {
        await sb.storage.from("book-payment-proofs").remove([path]);
        if (error.code === "23505") throw new Error("لديك طلب شراء قائم لهذا الكتاب بالفعل.");
        throw error;
      }
      state.orders.set(book.id,"pending");
      renderBookDetails(book);
      const area = $("bookAccessArea");
      area.innerHTML = '<div class="book-status pending"><i class="fa-solid fa-clock"></i> تم إرسال طلبك بنجاح، وهو الآن قيد المراجعة. سيظهر رابط الكتاب بعد تأكيد الدفع.</div>';
    } catch (error) {
      console.error("Book order submission failed:",error);
      button.disabled = false;
      alert(error.message || "تعذر إرسال الطلب. حاول مرة أخرى.");
    }
  }
  async function deliverBook(book, button) {
    button.disabled = true;
    try {
      const { data,error } = await sb.rpc("get_book_delivery_link",{p_book_id:book.id});
      if (error) throw error;
      if (!data || !/^https:\/\/(t\.me|telegram\.me)\//.test(data)) throw new Error("رابط تسليم الكتاب غير متاح حاليًا.");
      window.open(data,"_blank","noopener,noreferrer");
    } catch (error) {
      console.error("Book delivery lookup failed:",error);
      alert(error.message || "تعذر فتح رابط الكتاب.");
    } finally { button.disabled = false; }
  }
  async function openBook(bookId) {
    const book = state.books.find(item => item.id === bookId);
    if (!book) return;
    renderBookDetails(book);
  }
  async function initialize() {
    if (!sb) { showCatalogError("تعذر الاتصال بالمكتبة حاليًا."); return; }
    try {
      const [booksResult,settingsResult,user] = await Promise.all([
        sb.from("books").select("id,title,author,category,description,features,price,is_free,cover_path").eq("status","published").order("sort_order",{ascending:true}).order("created_at",{ascending:false}),
        sb.from("book_store_settings").select("payment_method,payment_details,payment_instructions").eq("id",true).maybeSingle(),
        access?.getCurrentUser?.() || Promise.resolve(null)
      ]);
      if (booksResult.error) throw booksResult.error;
      if (settingsResult.error) throw settingsResult.error;
      state.books = booksResult.data || [];
      state.settings = settingsResult.data || {};
      state.user = user;
      const categories = [...new Set(state.books.map(book => book.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ar"));
      $("booksCategory").innerHTML = '<option value="">كل التصنيفات</option>' + categories.map(category => '<option value="' + esc(category) + '">' + esc(category) + '</option>').join("");
      render();
    } catch (error) {
      console.error("Public books catalog failed:",error);
      showCatalogError("تعذر تحميل الكتب حاليًا. حاول تحديث الصفحة.");
    }
  }
  $("booksSearch").addEventListener("input",render);
  $("booksCategory").addEventListener("change",render);
  $("booksGrid").addEventListener("click",event=>{const button=event.target.closest("[data-book-view]");if(button)openBook(button.dataset.bookView)});
  $("bookModalClose").addEventListener("click",closeModal);
  $("bookModalBackdrop").addEventListener("click",event=>{if(event.target===$("bookModalBackdrop"))closeModal()});
  $("bookModalBody").addEventListener("click",event=>{
    const target=event.target.closest("button");
    if(!target)return;
    if(target.hasAttribute("data-book-login"))loginPrompt();
    else if(target.hasAttribute("data-book-free") && state.activeBook)deliverBook(state.activeBook,target);
    else if(target.hasAttribute("data-book-delivery") && state.activeBook)deliverBook(state.activeBook,target);
    else if(target.hasAttribute("data-book-submit") && state.activeBook)submitPayment(state.activeBook,target);
  });
  initialize();
})();