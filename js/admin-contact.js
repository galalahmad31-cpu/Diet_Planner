(() => {
 "use strict";
 const $ = id => document.getElementById(id);
 const access = () => window.DietPlannerAccess;
 let loaded = false;
 let loading = false;

 function setState(message, isError = false) {
  const node = $("adminContactState");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message;
  node.style.color = isError ? "#b42318" : "";
 }
 function validTelegram(value) {
  return !value || /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+\/?$/i.test(value);
 }
 function validWhatsapp(value) {
  return !value || /^https:\/\/(wa\.me\/[0-9]+|api\.whatsapp\.com\/send\?phone=[0-9]+)$/i.test(value);
 }
 function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
 }
 async function load(force = false) {
  if (loading || (loaded && !force)) return;
  loading = true;
  setState("جاري تحميل إعدادات التواصل...");
  const supabase = access()?.supabaseClient;
  if (!supabase) { setState("تعذر الاتصال بقاعدة البيانات.", true); loading = false; return; }
  const { data, error } = await supabase.from("contact_settings")
   .select("is_enabled,telegram_url,whatsapp_url,email,note")
   .eq("id", true).single();
  loading = false;
  if (error || !data) { console.error("Admin contact settings load failed:", error); setState("تعذر تحميل إعدادات التواصل.", true); return; }
  $("contactEnabled").checked = data.is_enabled === true;
  $("contactTelegram").value = data.telegram_url || "";
  $("contactWhatsapp").value = data.whatsapp_url || "";
  $("contactEmail").value = data.email || "";
  $("contactNote").value = data.note || "";
  $("adminContactForm").hidden = false;
  setState("");
  loaded = true;
 }
 async function save(event) {
  event.preventDefault();
  const telegram = $("contactTelegram").value.trim();
  const whatsapp = $("contactWhatsapp").value.trim();
  const email = $("contactEmail").value.trim();
  const note = $("contactNote").value.trim();
  if (!validTelegram(telegram)) { $("contactTelegram").setCustomValidity("استخدم رابط Telegram مثل https://t.me/username"); $("contactTelegram").reportValidity(); $("contactTelegram").setCustomValidity(""); return; }
  if (!validWhatsapp(whatsapp)) { $("contactWhatsapp").setCustomValidity("استخدم رابط WhatsApp مثل https://wa.me/201xxxxxxxxx"); $("contactWhatsapp").reportValidity(); $("contactWhatsapp").setCustomValidity(""); return; }
  if (!validEmail(email)) { $("contactEmail").reportValidity(); return; }
  if (note.length > 500) { $("contactNote").focus(); return; }
  if (!telegram && !whatsapp && !email && $("contactEnabled").checked) { window.alert("أضف وسيلة تواصل واحدة على الأقل أو أوقف عرض صفحة التواصل."); return; }
  const button = $("saveContactSettings");
  const status = $("adminContactSaveState");
  button.disabled = true;
  status.textContent = "جاري الحفظ...";
  const supabase = access()?.supabaseClient;
  const { error } = await supabase.from("contact_settings").update({
   is_enabled: $("contactEnabled").checked,
   telegram_url: telegram,
   whatsapp_url: whatsapp,
   email,
   note,
   updated_at: new Date().toISOString()
  }).eq("id", true);
  button.disabled = false;
  if (error) { console.error("Admin contact settings save failed:", error); status.textContent = "فشل الحفظ. تحقق من صلاحيات الإدارة والبيانات."; status.style.color = "#b42318"; return; }
  status.textContent = "تم حفظ الإعدادات.";
  status.style.color = "#137a45";
 }
 $("adminContactForm")?.addEventListener("submit", save);
 window.DietPlannerAdminContact = Object.freeze({ load: () => load(true) });
})();