(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, patient: null, patientId: null, logs: [], busy: false, hasActiveCareTeam: false };

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
    if (!state.hasActiveCareTeam && panelId !== "portalCommunicationPanel") return;
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

  function measurementDelta(value) {
    if (!Number.isFinite(value)) return { value: "—", note: "لا توجد بيانات كافية", trend: "neutral" };
    if (Math.abs(value) < 0.05) return { value: "0.0 كجم", note: "لا يوجد تغير", trend: "neutral" };
    const amount = Math.abs(value).toFixed(1);
    return value > 0
      ? { value: "+" + amount + " كجم", note: "زيادة في الوزن", trend: "up" }
      : { value: "−" + amount + " كجم", note: "انخفاض في الوزن", trend: "down" };
  }

  function renderMeasurementSummary() {
    const logs = state.logs;
    const valid = logs.filter(log => Number.isFinite(Number(log.weight)) && Number(log.weight) > 0);
    const first = valid[0], latest = valid[valid.length - 1], previous = valid[valid.length - 2];
    const overall = first && latest ? measurementDelta(Number(latest.weight) - Number(first.weight)) : null;
    const recent = previous && latest ? measurementDelta(Number(latest.weight) - Number(previous.weight)) : null;
    const set = (id, value, note, trend) => {
      const node = $(id); if (!node) return;
      node.textContent = value || "—";
      node.dataset.trend = trend || "neutral";
      const noteNode = $(id + "Note"); if (noteNode) noteNode.textContent = note || "";
    };
    set("portalWeightChangeOverall", overall?.value, overall ? (valid.length > 1 ? overall.note : "هذا هو القياس المسجل الأول") : "لا توجد قياسات مسجلة", overall?.trend);
    set("portalWeightChangeRecent", recent?.value, recent?.note || "يلزم تسجيل قياسين على الأقل", recent?.trend);
    const heightCm = Number(state.patient?.height);
    const bmi = latest && heightCm > 0 ? Number(latest.weight) / Math.pow(heightCm / 100, 2) : NaN;
    set("portalLatestBmi", Number.isFinite(bmi) ? bmi.toFixed(1) : "—",
      Number.isFinite(bmi) ? "بناءً على آخر وزن والطول المسجل" : "يلزم تسجيل الطول والوزن لحساب BMI");
  }

  function renderMeasurements() {
    renderMeasurementSummary();
    const tbody = $("portalMeasurementsRows");
    if (!tbody) return;
    if (!state.logs.length) {
      tbody.innerHTML = '<tr><td colspan="10">لا توجد قياسات مسجلة لهذا المريض.</td></tr>';
      return;
    }
    const adherence = { excellent: "ممتاز", good: "جيد", fair: "متوسط", poor: "ضعيف" };
    tbody.innerHTML = state.logs.map(log => {
      const canManage = log.created_by === state.user?.id;
      return `<tr>
        <td>${escapeHtml(formatDate(log.measurement_date))}</td>
        <td><strong>${escapeHtml(optionalNumber(log.weight, " كجم"))}</strong></td>
        <td>${escapeHtml(optionalNumber(log.body_fat_percent, "%"))}</td>
        <td>${escapeHtml(optionalNumber(log.muscle_percent, "%"))}</td>
        <td>${escapeHtml(optionalNumber(log.water_percent, "%"))}</td>
        <td>${escapeHtml(optionalNumber(log.waist_cm, " سم"))}</td>
        <td>${escapeHtml(optionalNumber(log.hip_cm, " سم"))}</td>
        <td>${escapeHtml(adherence[log.diet_adherence] || "—")}</td>
        <td class="portal-measurement-notes">${escapeHtml(log.notes || "—")}</td>
        <td>${canManage ? `<div class="portal-measurement-row-actions"><button type="button" data-edit-measurement="${escapeHtml(log.id)}">تعديل</button><button type="button" data-delete-measurement="${escapeHtml(log.id)}">حذف</button></div>` : '<span class="portal-measurement-readonly">سجل المختص</span>'}</td>
      </tr>`;
    }).join("");
  }

  async function loadMeasurements() {
    const { data, error } = await supabase.from("weight_logs")
      .select("id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at,created_by")
      .eq("patient_id", state.patientId)
      .order("measurement_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    state.logs = data || [];
    renderMeasurements();
  }

  function resetMeasurementForm() {
    $("portalMeasurementForm")?.reset();
    $("portalEditingMeasurementId").value = "";
    $("portalMeasurementDate").value = localToday();
    $("portalSaveMeasurement").innerHTML = '<i class="fa-solid fa-plus"></i> حفظ القياس';
    $("portalCancelMeasurementEdit").hidden = true;
  }

  function editPatientMeasurement(id) {
    const log = state.logs.find(item => String(item.id) === String(id));
    if (!log || log.created_by !== state.user?.id) return;
    const values = {
      portalWeight: log.weight, portalMeasurementDate: log.measurement_date,
      portalBodyFat: log.body_fat_percent, portalMuscle: log.muscle_percent,
      portalWater: log.water_percent, portalWaist: log.waist_cm, portalHip: log.hip_cm,
      portalAdherence: log.diet_adherence, portalMeasurementNotes: log.notes
    };
    Object.entries(values).forEach(([id, value]) => { $(id).value = value ?? ""; });
    $("portalEditingMeasurementId").value = log.id;
    $("portalSaveMeasurement").textContent = "حفظ التعديلات";
    $("portalCancelMeasurementEdit").hidden = false;
    $("portalMeasurementForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function deletePatientMeasurement(id, button) {
    const log = state.logs.find(item => String(item.id) === String(id));
    if (!log || log.created_by !== state.user?.id || state.busy) return;
    if (!window.confirm("هل تريد حذف القياس الذي سجلته؟ لا يمكن التراجع عن الحذف.")) return;
    state.busy = true; button.disabled = true;
    try {
      const { error } = await supabase.from("weight_logs").delete()
        .eq("id", log.id).eq("patient_id", state.patientId).eq("created_by", state.user.id);
      if (error) throw error;
      state.logs = state.logs.filter(item => item.id !== log.id);
      renderMeasurements();
      setMessage("portalMeasurementMessage", "تم حذف القياس.", "success");
    } catch (error) {
      console.error("Patient measurement delete failed:", error);
      setMessage("portalMeasurementMessage", error.message || "تعذر حذف القياس.", "error");
    } finally { state.busy = false; button.disabled = false; }
  }


  async function loadSubscriptionFollowUp() {
    const loading = $("portalFollowUpLoading");
    const errorBox = $("portalFollowUpError");
    const empty = $("portalFollowUpEmpty");
    const content = $("portalFollowUpContent");
    if (loading) loading.hidden = false;
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ""; }
    if (empty) empty.hidden = true;
    if (content) content.hidden = true;
    try {
      // A narrow RPC returns only the three dates; it does not expose finance amounts.
      const { data, error } = await supabase.rpc("get_patient_subscription_follow_up");
      if (error) throw error;
      const record = Array.isArray(data) ? data[0] : data;
      if (!record) {
        if (empty) empty.hidden = false;
        return;
      }
      $("portalSubscriptionStart").textContent = formatDate(record.subscription_start_date);
      $("portalSubscriptionEnd").textContent = formatDate(record.subscription_end_date);
      $("portalNextFollowUp").textContent = formatDate(record.next_follow_up_date);
      const hint = $("portalFollowUpHint");
      if (hint) {
        if (!record.next_follow_up_date) hint.textContent = "لم يحدد المختص موعد المتابعة القادمة بعد";
        else {
          const today = localToday();
          hint.textContent = record.next_follow_up_date < today
            ? "موعد المتابعة المحدد قد مضى؛ تواصل مع مختصك لتحديثه"
            : "يحدده المختص المسؤول عن ملفك";
        }
      }
      if (content) content.hidden = false;
    } catch (error) {
      console.error("Patient subscription/follow-up load failed:", error);
      if (errorBox) {
        errorBox.textContent = error.message || "تعذر تحميل بيانات الاشتراك والمتابعة.";
        errorBox.hidden = false;
      }
    } finally {
      if (loading) loading.hidden = true;
    }
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

  async function loadProfessionalRequests(rootId = "patientProfessionalRequests") {
    const root = $(rootId);
    if (!root) return;
    const { data, error } = await supabase.rpc("list_my_professional_connection_requests");
    if (error) { root.textContent = "تعذر تحميل طلبات المحادثة."; return; }
    if (!data?.length) { root.textContent = "لم ترسل طلبات محادثة حتى الآن."; return; }
    const status = { pending: "طلب المحادثة قيد الانتظار", accepted: "المحادثة مفتوحة · بانتظار الاتفاق والدفع", active: "المتابعة نشطة", declined: "لم يتم قبول الطلب", cancelled: "ملغي" };
    root.className = "portal-plans-list";
    root.innerHTML = data.map(item => `<article class="portal-plan-card"><div class="portal-plan-head"><div><strong>${escapeHtml(item.professional_name || "مختص")}</strong><small>${escapeHtml(item.professional_title || "")}</small></div><span class="portal-plan-status">${escapeHtml(status[item.status] || item.status)}</span></div>${item.status === "pending" ? `<button type="button" class="portal-primary-button" data-cancel-professional-request="${escapeHtml(item.request_id)}">إلغاء الطلب</button>` : ""}</article>`).join("");
    root.querySelectorAll("[data-cancel-professional-request]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("هل تريد إلغاء طلب المحادثة؟")) return;
      button.disabled = true;
      const { error: cancelError } = await supabase.rpc("cancel_professional_connection_request", { p_request_id: button.dataset.cancelProfessionalRequest });
      if (cancelError) { button.disabled = false; root.dataset.error = cancelError.message; return; }
      await loadProfessionalRequests(rootId);
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
      await loadProfessionalRequests("patientProfessionalRequestsUnlinked");
      showOnly("portalUnlinked");
      return;
    }

    state.patientId = account.patient_id;
    const { data: careLinks, error: careError } = await supabase
      .from("patient_care_team")
      .select("id")
      .eq("patient_id", state.patientId)
      .eq("status", "active")
      .limit(1);
    if (careError) throw careError;
    state.hasActiveCareTeam = Boolean(careLinks?.length);

    await loadPatient();
    if (state.hasActiveCareTeam) {
      document.querySelectorAll("[data-health-tab]").forEach(tab => { tab.hidden = false; });
      await Promise.all([loadMeasurements(), loadPlans(), loadProfessionalRequests(), loadSubscriptionFollowUp()]);
      activateHealthTab("portalPlansPanel");
    } else {
      document.querySelectorAll("[data-health-tab]").forEach(tab => {
        tab.hidden = tab.dataset.healthTab !== "portalCommunicationPanel";
      });
      ["portalPlansPanel", "portalMeasurementsPanel", "portalAppointmentsPanel"].forEach(id => {
        const panel = $(id);
        if (panel) panel.hidden = true;
      });
      await loadProfessionalRequests();
      activateHealthTab("portalCommunicationPanel");
    }

    showOnly("portalContent");
    void window.DietPlannerPatientMessages?.mount($("patientPortalMessages"), {
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
    const read = id => $(id).value.trim();
    const number = id => read(id) === "" ? null : Number(read(id));
    const record = {
      patient_id: state.patientId, weight: number("portalWeight"),
      measurement_date: read("portalMeasurementDate"),
      body_fat_percent: number("portalBodyFat"), muscle_percent: number("portalMuscle"),
      water_percent: number("portalWater"), waist_cm: number("portalWaist"),
      hip_cm: number("portalHip"), diet_adherence: read("portalAdherence") || null,
      notes: read("portalMeasurementNotes") || null
    };
    const percentValid = value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
    if (!record.measurement_date || !Number.isFinite(record.weight) || record.weight <= 0) {
      setMessage("portalMeasurementMessage", "أدخل تاريخ القياس والوزن بصورة صحيحة.", "error"); return;
    }
    if (![record.body_fat_percent,record.muscle_percent,record.water_percent].every(percentValid)) {
      setMessage("portalMeasurementMessage", "النسب المئوية يجب أن تكون بين 0 و100%.", "error"); return;
    }
    if ([record.waist_cm,record.hip_cm].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) {
      setMessage("portalMeasurementMessage", "محيطات الجسم يجب أن تكون أكبر من صفر.", "error"); return;
    }
    const editingId = $("portalEditingMeasurementId").value;
    const button = $("portalSaveMeasurement");
    state.busy = true; button.disabled = true;
    setMessage("portalMeasurementMessage", editingId ? "جاري تحديث القياس..." : "جاري حفظ القياس...");
    try {
      const query = editingId
        ? supabase.from("weight_logs").update(record).eq("id", editingId).eq("patient_id", state.patientId).eq("created_by", state.user.id)
        : supabase.from("weight_logs").insert(record);
      const { error } = await query;
      if (error) throw error;
      resetMeasurementForm();
      await loadMeasurements();
      setMessage("portalMeasurementMessage", editingId ? "تم تحديث القياس بنجاح." : "تم حفظ القياس بنجاح.", "success");
    } catch (error) {
      console.error("Patient measurement save failed:", error);
      setMessage("portalMeasurementMessage", error.message || "تعذر حفظ القياس. تحقق من صلاحيات قاعدة البيانات.", "error");
    } finally { state.busy = false; button.disabled = false; }
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
    document.querySelector("[data-open-patient-messages]")?.addEventListener("click", () => {
      activateHealthTab("portalCommunicationPanel");
      $("patientPortalMessages")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.querySelectorAll("[data-health-tab]").forEach(tab => tab.addEventListener("click", () => activateHealthTab(tab.dataset.healthTab)));
    const initialSection = window.location.hash.slice(1);
    const patientSections = new Set([
      "portalHome",
      "portalContent",
      "portalDietBuilder",
      "portalEducation",
      "portalTools",
      "portalProfileArea"
    ]);
    if (initialSection !== "portalProfileArea") {
      loadSelfProfile().catch(error => {
        console.error("Patient profile load failed:", error);
        setMessage("selfProfileMessage", "تعذر تحميل بيانات الحساب.", "error");
      });
    }
    $("portalMeasurementForm")?.addEventListener("submit", handleMeasurementSubmit);
    $("portalCancelMeasurementEdit")?.addEventListener("click", resetMeasurementForm);
    $("portalMeasurementsRows")?.addEventListener("click", event => {
      const edit = event.target.closest("[data-edit-measurement]");
      const remove = event.target.closest("[data-delete-measurement]");
      if (edit) editPatientMeasurement(edit.dataset.editMeasurement);
      else if (remove) void deletePatientMeasurement(remove.dataset.deleteMeasurement, remove);
    });
    $("portalMeasurementDate").value = localToday();
    $("portalThemeToggle")?.addEventListener("click", () => {
      if (window.DietPlannerTheme?.toggle) window.DietPlannerTheme.toggle();
    });
    $("portalHome")?.querySelector("[data-portal-open-health]")?.addEventListener("click", openHealthArea);
    if (new URLSearchParams(window.location.search).has("invite")) {
      openHealthArea();
    } else if (patientSections.has(initialSection)) {
      await window.DietPlannerPatientPortal.navigateToSection(initialSection);
    }
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
