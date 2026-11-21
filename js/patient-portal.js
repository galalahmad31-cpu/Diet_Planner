(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, patient: null, patientId: null, logs: [], busy: false, hasActiveCareTeam: false, loadedPanels: new Set(), loadingPanels: new Map() };

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
    void ensureHealthPanelLoaded(panelId);
  }

  async function ensureHealthPanelLoaded(panelId) {
    if (state.loadedPanels.has(panelId)) return;
    if (state.loadingPanels.has(panelId)) return state.loadingPanels.get(panelId);
    const loaders = {
      portalPlansPanel: loadPlans,
      portalMeasurementsPanel: loadMeasurements,
      portalAppointmentsPanel: loadSubscriptionFollowUp,
      portalCommunicationPanel: loadProfessionalRequests
    };
    const loader = loaders[panelId];
    if (!loader) return;
    const task = (async () => {
      try {
        await loader();
        state.loadedPanels.add(panelId);
      } catch (error) {
        console.error("Patient portal panel load failed:", panelId, error);
        const message = error?.message || "تعذر تحميل هذا القسم.";
        const targets = {
          portalPlansPanel: "portalPlansLoading",
          portalMeasurementsPanel: "portalMeasurementsRows",
          portalAppointmentsPanel: "portalFollowUpError",
          portalCommunicationPanel: "patientProfessionalRequests"
        };
        const target = $(targets[panelId]);
        if (target) {
          target.textContent = message;
          target.hidden = false;
        }
      } finally {
        state.loadingPanels.delete(panelId);
      }
    })();
    state.loadingPanels.set(panelId, task);
    return task;
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
    window.DietPlannerWeightLogs?.render({
      tbody: $("portalMeasurementsRows"),
      logs: state.logs.map(log => ({
        id: log.id, created_by: log.created_by, date: log.measurement_date, weight: log.weight,
        bodyFat: log.body_fat_percent, muscle: log.muscle_percent,
        water: log.water_percent, waist: log.waist_cm, hip: log.hip_cm,
        adherence: log.diet_adherence, notes: log.notes
      })),
      actionCell: log => log.created_by === state.user?.id
        ? `<div class="measurement-row-actions">
            <button type="button" class="measurement-edit-button" data-edit-measurement="${escapeHtml(log.id)}">تعديل</button>
            <button type="button" class="measurement-delete-button" data-delete-measurement="${escapeHtml(log.id)}">حذف</button>
          </div>`
        : '<span class="portal-measurement-readonly">سجل المختص</span>'
    });
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
    if (!loading || !empty || !list || !state.patientId) return;

    loading.hidden = false;
    empty.hidden = true;
    list.replaceChildren();

    try {
      // One relational request replaces the previous publication -> plans ->
      // days -> meals -> items -> food-name request chain.
      const { data: plans, error } = await supabase
        .from("nutrition_plans")
        .select(`
          id,patient_id,plan_name,start_date,notes,created_at,updated_at,
          publication:patient_plan_publications!inner(published_at,revoked_at),
          days:plan_days(
            id,plan_id,day_number,day_name,notes,
            meals:plan_meals(
              id,day_id,meal_name,meal_order,frequency,
              items:plan_items(
                id,meal_id,food_id,item_name,quantity_g,household_measure,frequency,notes,
                food:foods(name_ar)
              )
            )
          )
        `)
        .eq("patient_id", state.patientId)
        .is("patient_plan_publications.revoked_at", null);

      if (error) throw error;

      const orderedPlans = (plans || []).slice().sort((a, b) => {
        const publicationDate = plan => {
          const publication = Array.isArray(plan.publication)
            ? plan.publication[0]
            : plan.publication;
          return publication?.published_at || plan.updated_at || plan.created_at || "";
        };
        return new Date(publicationDate(b)).getTime() - new Date(publicationDate(a)).getTime();
      });

      if (!orderedPlans.length) {
        empty.hidden = false;
        return;
      }

      list.innerHTML = orderedPlans.map(plan => {
        const planDays = Array.isArray(plan.days) ? plan.days.slice().sort(
          (a, b) => Number(a.day_number || 0) - Number(b.day_number || 0)
        ) : [];
        const planDate = plan.start_date
          ? "تاريخ البداية: " + escapeHtml(formatDate(plan.start_date))
          : "تمت مشاركتها معك";

        const dayMarkup = planDays.map(day => {
          const dayMeals = Array.isArray(day.meals) ? day.meals.slice().sort(
            (a, b) => Number(a.meal_order || 0) - Number(b.meal_order || 0)
          ) : [];
          const mealsMarkup = dayMeals.map(meal => {
            const mealItems = Array.isArray(meal.items) ? meal.items : [];
            const foodMarkup = mealItems.length ? mealItems.map(item => {
              const itemName = item.item_name || item.food?.name_ar || "صنف غذائي";
              return `<div class="portal-food-row">
                <span class="portal-food-name">${escapeHtml(itemName)}${item.notes ? '<small>' + escapeHtml(item.notes) + '</small>' : ''}</span>
                <span class="portal-food-quantity">${escapeHtml(optionalNumber(item.quantity_g, " جم"))}</span>
                <span class="portal-food-household">${escapeHtml(item.household_measure || "—")}</span>
              </div>`;
            }).join("") : '<p class="portal-plan-empty-meal">لا توجد أصناف مسجلة لهذه الوجبة.</p>';

            return `<section class="portal-meal">
              <h4 class="portal-meal-title">${escapeHtml(meal.meal_name || "وجبة")}${meal.frequency ? '<small>' + escapeHtml(meal.frequency) + '</small>' : ''}</h4>
              <div class="portal-food-table" role="table" aria-label="أصناف ${escapeHtml(meal.meal_name || "الوجبة")}">
                <div class="portal-food-row portal-food-row-head" role="row"><span role="columnheader">الصنف</span><span role="columnheader">الكمية</span><span role="columnheader">المقياس المنزلي</span></div>
                ${foodMarkup}
              </div>
            </section>`;
          }).join("");

          return `<section class="portal-plan-day">
            <h3>${escapeHtml(day.day_name || ("اليوم " + day.day_number))}</h3>
            ${day.notes ? '<p class="portal-plan-day-note">' + escapeHtml(day.notes) + '</p>' : ""}
            ${mealsMarkup || '<p class="portal-plan-empty-meal">لا توجد وجبات مسجلة لهذا اليوم.</p>'}
          </section>`;
        }).join("");

        const fallbackNotes = plan.notes
          ? '<p class="portal-plan-note">' + escapeHtml(plan.notes).replace(/\\n/g, "<br>") + '</p>'
          : "";
        const content = planDays.length
          ? dayMarkup
          : '<p class="portal-plan-empty-meal">لا توجد أيام مسجلة في هذه الخطة.</p>';

        return `<details class="portal-plan-card">
          <summary class="portal-plan-summary">
            <span class="portal-plan-summary-copy">
              <strong>${escapeHtml(plan.plan_name || "الخطة الغذائية")}</strong>
              <small>${planDate}</small>
            </span>
            <span class="portal-plan-summary-meta">
              <span class="portal-plan-status">منشورة</span>
              <span class="portal-plan-toggle" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>
            </span>
          </summary>
          <div class="portal-plan-content">
            ${fallbackNotes}
            ${content}
          </div>
        </details>`;
      }).join("");
    } catch (error) {
      list.replaceChildren();
      throw error;
    } finally {
      loading.hidden = true;
    }
  }

  async function loadProfessionalRequests(rootId = "patientProfessionalRequests") {
    const root = $(rootId);
    if (!root) return;
    const { data, error } = await supabase.rpc("list_my_professional_connection_requests");
    if (error) { root.textContent = "تعذر تحميل طلبات المحادثة."; return; }
    if (!data?.length) { root.textContent = "لم ترسل طلبات محادثة حتى الآن."; return; }
    const status = { pending: "طلب المحادثة قيد الانتظار", accepted: "المحادثة مفتوحة · بانتظار الاتفاق والدفع", active: "المتابعة نشطة", ended: "انتهت المتابعة", declined: "لم يتم قبول الطلب", cancelled: "ملغي" };
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

    const nextPatientId = account.patient_id;
    if (state.patientId !== nextPatientId) {
      state.loadedPanels.clear();
      state.loadingPanels.clear();
      state.logs = [];
    }
    state.patientId = nextPatientId;
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
      showOnly("portalContent");
      activateHealthTab("portalPlansPanel");
    } else {
      document.querySelectorAll("[data-health-tab]").forEach(tab => {
        tab.hidden = tab.dataset.healthTab !== "portalCommunicationPanel";
      });
      ["portalPlansPanel", "portalMeasurementsPanel", "portalAppointmentsPanel"].forEach(id => {
        const panel = $(id);
        if (panel) panel.hidden = true;
      });
      showOnly("portalContent");
      activateHealthTab("portalCommunicationPanel");
    }

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
