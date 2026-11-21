(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const client = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const PAGE = "job_posts";
  const SPECIALTIES = {
    medicine: "الطب", pharmacy: "الصيدلة", nursing: "التمريض",
    clinical_nutrition: "التغذية العلاجية", laboratory: "المعامل والتحاليل",
    radiology: "الأشعة", dentistry: "طب الأسنان", physiotherapy: "العلاج الطبيعي",
    healthcare_management: "الإدارة الصحية", other: "تخصصات صحية أخرى"
  };
  const EMPLOYMENT = {
    full_time: "دوام كامل", part_time: "دوام جزئي", contract: "تعاقد",
    temporary: "مؤقت", internship: "تدريب", freelance: "عمل حر"
  };
  const WORKPLACE = { on_site: "من مقر العمل", hybrid: "هجين", remote: "عن بُعد" };
  const STATUS = { draft: "مسودة", published: "منشور", closed: "مغلق" };
  let rows = [];
  let currentUserId = null;
  let saving = false;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const date = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(parsed);
  };
  function toast(message) {
    const element = $("toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("show");
    window.setTimeout(() => element.classList.remove("show"), 2600);
  }
  function setState(message, isLoading = false) {
    $("jobAdminState").hidden = false;
    $("jobAdminState").textContent = message;
    $("jobAdminList").hidden = true;
    if (isLoading) $("jobAdminState").innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + esc(message);
  }
  function render() {
    const query = $("jobAdminSearch").value.trim().toLocaleLowerCase();
    const filtered = rows.filter((job) => [
      job.title, job.organization_name, job.location_city, SPECIALTIES[job.specialty]
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
    $("jobAdminTotal").textContent = String(rows.length);
    $("jobAdminPublished").textContent = String(rows.filter((job) => job.status === "published").length);
    $("jobAdminDrafts").textContent = String(rows.filter((job) => job.status === "draft").length);
    if (!filtered.length) {
      $("jobAdminList").replaceChildren();
      $("jobAdminList").hidden = true;
      $("jobAdminState").hidden = false;
      $("jobAdminState").textContent = rows.length ? "لا توجد نتائج مطابقة." : "لا توجد وظائف بعد. أضف أول وظيفة.";
      return;
    }
    $("jobAdminState").hidden = true;
    $("jobAdminList").hidden = false;
    $("jobAdminList").innerHTML = filtered.map((job) => `
      <article class="job-admin-card">
        <div class="job-admin-card-head">
          <div><h3>${esc(job.title)}</h3><p class="job-admin-company">${esc(job.organization_name)}</p></div>
          <span class="job-admin-badge ${esc(job.status)}">${esc(STATUS[job.status] || job.status)}</span>
        </div>
        <div class="job-admin-meta">
          <span>${esc(SPECIALTIES[job.specialty] || "تخصص صحي")}</span>
          <span>${esc(job.location_city || "الموقع غير محدد")}</span>
          <span>${esc(EMPLOYMENT[job.employment_type] || "")}</span>
          <span>النشر: ${esc(date(job.published_at || job.created_at))}</span>
          <span>الانتهاء: ${esc(date(job.expires_at))}</span>
        </div>
        <div class="job-admin-card-actions">
          <button class="btn btn-outline" type="button" data-job-edit="${esc(job.id)}"><i class="fa-solid fa-pen"></i> تعديل</button>
          <button class="btn btn-outline" type="button" data-job-toggle="${esc(job.id)}">${job.status === "published" ? "تحويل لمسودة" : "نشر الوظيفة"}</button>
          <button class="btn btn-danger" type="button" data-job-delete="${esc(job.id)}"><i class="fa-solid fa-trash"></i> حذف</button>
          ${job.status === "published" ? '<a class="btn btn-outline" target="_blank" rel="noopener" href="https://nutrition-3.vercel.app/jobs/' + encodeURIComponent(job.id) + '">معاينة</a>' : ""}
        </div>
      </article>`).join("");
  }
  async function loadJobs() {
    if (!client) return setState("تعذر الاتصال بقاعدة البيانات.");
    setState("جاري تحميل الوظائف...", true);
    const { data, error } = await client.from(PAGE).select("id,title,specialty,organization_name,location_city,country_code,employment_type,workplace_type,description,requirements,salary_min,salary_max,salary_currency,salary_period,application_url,contact_email,contact_phone,status,published_at,expires_at,created_at,updated_at").order("created_at", { ascending: false });
    if (error) {
      console.error("Admin jobs load failed:", error);
      return setState("تعذر تحميل الوظائف. تحقق من الصلاحيات والاتصال.");
    }
    rows = data || [];
    render();
  }
  function openForm(job = null) {
    const form = $("jobAdminForm");
    form.reset();
    $("jobAdminId").value = job?.id || "";
    $("jobAdminTitle").value = job?.title || "";
    $("jobAdminSpecialty").value = job?.specialty || "medicine";
    $("jobAdminCompany").value = job?.organization_name || "";
    $("jobAdminCity").value = job?.location_city || "";
    $("jobAdminEmployment").value = job?.employment_type || "full_time";
    $("jobAdminWorkplace").value = job?.workplace_type || "on_site";
    $("jobAdminDescription").value = job?.description || "";
    $("jobAdminRequirements").value = job?.requirements || "";
    $("jobAdminSalaryMin").value = job?.salary_min ?? "";
    $("jobAdminSalaryMax").value = job?.salary_max ?? "";
    $("jobAdminSalaryPeriod").value = job?.salary_period || "month";
    $("jobAdminCurrency").value = job?.salary_currency || "EGP";
    $("jobAdminApplyUrl").value = job?.application_url || "";
    $("jobAdminEmail").value = job?.contact_email || "";
    $("jobAdminPhone").value = job?.contact_phone || "";
    $("jobAdminExpiry").value = job?.expires_at || "";
    $("jobAdminStatus").value = job?.status || "draft";
    $("jobAdminDialogTitle").textContent = job ? "تعديل الوظيفة" : "إضافة وظيفة جديدة";
    $("jobAdminOverlay").hidden = false;
    document.body.style.overflow = "hidden";
    $("jobAdminTitle").focus();
  }
  function closeForm() {
    $("jobAdminOverlay").hidden = true;
    document.body.style.overflow = "";
  }
  function valueOrNull(id) {
    const value = $(id).value.trim();
    return value || null;
  }
  async function saveJob(event) {
    event.preventDefault();
    if (saving) return;
    const form = $("jobAdminForm");
    if (!form.reportValidity()) return;
    const id = $("jobAdminId").value || null;
    const existing = rows.find((job) => job.id === id);
    const status = $("jobAdminStatus").value;
    const applicationUrl = valueOrNull("jobAdminApplyUrl");
    const email = valueOrNull("jobAdminEmail");
    const phone = valueOrNull("jobAdminPhone");
    if (!applicationUrl && !email && !phone) {
      toast("أضف رابط التقديم أو البريد الإلكتروني أو رقم التواصل.");
      return;
    }
    const expiryDate = valueOrNull("jobAdminExpiry");
    const today = new Date().toISOString().slice(0, 10);
    if (status === "published" && expiryDate && expiryDate < today) {
      toast("لا يمكن نشر وظيفة انتهى موعد التقديم الخاص بها.");
      return;
    }
    const salaryMin = valueOrNull("jobAdminSalaryMin");
    const salaryMax = valueOrNull("jobAdminSalaryMax");
    if (salaryMin !== null && salaryMax !== null && Number(salaryMax) < Number(salaryMin)) {
      toast("الحد الأقصى للراتب يجب ألا يقل عن الحد الأدنى.");
      return;
    }
    const now = new Date().toISOString();
    const payload = {
      title: $("jobAdminTitle").value.trim(),
      specialty: $("jobAdminSpecialty").value,
      organization_name: $("jobAdminCompany").value.trim(),
      location_city: valueOrNull("jobAdminCity"),
      country_code: "EG",
      employment_type: $("jobAdminEmployment").value,
      workplace_type: $("jobAdminWorkplace").value,
      description: $("jobAdminDescription").value.trim(),
      requirements: valueOrNull("jobAdminRequirements"),
      salary_min: salaryMin === null ? null : Number(salaryMin),
      salary_max: salaryMax === null ? null : Number(salaryMax),
      salary_currency: $("jobAdminCurrency").value,
      salary_period: salaryMin !== null || salaryMax !== null ? valueOrNull("jobAdminSalaryPeriod") : null,
      application_url: applicationUrl,
      contact_email: email,
      contact_phone: phone,
      status,
      published_at: status === "published"
        ? (existing?.status === "published" && existing.published_at ? existing.published_at : now)
        : (existing?.published_at || null),
      expires_at: expiryDate,
      updated_at: now
    };
    if (!id) payload.created_by = currentUserId;
    saving = true;
    const button = $("jobAdminSave");
    button.disabled = true;
    button.textContent = "جاري الحفظ...";
    try {
      const result = id
        ? await client.from(PAGE).update(payload).eq("id", id)
        : await client.from(PAGE).insert(payload);
      if (result.error) throw result.error;
      closeForm();
      toast(id ? "تم تحديث الوظيفة." : "تمت إضافة الوظيفة.");
      await loadJobs();
    } catch (error) {
      console.error("Admin job save failed:", error);
      toast(error?.message || "تعذر حفظ الوظيفة.");
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = "حفظ الوظيفة";
    }
  }
  async function toggleJob(id) {
    const job = rows.find((item) => item.id === id);
    if (!job) return;
    const status = job.status === "published" ? "draft" : "published";
    const today = new Date().toISOString().slice(0, 10);
    if (status === "published" && job.expires_at && job.expires_at < today) {
      toast("حدّث تاريخ انتهاء الإعلان قبل إعادة نشر الوظيفة.");
      return;
    }
    const now = new Date().toISOString();
    const { error } = await client.from(PAGE).update({
      status,
      published_at: status === "published" ? now : job.published_at,
      updated_at: now
    }).eq("id", id);
    if (error) return toast(error.message || "تعذر تغيير حالة الوظيفة.");
    toast(status === "published" ? "تم نشر الوظيفة." : "تم تحويل الوظيفة إلى مسودة.");
    await loadJobs();
  }
  async function deleteJob(id) {
    const job = rows.find((item) => item.id === id);
    const confirmation = window.DietPlannerConfirm;
    if (!job || !confirmation || typeof confirmation.ask !== "function") {
      if (job) toast("تعذر فتح نافذة التأكيد. أعد تحميل الصفحة.");
      return;
    }
    confirmation.ask(
      "حذف الوظيفة",
      `هل تريد حذف وظيفة «${job.title}» نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.`,
      async () => {
        const { error } = await client.from(PAGE).delete().eq("id", id);
        if (error) {
          toast(error.message || "تعذر حذف الوظيفة.");
          return;
        }
        toast("تم حذف الوظيفة.");
        await loadJobs();
      }
    );
  }

  async function init() {
    if (!client || !access) return;
    try {
      const status = await access.getAccessStatus();
      if (!status?.authenticated || status.isAdmin !== true) return;
      currentUserId = status.user?.id || null;
      $("jobAdminNew").addEventListener("click", () => openForm());
      $("jobAdminRefresh").addEventListener("click", loadJobs);
      $("jobAdminSearch").addEventListener("input", render);
      $("jobAdminCancel").addEventListener("click", closeForm);
      $("jobAdminClose").addEventListener("click", closeForm);
      $("jobAdminOverlay").addEventListener("click", (event) => {
        if (event.target === $("jobAdminOverlay")) closeForm();
      });
      $("jobAdminForm").addEventListener("submit", saveJob);
      $("jobAdminList").addEventListener("click", (event) => {
        const edit = event.target.closest("[data-job-edit]");
        const toggle = event.target.closest("[data-job-toggle]");
        const del = event.target.closest("[data-job-delete]");
        if (edit) openForm(rows.find((job) => job.id === edit.dataset.jobEdit));
        else if (toggle) toggleJob(toggle.dataset.jobToggle);
        else if (del) deleteJob(del.dataset.jobDelete);
      });
      document.querySelector('[data-tab="jobs"]')?.addEventListener("click", loadJobs);
    } catch (error) {
      console.error("Admin job authorization failed:", error);
    }
  }
  init();
})();