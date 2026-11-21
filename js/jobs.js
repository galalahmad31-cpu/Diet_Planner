(() => {
  "use strict";

  const client = window.DietPlannerAccess?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const PAGE_SIZE = 20;
  const SPECIALTIES = {
    medicine: "الطب", pharmacy: "الصيدلة", nursing: "التمريض",
    clinical_nutrition: "التغذية العلاجية", laboratory: "المعامل والتحاليل",
    radiology: "الأشعة", dentistry: "طب الأسنان",
    physiotherapy: "العلاج الطبيعي", healthcare_management: "الإدارة الصحية",
    other: "تخصصات صحية أخرى"
  };
  const EMPLOYMENT = {
    full_time: "دوام كامل", part_time: "دوام جزئي", contract: "تعاقد",
    temporary: "مؤقت", internship: "تدريب", freelance: "عمل حر"
  };
  const WORKPLACE = { on_site: "من مقر العمل", hybrid: "هجين", remote: "عن بُعد" };
  let offset = 0;
  let hasMore = true;
  let loading = false;
  let searchTimer = null;
  let reloadQueued = false;
  let jobs = [];

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ar-EG", {
      year: "numeric", month: "short", day: "numeric"
    }).format(date);
  }

  function salaryLabel(job) {
    if (job.salary_min == null && job.salary_max == null) return "";
    const amount = (value) => Number(value).toLocaleString("ar-EG");
    const range = job.salary_min != null && job.salary_max != null
      ? amount(job.salary_min) + " – " + amount(job.salary_max)
      : amount(job.salary_min ?? job.salary_max);
    const period = { hour: "للساعة", day: "لليوم", week: "للأسبوع", month: "للشهر", year: "للسنة" }[job.salary_period] || "";
    return range + " " + (job.salary_currency || "EGP") + (period ? " " + period : "");
  }

  function render() {
    const query = $("jobsSearch").value.trim().toLocaleLowerCase();
    const specialty = $("jobsSpecialty").value;
    const filtered = jobs.filter((job) => {
      if (specialty && job.specialty !== specialty) return false;
      const haystack = [job.title, job.organization_name, job.location_city, job.description]
        .join(" ").toLocaleLowerCase();
      return !query || haystack.includes(query);
    });

    $("jobsList").innerHTML = filtered.map((job) => {
      const location = [job.location_city, job.workplace_type === "remote" ? "عن بُعد" : ""].filter(Boolean).join(" · ");
      const salary = salaryLabel(job);
      return `<article class="job-card">
        <div class="job-card-top">
          <div><h3>${escapeHtml(job.title)}</h3><p class="job-company">${escapeHtml(job.organization_name)}</p></div>
          <span class="job-specialty">${escapeHtml(SPECIALTIES[job.specialty] || "قطاع صحي")}</span>
        </div>
        <div class="job-meta">
          ${location ? `<span><i class="fa-solid fa-location-dot"></i>${escapeHtml(location)}</span>` : ""}
          <span><i class="fa-regular fa-clock"></i>${escapeHtml(EMPLOYMENT[job.employment_type] || "")}</span>
          <span><i class="fa-solid fa-building"></i>${escapeHtml(WORKPLACE[job.workplace_type] || "")}</span>
          ${salary ? `<span><i class="fa-solid fa-money-bill-wave"></i>${escapeHtml(salary)}</span>` : ""}
        </div>
        <p class="job-card-description">${escapeHtml(job.description)}</p>
        <div class="job-card-bottom">
          <span class="job-date">${job.published_at ? "نُشرت " + escapeHtml(formatDate(job.published_at)) : ""}</span>
          <a class="job-details-link" href="https://nutrition-3.vercel.app/jobs/${encodeURIComponent(job.id)}">التفاصيل والتقديم <i class="fa-solid fa-arrow-left"></i></a>
        </div>
      </article>`;
    }).join("");

    $("jobsEmpty").hidden = filtered.length > 0 || jobs.length === 0;
    if (jobs.length === 0) $("jobsEmpty").hidden = true;
    $("jobsCount").textContent = query || specialty
      ? `عرض ${filtered.length} من ${jobs.length} وظيفة محمّلة`
      : `تم تحميل ${jobs.length} وظيفة`;
    $("jobsLoadMore").hidden = !hasMore;
  }

  async function loadJobs(reset = false) {
    if (loading) {
      if (reset) reloadQueued = true;
      return;
    }
    if (!client) {
      showError("تعذر الاتصال بقاعدة البيانات. حاول تحديث الصفحة.");
      return;
    }
    if (reset) {
      offset = 0;
      hasMore = true;
      jobs = [];
    }
    if (!hasMore) return;

    loading = true;
    $("jobsLoadMore").disabled = true;
    $("jobsLoadMore").textContent = "جاري التحميل...";
    if (offset === 0) {
      $("jobsList").innerHTML = '<div class="jobs-state"><i class="fa-solid fa-spinner fa-spin"></i><p>جاري تحميل الوظائف...</p></div>';
    }
    try {
      let request = client.from("job_posts")
        .select("id,title,specialty,organization_name,location_city,employment_type,workplace_type,description,salary_min,salary_max,salary_currency,salary_period,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      const specialty = $("jobsSpecialty").value;
      if (specialty) request = request.eq("specialty", specialty);
      const search = $("jobsSearch").value.trim().replace(/[(),.*%_'"\\]/g, " ").replace(/\s+/g, " ").slice(0, 80);
      if (search) {
        const pattern = "%" + search + "%";
        request = request.or("title.ilike." + pattern + ",organization_name.ilike." + pattern + ",location_city.ilike." + pattern);
      }
      const { data, error } = await request;
      if (error) throw error;
      const rows = data || [];
      jobs = reset ? rows : jobs.concat(rows);
      offset += rows.length;
      hasMore = rows.length === PAGE_SIZE;
      render();
      if (!jobs.length) {
        $("jobsList").innerHTML = "";
        $("jobsEmpty").hidden = false;
        $("jobsEmpty").querySelector("p").textContent = $("jobsSearch").value.trim() || $("jobsSpecialty").value
          ? "لا توجد وظائف مطابقة لبحثك أو التخصص المحدد."
          : "لا توجد وظائف منشورة حاليًا.";
      }
    } catch (error) {
      console.error("Public jobs load failed:", error);
      showError("تعذر تحميل الوظائف حاليًا. حاول مرة أخرى.");
    } finally {
      loading = false;
      $("jobsLoadMore").disabled = false;
      $("jobsLoadMore").innerHTML = 'عرض المزيد <i class="fa-solid fa-chevron-down"></i>';
      if (reloadQueued) {
        reloadQueued = false;
        loadJobs(true);
      }
    }
  }

  function showError(message) {
    $("jobsList").innerHTML = "";
    $("jobsEmpty").hidden = false;
    $("jobsEmpty").querySelector("p").textContent = message;
    $("jobsCount").textContent = "";
  }

  $("jobsSearch").addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => loadJobs(true), 300);
  });
  $("jobsSpecialty").addEventListener("change", () => loadJobs(true));
  $("jobsLoadMore").addEventListener("click", () => loadJobs(false));
  loadJobs(true);
})();