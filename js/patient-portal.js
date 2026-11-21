(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, patient: null, patientId: null, logs: [], busy: false };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }

  function setMessage(id, message, type = "") {
    const node = $(id);
    if (!node) return;
    node.textContent = message || "";
    node.className = "portal-inline-message" + (type ? " is-" + type : "");
  }

  function showOnly(id) {
    ["portalLoading", "portalError", "portalUnlinked"].forEach(key => { if ($(key)) $(key).hidden = key !== id; });
    if ($("portalContent")) $("portalContent").hidden = id !== "portalContent";
  }

  function openHealthArea() {
    $("portalHome").hidden = true;
    $("portalHealthArea").hidden = false;
    loadPortal().catch(error => {
      console.error("Patient health area load failed:", error);
      fail(error.message || "تعذر تحميل الملف الصحي.");
    });
  }

  function fail(message) {
    $("portalErrorText").textContent = message;
    showOnly("portalError");
  }

  function localToday() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value + "T00:00:00");
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ar-EG");
  }

  function optionalNumber(value, suffix = "") {
    return value === null || value === undefined || value === "" ? "—" : Number(value).toLocaleString("ar-EG", { maximumFractionDigits: 1 }) + suffix;
  }

  async function loadSelfProfile() {
    const { data, error } = await supabase.from("profiles")
      .select("full_name,email,phone,account_type")
      .eq("id", state.user.id).maybeSingle();
    if (error) throw error;
    const profile = data || {};
    $("selfProfileName").value = profile.full_name || state.user.user_metadata?.full_name || "";
    $("selfProfilePhone").value = profile.phone || "";
    $("selfProfileEmail").value = profile.email || state.user.email || "";
    $("selfProfileType").value = profile.account_type === "patient" ? "مريض" : "حساب مريض";
    $("portalWelcomeName") && ($("portalWelcomeName").textContent = profile.full_name || "مرحبًا بك");
  }

  async function saveSelfProfile(event) {
    event.preventDefault();
    const form = $("patientSelfProfileForm");
    const button = form.querySelector('button[type="submit"]');
    const fullName = $("selfProfileName").value.trim();
    const phone = $("selfProfilePhone").value.trim();
    if (fullName.length < 2 || fullName.length > 120) {
      setMessage("selfProfileMessage", "يرجى إدخال اسم صحيح (2 إلى 120 حرفًا).", "error");
      return;
    }
    if (phone.length > 25) {
      setMessage("selfProfileMessage", "رقم الهاتف أطول من المسموح.", "error");
      return;
    }
    button.disabled = true;
    setMessage("selfProfileMessage", "جاري حفظ البيانات...");
    try {
      const { error } = await supabase.from("profiles")
        .update({ full_name: fullName, phone: phone || null })
        .eq("id", state.user.id);
      if (error) throw error;
      setMessage("selfProfileMessage", "تم تحديث بيانات حسابك بنجاح.", "success");
      if ($("portalPatientName")) $("portalPatientName").textContent = fullName;
    } catch (error) {
      console.error("Patient self profile update failed:", error);
      setMessage("selfProfileMessage", error.message || "تعذر حفظ البيانات.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function activateHealthTab(panelId) {
    const allowed = ["portalPlansPanel", "portalMeasurementsPanel", "portalAppointmentsPanel", "portalCommunicationPanel"];
    if (!allowed.includes(panelId)) return;
    document.querySelectorAll("[data-health-tab]").forEach(tab => {
      const active = tab.dataset.healthTab === panelId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    allowed.forEach(id => { const panel = $(id); if (panel) panel.hidden = id !== panelId; });
  }

  function showPortalDestination(id) {
    const home = $("portalHome"), health = $("portalHealthArea"), profile = $("portalProfileArea");
    if (home) home.hidden = !["portalHome", "portalDietBuilder", "portalEducation", "portalTools"].includes(id);
    if (health) health.hidden = id !== "portalContent" && !["portalPlansPanel","portalMeasurementsPanel","portalAppointmentsPanel","portalCommunicationPanel"].includes(id);
    if (profile) profile.hidden = id !== "portalProfileArea";
    if (health && !health.hidden) {
      if (id === "portalContent") activateHealthTab("portalPlansPanel");
      else if (id.startsWith("portal")) activateHealthTab(id);
    }
    if (["portalDietBuilder","portalEducation","portalTools"].includes(id)) {
      const target = $(id);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const target = id === "portalContent" ? health : id === "portalProfileArea" ? profile : $(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function getPatientAccount() {
    const { data, error } = await supabase
      .from("patient_accounts")
      .select("patient_id")
      .eq("user_id", state.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function acceptInvitation(token) {
    const cleanToken = String(token || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanToken)) {
      throw new Error("رمز الدعوة غير صحيح. تأكد من نسخ الرمز كاملًا.");
    }
    const { error } = await supabase.rpc("accept_patient_invitation", { p_token: cleanToken });
    if (error) throw error;
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  async function loadPatient() {
    const { data, error } = await supabase
      .from("patients")
      .select("id,name,gender,birth_date,age,height,diagnosis")
      .eq("id", state.patientId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("لم نتمكن من الوصول إلى ملفك الصحي المرتبط. تواصل مع مختصك.");
    state.patient = data;
    $("portalPatientName").textContent = data.name || "مرحبًا بك";
    $("portalHeight").textContent = optionalNumber(data.height, " سم");
    $("portalAge").textContent = optionalNumber(data.age, " سنة");
    $("portalDiagnosis").textContent = data.diagnosis || "غير مسجل";
  }

  async function loadMeasurements() {
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id,weight,measurement_date,waist_cm,hip_cm,body_fat_percent,notes")
      .eq("patient_id", state.patientId)
      .order("measurement_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.logs = data || [];
    renderMeasurements();
  }

  function renderMeasurements() {
    const tbody = $("portalMeasurementsRows");
    if (!tbody) return;
    if (!state.logs.length) {
      tbody.innerHTML = '<tr><td colspan="5">لم تسجل قياسات بعد. أضف أول قياس من النموذج أعلاه.</td></tr>';
      return;
    }
    tbody.innerHTML = state.logs.map(log => `
      <tr>
        <td>${escapeHtml(formatDate(log.measurement_date))}</td>
        <td><strong>${escapeHtml(optionalNumber(log.weight, " كجم"))}</strong></td>
        <td>${escapeHtml(optionalNumber(log.waist_cm, " سم"))}</td>
        <td>${escapeHtml(optionalNumber(log.hip_cm, " سم"))}</td>
        <td>${escapeHtml(optionalNumber(log.body_fat_percent, "%"))}</td>
      </tr>`).join("");
  }

  async function loadPlans() {
    const loading = $("portalPlansLoading");
    const empty = $("portalPlansEmpty");
    const list = $("portalPlansList");
    loading.hidden = false;
    empty.hidden = true;
    list.replaceChildren();

    try {
      // The publication table is the source of truth: never show a plan just
      // because it belongs to this patient; it must currently be published.
      const { data: publications, error: publicationError } = await supabase
        .from("patient_plan_publications")
        .select("plan_id,published_at")
        .is("revoked_at", null)
        .order("published_at", { ascending: false });
      if (publicationError) throw publicationError;

      const publishedPlanIds = [...new Set((publications || []).map(row => row.plan_id).filter(Boolean))];
      if (!publishedPlanIds.length) {
        loading.hidden = true;
        empty.hidden = false;
        return;
      }

      const { data: plans, error: plansError } = await supabase
        .from("nutrition_plans")
        .select("id,plan_name,start_date,notes,created_at,updated_at")
        .in("id", publishedPlanIds);
      if (plansError) throw plansError;

      const publicationOrder = new Map();
      (publications || []).forEach(row => {
        if (row.plan_id && !publicationOrder.has(row.plan_id)) publicationOrder.set(row.plan_id, row.published_at);
      });
      const orderedPlans = (plans || []).sort((a, b) =>
        new Date(publicationOrder.get(b.id) || b.updated_at || b.created_at) -
        new Date(publicationOrder.get(a.id) || a.updated_at || a.created_at)
      );

      if (!orderedPlans.length) {
        loading.hidden = true;
        empty.hidden = false;
        return;
      }

      const planIds = orderedPlans.map(plan => plan.id);
      const { data: days, error: daysError } = await supabase
        .from("plan_days")
        .select("id,plan_id,day_number,day_name,notes")
        .in("plan_id", planIds)
        .order("day_number", { ascending: true });
      if (daysError) throw daysError;

      const dayIds = (days || []).map(day => day.id);
      let meals = [];
      if (dayIds.length) {
        const result = await supabase.from("plan_meals")
          .select("id,day_id,meal_name,meal_order,frequency")
          .in("day_id", dayIds)
          .order("meal_order", { ascending: true });
        if (result.error) throw result.error;
        meals = result.data || [];
      }

      const mealIds = meals.map(meal => meal.id);
      let items = [];
      if (mealIds.length) {
        const result = await supabase.from("plan_items")
          .select("id,meal_id,item_name,quantity_g,household_measure,frequency,notes")
          .in("meal_id", mealIds);
        if (result.error) throw result.error;
        items = result.data || [];
      }

      const mealsByDay = new Map();
      meals.forEach(meal => {
        const bucket = mealsByDay.get(meal.day_id) || [];
        bucket.push(meal);
        mealsByDay.set(meal.day_id, bucket);
      });
      const itemsByMeal = new Map();
      items.forEach(item => {
        const bucket = itemsByMeal.get(item.meal_id) || [];
        bucket.push(item);
        itemsByMeal.set(item.meal_id, bucket);
      });
      const daysByPlan = new Map();
      (days || []).forEach(day => {
        const bucket = daysByPlan.get(day.plan_id) || [];
        bucket.push(day);
        daysByPlan.set(day.plan_id, bucket);
      });

      list.innerHTML = orderedPlans.map(plan => {
        const planDays = daysByPlan.get(plan.id) || [];
        const planDate = plan.start_date
          ? "تاريخ البداية: " + escapeHtml(formatDate(plan.start_date))
          : "تمت مشاركتها معك";

        // Exchange-based plans are stored as notes + exchange_values and do
        // not use the day/meal/item structure. Patients only need the
        // professional's written instructions, never exchange counts.
        if (!planDays.length) {
          return `<article class="portal-plan-card">
            <div class="portal-plan-head">
              <div><strong>${escapeHtml(plan.plan_name || "الخطة الغذائية")}</strong><small>${planDate}</small></div>
              <span class="portal-plan-status">منشورة</span>
            </div>
            <p class="portal-plan-note"><strong>ملاحظات المختص:</strong><br>${plan.notes ? escapeHtml(plan.notes).replace(/\n/g, "<br>") : "لم يضف المختص ملاحظات لهذه الخطة."}</p>
          </article>`;
        }

        const dayMarkup = planDays.map(day => {
          const dayMeals = mealsByDay.get(day.id) || [];
          const mealsMarkup = dayMeals.map(meal => {
            const mealItems = itemsByMeal.get(meal.id) || [];
            const foodMarkup = mealItems.length ? mealItems.map(item => `
              <div class="portal-food-row">
                <span>${escapeHtml(item.item_name || "صنف غذائي")}${item.notes ? " — " + escapeHtml(item.notes) : ""}</span>
                <strong>${escapeHtml(optionalNumber(item.quantity_g, " جم"))}${item.household_measure ? " · " + escapeHtml(item.household_measure) : ""}</strong>
              </div>`).join("") : '<div class="portal-food-row"><span>لا توجد أصناف مسجلة لهذه الوجبة.</span></div>';
            return `<div class="portal-meal"><div class="portal-meal-title">${escapeHtml(meal.meal_name)}${meal.frequency ? " · " + escapeHtml(meal.frequency) : ""}</div><div class="portal-food-list">${foodMarkup}</div></div>`;
          }).join("");
          return `<div class="portal-plan-day"><h4>${escapeHtml(day.day_name || ("اليوم " + day.day_number))}</h4>${day.notes ? '<p class="portal-plan-note">' + escapeHtml(day.notes) + '</p>' : ""}${mealsMarkup || '<p class="portal-plan-note">لا توجد وجبات مسجلة.</p>'}</div>`;
        }).join("");

        return `<article class="portal-plan-card">
          <div class="portal-plan-head">
            <div><strong>${escapeHtml(plan.plan_name || "الخطة الغذائية")}</strong><small>${planDate}</small></div>
            <span class="portal-plan-status">منشورة</span>
          </div>
          ${plan.notes ? '<p class="portal-plan-note">' + escapeHtml(plan.notes) + '</p>' : ""}
          ${dayMarkup}
        </article>`;
      }).join("");
      loading.hidden = true;
    } catch (error) {
      loading.hidden = true;
      throw error;
    }
  }

  async function loadProfessionalRequests() {
    const root = $("patientProfessionalRequests");
    if (!root) return;
    const { data, error } = await supabase.rpc("list_my_professional_connection_requests");
    if (error) { root.textContent = "تعذر تحميل طلبات المتابعة."; return; }
    if (!data?.length) { root.textContent = "لم ترسل طلبات متابعة حتى الآن."; return; }
    const status = { pending: "قيد الانتظار", accepted: "تم قبول الطلب", declined: "لم يتم قبول الطلب", cancelled: "ملغي" };
    root.className = "portal-plans-list";
    root.innerHTML = data.map(item => `<article class="portal-plan-card"><div class="portal-plan-head"><div><strong>${escapeHtml(item.professional_name || "مختص")}</strong><small>${escapeHtml(item.professional_title || "")}</small></div><span class="portal-plan-status">${escapeHtml(status[item.status] || item.status)}</span></div>${item.status === "pending" ? `<button type="button" class="portal-primary-button" data-cancel-professional-request="${escapeHtml(item.professional_id)}">إلغاء الطلب</button>` : ""}</article>`).join("");
    root.querySelectorAll("[data-cancel-professional-request]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("هل تريد إلغاء طلب المتابعة؟")) return;
      button.disabled = true;
      const { error: cancelError } = await supabase.rpc("cancel_professional_connection_request", { p_request_id: button.dataset.cancelProfessionalRequest });
      if (cancelError) { button.disabled = false; root.dataset.error = cancelError.message; return; }
      await loadProfessionalRequests();
    }));
  }

  async function loadPortal() {
    showOnly("portalLoading");
    const account = await getPatientAccount();
    if (!account?.patient_id) {
      const token = new URLSearchParams(window.location.search).get("invite");
      if (token) {
        try {
          await acceptInvitation(token);
          return loadPortal();
        } catch (error) {
          showOnly("portalUnlinked");
          $("portalInviteToken").value = token;
          setMessage("portalInviteMessage", error.message || "تعذر قبول الدعوة. تحقق من صلاحيتها.", "error");
          return;
        }
      }
      showOnly("portalUnlinked");
      return;
    }
    state.patientId = account.patient_id;
    await loadPatient();
    await Promise.all([loadMeasurements(), loadPlans(), loadProfessionalRequests()]);
    showOnly("portalContent");
    void window.DietPlannerPatientMessages?.mount($("patientPortalMessages"), {
      patientId: state.patientId,
      role: "patient"
    });
    void window.DietPlannerPatientAppointments?.mount($("patientPortalAppointments"), {
      patientId: state.patientId,
      role: "patient"
    });
  }

  async function handleInviteSubmit(event) {
    event.preventDefault();
    const input = $("portalInviteToken");
    const button = event.submitter || $("portalInviteForm").querySelector("button[type=submit]");
    const token = input.value.trim();
    button.disabled = true;
    setMessage("portalInviteMessage", "جاري التحقق من الدعوة...");
    try {
      await acceptInvitation(token);
      input.value = "";
      setMessage("portalInviteMessage", "تم ربط حسابك بنجاح.", "success");
      await loadPortal();
    } catch (error) {
      console.error("Invitation acceptance failed:", error);
      setMessage("portalInviteMessage", error.message || "تعذر قبول الدعوة.", "error");
      button.disabled = false;
    }
  }

  async function handleMeasurementSubmit(event) {
    event.preventDefault();
    if (state.busy || !state.patientId) return;
    const weight = Number($("portalWeight").value);
    const date = $("portalMeasurementDate").value;
    const waist = $("portalWaist").value;
    const hip = $("portalHip").value;
    const bodyFat = $("portalBodyFat").value;
    if (!Number.isFinite(weight) || weight <= 0 || !date) {
      setMessage("portalMeasurementMessage", "أدخل وزنًا صحيحًا وتاريخ القياس.", "error");
      return;
    }
    const button = $("portalMeasurementForm").querySelector('button[type="submit"]');
    state.busy = true;
    button.disabled = true;
    setMessage("portalMeasurementMessage", "جاري حفظ القياس...");
    const record = {
      patient_id: state.patientId,
      weight,
      measurement_date: date,
      waist_cm: waist ? Number(waist) : null,
      hip_cm: hip ? Number(hip) : null,
      body_fat_percent: bodyFat ? Number(bodyFat) : null,
      notes: $("portalMeasurementNotes").value.trim() || null
    };
    try {
      const { error } = await supabase.from("weight_logs").insert(record);
      if (error) throw error;
      $("portalMeasurementForm").reset();
      $("portalMeasurementDate").value = localToday();
      await loadMeasurements();
      setMessage("portalMeasurementMessage", "تم حفظ القياس بنجاح.", "success");
    } catch (error) {
      console.error("Patient measurement insert failed:", error);
      setMessage("portalMeasurementMessage", error.message || "تعذر حفظ القياس.", "error");
    } finally {
      state.busy = false;
      button.disabled = false;
    }
  }

  async function init() {
    if (!supabase || !access?.getCurrentUser) {
      fail("تعذر تهيئة الاتصال الآمن. أعد تحميل الصفحة.");
      return;
    }
    const user = await access.getCurrentUser();
    if (!user) {
      const next = window.location.pathname.split("/").pop() + window.location.search;
      window.location.replace("login.html?next=" + encodeURIComponent(next));
      return;
    }
    state.user = user;
    $("portalLogout")?.addEventListener("click", () => access.logout());
    $("portalRetry")?.addEventListener("click", () => loadPortal().catch(error => fail(error.message || "تعذر تحميل البيانات.")));
    $("portalInviteForm")?.addEventListener("submit", handleInviteSubmit);
    $("patientSelfProfileForm")?.addEventListener("submit", saveSelfProfile);
    document.querySelectorAll("[data-health-tab]").forEach(tab => tab.addEventListener("click", () => activateHealthTab(tab.dataset.healthTab)));
    loadSelfProfile().catch(error => {
      console.error("Patient profile load failed:", error);
      setMessage("selfProfileMessage", "تعذر تحميل بيانات الحساب.", "error");
    });
    $("portalMeasurementForm")?.addEventListener("submit", handleMeasurementSubmit);
    $("portalMeasurementDate").value = localToday();
    $("portalThemeToggle")?.addEventListener("click", () => {
      if (window.DietPlannerTheme?.toggle) window.DietPlannerTheme.toggle();
    });
    $("portalHome")?.querySelector("[data-portal-open-health]")?.addEventListener("click", openHealthArea);
    if (new URLSearchParams(window.location.search).has("invite")) openHealthArea();
  }

  window.DietPlannerPatientPortal = Object.freeze({
    async navigateToSection(id) {
      if (id === "portalContent" || ["portalPlansPanel","portalMeasurementsPanel","portalAppointmentsPanel","portalCommunicationPanel"].includes(id)) {
        if (!state.patientId || $("portalContent")?.hidden) {
          $("portalHome").hidden = true;
          $("portalHealthArea").hidden = false;
          try { await loadPortal(); }
          catch (error) { fail(error.message || "تعذر تحميل الملف الصحي."); return; }
          if ($("portalContent")?.hidden) return;
        }
      }
      if (id === "portalProfileArea") {
        try { await loadSelfProfile(); }
        catch (error) { setMessage("selfProfileMessage", error.message || "تعذر تحميل بيانات الحساب.", "error"); }
      }
      showPortalDestination(id);
    }
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
