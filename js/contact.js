(() => {
 "use strict";
 const access = () => window.DietPlannerAccess;
 const root = document.getElementById("contactChannels");
 const note = document.getElementById("contactNote");
 if (!root) return;

 const channels = [
  { key:"telegram_url", title:"Telegram", description:"راسل إدارة المنصة عبر تيليجرام", icon:"fa-brands fa-telegram", kind:"url", valid:value=>/^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+/-]+\/?$/i.test(value) },
  { key:"whatsapp_url", title:"WhatsApp", description:"تواصل معنا عبر واتساب", icon:"fa-brands fa-whatsapp", kind:"url", valid:value=>/^https:\/\/(wa\.me\/[0-9]+|api\.whatsapp\.com\/send\?phone=[0-9]+)$/i.test(value) },
  { key:"email", title:"البريد الإلكتروني", description:"أرسل استفسارك إلى البريد الرسمي", icon:"fa-regular fa-envelope", kind:"email", valid:value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
 ];

 function addChannel(item, value) {
  const card = document.createElement("a");
  card.className = "contact-channel";
  card.href = item.kind === "email" ? "mailto:" + value : value;
  if (item.kind === "url") { card.target = "_blank"; card.rel = "noopener noreferrer"; }
  const icon = document.createElement("span");
  icon.className = "contact-channel-icon";
  const i = document.createElement("i");
  i.className = item.icon;
  i.setAttribute("aria-hidden", "true");
  icon.append(i);
  const copy = document.createElement("span");
  copy.className = "contact-channel-copy";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const description = document.createElement("small");
  description.textContent = item.description;
  copy.append(title, description);
  const arrow = document.createElement("i");
  arrow.className = "fa-solid fa-arrow-up-right-from-square contact-channel-arrow";
  arrow.setAttribute("aria-hidden", "true");
  card.append(icon, copy, arrow);
  root.append(card);
 }

 async function load() {
  root.replaceChildren();
  const supabase = access()?.supabaseClient;
  if (!supabase) { showState("تعذر الاتصال بالخدمة حاليًا. حاول مرة أخرى لاحقًا."); return; }
  const { data, error } = await supabase.from("contact_settings")
   .select("is_enabled,telegram_url,whatsapp_url,email,note")
   .eq("id", true).maybeSingle();
  if (error) { console.error("Contact settings load failed:", error); showState("تعذر تحميل وسائل التواصل حاليًا."); return; }
  if (!data || !data.is_enabled) { showState("قنوات التواصل غير متاحة حاليًا."); return; }
  if (note && data.note) note.textContent = data.note;
  channels.forEach(item => {
   const value = String(data[item.key] || "").trim();
   if (value && item.valid(value)) addChannel(item, value);
  });
  if (!root.childElementCount) showState("سيتم إضافة وسائل التواصل قريبًا.");
 }
 function showState(message) {
  const state = document.createElement("p");
  state.className = "contact-state";
  state.textContent = message;
  root.replaceChildren(state);
 }
 load();
})();