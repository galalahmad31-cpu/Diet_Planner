(() => {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const patientParams = new URLSearchParams(window.location.search);
  const rawPatientId = patientParams.get('id') || patientParams.get('patient') || patientParams.get('patient_id');
  const patientId = typeof rawPatientId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawPatientId)
    ? rawPatientId
    : null;

  const state = {
    patient: null,
    user: null,
    isAdmin: false,
    hasActiveSubscription: false,
    isEditing: false,
    isSaving: false,
    isCreatingPlan: false,
    patientCareMode: null,
    patientCareModePromise: null,
    patientFinance: null,
    patientFinanceEditing: false,
    patientFinanceLoading: false,
  };

  const $ = (id) => document.getElementById(id);

  let dietPlanModulePromise = null;

  function setLink(id, page) {
    const element = $(id);
    if (element && patientId) {
      element.href = `${page}?id=${encodeURIComponent(patientId)}`;
    }
  }

  function showError(message) {
    $('loadingState')?.classList.add('hidden');
    $('patientContent')?.classList.add('hidden');
    $('modulesSection')?.classList.add('hidden');
    $('errorState')?.classList.remove('hidden');
    const errorText = $('errorText');
    if (errorText) errorText.textContent = message;
  }

  async function refreshWriteAccess() {
    // Permission checks are deliberately independent from patient data loading.
    // A delayed role/subscription RPC must never keep the profile screen in loading state.
    try {
      if (!state.user?.id) {
        state.isAdmin = false;
        state.hasActiveSubscription = false;
        updateWriteControls();
        return;
      }

      const role = await access?.getUserRole?.(state.user.id);
      state.isAdmin = role === 'admin';
      state.hasActiveSubscription = state.isAdmin
        ? true
        : (await access?.hasActiveSubscription?.(state.user.id)) === true;

      updateWriteControls();
    } catch (error) {
      console.error('Patient profile access check failed:', error);
      state.isAdmin = false;
      state.hasActiveSubscription = false;
      updateWriteControls();
    } finally {
      if (state.user?.id && state.patient) {
        await loadPatientCareMode();
      }
    }
  }

  function updateWriteControls() {
    const canWrite = canWritePatientPrivateData() || canEditSharedHealth();
    const canManageCare = canManagePatientCare();

    const editButton = $('editButton');
    const addPlanButton = $('addPlanButton');
    const addExchangePlanButton = $('addExchangePlanButton');
    

    if (editButton) {
      editButton.disabled = !canWrite;
      editButton.classList.toggle('opacity-50', !canWrite);
      editButton.classList.toggle('cursor-not-allowed', !canWrite);
      editButton.title = canWrite
        ? 'تعديل بيانات المريض'
        : 'تعديل بيانات المريض متاح أثناء الاشتراك المدفوع فقط';
    }

    [addPlanButton, addExchangePlanButton].forEach(button => {
      if (!button) return;
      button.disabled = !canManageCare || state.isCreatingPlan;
      button.classList.toggle('opacity-50', !canWrite);
      button.classList.toggle('cursor-not-allowed', !canWrite);
      button.title = canManageCare ? 'إضافة خطة غذائية' : 'تتطلب إدارة الخطة ارتباط متابعة نشطًا أو ملكية الملف';
    });

    const accessBox = $('writeAccessStatus');
    if (accessBox) {
      if (canEditSharedHealth()) {
        accessBox.textContent = 'مالك الملف — يمكنك إدارة البيانات الصحية والمالية من مساحة المختص.';
        accessBox.className =
          'mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
      } else if (canWritePatientPrivateData()) {
        accessBox.textContent = 'الاشتراك فعال — يمكنك إدارة ملف المريض المملوك لحسابك.';
        accessBox.className =
          'mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
      } else {
        accessBox.textContent =
          'لا توجد صلاحية تعديل حالية لهذا الملف. يمكنك الاطلاع وفق صلاحيات الوصول المتاحة.';
        accessBox.className =
          'mt-4 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2';
      }
    }
    if (state.patientCareMode === 'owner') {
      setPatientFinanceEditing(state.patientFinanceEditing);
    }
    if (measurementState.loaded) renderMeasurements();
  }

  function canWritePatientPrivateData() {
    const ownsWorkspace = Boolean(state.user?.id && state.patient?.user_id === state.user.id);
    return ownsWorkspace && (state.isAdmin || state.hasActiveSubscription) && sharedHealthState.expired === false;
  }

  function canManagePatientFinance() {
    const ownsWorkspace = Boolean(state.user?.id && state.patient?.user_id === state.user.id);
    return ownsWorkspace && (state.isAdmin || state.hasActiveSubscription);
  }

  function canManagePatientCare() {
    return canWritePatientPrivateData() || canEditSharedHealth();
  }

  window.DietPlannerPatientProfileAccess = Object.freeze({
    canManagePatientCare
  });

  function canWrite() {
    return canWritePatientPrivateData();
  }

  function canEditSharedHealth() {
    return state.patientCareMode === 'owner' && sharedHealthState.expired === false;
  }

  function canEditPatientPrivateFields() {
    return (!state.patientCareMode || state.patientCareMode === 'owner') && canWrite();
  }

  async function loadPatient() {
    if (!supabase) {
      showError('تعذر الاتصال بقاعدة البيانات.');
      return;
    }

    if (!patientId) {
      showError('لم يتم تحديد المريض.');
      return;
    }

    let result;
    let timeoutId;
    try {
      const request = supabase
        .from('patients')
        .select('id,user_id,name,phone,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,energy_target_calories,energy_target_protein,energy_target_carb,energy_target_fat,energy_approved_at,created_at,updated_at')
        .eq('id', patientId)
        .maybeSingle();

      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('انتهت مهلة الاتصال بقاعدة البيانات أثناء تحميل ملف المريض.')),
          15000
        );
      });

      result = await Promise.race([request, timeout]);
    } catch (requestError) {
      console.error('Patient record request failed or timed out:', requestError);
      showError(requestError?.message || 'تعذر الاتصال بقاعدة البيانات أثناء تحميل ملف المريض.');
      return;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const { data, error } = result;
    if (error) {
      console.error('Load patient failed:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      showError('تعذر تحميل ملف المريض. يرجى مراجعة الاتصال والصلاحيات.');
      return;
    }

    if (!data) {
      // RLS returns no row unless the user owns the workspace, is the patient,
      // or has an active/read-only care relationship. Do not weaken the policy here.
      showError('ملف المريض غير موجود أو لا تملك صلاحية الوصول إليه.');
      return;
    }

    if (!state.user?.id || data.user_id !== state.user.id) {
      showError('هذه الصفحة مخصصة للمختص مالك الملف. استخدم بوابة المريض لعرض ملفك الصحي.');
      return;
    }

    state.patient = data;
    fillPatientData();

    // Reveal the loaded patient immediately. Access checks and secondary modules
    // run afterward and cannot block the main patient record.
    $('loadingState')?.classList.add('hidden');
    $('errorState')?.classList.add('hidden');
    $('patientContent')?.classList.remove('hidden');
    $('modulesSection')?.classList.remove('hidden');

    updateWriteControls();
    await loadNutritionPlans();
  }


  // Inline patient measurements use the same owner-or-active-care permission
  // model as the database policies, without navigating away from this profile.
  const measurementState = { logs: [], loaded: false, loading: false };

  function formatMeasurementDelta(value) {
    if (!Number.isFinite(value)) return { value: '—', note: 'لا توجد بيانات كافية', trend: 'neutral' };
    const rounded = Math.round(Math.abs(value) * 10) / 10;
    if (Math.abs(value) < 0.05) return { value: '0.0 كجم', note: 'لا يوجد تغير', trend: 'neutral' };
    return value > 0
      ? { value: `+${rounded.toFixed(1)} كجم`, note: 'زيادة في الوزن', trend: 'up' }
      : { value: `−${rounded.toFixed(1)} كجم`, note: 'انخفاض في الوزن', trend: 'down' };
  }

  function updateMeasurementSummary() {
    const logs = measurementState.logs;
    const overallValue = $('weightChangeOverall');
    const overallNote = $('weightChangeOverallNote');
    const recentValue = $('weightChangeRecent');
    const recentNote = $('weightChangeRecentNote');
    const bmiValue = $('latestMeasurementBmi');
    const bmiNote = $('latestMeasurementBmiNote');
    if (!overallValue || !overallNote || !recentValue || !recentNote || !bmiValue || !bmiNote) return;

    const validLogs = logs.filter(log => Number.isFinite(log.weight) && log.weight > 0);
    const first = validLogs[0];
    const latest = validLogs[validLogs.length - 1];
    const overall = first && latest ? formatMeasurementDelta(latest.weight - first.weight) : null;
    overallValue.textContent = overall?.value || '—';
    overallNote.textContent = overall ? (validLogs.length > 1 ? overall.note : 'هذا هو القياس المسجل الأول') : 'لا توجد قياسات مسجلة';
    overallValue.dataset.trend = overall?.trend || 'neutral';

    const previous = validLogs.length > 1 ? validLogs[validLogs.length - 2] : null;
    const recent = previous && latest ? formatMeasurementDelta(latest.weight - previous.weight) : null;
    recentValue.textContent = recent?.value || '—';
    recentNote.textContent = recent ? recent.note : 'يلزم تسجيل قياسين على الأقل';
    recentValue.dataset.trend = recent?.trend || 'neutral';

    const heightCm = Number(state.patient?.height);
    if (latest && Number.isFinite(heightCm) && heightCm > 0) {
      const bmi = latest.weight / Math.pow(heightCm / 100, 2);
      bmiValue.textContent = Number.isFinite(bmi) ? bmi.toFixed(1) : '—';
      bmiNote.textContent = Number.isFinite(bmi) ? `بناءً على آخر وزن (${latest.weight.toFixed(1)} كجم)` : 'تعذر حساب المؤشر';
    } else {
      bmiValue.textContent = '—';
      bmiNote.textContent = latest ? 'أدخل طول المريض في بياناته لحساب BMI' : 'لا يوجد وزن مسجل لحساب BMI';
    }
    bmiValue.dataset.trend = 'neutral';
  }

  function renderMeasurements() {
    updateMeasurementSummary();
    const tableRenderer = window.DietPlannerWeightLogs;
    if (!tableRenderer || typeof tableRenderer.render !== "function") {
      showMeasurementError("تعذر تحميل مكوّن جدول القياسات. حدّث الصفحة وحاول مرة أخرى.");
      return;
    }
    tableRenderer.render({
      container: $("weightTableContainer"),
      logs: measurementState.logs,
      addDisabled: !canManagePatientCare(),
      actionCell: (_log, index) => canManagePatientCare() ? `
        <div class="measurement-row-actions">
          <button type="button" class="measurement-edit-button" data-measurement-edit="${index}" aria-label="تعديل القياس">تعديل</button>
          <button type="button" class="measurement-delete-button" data-measurement-delete="${index}" aria-label="حذف القياس">حذف</button>
        </div>` : ''
    });
  }

  async function loadMeasurements() {
    if (measurementState.loaded || measurementState.loading || !patientId || !supabase) return;
    measurementState.loading = true;
    const loading = $('measurementsLoading');
    const errorBox = $('measurementsError');
    if (loading) loading.hidden = false;
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    try {
      const { data, error } = await supabase
        .from('weight_logs')
        .select('id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at')
        .eq('patient_id', patientId)
        .order('measurement_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      measurementState.logs = (data || []).map(item => ({
        id: item.id,
        date: item.measurement_date,
        createdAt: item.created_at || '',
        weight: Number(item.weight),
        bodyFat: item.body_fat_percent == null ? null : Number(item.body_fat_percent),
        muscle: item.muscle_percent == null ? null : Number(item.muscle_percent),
        water: item.water_percent == null ? null : Number(item.water_percent),
        waist: item.waist_cm == null ? null : Number(item.waist_cm),
        hip: item.hip_cm == null ? null : Number(item.hip_cm),
        adherence: item.diet_adherence || '',
        notes: item.notes || ''
      }));
      measurementState.loaded = true;
      renderMeasurements();
    } catch (error) {
      console.error('Patient inline measurements load failed:', error);
      if (errorBox) {
        errorBox.textContent = 'تعذر تحميل سجل القياسات. تحقق من الاتصال وصلاحيات قاعدة البيانات ثم أعد فتح القسم.';
        errorBox.hidden = false;
      }
    } finally {
      measurementState.loading = false;
      if (loading) loading.hidden = true;
    }
  }

  function createMeasurementEditor(log = null) {
    return window.DietPlannerWeightLogs.createEditorRow(log);
  }

  function openMeasurementEntry() {
    if (!canManagePatientCare()) { showMeasurementError('إضافة القياسات تتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.'); return; }
    if (!measurementState.loaded) { void loadMeasurements().then(() => { if (measurementState.loaded) openMeasurementEntry(); }); return; }
    const body = $('weightTableBody');
    if (!body || body.querySelector('[data-measurement-editor]')) return;
    const row = createMeasurementEditor();
    body.prepend(row);
    row.querySelector('[data-field="weight"]')?.focus();
    const errorBox = $('measurementsError'); if (errorBox) errorBox.hidden = true;
  }

  function editMeasurementEntry(index) {
    if (!canManagePatientCare()) { showMeasurementError('تعديل القياسات يتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.'); return; }
    const log = measurementState.logs[index];
    const body = $('weightTableBody');
    const currentRow = body?.querySelectorAll('tr')[index];
    if (!log || !currentRow || body.querySelector('[data-measurement-editor]')) return;
    const editor = createMeasurementEditor(log);
    currentRow.replaceWith(editor);
    editor.querySelector('[data-field="weight"]')?.focus();
  }

  async function saveMeasurementEntry(row) {
    if (!row || row.dataset.saving === 'true') return;
    if (!canManagePatientCare()) {
      showMeasurementError('انتهت صلاحية إدارة القياسات لهذا المريض.');
      renderMeasurements();
      return;
    }
    const read = field => row.querySelector('[data-field="' + field + '"]')?.value?.trim() ?? '';
    const numeric = field => read(field) === '' ? null : Number(read(field));
    const payload = { date: read('date'), weight: numeric('weight'), bodyFat: numeric('bodyFat'), muscle: numeric('muscle'), water: numeric('water'), waist: numeric('waist'), hip: numeric('hip'), adherence: read('adherence') || null, notes: read('notes') || null };
    const validPercent = value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
    if (!payload.date || !Number.isFinite(payload.weight) || payload.weight <= 0) { showMeasurementError('أدخل تاريخ القياس والوزن بصورة صحيحة.'); row.querySelector('[data-field="weight"]')?.focus(); return; }
    if (![payload.bodyFat, payload.muscle, payload.water].every(validPercent)) { showMeasurementError('النسب المئوية يجب أن تكون بين 0 و100%.'); return; }
    if ([payload.waist, payload.hip].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) { showMeasurementError('محيطات الجسم يجب أن تكون أرقامًا أكبر من صفر.'); return; }
    row.dataset.saving = 'true'; const saveButton = row.querySelector('[data-measurement-save]');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'جارٍ الحفظ'; }
    try {
      const record = { patient_id: patientId, weight: payload.weight, measurement_date: payload.date, body_fat_percent: payload.bodyFat, muscle_percent: payload.muscle, water_percent: payload.water, waist_cm: payload.waist, hip_cm: payload.hip, diet_adherence: payload.adherence, notes: payload.notes };
      const editingId = row.dataset.measurementEditorId || '';
      const query = editingId
        ? supabase.from('weight_logs').update(record).eq('id', editingId).eq('patient_id', patientId)
        : supabase.from('weight_logs').insert(record);
      const { data, error } = await query.select('id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at').single();
      if (error) throw error;
      const savedLog = { id: data.id, date: data.measurement_date, createdAt: data.created_at || '', weight: Number(data.weight), bodyFat: data.body_fat_percent == null ? null : Number(data.body_fat_percent), muscle: data.muscle_percent == null ? null : Number(data.muscle_percent), water: data.water_percent == null ? null : Number(data.water_percent), waist: data.waist_cm == null ? null : Number(data.waist_cm), hip: data.hip_cm == null ? null : Number(data.hip_cm), adherence: data.diet_adherence || '', notes: data.notes || '' };
      if (editingId) {
        const existingIndex = measurementState.logs.findIndex(log => String(log.id) === String(editingId));
        if (existingIndex >= 0) measurementState.logs[existingIndex] = savedLog;
      } else {
        measurementState.logs.push(savedLog);
      }
      measurementState.logs.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
      renderMeasurements();
    } catch (error) {
      console.error('Save patient measurement failed:', error); row.dataset.saving = 'false';
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'حفظ'; }
      showMeasurementError(error?.message || error?.details || error?.hint || 'تحقق من الاتصال وصلاحيات الحفظ.');
    }
  }

  function showMeasurementError(message) { const box = $('measurementsError'); if (box) { box.textContent = String(message || 'حدث خطأ غير متوقع.'); box.hidden = false; } }

  async function deleteMeasurement(index) {
    if (!canManagePatientCare()) { showMeasurementError('حذف القياسات يتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.'); return; }
    const entry = measurementState.logs[index];
    if (!entry) return;

    if (!state.user?.id) {
      await Swal.fire({
        icon: 'warning',
        title: 'تسجيل الدخول مطلوب',
        text: 'يجب تسجيل الدخول قبل حذف القياسات.',
        confirmButtonText: 'حسنًا',
        buttonsStyling: false,
        customClass: {
          popup: 'visit-delete-popup',
          title: 'visit-delete-title',
          htmlContainer: 'visit-delete-text',
          confirmButton: 'visit-delete-confirm'
        },
        heightAuto: false
      });
      return;
    }

    const confirmed = await window.DPConfirm?.ask({
      title: 'حذف القياس؟',
      message: 'هل أنت متأكد من حذف القياس المحدد؟',
      confirmText: 'حذف',
      variant: 'danger'
    });
    if (!confirmed) return;

    const { error } = await supabase.from('weight_logs')
      .delete()
      .eq('id', entry.id)
      .eq('patient_id', patientId);
    if (error) {
      console.error('Delete patient measurement failed:', error);
      await Swal.fire('تعذر الحذف', 'تعذر حذف القياس من قاعدة البيانات. حاول مرة أخرى.', 'error');
      return;
    }

    measurementState.logs = measurementState.logs.filter(log => log.id !== entry.id);
    renderMeasurements();

    await Swal.fire({
      toast: true,
      position: 'top',
      icon: 'success',
      title: 'تم حذف القياس بنجاح',
      showConfirmButton: false,
      timer: 1800,
      timerProgressBar: true,
      heightAuto: false
    });
  }

  async function setPatientPlanPublication(plan, shouldPublish, button) {
    if (!plan?.id || !button) return;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = shouldPublish ? 'جاري النشر...' : 'جاري الإخفاء...';
    try {
      const rpc = shouldPublish
        ? 'publish_patient_nutrition_plan'
        : 'revoke_patient_nutrition_plan';
      const { error } = await supabase.rpc(rpc, { p_plan_id: plan.id });
      if (error) throw error;
      await loadNutritionPlans();
      if (window.Swal?.fire) {
        await window.Swal.fire({
          icon: 'success',
          title: shouldPublish ? 'تم نشر الخطة' : 'تم إخفاء الخطة',
          text: shouldPublish
            ? 'أصبحت الخطة متاحة للمريض في بوابته.'
            : 'لم تعد الخطة ظاهرة للمريض.',
          confirmButtonText: 'حسنًا'
        });
      }
    } catch (error) {
      console.error('Patient plan publication update failed:', error);
      if (window.Swal?.fire) {
        await window.Swal.fire({
          icon: 'error',
          title: 'تعذر تحديث حالة النشر',
          text: error.message || 'حاول مرة أخرى.',
          confirmButtonText: 'حسنًا'
        });
      } else {
        window.alert(error.message || 'تعذر تحديث حالة النشر.');
      }
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function loadNutritionPlans({ autoOpenLatest = false } = {}) {
    const loading = $('visitsLoading');
    const empty = $('visitsEmpty');
    const list = $('visitsList');
    if (!loading || !empty || !list) return [];

    loading.hidden = false;
    loading.textContent = 'جاري تحميل الخطط الغذائية...';
    empty.hidden = true;
    list.replaceChildren();

    const { data, error } = await supabase
      .from('nutrition_plans')
      .select('id,patient_id,plan_name,start_date,updated_at,created_at')
      .eq('patient_id', patientId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false });

    loading.hidden = true;
    if (error) {
      console.error('Load nutrition plans failed:', error);
      loading.hidden = false;
      loading.textContent = 'تعذر تحميل الخطط الغذائية.';
      return [];
    }
    if (!data?.length) {
      empty.hidden = false;
      return [];
    }

    const { data: publicationRows, error: publicationError } = await supabase
      .from('patient_plan_publications')
      .select('plan_id,revoked_at')
      .in('plan_id', data.map(plan => plan.id));
    if (publicationError) {
      console.error('Load patient plan publication states failed:', publicationError);
    }
    const publicationByPlan = new Map(
      (publicationRows || []).map(publication => [String(publication.plan_id), publication])
    );

    const planNumberById = new Map(
      [...data]
        .sort((a, b) => String(a.created_at || a.start_date || '').localeCompare(String(b.created_at || b.start_date || '')))
        .map((plan, index) => {
          const savedNumber = /^الخطة\s+(\d+)/.exec(String(plan.plan_name || ''))?.[1];
          return [String(plan.id), savedNumber ? Number(savedNumber) : index + 1];
        })
    );

    data.forEach((plan) => {
      const planNumber = planNumberById.get(String(plan.id)) || 1;
      const row = document.createElement('article');
      row.className = 'followup-day-row';

      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'followup-day-open';
      openButton.dataset.openPlan = plan.id;
      openButton.dataset.planType = plan.plan_name || '';
      openButton.setAttribute('aria-label', 'فتح ' + (plan.plan_name || 'الخطة الغذائية'));

      const number = document.createElement('span');
      number.className = 'followup-day-number';
      number.textContent = String(planNumber);
      number.setAttribute('aria-label', 'الخطة رقم ' + planNumber);

      const title = document.createElement('strong');
      title.className = 'followup-day-title';
      const planDate = plan.start_date || plan.created_at;
      const dateLabel = planDate ? new Date(planDate).toLocaleDateString('en-GB') : 'بدون تاريخ';
      title.textContent = `الخطة ${planNumber} - ${dateLabel}`;
      openButton.append(number, title);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'followup-day-delete';
      deleteButton.title = 'حذف الخطة';
      deleteButton.setAttribute('aria-label', 'حذف الخطة');
      deleteButton.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      deleteButton.addEventListener('click', () => void deleteNutritionPlan(plan));

      const publication = publicationByPlan.get(String(plan.id));
      const isPublished = Boolean(publication && !publication.revoked_at);
      const publicationButton = document.createElement('button');
      publicationButton.type = 'button';
      publicationButton.className = 'followup-day-publish' + (isPublished ? ' is-published' : '');
      publicationButton.textContent = isPublished ? 'إخفاء عن المريض' : 'نشر للمريض';
      publicationButton.title = publicationError
        ? 'تعذر التحقق من حالة النشر'
        : isPublished
          ? 'إيقاف ظهور هذه الخطة للمريض'
          : 'إتاحة هذه الخطة للمريض في بوابته';
      publicationButton.disabled = Boolean(publicationError);
      publicationButton.setAttribute('aria-label', publicationButton.title);
      publicationButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void setPatientPlanPublication(plan, !isPublished, publicationButton);
      });

      row.append(openButton, publicationButton, deleteButton);
      list.appendChild(row);
    });

    const activePanel = $('planWorkspacePanel');
    const activePlanId = activePanel?.dataset.planId || '';
    if (activePlanId) {
      const stillExists = data.some(item => String(item.id) === String(activePlanId));
      if (!stillExists) closePlanWorkspace();
      else list.querySelectorAll('[data-open-plan]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.openPlan === activePlanId);
      });
    }

    if (autoOpenLatest) {
      // The query is already ordered by latest update, then creation date.
      // Select from all plans and let openPlanWorkspace choose the editor
      // from the selected plan's actual name (grams or exchanges).
      const latestPlan = data[0];
      if (latestPlan) {
        await openPlanWorkspace(latestPlan.id, latestPlan.plan_name || '');
      }
    }
    return data;
  }

  async function loadDietPlanModule() {
    if (typeof window.dietPlan?.openPlan === 'function') return true;
    if (dietPlanModulePromise) return dietPlanModulePromise;

    dietPlanModulePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/visit-diet-plan.js?v=20261123-publication-safe-edit-v1';
      script.async = true;
      script.onload = () => {
        if (typeof window.dietPlan?.openPlan !== 'function') {
          reject(new Error(window.__dpDietPlanLoadError || 'تعذر تهيئة محرر الخطة الغذائية.'));
          return;
        }
        resolve(true);
      };
      script.onerror = () => reject(new Error('تعذر تحميل محرر الخطة الغذائية.'));
      document.head.appendChild(script);
    }).catch(error => {
      dietPlanModulePromise = null;
      console.error('Direct diet-plan module load failed:', error);
      return false;
    });

    return dietPlanModulePromise;
  }

  let exchangePlanModulePromise = null;

  async function loadExchangePlanModule() {
    if (typeof window.exchangePlan?.init === 'function') return true;
    if (exchangePlanModulePromise) return exchangePlanModulePromise;
    exchangePlanModulePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'js/visit-exchange-plan.js?v=20261123-atomic-exchange-save-v2';
      script.async = true;
      script.onload = () => typeof window.exchangePlan?.init === 'function'
        ? resolve(true)
        : reject(new Error('تعذر تهيئة محرر خطة البدائل.'));
      script.onerror = () => reject(new Error('تعذر تحميل محرر خطة البدائل.'));
      document.head.appendChild(script);
    }).catch(error => {
      exchangePlanModulePromise = null;
      console.error('Direct exchange-plan module load failed:', error);
      return false;
    });
    return exchangePlanModulePromise;
  }

  function bindDietPlanActions() {
    if (document.documentElement.dataset.dpDirectDietActionsBound === 'true') return;
    document.documentElement.dataset.dpDirectDietActionsBound = 'true';

    const isDietPlanElement = (element) => Boolean(
      element?.closest(
        '#planWorkspace, #foodModal, #fixedMealsModal, #addMealModal, #printSettingsModal, #dayDetailsModal'
      )
    );

    document.addEventListener('click', async (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || !isDietPlanElement(target)) return;
      const action = target.dataset.action || '';
      if (action === 'executeActivePrint') {
        event.preventDefault();
        if (target.dataset.printMode === 'exchange') await window.exchangePlan?.saveAndPrintFromSettings?.();
        else window.dietPlan?.executePrint?.();
        return;
      }
      if (action.startsWith('exchangePlan.')) {
        const method = window.exchangePlan?.[action.slice('exchangePlan.'.length)];
        if (typeof method !== 'function') return;
        event.preventDefault();
        method(event);
        return;
      }
      if (!action.startsWith('dietPlan.')) return;
      if (action === 'dietPlan.closePrintSettingsModal' && target.closest('#printSettingsModal') && target.closest('#printSettingsModal').classList.contains('hidden') === false && target.dataset.printMode !== 'exchange' && $('executePrintBtn')?.dataset.printMode === 'exchange') {
        event.preventDefault();
        $('printSettingsModal')?.classList.add('hidden');
        delete $('executePrintBtn')?.dataset.printMode;
        return;
      }
      const method = window.dietPlan?.[action.slice('dietPlan.'.length)];
      if (typeof method !== 'function') return;
      event.preventDefault();
      method(event);
    });

    const runInputAction = (event) => {
      const target = event.target.closest('[data-action-input]');
      if (!target || !isDietPlanElement(target)) return;
      const method = window.dietPlan?.[target.dataset.actionInput];
      if (typeof method === 'function') method(event);
    };
    document.addEventListener('input', runInputAction);
  }

  async function openPlanWorkspace(planId = null, planType = '') {
    const panel = $('planWorkspacePanel');
    const gramsContent = $('dietPlanContent');
    const exchangeContent = $('exchangePlanContent');
    if (!panel || !gramsContent || !exchangeContent || !patientId) return;

    const isExchange = String(planType || '').includes('البدائل');
    panel.hidden = false;
    gramsContent.classList.toggle('hidden', isExchange);
    exchangeContent.classList.toggle('hidden', !isExchange);
    panel.dataset.planId = planId ? String(planId) : '';
    panel.dataset.planType = isExchange ? 'exchange' : 'grams';
    window.currentPatientId = state.patient?.id || patientId;
    window.currentPatientEnergy = state.patient || {};

    document.querySelectorAll('[data-open-plan]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.openPlan === String(planId || ''));
    });

    bindDietPlanActions();
    try {
      if (isExchange) {
        const loaded = await loadExchangePlanModule();
        if (!loaded) throw new Error('تعذر تحميل محرر خطة البدائل.');
        await window.exchangePlan.init(planId || null);
      } else {
        const loaded = await loadDietPlanModule();
        if (!loaded) throw new Error('تعذر تحميل محرر الخطة الغذائية.');
        await window.dietPlan.openPlan(planId, !planId);
      }
    } catch (error) {
      console.error('Open direct nutrition plan failed:', error);
      const status = $('visitsLoading');
      if (status) {
        status.hidden = false;
        status.textContent = error?.message || 'تعذر فتح الخطة الغذائية.';
      }
    }
  }

  function closePlanWorkspace() {
    const panel = $('planWorkspacePanel');
    if (panel) {
      panel.hidden = true;
      delete panel.dataset.planId;
      delete panel.dataset.planType;
      $('dietPlanContent')?.classList.add('hidden');
      $('exchangePlanContent')?.classList.add('hidden');
    }
    window.dietPlan?.closeDayDetails?.();
    window.exchangePlan?.closeConfirmModal?.();
    const printSettingsModal = $('printSettingsModal');
    printSettingsModal?.classList.add('hidden');
    const executePrintButton = $('executePrintBtn');
    if (executePrintButton) delete executePrintButton.dataset.printMode;
    window.dietPlan?.closeFoodModal?.();
    window.dietPlan?.closeFixedMeals?.();
    window.dietPlan?.closeAddMealModal?.();
    window.dietPlan?.closeConfirmModal?.();
    document.querySelectorAll('[data-open-plan]').forEach(button => button.classList.remove('is-active'));
  }

  function formatPlanDate(date) {
    if (!date) return 'بدون تاريخ';
    const value = new Date(`${date}T00:00:00`);
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric'
    }).format(value);
  }

  async function deleteNutritionPlan(plan) {
    if (!canManagePatientCare()) {
      alert('حذف الخطة يتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.');
      return;
    }
    if (String(plan.plan_name || '').includes('البدائل')) {
      const loaded = await loadExchangePlanModule();
      if (!loaded) {
        await Swal.fire('تعذر الحذف', 'تعذر تحميل وحدة خطة البدائل.', 'error');
        return;
      }
      await openPlanWorkspace(plan.id, plan.plan_name);
      window.exchangePlan.deletePlan();
      return;
    }
    const confirmed = await window.DPConfirm?.ask({
      title: 'حذف الخطة الغذائية؟',
      message: `هل تريد حذف "${plan.plan_name || 'الخطة'}"؟ سيتم حذف الأيام والوجبات والأصناف التابعة لها.`,
      confirmText: 'حذف الخطة',
      variant: 'danger'
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('nutrition_plans').delete()
        .eq('id', plan.id).eq('patient_id', patientId);
      if (error) throw error;

      if (String($('planWorkspacePanel')?.dataset.planId || '') === String(plan.id)) closePlanWorkspace();
      await loadNutritionPlans();
    } catch (error) {
      console.error('Delete nutrition plan failed:', error);
      await Swal.fire('تعذر الحذف', error.message || 'حدث خطأ أثناء حذف الخطة.', 'error');
    }
  }

  async function addNutritionPlan() {
    if (!canManagePatientCare()) {
      alert('إدارة خطط هذا المريض تتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.');
      return;
    }
    if (state.isCreatingPlan || !patientId) return;
    state.isCreatingPlan = true;
    updateWriteControls();
    try {
      const { data: planId, error } = await supabase.rpc('create_nutrition_plan', { p_patient_id: patientId });
      if (error) throw error;
      if (!planId) throw new Error('لم يتم استلام معرّف الخطة الجديدة.');
      await loadNutritionPlans();
      openPlanWorkspace(planId, '');
    } catch (error) {
      console.error('Create nutrition plan failed:', error);
      await Swal.fire('تعذر إضافة الخطة', error.message || 'حدث خطأ أثناء إنشاء الخطة الغذائية.', 'error');
    } finally {
      state.isCreatingPlan = false;
      updateWriteControls();
    }
  }

  async function addExchangeNutritionPlan() {
    if (!canManagePatientCare()) {
      alert('إدارة خطط هذا المريض تتطلب ارتباط متابعة نشطًا أو صلاحية مالك الملف.');
      return;
    }
    if (state.isCreatingPlan || !patientId) return;
    state.isCreatingPlan = true;
    updateWriteControls();
    try {
      const { data: planId, error } = await supabase.rpc('create_nutrition_plan', { p_patient_id: patientId });
      if (error) throw error;
      if (!planId) throw new Error('لم يتم استلام معرّف الخطة الجديدة.');
      const { error: renameError } = await supabase
        .from('nutrition_plans')
        .update({ plan_name: 'الخطة الغذائية باستخدام البدائل' })
        .eq('id', planId)
        .eq('patient_id', patientId);
      if (renameError) {
        const { error: cleanupError } = await supabase.from('nutrition_plans').delete().eq('id', planId).eq('patient_id', patientId);
        if (cleanupError) console.error('Failed to clean up unlabelled exchange plan:', cleanupError);
        throw renameError;
      }
      await loadNutritionPlans();
      await openPlanWorkspace(planId, 'الخطة الغذائية باستخدام البدائل');
    } catch (error) {
      console.error('Create exchange nutrition plan failed:', error);
      await Swal.fire('تعذر إضافة خطة البدائل', error.message || 'حدث خطأ أثناء إنشاء الخطة.', 'error');
    } finally {
      state.isCreatingPlan = false;
      updateWriteControls();
    }
  }

  function fillPatientData() {
    const patient = state.patient;
    if (!patient) return;

    $('patientName').textContent = patient.name || 'بدون اسم';
    $('nameInput').value = patient.name || '';
    $('phoneInput').value = patient.phone || '';
    $('genderInput').value = ['male', 'ذكر'].includes(patient.gender) ? 'male' : ['female', 'أنثى'].includes(patient.gender) ? 'female' : '';
    $('birthDateInput').value = patient.birth_date || '';
    $('ageInput').value = patient.age ?? '';
    $('ageInput').disabled = true;
    $('ageInput').readOnly = true;
    $('heightInput').value = patient.height ?? '';
    $('diagnosisInput').value = patient.diagnosis || '';
    $('complaintsInput').value = patient.complaints || '';
    $('notesInput').value = patient.clinical_notes || '';
    renderSharedHealthInProfessionalProfile();
  }

  const sharedHealthFieldIds = [
    'genderInput', 'birthDateInput', 'heightInput', 'diagnosisInput', 'complaintsInput'
  ];
  const patientFieldIds = [
    'nameInput', 'phoneInput', 'notesInput'
  ];
  function setEditing(enabled) {
    state.isEditing = Boolean(enabled);
    const canEditPrivate = state.isEditing && canEditPatientPrivateFields() && !state.isSaving;
    const canEditShared = state.isEditing && canEditSharedHealth() && !state.isSaving;
    patientFieldIds.forEach(id => { const field = $(id); if (field) field.disabled = !canEditPrivate; });
    sharedHealthFieldIds.forEach(id => { const field = $(id); if (field) field.disabled = !canEditShared; });
    if ($('saveArea')) $('saveArea').hidden = !enabled;
    if ($('editButton')) $('editButton').hidden = enabled;
    updateSharedHealthWriteState();
  }
  function enableEditing() {
    if (!canEditPatientPrivateFields() && !canEditSharedHealth()) {
      alert('لا توجد صلاحية تعديل لهذا الملف حاليًا.');
      return;
    }
    setEditing(true);
  }
  function cancelEditing() { setEditing(false); fillPatientData(); }

  async function savePatientSection() {
    if (!canWrite() || !state.isEditing) return false;

    const payload = {
      name: $('nameInput').value.trim() || 'مريض',
      phone: $('phoneInput').value.trim() || null,
      clinical_notes: $('notesInput').value.trim() || null
    };

    const { data, error } = await supabase
      .from('patients')
      .update(payload)
      .eq('id', patientId)
      .select('id,user_id,name,phone,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
      .single();

    if (error) {
      console.error('Save patient contact/admin fields failed:', error);
      alert('تعذر حفظ بيانات الاتصال والملاحظات الإدارية.');
      return false;
    }

    state.patient = { ...state.patient, ...data };
    return true;
  }

  const sharedHealthState = {
    loaded: false,
    loading: false,
    saving: false,
    expired: null,
    history: []
  };
  const sharedHealthLabels = {
    name: 'اسم المريض', gender: 'النوع', birth_date: 'تاريخ الميلاد', age: 'العمر', height: 'الطول',
    diagnosis: 'التشخيص', complaints: 'الشكوى'
  };

  function updateSharedHealthWriteState() {
    const host = $('professionalSharedHealthStatus');
    const button = $('savePatientButton');
    const fields = sharedHealthFieldIds.map(id => $(id)).filter(Boolean);
    const expired = sharedHealthState.expired === true;
    const verified = sharedHealthState.expired === false;
    fields.forEach(field => {
      field.disabled = !state.isEditing || !canEditSharedHealth() || state.isSaving;
    });
    if (host) {
      host.textContent = expired
        ? 'انتهت مدة المتابعة المسجلة في Finance؛ الملف متاح للعرض فقط.'
        : verified
          ? 'يمكنك تعديل البيانات الصحية، ويُسجّل النظام مصدر كل تعديل ووقته.'
          : 'جارٍ التحقق من صلاحية الاتفاق؛ التعديل متوقف مؤقتًا.';
    }
    if (button) button.disabled = state.isSaving || sharedHealthState.saving;
  }

  async function loadPatientFinanceFollowUpStatus() {
    if (!state.user?.id || !patientId || !supabase) {
      sharedHealthState.expired = true;
      updateSharedHealthWriteState();
      return;
    }
    try {
      const { data, error } = await supabase.from('patient_finances')
        .select('subscription_end_date')
        .eq('patient_id', patientId)
        .eq('user_id', state.user.id)
        .maybeSingle();
      if (error) throw error;
      const now = new Date();
      const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      sharedHealthState.expired = !data?.subscription_end_date || data.subscription_end_date < today;
    } catch (error) {
      sharedHealthState.expired = null;
      console.warn('Could not verify Finance follow-up status; clinical editing remains locked:', error);
    }
    updateSharedHealthWriteState();
    updateWriteControls();
  }

  async function loadSharedHealthHistory() {
    if (state.patientCareMode !== 'owner' || !patientId || !supabase || !state.user?.id || sharedHealthState.loading) return;
    sharedHealthState.loading = true;
    const root = $('professionalSharedHealthHistory');
    if (root) root.textContent = 'جاري تحميل سجل التعديلات...';
    try {
      const { data, error } = await supabase.from('patient_health_audit')
        .select('id,actor_id,actor_role,operation,changed_fields,created_at')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      sharedHealthState.history = (data || [])
        .filter(item => (item.changed_fields || []).some(field =>
          Object.prototype.hasOwnProperty.call(sharedHealthLabels, field)
        ))
        .slice(0, 30);
      sharedHealthState.loaded = true;
      renderSharedHealthInProfessionalProfile();
    } catch (error) {
      console.error('Professional shared health audit load failed:', error);
      if (root) root.textContent = 'تعذر تحميل سجل التعديلات. تحقق من صلاحيات القراءة.';
    } finally {
      sharedHealthState.loading = false;
    }
  }

  async function updateSharedHealthFromProfessional() {
    if (!canEditSharedHealth() || !state.isEditing || sharedHealthState.saving) return false;
    sharedHealthState.saving = true;
    updateSharedHealthWriteState();
    const rawHeight = $('heightInput')?.value.trim() ?? '';
    const height = rawHeight === '' ? null : Number(rawHeight);
    const birthDate = $('birthDateInput')?.value || null;
    const today = new Date().toISOString().slice(0, 10);
    if (height !== null && (!Number.isFinite(height) || height < 30 || height > 260)) {
      alert('الطول يجب أن يكون بين 30 و260 سم.');
      sharedHealthState.saving = false;
      updateSharedHealthWriteState();
      return false;
    }
    if (birthDate && birthDate > today) {
      alert('تاريخ الميلاد لا يمكن أن يكون في المستقبل.');
      sharedHealthState.saving = false;
      updateSharedHealthWriteState();
      return false;
    }
    try {
      const { data, error } = await supabase.rpc('update_shared_patient_health_profile', {
        p_patient_id: patientId,
        p_gender: $('genderInput')?.value || null,
        p_birth_date: birthDate,
        p_height: height,
        p_diagnosis: $('diagnosisInput')?.value.trim() || null,
        p_complaints: $('complaintsInput')?.value.trim() || null
      });
      if (error) throw error;
      state.patient = { ...state.patient, ...data };
      return true;
    } catch (error) {
      console.error('Professional shared health save failed:', error);
      const messages = {
        patient_followup_expired_read_only: 'انتهت مدة اتفاق المتابعة. يمكنك الاطلاع على البيانات دون تعديلها.',
        patient_workspace_access_denied: 'ليس لديك صلاحية تعديل السجل الصحي لهذا المريض.',
        invalid_gender_value: 'قيمة النوع غير صحيحة.',
        birth_date_in_future: 'تاريخ الميلاد لا يمكن أن يكون في المستقبل.',
        height_out_of_range: 'الطول يجب أن يكون بين 30 و260 سم.',
        diagnosis_too_long: 'التشخيص أطول من الحد المسموح.',
        complaints_too_long: 'الشكوى أطول من الحد المسموح.'
      };
      const message = messages[error.message] || error.message || 'تعذر حفظ البيانات الصحية المشتركة.';
      alert(message);
      return false;
    } finally {
      sharedHealthState.saving = false;
      updateSharedHealthWriteState();
    }
  }
  const patientFinanceFields = [
    'pfInputStart', 'pfInputMonths', 'pfInputAmount', 'pfInputDiscount',
    'pfInputPaid', 'pfInputLastVisit', 'pfInputNextFollowUp'
  ];

  function setPatientCareView() {
    if (!state.user?.id || state.patient?.user_id !== state.user.id) return false;
    const financeView = $('patientFinanceView');
    const sharedHealthSection = $('professionalSharedHealthSection');
    if (financeView) financeView.hidden = false;
    if (sharedHealthSection) sharedHealthSection.hidden = false;
    state.patientCareMode = 'owner';
    updateWriteControls();
    return true;
  }

  async function loadPatientCareMode() {
    if (!patientId || !state.user?.id || !state.patient) return;
    if (state.patient.user_id !== state.user.id) {
      state.patientCareMode = 'readonly';
      setEditing(false);
      updateWriteControls();
      return;
    }
    if (state.patientCareMode === 'owner') return;
    if (state.patientCareModePromise) return state.patientCareModePromise;

    state.patientCareModePromise = (async () => {
      try {
        if (!setPatientCareView()) return;
        await loadPatientFinanceFollowUpStatus();
        await Promise.all([loadPatientFinance(), loadSharedHealthHistory()]);
      } catch (error) {
        console.error('Patient owner workspace load failed:', error);
        state.patientCareMode = 'error';
        const financeError = $('patientFinanceError');
        if (financeError) {
          financeError.hidden = false;
          financeError.textContent = 'تعذر تحميل بيانات Finance أو سجل الملف الصحي.';
        }
      } finally {
        state.patientCareModePromise = null;
      }
    })();
    return state.patientCareModePromise;
  }

  function formatFinanceAmount(value) {
    if (value === null || value === undefined || value === '') return '—';
    return Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' جنيه';
  }

  function updatePatientFinancePreview() {
    const amountRaw = $('pfInputAmount')?.value ?? '';
    const discountRaw = $('pfInputDiscount')?.value ?? '0';
    const amount = amountRaw === '' ? null : Number(amountRaw);
    const discount = Number(discountRaw || 0);
    const preview = $('pfInputDiscountedPreview');
    if (preview) {
      preview.textContent = amount === null || !Number.isFinite(amount) || !Number.isFinite(discount)
        ? '—'
        : formatFinanceAmount(Math.max(0, amount * (1 - discount / 100)));
    }

    const startValue = $('pfInputStart')?.value;
    const months = Number($('pfInputMonths')?.value);
    const end = $('pfInputEndDate');
    if (end) {
      if (!startValue || !Number.isInteger(months) || months < 1) {
        end.textContent = '—';
      } else {
        const start = new Date(startValue + 'T00:00:00');
        const day = start.getDate();
        start.setDate(1);
        start.setMonth(start.getMonth() + months);
        start.setDate(Math.min(day, new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()));
        end.textContent = start.toLocaleDateString('ar-EG');
      }
    }
  }

  function setPatientFinanceEditing(editing) {
    state.patientFinanceEditing = editing;
    const writable = canManagePatientFinance() && state.patientCareMode === 'owner';
    patientFinanceFields.forEach(id => {
      const field = $(id);
      if (field) field.disabled = !editing || !writable;
    });
    const edit = $('patientFinanceEdit');
    const save = $('patientFinanceSave');
    const cancel = $('patientFinanceCancel');
    const remove = $('patientFinanceDelete');
    if (edit) edit.hidden = editing || !writable;
    if (save) save.hidden = !editing || !writable;
    if (cancel) cancel.hidden = !editing;
    if (remove) remove.hidden = editing || !writable || !state.patientFinance;
    const note = $('patientFinanceAccessNote');
    if (note) {
      note.textContent = writable
        ? 'يمكنك إدارة الاشتراك والسداد والمتابعة يدويًا لهذا الملف.'
        : 'بيانات Finance متاحة للعرض فقط؛ يتطلب التعديل اشتراكًا مهنيًا فعالًا.';
    }
  }

  function fillPatientFinance(finance) {
    state.patientFinance = finance || null;
    $('pfInputStart').value = finance?.subscription_start_date || '';
    $('pfInputMonths').value = finance?.subscription_months ?? '';
    $('pfInputAmount').value = finance?.subscription_amount ?? '';
    $('pfInputDiscount').value = finance?.discount_percent ?? 0;
    $('pfInputPaid').value = String(Boolean(finance?.is_paid));
    $('pfInputLastVisit').value = finance?.last_visit_date || '';
    $('pfInputNextFollowUp').value = finance?.next_follow_up_date || '';
    const empty = $('patientFinanceEmpty');
    if (empty) empty.hidden = Boolean(finance);
    updatePatientFinancePreview();
    setPatientFinanceEditing(false);
  }

  async function loadPatientFinance() {
    if (!state.patient || !state.user?.id || state.patientFinanceLoading) return;
    state.patientFinanceLoading = true;
    const loading = $('patientFinanceLoading');
    const errorBox = $('patientFinanceError');
    if (loading) loading.hidden = false;
    if (errorBox) errorBox.hidden = true;
    try {
      const { data, error } = await supabase.from('patient_finances')
        .select('id,patient_id,user_id,subscription_start_date,subscription_months,subscription_end_date,is_paid,subscription_amount,discount_percent,discounted_amount,last_visit_date,next_follow_up_date')
        .eq('patient_id', patientId)
        .maybeSingle();
      if (error) throw error;
      fillPatientFinance(data);
    } catch (error) {
      console.error('Legacy patient finance load failed:', error);
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = 'تعذر تحميل بيانات Finance. تحقق من صلاحيات الوصول والاشتراك.';
      }
    } finally {
      state.patientFinanceLoading = false;
      if (loading) loading.hidden = true;
    }
  }

  async function savePatientFinance() {
    if (!canManagePatientFinance() || state.patientCareMode !== 'owner' || !state.patient || !state.user?.id || !state.patientFinanceEditing) return;
    const startDate = $('pfInputStart').value || null;
    const months = $('pfInputMonths').value === '' ? null : Number($('pfInputMonths').value);
    const amount = $('pfInputAmount').value === '' ? null : Number($('pfInputAmount').value);
    const discount = $('pfInputDiscount').value === '' ? 0 : Number($('pfInputDiscount').value);
    if ((startDate && (!Number.isInteger(months) || months < 1)) || (months && !startDate)) {
      alert('أدخل تاريخ بداية الاشتراك ومدة صحيحة بالشهور.');
      return;
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      alert('قيمة الاشتراك يجب أن تكون رقمًا موجبًا أو صفرًا.');
      return;
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      alert('نسبة الخصم يجب أن تكون بين 0 و100%.');
      return;
    }

    const save = $('patientFinanceSave');
    if (save) { save.disabled = true; save.textContent = 'جارٍ الحفظ...'; }
    const errorBox = $('patientFinanceError');
    if (errorBox) errorBox.hidden = true;
    try {
      const payload = {
        patient_id: patientId,
        user_id: state.patient.user_id,
        subscription_start_date: startDate,
        subscription_months: months,
        subscription_amount: amount,
        discount_percent: discount,
        is_paid: $('pfInputPaid').value === 'true',
        last_visit_date: $('pfInputLastVisit').value || null,
        next_follow_up_date: $('pfInputNextFollowUp').value || null
      };
      const { data, error } = await supabase.from('patient_finances')
        .upsert(payload, { onConflict: 'patient_id' })
        .select('id,patient_id,user_id,subscription_start_date,subscription_months,subscription_end_date,is_paid,subscription_amount,discount_percent,discounted_amount,last_visit_date,next_follow_up_date')
        .single();
      if (error) throw error;
      fillPatientFinance(data);
      await loadPatientFinanceFollowUpStatus();
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = 'تم حفظ بيانات Finance بنجاح.';
        errorBox.classList.add('is-success');
      }
    } catch (error) {
      console.error('Legacy patient finance save failed:', error);
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || 'تعذر حفظ بيانات Finance.';
        errorBox.classList.remove('is-success');
      }
    } finally {
      if (save) { save.disabled = false; save.textContent = 'حفظ البيانات'; }
    }
  }

  async function deletePatientFinance() {
    if (!canManagePatientFinance() || state.patientCareMode !== 'owner' || !state.patientFinance) return;
    const confirmed = await window.DPConfirm?.ask({
      title: 'حذف بيانات Finance؟',
      message: 'سيتم حذف سجل الاشتراك المالي لهذا المريض فقط.',
      confirmText: 'حذف',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      const { error } = await supabase.from('patient_finances')
        .delete()
        .eq('patient_id', patientId);
      if (error) throw error;
      fillPatientFinance(null);
      await loadPatientFinanceFollowUpStatus();
      const errorBox = $('patientFinanceError');
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = 'تم حذف سجل Finance.';
        errorBox.classList.add('is-success');
      }
    } catch (error) {
      console.error('Legacy patient finance delete failed:', error);
      const errorBox = $('patientFinanceError');
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error.message || 'تعذر حذف سجل Finance.';
        errorBox.classList.remove('is-success');
      }
    }
  }

  async function saveAllPatientData() {
    if (!state.isEditing || state.isSaving) return;

    const saveSharedHealth = canEditSharedHealth();
    const savePrivateData = canEditPatientPrivateFields();
    if (!saveSharedHealth && !savePrivateData) return;

    state.isSaving = true;
    setEditing(true);
    const saveButton = $('savePatientButton');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'جارٍ حفظ التعديلات...';
    }

    try {
      if (saveSharedHealth) {
        const sharedHealthSaved = await updateSharedHealthFromProfessional();
        if (!sharedHealthSaved) return;
      }

      if (savePrivateData) {
        const patientSaved = await savePatientSection();
        if (!patientSaved) return;
      }

      fillPatientData();
      if (saveSharedHealth) await loadSharedHealthHistory();
      setEditing(false);
      showPatientProfileSuccess();
    } catch (error) {
      console.error('Saving patient profile failed:', error);
      alert('تعذر إكمال حفظ بيانات المريض. راجع وحدة التحكم لمعرفة التفاصيل.');
    } finally {
      state.isSaving = false;
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'حفظ التعديلات';
      }
      if (state.isEditing) setEditing(true);
    }
  }

  function showPatientProfileSuccess() {
    let toast = $('patientProfileSuccessToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'patientProfileSuccessToast';
      toast.className = 'patient-profile-success-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.textContent = 'تم حفظ بيانات الملف والسجل الصحي بنجاح';
      document.body.appendChild(toast);
    }
    toast.classList.remove('is-visible');
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    window.clearTimeout(toast.dismissTimer);
    toast.dismissTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 1800);
  }

  function activatePatientModule(moduleName) {
    const modules = {
      measurements: { tab: 'measurementsTab', panel: 'measurementsPanel' },
      energy: { tab: 'energyTab', panel: 'patientEnergyPanel' },
      plans: { tab: 'plansTab', panel: 'plansPanel' },
      'nutrition-support': { tab: 'nutritionSupportTab', panel: 'nutritionSupportPanel' },
      'patient-care': { tab: 'patientCareTab', panel: 'patientCarePanel' }
    };
    if (moduleName !== null && !modules[moduleName]) return;

    Object.entries(modules).forEach(([name, refs]) => {
      const active = name === moduleName;
      const tab = $(refs.tab);
      const panel = $(refs.panel);
      if (tab) {
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.setAttribute('tabindex', active || moduleName === null ? '0' : '-1');
      }
      if (panel) panel.hidden = !active;
    });

    if (moduleName === 'measurements') void loadMeasurements();
    if (moduleName === 'energy') {
      if (typeof window.initCalculator === 'function') void window.initCalculator();
      else {
        const status = $('energyApprovalStatus');
        if (status) status.textContent = 'تعذر تحميل حاسبة الطاقة. حدّث الصفحة وحاول مرة أخرى.';
      }
    }
    if (moduleName === 'plans') {
      void loadNutritionPlans({ autoOpenLatest: true });
    }
    if (moduleName === 'nutrition-support') loadNutritionSupportFrame();
    if (moduleName === 'patient-care') void loadPatientCareMode();
  }

  function loadNutritionSupportFrame() {
    const frame = $('nutritionSupportFrame');
    const id = state.patient?.id || patientId;
    if (!frame || !id || frame.dataset.loaded === 'true') return;
    try { sessionStorage.setItem('dpNutritionSupportPatientId', id); } catch (_) {}
    frame.style.height = '1px';
    frame.src = `nutritionsupport-patient.html?patient=${encodeURIComponent(id)}&embed=1`;
    frame.dataset.loaded = 'true';
  }

  function bindPatientModuleTabs() {
    document.querySelectorAll('[data-module]').forEach((tab) => {
      tab.addEventListener('click', () => activatePatientModule(tab.dataset.module));
    });
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;

      const frame = $('nutritionSupportFrame');
      if (!frame || event.source !== frame.contentWindow) return;

      if (event.data?.type === 'dp-nsp-embed-height') {
        const height = Number(event.data.height);
        if (Number.isFinite(height) && height > 0) {
          frame.style.height = `${Math.max(1, Math.min(height + 2, 12000))}px`;
        }
        return;
      }

      if (event.data?.type === 'dp-nsp-open-delete-modal') {
        const requestId = String(event.data.requestId || '');
        const message = String(event.data.message || 'هل تريد حذف يوم الدعم الغذائي؟');
        void window.DPConfirm?.ask({
          title: 'حذف يوم الدعم الغذائي؟',
          message,
          confirmText: 'حذف',
          variant: 'danger'
        }).then(approved => {
          if (frame.contentWindow) frame.contentWindow.postMessage({
            type: 'dp-nsp-delete-modal-result',
            requestId,
            approved
          }, window.location.origin);
        });
      }
    });
    // Keep the workspace compact on first load; open a module only after an explicit selection.
    activatePatientModule(null);
  }

  function bindPatientConversationDrawer() {
    const drawer = $('patientConversationDrawer');
    const openButton = $('openPatientConversation');
    const closeButton = $('closePatientConversation');
    const name = $('patientConversationPatientName');
    const messagesRoot = $('patientProfileMessages');
    if (!drawer || !openButton || !closeButton || !messagesRoot) return;

    const close = () => {
      drawer.hidden = true;
      document.body.classList.remove('patient-conversation-open');
      openButton.setAttribute('aria-expanded', 'false');
      openButton.focus();
    };
    const open = () => {
      const patientName = state.patient?.name || $('patientName')?.textContent || 'المريض';
      if (name) name.textContent = patientName;
      drawer.hidden = false;
      document.body.classList.add('patient-conversation-open');
      openButton.setAttribute('aria-expanded', 'true');
      closeButton.focus();
      void window.DietPlannerPatientMessages?.mount(messagesRoot, {
        patientId: state.patient?.id || patientId,
        role: 'professional'
      });
    };

    openButton.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    drawer.addEventListener('click', event => {
      if (event.target === drawer) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !drawer.hidden) close();
    });
  }

  function bindPatientFinanceEvents() {
    $('patientFinanceEdit')?.addEventListener('click', () => setPatientFinanceEditing(true));
    $('patientFinanceCancel')?.addEventListener('click', () => fillPatientFinance(state.patientFinance));
    $('patientFinanceSave')?.addEventListener('click', () => void savePatientFinance());
    $('patientFinanceDelete')?.addEventListener('click', () => void deletePatientFinance());
    ['pfInputAmount', 'pfInputDiscount', 'pfInputStart', 'pfInputMonths'].forEach(id => {
      $(id)?.addEventListener('input', updatePatientFinancePreview);
      $(id)?.addEventListener('change', updatePatientFinancePreview);
    });
  }

  function bindEvents() {
    bindPatientModuleTabs();
    bindPatientConversationDrawer();
    bindDietPlanActions();
    // These controls live inside <summary>; cancel its toggle behavior but keep button actions.
    $('patientDataActions')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    $('editButton')?.addEventListener('click', enableEditing);
    $('savePatientButton')?.addEventListener('click', saveAllPatientData);
    $('cancelEditButton')?.addEventListener('click', cancelEditing);
    setEditing(false);
    window.addEventListener('dp-exchange-plan-deleted', () => {
      closePlanWorkspace();
      void loadNutritionPlans();
    });
    window.addEventListener('dp-nutrition-plan-content-changed', () => {
      void loadNutritionPlans();
    });
    $('addPlanButton')?.addEventListener('click', addNutritionPlan);
    $('addExchangePlanButton')?.addEventListener('click', addExchangeNutritionPlan);
    $('visitsList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-plan]');
      if (!button) return;
      openPlanWorkspace(button.dataset.openPlan, button.dataset.planType);
    });
    $('weightTableContainer')?.addEventListener('click', (event) => {
      const add = event.target.closest('[data-add-measurement]');
      const save = event.target.closest('[data-measurement-save]');
      const cancel = event.target.closest('[data-measurement-cancel]');
      const edit = event.target.closest('[data-measurement-edit]');
      const remove = event.target.closest('[data-measurement-delete]');
      if (add) openMeasurementEntry();
      else if (save) void saveMeasurementEntry(save.closest('[data-measurement-editor]'));
      else if (cancel) renderMeasurements();
      else if (edit) editMeasurementEntry(Number(edit.dataset.measurementEdit));
      else if (remove) void deleteMeasurement(Number(remove.dataset.measurementDelete));
    });
  }

  async function init() {
    try {
      bindEvents();
      bindPatientFinanceEvents();

      if (!access || !supabase) {
        throw new Error('تعذر تهيئة الاتصال بقاعدة البيانات.');
      }

      const user = await access.getCurrentUser?.();
      if (!user?.id) throw new Error('يجب تسجيل الدخول بحساب المختص مالك الملف.');
      state.user = user;

      await loadPatient();
      if (!state.patient) return;
      await refreshWriteAccess();
    } catch (error) {
      console.error('Patient profile initialization failed:', error);
      showError(error?.message || 'تعذر تحميل ملف المريض.');
    }
  }

  function boot() {
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
