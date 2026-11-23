(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, patient: null, patientId: null, logs: [], busy: false, activePlanTab: "self", messagesMountedFor: null, loadedPanels: new Set(), loadingPanels: new Map(), foods: null, foodSearchIndex: null, foodsPromise: null, carbMeals: [{ id: "breakfast", name: "الفطور", items: [] }, { id: "lunch", name: "الغداء", items: [] }, { id: "dinner", name: "العشاء", items: [] }, { id: "snacks", name: "الوجبات الخفيفة", items: [] }], renalMeals: [{ id: "breakfast", name: "الفطور", items: [] }, { id: "lunch", name: "الغداء", items: [] }, { id: "dinner", name: "العشاء", items: [] }, { id: "snacks", name: "الوجبات الخفيفة", items: [] }], activeFoodTool: null, activeFoodMeal: null, selectedFood: null };

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

  function isValidPatientId(value) {
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function showOnly(id) {
    ["portalLoading", "portalError", "portalUnlinked"].forEach(key => { if ($(key)) $(key).hidden = key !== id; });
    if ($("portalContent")) $("portalContent").hidden = id !== "portalContent";
  }

  function openHealthArea() {
    // Switch the top-level view before starting asynchronous data loading.
    // This prevents the previously visible portal section from remaining on screen
    // if the health file resolves to loading, unlinked, or error state.
    showPortalDestination("portalContent");
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
    const allowed = ["portalPlansPanel", "portalMeasurementsPanel", "portalCareManagementPanel", "portalSharedHealthPanel"];
    if (!allowed.includes(panelId)) return;

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
    if (panelId === "portalCareManagementPanel") state.loadedPanels.delete(panelId);
    void ensureHealthPanelLoaded(panelId);
  }

  async function ensureHealthPanelLoaded(panelId) {
    if (state.loadedPanels.has(panelId)) return;
    if (state.loadingPanels.has(panelId)) return state.loadingPanels.get(panelId);
    const loaders = {
      portalPlansPanel: () => state.activePlanTab === "professional" ? loadPlans() : Promise.resolve(),
      portalMeasurementsPanel: loadMeasurements,
      portalCareManagementPanel: loadProfessionalCareManagement,
      portalSharedHealthPanel: loadSharedHealthRecord
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
          portalCareManagementPanel: "patientCareManagementContent",
          portalSharedHealthPanel: "patientSharedHealthStatus"
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
    if (home) home.hidden = !["portalHome", "portalDietBuilder"].includes(id) || toolsOpen;
    if (health) health.hidden = id !== "portalContent" && !["portalPlansPanel","portalMeasurementsPanel","portalCareManagementPanel","portalSharedHealthPanel"].includes(id);
    if (profile) profile.hidden = id !== "portalProfileArea";
    if (tools) tools.hidden = !toolsOpen;
    if (health && !health.hidden) {
      if (id === "portalContent") activateHealthTab("portalPlansPanel");
      else if (id.startsWith("portal")) activateHealthTab(id);
    }
    if (toolsOpen) {
      void ensurePatientFoods().then(() => { renderCarbMeals(); renderRenalMeals(); }).catch(error => showToolsLoadError(error));
      tools?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (id === "portalDietBuilder") {
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
    if (!isValidPatientId(state.patientId)) {
      throw new Error("معرّف الملف الصحي غير صالح. أعد تحميل بوابة المريض أو أعد ربط الحساب.");
    }
    const { data, error } = await supabase
      .from("patients")
      .select("id,name,gender,birth_date,age,height,diagnosis,complaints")
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
    const confirmed = await window.DPConfirm?.ask({ title: "حذف القياس؟", message: "هل تريد حذف القياس الذي سجلته؟ لا يمكن التراجع عن الحذف.", confirmText: "حذف", variant: "danger" });
    if (!confirmed) return;
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


  function activatePlanTab(tab) {
    if (!["self", "professional"].includes(tab)) return;
    state.activePlanTab = tab;
    document.querySelectorAll("[data-plan-tab]").forEach(button => {
      const active = button.dataset.planTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const selfPanel = $("portalPlansSelfPanel");
    const professionalPanel = $("portalPlansProfessionalPanel");
    if (selfPanel) selfPanel.hidden = tab !== "self";
    if (professionalPanel) professionalPanel.hidden = tab !== "professional";
    if (tab === "professional") {
      state.loadedPanels.delete("portalPlansPanel");
      void ensureHealthPanelLoaded("portalPlansPanel");
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


  function careAgreementMarkup(item) {
    const hasAgreement = Boolean(item.agreement_service_title);
    const agreed = Boolean(item.patient_agreement_at && item.professional_agreement_at);
    const sent = Boolean(item.payment_sent_at), received = Boolean(item.payment_received_at);
    const expired = item.agreement_end_date && item.agreement_end_date < localToday();
    const money = item.agreement_amount == null ? "—" : Number(item.agreement_amount).toLocaleString("ar-EG") + " " + (item.agreement_currency || "EGP");
    const statusLabels = { pending:"طلب المحادثة قيد الانتظار", accepted:"بانتظار استكمال الاتفاق", active:"المتابعة نشطة", ended:"انتهت المتابعة", declined:"لم يتم قبول الطلب", cancelled:"تم إلغاء الطلب" };
    const status = expired && item.status === "active" ? "انتهت مدة الاتفاق — قراءة فقط" : statusLabels[item.status] || "حالة الطلب غير محددة";
    let actions = "";
    if (hasAgreement && item.status === "accepted" && !item.patient_agreement_at) actions += '<button type="button" class="portal-primary-button" data-care-confirm="agreement" data-request-id="' + escapeHtml(item.request_id) + '">الموافقة على الاتفاق</button>';
    if (agreed && item.status === "accepted" && !sent) actions += '<button type="button" class="portal-primary-button" data-care-confirm="payment_sent" data-request-id="' + escapeHtml(item.request_id) + '">تأكيد إرسال المبلغ</button>';
    if (item.status === "pending") actions += '<button type="button" class="portal-secondary-button" data-cancel-professional-request="' + escapeHtml(item.request_id) + '">إلغاء الطلب</button>';
    const details = hasAgreement
      ? '<div class="portal-care-agreement__details"><div><small>الخدمة</small><strong>' + escapeHtml(item.agreement_service_title) + '</strong></div><div><small>القيمة</small><strong>' + escapeHtml(money) + '</strong></div><div><small>المدة</small><strong>' + escapeHtml(item.agreement_duration_days) + ' يوم</strong></div><div><small>من</small><strong>' + escapeHtml(formatDate(item.agreement_start_date)) + '</strong></div><div><small>إلى</small><strong>' + escapeHtml(formatDate(item.agreement_end_date)) + '</strong></div></div>' +
        (item.agreement_service_description ? '<p>' + escapeHtml(item.agreement_service_description) + '</p>' : '') +
        (item.agreement_terms ? '<p>' + escapeHtml(item.agreement_terms) + '</p>' : '') +
        '<ol class="portal-care-steps"><li class="' + (item.patient_agreement_at ? 'is-done' : '') + '">موافقة المريض</li><li class="' + (item.professional_agreement_at ? 'is-done' : '') + '">موافقة المختص</li><li class="' + (sent ? 'is-done' : '') + '">إرسال المبلغ</li><li class="' + (received ? 'is-done' : '') + '">استلام المبلغ وبدء المتابعة</li></ol>'
      : '<p>لم يرسل المختص تفاصيل الاتفاق بعد. ستظهر الخدمة والسعر والمدة هنا قبل أي التزام مالي.</p>';
    const label = item.agreement_service_title || (item.status === "pending" ? "طلب محادثة جديد" : "طلب متابعة");
    return '<details class="portal-care-agreement" data-care-request-id="' + escapeHtml(item.request_id) + '"><summary><span><strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(status) + '</small></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></summary><div class="portal-care-agreement__body"><div class="portal-care-agreement__details-wrap">' + details + '</div><div class="portal-care-agreement__actions">' + actions + '</div>' +
      (hasAgreement ? '<p class="portal-care-agreement__notice">الدفع مباشر بينك وبين المختص؛ المنصة تسجل التأكيدات ولا تحصّل المبلغ.</p>' : '') + '</div></details>';
  }

  function renderSharedHealthForm() {
    const patient = state.patient || {};
    $("sharedHealthName").value = patient.name || "";
    $("sharedHealthGender").value = ["male", "ذكر"].includes(patient.gender) ? "male" : ["female", "أنثى"].includes(patient.gender) ? "female" : "";
    $("sharedHealthBirthDate").value = patient.birth_date || "";
    $("sharedHealthHeight").value = patient.height ?? "";
    $("sharedHealthDiagnosis").value = patient.diagnosis || "";
    $("sharedHealthComplaints").value = patient.complaints || "";
  }

  async function loadSharedHealthRecord() {
    const status = $("patientSharedHealthStatus");
    const history = $("patientHealthAuditList");
    if (!isValidPatientId(state.patientId)) {
      const message = "تعذر تحديد ملفك الصحي المرتبط. أعد تحميل الصفحة، وإذا استمرت المشكلة تواصل مع الدعم.";
      if (status) setMessage("patientSharedHealthStatus", message, "error");
      if (history) history.textContent = message;
      throw new Error("Invalid patient UUID in patient portal shared health loader.");
    }
    status.textContent = "جاري تحميل البيانات الصحية...";
    renderSharedHealthForm();
    const { data, error } = await supabase.from("patient_health_audit")
      .select("id,actor_id,actor_role,operation,changed_fields,created_at")
      .eq("patient_id", state.patientId).order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    status.textContent = "يمكنك مراجعة بياناتك الأساسية وتحديثها. يحتفظ النظام بسجل لمن قام بالتعديل ووقته.";
    const labels = {name:"اسم المريض",gender:"النوع",birth_date:"تاريخ الميلاد",age:"العمر",height:"الطول",diagnosis:"التشخيص",complaints:"الشكوى"};
    const healthEvents = (data || []).filter(item =>
      (item.changed_fields || []).some(field => Object.prototype.hasOwnProperty.call(labels, field))
    ).slice(0, 30);
    if (!healthEvents.length) { history.textContent = "لا توجد تعديلات صحية مسجلة حتى الآن."; return; }
    history.innerHTML = healthEvents.map(item => {
      const actor = item.actor_id === state.user.id ? "أنت" : item.actor_role === "professional" ? "المختص" : item.actor_role === "admin" ? "إدارة المنصة" : "مستخدم مخوّل";
      const fields = (item.changed_fields || []).map(field => escapeHtml(labels[field] || field)).join("، ");
      const date = new Date(item.created_at).toLocaleString("ar-EG");
      return '<article class="portal-health-audit-item"><div><strong>' + escapeHtml(actor) + '</strong><time>' + escapeHtml(date) + '</time></div><p>' + escapeHtml(item.operation === "UPDATE" ? "تحديث البيانات الصحية" : "إنشاء سجل") + (fields ? " · " + fields : "") + '</p></article>';
    }).join("");
  }

  async function saveSharedHealthRecord(event) {
    event.preventDefault();
    const form = $("patientSharedHealthForm");
    const button = form?.querySelector('button[type="submit"]');
    if (!isValidPatientId(state.patientId)) {
      setMessage("patientSharedHealthStatus", "تعذر حفظ البيانات لأن ملف المريض غير محدد بشكل صحيح. أعد تحميل البوابة.", "error");
      return;
    }
    if (!form || !button) return;

    const name = $("sharedHealthName").value.trim();
    if (name.length < 2 || name.length > 120) {
      setMessage("patientSharedHealthStatus", "اسم المريض يجب أن يكون من 2 إلى 120 حرفًا.", "error");
      $("sharedHealthName").focus();
      return;
    }

    const raw = $("sharedHealthHeight").value.trim();
    const height = raw === "" ? null : Number(raw);
    if (height !== null && (!Number.isFinite(height) || height < 30 || height > 260)) {
      setMessage("patientSharedHealthStatus", "الطول يجب أن يكون بين 30 و260 سم.", "error");
      return;
    }

    const currentName = String(state.patient?.name || "").trim();
    const nameChanged = name !== currentName;
    let nameSaved = false;
    button.disabled = true;
    setMessage("patientSharedHealthStatus", "جاري حفظ البيانات...");
    try {
      // The UI uses one save action; backend permissions remain separated by field scope.
      if (nameChanged) {
        const { data: nameData, error: nameError } = await supabase.rpc("update_my_patient_record_name", {
          p_patient_id: state.patientId,
          p_name: name
        });
        if (nameError) throw nameError;
        state.patient = { ...state.patient, name: nameData?.name || name };
        nameSaved = true;
      }

      const { data, error } = await supabase.rpc("update_shared_patient_health_profile", {
        p_patient_id: state.patientId,
        p_gender: $("sharedHealthGender").value.trim() || null,
        p_birth_date: $("sharedHealthBirthDate").value || null,
        p_height: height,
        p_diagnosis: $("sharedHealthDiagnosis").value.trim() || null,
        p_complaints: $("sharedHealthComplaints").value.trim() || null
      });
      if (error) throw error;

      state.patient = { ...state.patient, ...data, name };
      renderSharedHealthForm();
      try {
        await loadSharedHealthRecord();
        setMessage("patientSharedHealthStatus", "تم حفظ الاسم والبيانات الصحية وتسجيل التعديلات.", "success");
      } catch (refreshError) {
        console.error("Shared health history refresh failed:", refreshError);
        setMessage("patientSharedHealthStatus", "تم حفظ البيانات، لكن تعذر تحديث سجل التعديلات. أعد تحميل الصفحة لمراجعته.", "success");
      }
    } catch (error) {
      console.error("Shared health profile save failed:", error);
      let message = error.message === "care_agreement_expired_read_only"
        ? "انتهت مدة المتابعة. يمكنك الاطلاع على البيانات دون تعديلها."
        : error.message === "patient_record_access_denied"
          ? "لا تملك صلاحية تعديل اسم هذا الملف."
          : error.message === "invalid_patient_name"
            ? "اسم المريض يجب أن يكون من 2 إلى 120 حرفًا."
            : (error.message || "تعذر حفظ البيانات.");
      if (nameSaved) {
        message = "تم حفظ اسم المريض، لكن تعذر حفظ بقية البيانات: " + message;
      }
      setMessage("patientSharedHealthStatus", message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function redeemProfessionalInvitation(event) {
    event.preventDefault();
    const form = $("patientProfessionalCodeForm");
    const input = $("patientProfessionalCode");
    const button = form?.querySelector('button[type="submit"]');
    const token = String(input?.value || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      setMessage("patientProfessionalCodeStatus", "كود الربط غير صحيح. أدخل الكود كاملًا كما أرسله المختص.", "error");
      return;
    }
    if (!button || button.disabled) return;
    button.disabled = true;
    setMessage("patientProfessionalCodeStatus", "جاري التحقق من الكود وإرسال طلب المتابعة...");
    try {
      const { error } = await supabase.rpc("redeem_patient_professional_invitation", { p_token: token });
      if (error) throw error;
      input.value = "";
      setMessage("patientProfessionalCodeStatus", "تم التحقق من الكود وإرسال طلب المتابعة للمختص. ستظهر حالته هنا.", "success");
      state.loadedPanels.delete("portalCareManagementPanel");
      await ensureHealthPanelLoaded("portalCareManagementPanel");
    } catch (error) {
      console.error("Professional invitation redemption failed:", error);
      const messages = {
        invitation_invalid_expired_or_used: "الكود غير صحيح أو انتهت صلاحيته أو سبق استخدامه.",
        invitation_already_used: "تم استخدام هذا الكود من قبل.",
        active_patient_account_required: "يلزم تسجيل الدخول بحساب مريض نشط لاستخدام كود الربط.",
        already_in_care_team: "أنت مرتبط بالفعل بهذا المختص.",
        connection_request_already_open_or_processed: "يوجد طلب أو متابعة سابقة مع هذا المختص بالفعل."
      };
      setMessage("patientProfessionalCodeStatus", messages[error?.message] || "تعذر استخدام الكود. راجع صلاحيته أو تواصل مع المختص.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function loadProfessionalCareManagement() {
    const root = $("patientCareManagementContent");
    if (!root) return;
    root.textContent = "جاري تحميل طلبات المتابعة...";
    const { data, error } = await supabase.rpc("list_my_professional_connection_requests");
    if (error) throw error;

    const requests = Array.isArray(data) ? data : [];
    if (!requests.length) {
      root.textContent = "لا توجد طلبات أو اتفاقات متابعة حتى الآن. يمكنك اختيار مختص من الدليل لبدء التواصل.";
      return;
    }

    const groups = new Map();
    requests.forEach(item => {
      const key = item.professional_id || ("name:" + (item.professional_name || item.request_id));
      if (!groups.has(key)) groups.set(key, { name: item.professional_name || "المختص", title: item.professional_title || "", items: [] });
      groups.get(key).items.push(item);
    });
    root.innerHTML = [...groups.values()].map(group =>
      '<details class="portal-care-professional"><summary><span><strong>' + escapeHtml(group.name) + '</strong><small>' + escapeHtml(group.title || (group.items.length.toLocaleString("ar-EG") + " اتفاق / طلب")) + '</small></span><span class="portal-care-count">' + group.items.length.toLocaleString("ar-EG") + '</span></summary><div class="portal-care-professional__agreements">' +
      group.items.map(careAgreementMarkup).join("") + '</div></details>'
    ).join("");
    root.querySelectorAll("[data-care-confirm]").forEach(button => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const step = button.dataset.careConfirm;
      const message = step === "agreement"
        ? "بتأكيدك، أنت توافق على الخدمة والسعر والمدة والشروط الموضحة."
        : "هل تؤكد أنك أرسلت المبلغ مباشرة إلى المختص؟";
      const ok = await window.DPConfirm?.ask({
        title: step === "agreement" ? "تأكيد الاتفاق" : "تأكيد الدفع",
        message,
        confirmText: "تأكيد"
      });
      if (!ok) return;

      button.disabled = true;
      const { error: rpcError } = await supabase.rpc("confirm_professional_connection_step", {
        p_request_id: button.dataset.requestId,
        p_step: step
      });
      if (rpcError) {
        button.disabled = false;
        button.insertAdjacentHTML("afterend", '<p class="portal-inline-message is-error" role="status">تعذر تسجيل التأكيد: ' + escapeHtml(rpcError.message) + '</p>');
        return;
      }
      state.loadedPanels.delete("portalCareManagementPanel");
      await loadProfessionalCareManagement();
    }));

    root.querySelectorAll("[data-cancel-professional-request]").forEach(button => button.addEventListener("click", async () => {
      if (button.disabled) return;
      const confirmed = await window.DPConfirm?.ask({
        title: "إلغاء طلب المحادثة؟",
        message: "هل تريد إلغاء هذا الطلب؟",
        confirmText: "إلغاء الطلب",
        variant: "danger"
      });
      if (!confirmed) return;

      button.disabled = true;
      const { error: cancelError } = await supabase.rpc("cancel_professional_connection_request", {
        p_request_id: button.dataset.cancelProfessionalRequest
      });
      if (cancelError) {
        button.disabled = false;
        button.insertAdjacentHTML("afterend", '<p class="portal-inline-message is-error" role="status">تعذر إلغاء الطلب: ' + escapeHtml(cancelError.message) + '</p>');
        return;
      }
      state.loadedPanels.delete("portalCareManagementPanel");
      await loadProfessionalCareManagement();
    }));
  }

  const FOOD_COLUMNS = "id,name_ar,name_en,carb,protein,potassium,phosphorus,sodium,household,preparation_method";

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
      state.foodSearchIndex = state.foods.map(food => ({ food, searchText: normalizeFoodSearch((food.name_ar || "") + " " + (food.name_en || "")) }));
      return state.foods;
    })();
    try { return await state.foodsPromise; }
    finally { state.foodsPromise = null; }
  }

  function showToolsLoadError(error) {
    const message = error?.message || "تعذر تحميل مكتبة الأغذية.";
    setMessage("portalToolsStatus", message, "error");
    ["portalCarbMeals", "portalRenalMeals"].forEach(id => {
      const node = $(id);
      if (node) node.textContent = message;
    });
  }

  function findFoods(query) {
    const needle = normalizeFoodSearch(query);
    if (!needle) return [];
    return (state.foodSearchIndex || []).filter(entry => entry.searchText.includes(needle)).map(entry => entry.food);
  }

  function foodSearchMarkup(food) {
    return `<button type="button" class="portal-food-search-item" data-select-food="${escapeHtml(food.id)}">
      <strong>${escapeHtml(food.name_ar || food.name_en || "غذاء")}</strong>
      <small>${escapeHtml(food.household || "لا يوجد مقياس منزلي مسجل")}</small>
    </button>`;
  }

  const TOOL_CONFIG = {
    carb: { meals: "carbMeals", total: "portalCarbDayTotal", search: "portalCarbSearchResults", nutrient: "carb", label: "الكربوهيدرات", unit: "جم", addAttr: "data-add-carb-food", itemAttr: "data-carb-item", quantityAttr: "data-carb-grams", removeAttr: "data-remove-carb-item" },
    renal: { meals: "renalMeals", total: "portalRenalDayTotals", search: "portalCarbSearchResults", nutrients: ["potassium", "phosphorus", "sodium"], labels: { potassium: "البوتاسيوم", phosphorus: "الفسفور", sodium: "الصوديوم" }, unit: "مجم", addAttr: "data-add-renal-food", itemAttr: "data-renal-item", quantityAttr: "data-renal-grams", removeAttr: "data-remove-renal-item" }
  };

  function getToolMeals(tool) {
    return state[TOOL_CONFIG[tool].meals];
  }

  function getFoodNutrient(food, nutrient, grams) {
    const raw = food?.[nutrient];
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value * Number(grams) / 100 : null;
  }

  function getMealNutrientTotal(meal, nutrient) {
    let total = 0, missing = 0;
    meal.items.forEach(item => {
      const value = getFoodNutrient(item.food, nutrient, item.grams);
      if (value === null) missing++;
      else total += value;
    });
    return { total, missing };
  }

  function renderRenalTotals() {
    const root = $("portalRenalDayTotals");
    if (!root) return;
    const totals = TOOL_CONFIG.renal.nutrients.map(key => {
      const result = state.renalMeals.reduce((acc, meal) => {
        const part = getMealNutrientTotal(meal, key);
        acc.total += part.total;
        acc.missing += part.missing;
        return acc;
      }, { total: 0, missing: 0 });
      return `<div class="portal-renal-total"><span>${TOOL_CONFIG.renal.labels[key]}</span><strong>${optionalNumber(result.total, " مجم")}${result.missing ? "*" : ""}</strong></div>`;
    }).join("");
    root.innerHTML = totals;
  }

  function renderToolMeals(tool) {
    const config = TOOL_CONFIG[tool];
    const meals = getToolMeals(tool);
    const root = $(tool === "carb" ? "portalCarbMeals" : "portalRenalMeals");
    if (!root) return;
    root.innerHTML = meals.map(meal => {
      const nutrientTotals = tool === "carb"
        ? `إجمالي الوجبة: <strong>${optionalNumber(getMealNutrientTotal(meal, "carb").total, " جم")}</strong> كربوهيدرات`
        : config.nutrients.map(key => {
            const result = getMealNutrientTotal(meal, key);
            return `<span>${config.labels[key]}: <strong>${optionalNumber(result.total, " مجم")}${result.missing ? "*" : ""}</strong></span>`;
          }).join(" · ");
      const items = meal.items.length ? meal.items.map(item => {
        const quantityAttr = tool === "carb" ? "data-carb-grams" : "data-renal-grams";
        const removeAttr = tool === "carb" ? "data-remove-carb-item" : "data-remove-renal-item";
        const foodName = escapeHtml(item.food.name_ar || item.food.name_en || "غذاء");
        const household = escapeHtml(item.food.household || "غير مسجل");
        return "<div class=\"portal-carb-item portal-tool-food-row\" data-tool-item=\"" + escapeHtml(item.id) + "\">" +
          "<strong class=\"portal-tool-food-name\">" + foodName + "</strong>" +
          "<label class=\"portal-carb-grams\"><span>الكمية (جم)</span><input type=\"number\" min=\"0.1\" max=\"10000\" step=\"1\" value=\"" + escapeHtml(item.grams) + "\" " + quantityAttr + "=\"" + escapeHtml(item.id) + "\" inputmode=\"decimal\" aria-label=\"كمية " + foodName + " بالجرام\"></label>" +
          "<div class=\"portal-tool-food-household\"><span>المقياس المنزلي</span><strong>" + household + "</strong></div>" +
          "<button type=\"button\" class=\"portal-tool-icon-button\" " + removeAttr + "=\"" + escapeHtml(item.id) + "\" aria-label=\"حذف " + foodName + "\"><i class=\"fa-solid fa-trash\"></i></button></div>";
      }).join("") : '<p class="portal-tool-hint">لم تضف أصنافًا لهذه الوجبة بعد.</p>';
      const addAttr = tool === "carb" ? "data-add-carb-food" : "data-add-renal-food";
      return `<section class="portal-carb-meal" data-tool-meal="${meal.id}">
        <div class="portal-carb-meal-heading"><div><h4>${meal.name}</h4><small class="portal-meal-nutrient-totals">${nutrientTotals}</small></div>
          <button type="button" class="portal-tool-add" ${addAttr}="${meal.id}"><i class="fa-solid fa-plus"></i> إضافة صنف</button></div>
        <div class="portal-carb-items">${items}</div>
      </section>`;
    }).join("");
    if (tool === "carb") {
      const total = meals.reduce((sum, meal) => sum + getMealNutrientTotal(meal, "carb").total, 0);
      $(config.total).textContent = optionalNumber(total, " جم");
    } else renderRenalTotals();
  }

  function renderCarbMeals() { renderToolMeals("carb"); }
  function renderRenalMeals() { renderToolMeals("renal"); }

  function renderFoodSearchResults(query) {
    const root = $("portalCarbSearchResults");
    if (!root) return;
    const matches = query.trim() ? findFoods(query) : (state.foods || []);
    root.innerHTML = matches.length
      ? '<p class="portal-food-results-count">' + (query.trim() ? 'نتائج البحث' : 'جميع الأصناف') + ' · ' + matches.length.toLocaleString('ar-EG') + ' صنف</p>' + matches.map(foodSearchMarkup).join("")
      : '<p class="portal-tool-hint">لا توجد أصناف مطابقة.</p>';
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

  function openFoodPicker(tool, mealId) {
    const meals = getToolMeals(tool);
    const meal = meals.find(item => item.id === mealId);
    const picker = $("portalCarbPicker");
    if (!picker || !meal) return;
    state.activeFoodTool = tool;
    state.activeFoodMeal = mealId;
    state.selectedFood = null;
    $("portalCarbMealLabel").textContent = "إضافة صنف إلى " + meal.name;
    $("portalCarbSearch").value = "";
    renderFoodSearchResults("");
    $("portalCarbSelectedFood").hidden = true;
    $("portalCarbConfirm").disabled = true;
    $("portalCarbGrams").value = "100";
    $("portalCarbConfirm").textContent = "إضافة للوجبة";
    picker.hidden = false;
    document.body.classList.add("portal-modal-open");
    window.setTimeout(() => $("portalCarbSearch")?.focus(), 30);
  }

  function selectFood(foodId) {
    const food = state.foods?.find(item => String(item.id) === String(foodId));
    if (!food) return;
    state.selectedFood = food;
    $("portalCarbSelectedName").textContent = food.name_ar || food.name_en || "غذاء";
    $("portalCarbHousehold").textContent = food.household || "لا يوجد مقياس منزلي مسجل لهذا الصنف.";
    $("portalCarbSelectedFood").hidden = false;
    $("portalCarbConfirm").disabled = false;
  }

  function closeFoodPicker() {
    const picker = $("portalCarbPicker");
    if (picker) picker.hidden = true;
    document.body.classList.remove("portal-modal-open");
    state.activeFoodTool = null;
    state.activeFoodMeal = null;
    state.selectedFood = null;
  }

  function confirmFood() {
    const food = state.selectedFood;
    const tool = state.activeFoodTool;
    const meal = tool ? getToolMeals(tool).find(item => item.id === state.activeFoodMeal) : null;
    const grams = Number($("portalCarbGrams")?.value);
    if (!food || !meal || !Number.isFinite(grams) || grams <= 0 || grams > 10000) {
      setMessage("portalToolsStatus", "اختر صنفًا وأدخل كمية صحيحة بالجرام.", "error");
      return;
    }
    meal.items.push({ id: window.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2), food, grams });
    closeFoodPicker();
    setMessage("portalToolsStatus", "", "");
    renderToolMeals(tool);
  }

  function handlePatientToolsClick(event) {
    const carbAdd = event.target.closest("[data-add-carb-food]");
    const renalAdd = event.target.closest("[data-add-renal-food]");
    const selected = event.target.closest("[data-select-food]");
    const carbRemove = event.target.closest("[data-remove-carb-item]");
    const renalRemove = event.target.closest("[data-remove-renal-item]");
    const close = event.target.closest("[data-close-carb-picker]");
    const confirm = event.target.closest("#portalCarbConfirm");
    const tab = event.target.closest("[data-tools-tab]");
    if (carbAdd) openFoodPicker("carb", carbAdd.dataset.addCarbFood);
    else if (renalAdd) openFoodPicker("renal", renalAdd.dataset.addRenalFood);
    else if (selected) selectFood(selected.dataset.selectFood);
    else if (carbRemove || renalRemove) {
      const tool = carbRemove ? "carb" : "renal";
      const itemId = (carbRemove || renalRemove).dataset[carbRemove ? "removeCarbItem" : "removeRenalItem"];
      getToolMeals(tool).forEach(meal => { meal.items = meal.items.filter(item => item.id !== itemId); });
      renderToolMeals(tool);
    } else if (close) closeFoodPicker();
    else if (confirm) confirmFood();
    else if (tab) activateToolsTab(tab.dataset.toolsTab);
    else if (event.target === $("portalCarbPicker")) closeFoodPicker();
  }

  function handleToolQuantity(event) {
    const carbInput = event.target.closest("[data-carb-grams]");
    const renalInput = event.target.closest("[data-renal-grams]");
    const input = carbInput || renalInput;
    if (!input) return;
    const tool = carbInput ? "carb" : "renal";
    const value = Number(input.value);
    if (!Number.isFinite(value) || value <= 0 || value > 10000) return;
    getToolMeals(tool).forEach(meal => {
      const item = meal.items.find(entry => entry.id === input.dataset[carbInput ? "carbGrams" : "renalGrams"]);
      if (item) item.grams = value;
    });
    renderToolMeals(tool);
  }

  const insulinMealIcrOverrides = Object.create(null);

  function calculateInsulinEstimate() {
    const regimen = $("portalInsulinRegimen")?.value || "basal_bolus";
    const kind = $("portalInsulinKind")?.value || "rapid";
    const tddInput = $("portalInsulinTdd")?.value ?? "";
    const currentInput = $("portalCurrentGlucose")?.value ?? "";
    const targetInput = $("portalTargetGlucose")?.value ?? "";
    const mealKey = $("portalInsulinMeal")?.value || "breakfast";
    const carbsInput = $("portalMealCarbs")?.value ?? "";
    const icrInput = $("portalMealIcr")?.value ?? "";
    const tdd = Number(tddInput), current = Number(currentInput), target = Number(targetInput);
    const carbs = Number(carbsInput), manualIcr = Number(icrInput);
    const outputs = {
      icr: $("portalInsulinIcrResult"),
      isf: $("portalInsulinIsfResult"),
      difference: $("portalGlucoseDifference"),
      correction: $("portalCorrectionEstimate"),
      meal: $("portalMealInsulinEstimate")
    };
    const message = $("portalInsulinMessage");
    const show = (node, value) => { if (node) node.textContent = value; };
    const setState = (node, state) => { if (node) node.dataset.state = state; };
    Object.values(outputs).forEach(node => show(node, "—"));
    if (!message) return;

    if (icrInput === "") {
      delete insulinMealIcrOverrides[mealKey];
    } else if (Number.isFinite(manualIcr) && manualIcr > 0 && manualIcr <= 200) {
      insulinMealIcrOverrides[mealKey] = manualIcr;
    }
    const validTdd = tddInput !== "" && Number.isFinite(tdd) && tdd > 0 && tdd <= 500;
    if (regimen !== "basal_bolus") {
      show(message, regimen === "basal_only"
        ? "النظام القاعدي فقط لا يتيح تقدير إنسولين الوجبة بهذه الأداة."
        : "الإنسولين المخلوط أو الجرعات الثابتة يحتاجان خطة مختلفة؛ لا نحسب لهما إنسولين الوجبة هنا.");
      setState(message, "warning");
      return;
    }
    if (!validTdd) {
      show(message, "أدخل إجمالي الإنسولين خلال 24 ساعة لعرض المعاملات الابتدائية.");
      setState(message, "notice");
      return;
    }

    const startingIcr = 500 / tdd;
    const isf = (kind === "regular" ? 1500 : 1800) / tdd;
    const mealIcr = insulinMealIcrOverrides[mealKey] || startingIcr;
    const mealIcrInput = $("portalMealIcr");
    if (mealIcrInput && document.activeElement !== mealIcrInput) {
      mealIcrInput.value = insulinMealIcrOverrides[mealKey] ? String(insulinMealIcrOverrides[mealKey]) : "";
      mealIcrInput.placeholder = startingIcr.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " (ابتدائي)";
    }
    show(outputs.icr, "1 وحدة لكل " + startingIcr.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " جم");
    show(outputs.isf, "1 وحدة لكل " + isf.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " mg/dL");

    if (carbsInput !== "") {
      if (Number.isFinite(carbs) && carbs >= 0 && carbs <= 500) {
        show(outputs.meal, (carbs / mealIcr).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " وحدة (نظريًا)");
      } else {
        show(outputs.meal, "قيمة غير صالحة");
      }
    }
    show(message, "المعامل الابتدائي تقديري. يمكنك إدخال معامل مختلف للوجبة المختارة؛ التعديل مؤقت ولا يُحفظ بعد مغادرة الصفحة.");
    setState(message, "notice");

    if (currentInput === "" || targetInput === "") return;
    if (!Number.isFinite(current) || !Number.isFinite(target) || current < 20 || current > 600 || target < 70 || target > 250) {
      show(outputs.difference, "قيمة غير صالحة");
      show(outputs.correction, "—");
      show(message, "يرجى مراجعة قياس السكر والهدف المدخلين.");
      setState(message, "warning");
      return;
    }
    const difference = current - target;
    show(outputs.difference, (difference > 0 ? "+" : "") + difference.toLocaleString("en-US") + " mg/dL");
    if (difference <= 0) {
      show(outputs.correction, difference < 0 ? "لا يُحسب تصحيح موجب" : "0 وحدة");
      if (difference < 0) {
        show(message, "قراءة السكر أقل من الهدف. يُرجى الرجوع إلى خطة المتابعة المتفق عليها مع فريق الرعاية.");
        setState(message, "warning");
      }
      return;
    }
    show(outputs.correction, (difference / isf).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " وحدة (نظريًا)");
  }

  async function loadPortal() {
    showOnly("portalLoading");
    let account = await getPatientAccount();
    const invitationToken = new URLSearchParams(window.location.search).get("invite");
    let invitationStatus = "";

    // Existing self-owned patient accounts redeem professional invitations as requests,
    // while unlinked accounts keep the original invitation-to-record linking flow below.
    if (account?.patient_id && invitationToken) {
      try {
        const { error } = await supabase.rpc("redeem_patient_professional_invitation", { p_token: invitationToken });
        if (error) throw error;
        invitationStatus = "تم التحقق من رابط المختص وإرسال طلب المتابعة. يمكنك متابعة حالته من هذا القسم.";
      } catch (error) {
        console.error("Professional invitation link redemption failed:", error);
        invitationStatus = error?.message === "already_in_care_team"
          ? "أنت مرتبط بالفعل بهذا المختص."
          : error?.message === "connection_request_already_open_or_processed"
            ? "يوجد طلب أو متابعة سابقة مع هذا المختص بالفعل."
            : "تعذر استخدام رابط الدعوة. قد يكون منتهي الصلاحية أو سبق استخدامه.";
      }
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("invite");
      window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }

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

      // One durable patient record is created on first entry; accepted requests reuse it.
      const { data: patientId, error: ensureError } = await supabase.rpc("ensure_patient_self_record");
      if (ensureError) throw ensureError;
      if (!isValidPatientId(patientId)) throw new Error("تعذر إنشاء الملف الصحي المستقل. يرجى إعادة المحاولة.");
      account = { patient_id: patientId };
    }

    const nextPatientId = account.patient_id;
    if (!isValidPatientId(nextPatientId)) {
      state.patientId = null;
      throw new Error("بيانات ملف المريض غير مكتملة أو غير صالحة. يرجى التواصل مع الدعم.");
    }
    if (state.patientId !== nextPatientId) {
      state.loadedPanels.clear();
      state.loadingPanels.clear();
      state.logs = [];
      state.patient = null;
    }
    state.patientId = nextPatientId;

    await loadPatient();
    document.querySelectorAll("[data-health-tab]").forEach(tab => { tab.hidden = false; });
    const professionalPlanTab = document.querySelector('[data-plan-tab="professional"]');
    if (professionalPlanTab) professionalPlanTab.hidden = false;

    showOnly("portalContent");
    activatePlanTab("self");
    // The invitation result is rendered beside the code field in the professional-plan tab.
    activateHealthTab("portalPlansPanel");
    if (invitationStatus) {
      setMessage("patientProfessionalCodeStatus", invitationStatus,
        invitationStatus.startsWith("تم التحقق") ? "success" : "error");
    }

    if (state.messagesMountedFor !== state.patientId) {
      state.messagesMountedFor = state.patientId;
      void window.DietPlannerPatientMessages?.mountInbox($("patientPortalMessages"), { patientId: state.patientId, role: "patient" });
    }
    const appointmentsRoot = $("patientPortalAppointments");
    if (appointmentsRoot && window.DietPlannerPatientAppointments?.mount) {
      void window.DietPlannerPatientAppointments.mount(appointmentsRoot, {
        patientId: state.patientId,
        role: "patient"
      }).catch(error => {
        console.error("Patient appointments initialization failed:", error);
        appointmentsRoot.textContent = "تعذر تهيئة قسم المواعيد. أعد تحميل الصفحة.";
      });
    }
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

  async function loadPatientAnnouncements() {
    const section = $("patientAnnouncementsSection");
    const host = $("patientAnnouncementsList");
    if (!section || !host || !supabase) return;
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from("announcements")
        .select("id,title,content,type,priority,starts_at,expires_at,created_at")
        .eq("is_active", true)
        .in("audience", ["patient", "both"])
        .lte("starts_at", now)
        .order("priority", { ascending: false })
        .order("starts_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      const current = (data || []).filter(item => !item.expires_at || new Date(item.expires_at).getTime() > Date.now()).slice(0, 3);
      host.replaceChildren();
      if (!current.length) { section.hidden = true; return; }
      const labels = { update: "تحديث جديد", announcement: "إعلان مهم", tip: "نصيحة واستخدام", alert: "تنبيه" };
      current.forEach(item => {
        const card = document.createElement("details");
        card.className = "portal-announcement-card";
        const summary = document.createElement("summary");
        const type = document.createElement("span");
        type.className = "portal-announcement-type";
        type.textContent = labels[item.type] || labels.update;
        const title = document.createElement("strong");
        title.textContent = item.title || "";
        const toggle = document.createElement("span");
        toggle.className = "portal-announcement-toggle";
        toggle.textContent = "عرض التفاصيل";
        summary.append(type, title, toggle);
        const content = document.createElement("p");
        content.textContent = item.content || "";
        card.append(summary, content);
        host.appendChild(card);
      });
      section.hidden = false;
    } catch (error) {
      section.hidden = true;
      console.warn("Patient announcements could not be loaded:", error);
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
    void window.DietPlannerPatientNotifications?.init($("patientNotifications"), user.id).catch(error => {
      console.error("Patient notifications initialization failed:", error);
      const status = $("patientNotifications")?.querySelector("[data-patient-notification-status]");
      if (status) status.textContent = error?.message || "تعذر تحميل الإشعارات حاليًا.";
      const empty = $("patientNotifications")?.querySelector("[data-patient-notification-empty]");
      if (empty) empty.hidden = true;
    });
    void loadPatientAnnouncements();
    $("portalLogout")?.addEventListener("click", () => access.logout());
    $("portalRetry")?.addEventListener("click", () => loadPortal().catch(error => fail(error.message || "تعذر تحميل البيانات.")));
    $("portalInviteForm")?.addEventListener("submit", handleInviteSubmit);
    $("patientSelfProfileForm")?.addEventListener("submit", saveSelfProfile);
    $("patientSharedHealthForm")?.addEventListener("submit", saveSharedHealthRecord);
    $("patientProfessionalCodeForm")?.addEventListener("submit", redeemProfessionalInvitation);
    document.querySelectorAll("[data-health-tab]").forEach(tab => tab.addEventListener("click", () => activateHealthTab(tab.dataset.healthTab)));
    document.querySelectorAll("[data-plan-tab]").forEach(tab => tab.addEventListener("click", () => activatePlanTab(tab.dataset.planTab)));
    const initialSection = window.location.hash.slice(1);
    const patientSections = new Set([
      "portalHome",
      "portalContent",
      "portalDietBuilder",
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
    $("portalToolsPanel")?.addEventListener("change", handleToolQuantity);
    $("portalToolsPanel")?.addEventListener("input", event => {
      if (event.target.matches("#portalInsulinTdd, #portalCurrentGlucose, #portalTargetGlucose, #portalMealCarbs, #portalMealIcr")) calculateInsulinEstimate();
    });
    $("portalToolsPanel")?.addEventListener("change", event => {
      if (event.target.matches("#portalDiabetesType, #portalInsulinRegimen, #portalInsulinKind, #portalInsulinMeal")) calculateInsulinEstimate();
    });
    $("portalCarbSearch")?.addEventListener("input", event => renderFoodSearchResults(event.target.value));
    $("portalCarbPicker")?.addEventListener("keydown", event => { if (event.key === "Escape") closeFoodPicker(); });
    activateToolsTab("portalCarbPanel");
    calculateInsulinEstimate();
    if (new URLSearchParams(window.location.search).has("invite")) {
      openHealthArea();
    } else if (patientSections.has(initialSection)) {
      await window.DietPlannerPatientPortal.navigateToSection(initialSection);
    }
  }

  window.DietPlannerPatientPortal = Object.freeze({
    async navigateToSection(id) {
      const healthSections = [
        "portalContent",
        "portalPlansPanel",
        "portalMeasurementsPanel",
        "portalCareManagementPanel",
        "portalSharedHealthPanel"
      ];
      const destination = id === "portalTools" ? "portalToolsPanel" : id;

      if (healthSections.includes(id)) {
        // Never activate a health tab before loadPortal resolves the patient UUID.
        // showPortalDestination() activates tabs and starts their loaders, so calling
        // it before this gate causes shared-health queries with a null patientId.
        const healthArea = $("portalHealthArea");
        const home = $("portalHome");
        const profile = $("portalProfileArea");
        const tools = $("portalToolsPanel");
        if (healthArea) healthArea.hidden = false;
        if (home) home.hidden = true;
        if (profile) profile.hidden = true;
        if (tools) tools.hidden = true;

        if (!isValidPatientId(state.patientId) || $("portalContent")?.hidden) {
          try {
            await loadPortal();
          } catch (error) {
            fail(error.message || "تعذر تحميل الملف الصحي.");
            return;
          }
          // An unlinked account intentionally remains on the unlinked screen.
          if ($("portalContent")?.hidden || !isValidPatientId(state.patientId)) return;
        }

        // Patient identity and access state are now resolved; it is safe to activate
        // the requested panel and start its data loader.
        showPortalDestination(destination);
        return;
      }

      // Non-health destinations do not require a patient UUID.
      showPortalDestination(destination);
      if (id === "portalProfileArea") {
        try {
          await loadSelfProfile();
        } catch (error) {
          setMessage("selfProfileMessage", error.message || "تعذر تحميل بيانات الحساب.", "error");
        }
      }
    }
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
