(() => {
  "use strict";
  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const params = new URLSearchParams(window.location.search);
  const rawPatientId = params.get("id") || params.get("patient") || params.get("patient_id");
  const patientId = typeof rawPatientId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawPatientId)
    ? rawPatientId
    : null;
  let dialog;

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = create("div", "patient-portal-invite-overlay");
    dialog.hidden = true;
    dialog.innerHTML = `
      <section class="patient-portal-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="patientPortalInviteTitle">
        <button type="button" class="patient-portal-invite-close" aria-label="إغلاق">×</button>
        <span class="patient-portal-invite-icon"><i class="fa-solid fa-link"></i></span>
        <h3 id="patientPortalInviteTitle">دعوة المريض لربط حسابه</h3>
        <p class="patient-portal-invite-description">أرسل هذا الرابط للمريض. يمكن استخدامه مرة واحدة خلال 24 ساعة، وبعد تسجيل الدخول سيُربط حسابه بملفه الحالي.</p>
        <label for="patientPortalInviteUrl">رابط الدعوة</label>
        <input id="patientPortalInviteUrl" type="text" readonly dir="ltr">
        <label for="patientPortalInviteCode">كود الربط (يمكن إدخاله داخل بوابة المريض)</label>
        <input id="patientPortalInviteCode" type="text" readonly dir="ltr">
        <div class="patient-portal-invite-actions">
          <button type="button" class="patient-portal-copy-code"><i class="fa-regular fa-copy"></i> نسخ الكود</button>
          <button type="button" class="patient-portal-copy-link"><i class="fa-regular fa-copy"></i> نسخ الرابط</button>
          <button type="button" class="patient-portal-invite-done">إغلاق</button>
        </div>
        <p class="patient-portal-invite-status" role="status"></p>
      </section>`;
    document.body.append(dialog);
    const close = () => { dialog.hidden = true; };
    dialog.querySelector(".patient-portal-invite-close").addEventListener("click", close);
    dialog.querySelector(".patient-portal-invite-done").addEventListener("click", close);
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    dialog.querySelector(".patient-portal-copy-code").addEventListener("click", async () => {
      const input = dialog.querySelector("#patientPortalInviteCode");
      const status = dialog.querySelector(".patient-portal-invite-status");
      try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = "تم نسخ كود الربط. أرسله للمريض ليُدخله في إدارة المتابعة.";
      } catch {
        input.focus();
        input.select();
        status.textContent = "تعذر النسخ التلقائي. حدّد الكود وانسخه يدويًا.";
      }
    });
    dialog.querySelector(".patient-portal-copy-link").addEventListener("click", async () => {
      const input = dialog.querySelector("#patientPortalInviteUrl");
      const status = dialog.querySelector(".patient-portal-invite-status");
      try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = "تم نسخ الرابط. أرسله للمريض عبر وسيلة التواصل المناسبة.";
      } catch {
        input.focus();
        input.select();
        status.textContent = "تعذر النسخ التلقائي. حدّد الرابط وانسخه يدويًا.";
      }
    });
    return dialog;
  }

  async function createInvitation(button) {
    if (!supabase || !patientId) return;
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء الدعوة...';
    try {
      const { data, error } = await supabase.rpc("create_patient_invitation", { p_patient_id: patientId });
      if (error) throw error;
      const token = typeof data === "string" ? data : data?.token;
      if (!token) throw new Error("لم يتم استلام رمز الدعوة من الخادم.");
      const url = new URL("patient-portal.html", window.location.href);
      url.searchParams.set("invite", token);
      const modal = ensureDialog();
      modal.querySelector("#patientPortalInviteUrl").value = url.toString();
      modal.querySelector("#patientPortalInviteCode").value = token;
      modal.querySelector(".patient-portal-invite-status").textContent = "الرابط صالح لمدة 24 ساعة ولمرة واحدة فقط.";
      modal.hidden = false;
    } catch (error) {
      console.error("Patient invitation creation failed:", error);
      window.alert(error.message || "تعذر إنشاء دعوة المريض.");
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  function init() {
    if (!patientId) return;
    const section = document.querySelector(".patient-name-bar");
    if (!section || document.getElementById("createPatientPortalInvite")) return;
    const button = create("button", "patient-portal-invite-button");
    button.id = "createPatientPortalInvite";
    button.type = "button";
    button.innerHTML = '<i class="fa-solid fa-link"></i><span>ربط حساب المريض</span>';
    button.addEventListener("click", () => createInvitation(button));
    const toolbar = section.querySelector("#patientActionToolbar");
    if (toolbar) {
      button.classList.add("patient-profile-link-button");
      toolbar.prepend(button);
    } else {
      const heading = section.querySelector("#patientName");
      if (heading?.parentElement) {
        const wrap = create("div", "patient-portal-invite-toolbar");
        wrap.append(button);
        heading.insertAdjacentElement("afterend", wrap);
      } else {
        section.prepend(button);
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
