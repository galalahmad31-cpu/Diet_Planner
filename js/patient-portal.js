(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, patient: null, patientId: null, logs: [], busy: false, hasActiveCareTeam: false, loadedPanels: new Set(), loadingPanels: new Map(), foods: null, foodsPromise: null, carbMeals: [{ id: "breakfast", name: "الفطور", items: [] }, { id: "lunch", name: "الغداء", items: [] }, { id: "dinner", name: "العشاء", items: [] }, { id: "snacks", name: "الوجبات الخفيفة", items: [] }], activeCarbMeal: null, selectedCarbFood: null };

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

    // Keep the selected panel's ancestors visible. Tabs live outside portalContent,
    // so a hidden parent would otherwise leave an active tab with a completely blank body.
    const healthArea = $("portalHealthArea");
    const content = $("portalContent");
    if (healthArea) healthArea.hidden = false;
    if (content) content.hidden = false;
    if ($("portalHome")) $("portalHome").hidden = true;

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
          portalMeasurementsPanel: "portalMeasurementsError",
          portalAppointmentsPanel: "portalFollowUpError",
          portalCommunicationPanel: "patientProfessionalRequests"
        };
        const target = $(targets[panelId]);
        if (target) {
          target.textContent = message;
          target.hidden = false;
          if (panelId === "portalMeasurementsPanel" && !target.querySelector("button")) {
            const retry = document.createElement("button");
            retry.type = "button";
            retry.id = "portalMeasurementsRetry";
            retry.className = "portal-primary-button";
            retry.textContent = "إعادة تحميل القياسات";
            retry.addEventListener("click", () => {
              state.loadedPanels.delete("portalMeasurementsPanel");
              void ensureHealthPanelLoaded("portalMeasurementsPanel");
            });
            target.append(" ", retry);
          }
        }
      } finally {
        state.loadingPanels.delete(panelId);
      }
    })();
    state.loadingPanels.set(panelId, task);
    return task;
  }

  function showPortalDestination(id) {
    const home = $("portalHome"), health = $("portalHealthArea"), profile = $("portalProfileArea"), tools = $("portalToolsPanel");
    const toolsOpen = id === "portalToolsPanel" || id === "portalTools";
    if (home) home.hidden = !["portalHome", "portalDietBuilder", "portalEducation"].includes(id) || toolsOpen;
    if (health) health.hidden = id !== "portalContent" && !["portalPlansPanel","portalMeasurementsPanel","portalAppointmentsPanel","portalCommunicationPanel"].includes(id);
    if (profile) profile.hidden = id !== "portalProfileArea";
    if (tools) tools.hidden = !toolsOpen;
    if (health && !health.hidden) {
      if (id === "portalContent") activateHealthTab("portalPlansPanel");
      else if (id.startsWith("portal")) activateHealthTab(id);
    }
    if (toolsOpen) {
      void ensurePatientFoods().then(() => { renderCarbMeals(); renderRenalFoods(); }).catch(error => showToolsLoadError(error));
      tools?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (["portalDietBuilder","portalEducation"].includes(id)) {
      $(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    const tableRenderer = window.DietPlannerWeightLogs;
    if (!tableRenderer || typeof tableRenderer.render !== "function") {
      throw new Error("تعذر تحميل مكوّن جدول القياسات. حدّث الصفحة وحاول مرة أخرى.");
    }
    tableRenderer.render({
      container: $("portalMeasurementsTable"),
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
    const loading = $("portalMeasurementsLoading");
    const errorBox = $("portalMeasurementsError");
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ""; }

    // Render the shared table immediately; database latency must not leave this panel blank.
    renderMeasurements();
    if (loading) loading.hidden = false;
    try {
      const { data, error } = await supabase.from("weight_logs")
      .select("id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at,created_by")
      .eq("patient_id", state.patientId)
      .order("measurement_date", { ascending: true })
      .order("created_at", { ascending: true });
      if (error) throw error;
      state.logs = data || [];
      renderMeasurements();
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  function openPatientMeasurement(log = null) {
    const body = $("portalMeasurementsRows");
    if (!body || body.querySelector("[data-measurement-editor]")) return;
    const editor = window.DietPlannerWeightLogs.createEditorRow(log ? {id:log.id,date:log.measurement_date,weight:log.weight,bodyFat:log.body_fat_percent,muscle:log.muscle_percent,water:log.water_percent,waist:log.waist_cm,hip:log.hip_cm,adherence:log.diet_adherence,notes:log.notes} : null);
    body.prepend(editor);
    editor.querySelector("[data-field=weight]")?.focus();
    editor.scrollIntoView({behavior:"smooth",block:"center"});
  }

  async function savePatientMeasurement(row) {
    if (!row || state.busy || row.dataset.saving === "true") return;
    const read = field => row.querySelector('[data-field="'+field+'"]')?.value?.trim() ?? "";
    const numeric = field => read(field)==="" ? null : Number(read(field));
    const record = {patient_id:state.patientId,weight:numeric("weight"),measurement_date:read("date"),body_fat_percent:numeric("bodyFat"),muscle_percent:numeric("muscle"),water_percent:numeric("water"),waist_cm:numeric("waist"),hip_cm:numeric("hip"),diet_adherence:read("adherence")||null,notes:read("notes")||null};
    const validPercent = value => value===null || (Number.isFinite(value)&&value>=0&&value<=100);
    if(!record.measurement_date||!Number.isFinite(record.weight)||record.weight<=0){setMessage("portalMeasurementMessage","أدخل تاريخ القياس والوزن بصورة صحيحة.","error");row.querySelector("[data-field=weight]")?.focus();return;}
    if(![record.body_fat_percent,record.muscle_percent,record.water_percent].every(validPercent)){setMessage("portalMeasurementMessage","النسب المئوية يجب أن تكون بين 0 و100%.","error");return;}
    if([record.waist_cm,record.hip_cm].some(value=>value!==null&&(!Number.isFinite(value)||value<=0))){setMessage("portalMeasurementMessage","محيطات الجسم يجب أن تكون أكبر من صفر.","error");return;}
    const editingId=row.dataset.measurementEditorId||"";
    row.dataset.saving="true";
    const save=row.querySelector("[data-measurement-save]");
    if(save){save.disabled=true;save.textContent="جارٍ الحفظ";}
    state.busy=true;
    try {
      const query=editingId ? supabase.from("weight_logs").update(record).eq("id",editingId).eq("patient_id",state.patientId).eq("created_by",state.user.id) : supabase.from("weight_logs").insert(record);
      const {data,error}=await query.select("id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at,created_by").single();
      if(error)throw error;
      const index=state.logs.findIndex(item=>String(item.id)===String(editingId));
      if(index>=0)state.logs[index]=data;else state.logs.push(data);
      state.logs.sort((x,y)=>String(x.measurement_date).localeCompare(String(y.measurement_date))||String(x.created_at||"").localeCompare(String(y.created_at||"")));
      renderMeasurements();
      setMessage("portalMeasurementMessage",editingId?"تم تحديث القياس بنجاح.":"تم حفظ القياس بنجاح.","success");
    } catch(error) {
      console.error("Patient measurement save failed:",error);
      row.dataset.saving="false";
      if(save){save.disabled=false;save.textContent="حفظ";}
      setMessage("portalMeasurementMessage",error.message||"تعذر حفظ القياس. تحقق من صلاحيات قاعدة البيانات.","error");
    } finally { state.busy=false; }
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
      // The SECURITY DEFINER RPC checks the active patient account once and
      // assembles the published plan tree without triggering per-row plan_items RLS joins.
      const { data, error } = await supabase.rpc(
        "get_patient_published_nutrition_plans",
        { p_patient_id: state.patientId }
      );
      if (error) throw error;

      const orderedPlans = Array.isArray(data) ? data : [];

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

  const FOOD_COLUMNS = "id,name_ar,name_en,carb,protein,potassium,phosphorus,sodium,household,preparation_method";
  const FOOD_SEARCH_LIMIT = 30;

  function normalizeFoodSearch(value) {
    return String(value || "").toLocaleLowerCase("ar").normalize("NFKD").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").trim();
  }

  async function ensurePatientFoods() {
    if (state.foods) return state.foods;
    if (state.foodsPromise) return state.foodsPromise;
    state.foodsPromise = (async () => {
      const { data, error } = await supabase.from("foods").select(FOOD_COLUMNS).order("name_ar", { ascending: true });
      if (error) throw error;
      state.foods = Array.isArray(data) ? data : [];
      return state.foods;
    })();
    try { return await state.foodsPromise; }
    finally { state.foodsPromise = null; }
  }

  function showToolsLoadError(error) {
    const message = error?.message || "تعذر تحميل مكتبة الأغذية.";
    setMessage("portalToolsStatus", message, "error");
    ["portalCarbMeals", "portalRenalResults"].forEach(id => {
      const node = $(id);
      if (node) node.textContent = message;
    });
  }

  function findFoods(query) {
    const needle = normalizeFoodSearch(query);
    if (!needle) return [];
    return state.foods.filter(food => normalizeFoodSearch(food.name_ar + " " + (food.name_en || "")).includes(needle)).slice(0, FOOD_SEARCH_LIMIT);
  }

  function foodSearchMarkup(food) {
    return `<button type="button" class="portal-food-search-item" data-select-carb-food="${escapeHtml(food.id)}">
      <strong>${escapeHtml(food.name_ar || food.name_en || "غذاء")}</strong>
      <small>${escapeHtml(food.household || "لا يوجد مقياس منزلي مسجل")}</small>
    </button>`;
  }

  function renderCarbMeals() {
    const root = $("portalCarbMeals");
    if (!root) return;
    root.innerHTML = state.carbMeals.map(meal => {
      const total = meal.items.reduce((sum, item) => sum + (Number(item.food.carb) * Number(item.grams) / 100), 0);
      const items = meal.items.length ? meal.items.map(item => {
        const carb = Number(item.food.carb) * Number(item.grams) / 100;
        return `<div class="portal-carb-item" data-carb-item="${escapeHtml(item.id)}">
          <div class="portal-carb-item-copy"><strong>${escapeHtml(item.food.name_ar || item.food.name_en || "غذاء")}</strong><small>${optionalNumber(item.grams, " جم")} · ${optionalNumber(carb, " جم كربوهيدرات")}</small><small class="portal-carb-household-inline">${escapeHtml(item.food.household || "لا يوجد مقياس منزلي مسجل")}</small></div>
          <label class="portal-carb-grams"><span>الكمية (جم)</span><input type="number" min="0.1" max="10000" step="1" value="${escapeHtml(item.grams)}" data-carb-grams="${escapeHtml(item.id)}" inputmode="decimal"></label>
          <button type="button" class="portal-tool-icon-button" data-remove-carb-item="${escapeHtml(item.id)}" aria-label="حذف الصنف"><i class="fa-solid fa-trash"></i></button>
        </div>`;
      }).join("") : '<p class="portal-tool-hint">لم تضف أصنافًا لهذه الوجبة بعد.</p>';
      return `<section class="portal-carb-meal" data-carb-meal="${meal.id}">
        <div class="portal-carb-meal-heading"><div><h4>${meal.name}</h4><small>إجمالي الوجبة: <strong>${optionalNumber(total, " جم")}</strong> كربوهيدرات</small></div>
          <button type="button" class="portal-tool-add" data-add-carb-food="${meal.id}"><i class="fa-solid fa-plus"></i> إضافة صنف</button></div>
        <div class="portal-carb-items">${items}</div>
      </section>`;
    }).join("");
    const dayTotal = state.carbMeals.reduce((sum, meal) => sum + meal.items.reduce((part, item) => part + Number(item.food.carb) * Number(item.grams) / 100, 0), 0);
    $("portalCarbDayTotal").textContent = optionalNumber(dayTotal, " جم");
  }

  function renderCarbSearchResults(query) {
    const root = $("portalCarbSearchResults");
    if (!root) return;
    if (!query.trim()) { root.innerHTML = '<p class="portal-tool-hint">اكتب اسم الصنف للبحث في المكتبة.</p>'; return; }
    const matches = findFoods(query);
    root.innerHTML = matches.length ? matches.map(foodSearchMarkup).join("") : '<p class="portal-tool-hint">لا توجد نتائج مطابقة.</p>';
  }

  function renderRenalFoods() {
    const root = $("portalRenalResults");
    if (!root) return;
    const query = $("portalRenalSearch")?.value || "";
    const nutrient = $("portalRenalNutrient")?.value || "potassium";
    const labels = { potassium: "البوتاسيوم", phosphorus: "الفوسفور", sodium: "الصوديوم", protein: "البروتين" };
    if (!query.trim()) { root.innerHTML = '<p class="portal-tool-hint">ابدأ بكتابة اسم الغذاء لعرض بياناته.</p>'; return; }
    const matches = findFoods(query);
    root.innerHTML = matches.length ? matches.map(food => {
      const value = food[nutrient];
      const display = value === null || value === undefined || value === "" ? "غير مسجل" : optionalNumber(value, nutrient === "protein" ? " جم" : " مجم");
      return `<article class="portal-renal-food"><div><strong>${escapeHtml(food.name_ar || food.name_en || "غذاء")}</strong><small>${escapeHtml(food.household || "—")}</small></div><span><small>${labels[nutrient]} / 100 جم</small><strong>${display}</strong></span></article>`;
    }).join("") : '<p class="portal-tool-hint">لا توجد نتائج مطابقة.</p>';
  }

  function activateToolsTab(panelId) {
    const allowed = ["portalCarbPanel", "portalRenalPanel"];
    if (!allowed.includes(panelId)) return;
    document.querySelectorAll("[data-tools-tab]").forEach(tab => {
      const active = tab.dataset.toolsTab === panelId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    allowed.forEach(id => { const panel = $(id); if (panel) panel.hidden = id !== panelId; });
  }

  function openCarbPicker(mealId) {
    state.activeCarbMeal = mealId;
    state.selectedCarbFood = null;
    const meal = state.carbMeals.find(item => item.id === mealId);
    const picker = $("portalCarbPicker");
    if (!picker || !meal) return;
    $("portalCarbMealLabel").textContent = "إضافة صنف إلى " + meal.name;
    $("portalCarbSearch").value = "";
    $("portalCarbSearchResults").innerHTML = '<p class="portal-tool-hint">اكتب اسم الصنف للبحث في مكتبة الأغذية.</p>';
    $("portalCarbSelectedFood").hidden = true;
    $("portalCarbConfirm").disabled = true;
    $("portalCarbGrams").value = "100";
    picker.hidden = false;
    document.body.classList.add("portal-modal-open");
    window.setTimeout(() => $("portalCarbSearch")?.focus(), 30);
  }

  function selectCarbFood(foodId) {
    const food = state.foods?.find(item => String(item.id) === String(foodId));
    if (!food) return;
    state.selectedCarbFood = food;
    $("portalCarbSelectedName").textContent = food.name_ar || food.name_en || "غذاء";
    $("portalCarbHousehold").textContent = food.household || "لا يوجد مقياس منزلي مسجل لهذا الصنف.";
    $("portalCarbSelectedFood").hidden = false;
    $("portalCarbConfirm").disabled = false;
  }

  function closeCarbPicker() {
    const picker = $("portalCarbPicker");
    if (picker) picker.hidden = true;
    document.body.classList.remove("portal-modal-open");
    state.activeCarbMeal = null;
    state.selectedCarbFood = null;
  }

  function confirmCarbFood() {
    const food = state.selectedCarbFood;
    const meal = state.carbMeals.find(item => item.id === state.activeCarbMeal);
    const grams = Number($("portalCarbGrams")?.value);
    if (!food || !meal || !Number.isFinite(grams) || grams <= 0 || grams > 10000) {
      setMessage("portalToolsStatus", "اختر صنفًا وأدخل كمية صحيحة بالجرام.", "error");
      return;
    }
    meal.items.push({ id: window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2), food, grams });
    closeCarbPicker();
    setMessage("portalToolsStatus", "", "");
    renderCarbMeals();
  }

  function handlePatientToolsClick(event) {
    const add = event.target.closest("[data-add-carb-food]");
    const selected = event.target.closest("[data-select-carb-food]");
    const remove = event.target.closest("[data-remove-carb-item]");
    const close = event.target.closest("[data-close-carb-picker]");
    const confirm = event.target.closest("#portalCarbConfirm");
    const tab = event.target.closest("[data-tools-tab]");
    if (add) openCarbPicker(add.dataset.addCarbFood);
    else if (selected) selectCarbFood(selected.dataset.selectCarbFood);
    else if (remove) {
      state.carbMeals.forEach(meal => { meal.items = meal.items.filter(item => item.id !== remove.dataset.removeCarbItem); });
      renderCarbMeals();
    } else if (close) closeCarbPicker();
    else if (confirm) confirmCarbFood();
    else if (tab) activateToolsTab(tab.dataset.toolsTab);
    else if (event.target === $("portalCarbPicker")) closeCarbPicker();
  }

  function handleCarbQuantity(event) {
    const input = event.target.closest("[data-carb-grams]");
    if (!input) return;
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) return;
    state.carbMeals.forEach(meal => {
      const item = meal.items.find(entry => entry.id === input.dataset.carbGrams);
      if (item) item.grams = value;
    });
    renderCarbMeals();
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
    $("portalMeasurementsTable")?.addEventListener("click", event => {
      const add = event.target.closest("[data-add-measurement]");
      const save = event.target.closest("[data-measurement-save]");
      const cancel = event.target.closest("[data-measurement-cancel]");
      const edit = event.target.closest("[data-edit-measurement]");
      const remove = event.target.closest("[data-delete-measurement]");
      if (add) openPatientMeasurement();
      else if (save) void savePatientMeasurement(save.closest("[data-measurement-editor]"));
      else if (cancel) renderMeasurements();
      else if (edit) {
        const log = state.logs.find(item => String(item.id) === String(edit.dataset.editMeasurement));
        if (log?.created_by === state.user?.id) {
          const current = edit.closest("tr");
          const editor = window.DietPlannerWeightLogs.createEditorRow({id:log.id,date:log.measurement_date,weight:log.weight,bodyFat:log.body_fat_percent,muscle:log.muscle_percent,water:log.water_percent,waist:log.waist_cm,hip:log.hip_cm,adherence:log.diet_adherence,notes:log.notes});
          current?.replaceWith(editor);
          editor.querySelector("[data-field=weight]")?.focus();
        }
      } else if (remove) void deletePatientMeasurement(remove.dataset.deleteMeasurement, remove);
    });
    $("portalThemeToggle")?.addEventListener("click", () => {
      if (window.DietPlannerTheme?.toggle) window.DietPlannerTheme.toggle();
    });
    $("portalHome")?.querySelector("[data-portal-open-health]")?.addEventListener("click", openHealthArea);
    $("portalHome")?.querySelector("[data-open-patient-tools]")?.addEventListener("click", () => {
      history.replaceState({}, "", location.pathname + location.search + "#portalTools");
      showPortalDestination("portalToolsPanel");
    });
    $("portalToolsPanel")?.addEventListener("click", handlePatientToolsClick);
    $("portalToolsPanel")?.addEventListener("change", handleCarbQuantity);
    $("portalCarbSearch")?.addEventListener("input", event => renderCarbSearchResults(event.target.value));
    $("portalCarbPicker")?.addEventListener("keydown", event => { if (event.key === "Escape") closeCarbPicker(); });
    $("portalRenalSearch")?.addEventListener("input", renderRenalFoods);
    $("portalRenalNutrient")?.addEventListener("change", renderRenalFoods);
    activateToolsTab("portalCarbPanel");
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
      if (id === "portalTools") { showPortalDestination("portalToolsPanel"); return; }
      if (id === "portalProfileArea") {
        try { await loadSelfProfile(); }
        catch (error) { setMessage("selfProfileMessage", error.message || "تعذر تحميل بيانات الحساب.", "error"); }
      }
      showPortalDestination(id === "portalTools" ? "portalToolsPanel" : id);
    }
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
