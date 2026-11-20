(() => {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const patientParams = new URLSearchParams(window.location.search);
  const patientId = patientParams.get('id') || patientParams.get('patient') || patientParams.get('patient_id');

  const state = {
    patient: null,
    user: null,
    isAdmin: false,
    hasActiveSubscription: false,
    isEditing: false,
    isSaving: false,
    isCreatingPlan: false,
  };

  const $ = (id) => document.getElementById(id);

  // Local HTML escaping for patient-entered text rendered in this page.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>\"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
    })[character]);
  }
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
    }
  }

  function updateWriteControls() {
    const canWrite = state.isAdmin || state.hasActiveSubscription;

    const editButton = $('editButton');
    const addPlanButton = $('addPlanButton');
    const addExchangePlanButton = $('addExchangePlanButton');
    updateMeasurementWriteAccess();
    updatePatientFinanceWriteAccess();

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
      button.disabled = !canWrite || state.isCreatingPlan;
      button.classList.toggle('opacity-50', !canWrite);
      button.classList.toggle('cursor-not-allowed', !canWrite);
      button.title = canWrite ? 'إضافة خطة غذائية' : 'إضافة الخطط متاحة أثناء الاشتراك المدفوع فقط';
    });

    const accessBox = $('writeAccessStatus');
    if (accessBox) {
      if (state.isAdmin) {
        accessBox.textContent = 'وضع المدير: جميع صلاحيات التعديل متاحة.';
        accessBox.className =
          'mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
      } else if (state.hasActiveSubscription) {
        accessBox.textContent = 'الاشتراك فعال — يمكنك تعديل الملف وإدارة الخطط الغذائية.';
        accessBox.className =
          'mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
      } else {
        accessBox.textContent =
          'الاشتراك غير فعال — يمكنك عرض بيانات المريض والبيانات والخطط للعرض فقط. التعديل وإضافة الخطط غير متاحين.';
        accessBox.className =
          'mt-4 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2';
      }
    }
  }

  function canWrite() {
    return state.isAdmin || state.hasActiveSubscription;
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
      // RLS intentionally returns no row when the signed-in account is not
      // the owner and is not an administrator. Do not weaken the policy here.
      showError('ملف المريض غير موجود أو لا تملك صلاحية الوصول إليه.');
      return;
    }

    state.patient = data;
    fillPatientData();
    setLink('financeLink', 'finance.html');

    // Reveal the loaded patient immediately. Access checks and secondary modules
    // run afterward and cannot block the main patient record.
    $('loadingState')?.classList.add('hidden');
    $('errorState')?.classList.add('hidden');
    $('patientContent')?.classList.remove('hidden');
    $('modulesSection')?.classList.remove('hidden');

    updateWriteControls();
    await loadNutritionPlans();
  }


  // Inline patient measurements: reuse the existing weight_logs schema and the
  // same subscription/admin write gate without navigating away from this profile.
  const measurementState = { logs: [], loaded: false, loading: false };

  function updateMeasurementWriteAccess() {
    const button = $('addMeasurementRowBtn');
    const status = $('measurementAccessStatus');
    if (!button) return;
    const allowed = canWrite();
    button.disabled = !allowed;
    button.title = allowed ? 'إضافة قياس جديد' : 'إضافة القياسات متاحة أثناء الاشتراك المدفوع فقط';
    button.classList.toggle('is-disabled', !allowed);
    if (status) {
      status.textContent = state.isAdmin
        ? 'وضع المدير: يمكنك إضافة القياسات وإدارتها.'
        : state.hasActiveSubscription
          ? 'الاشتراك فعال — يمكنك إضافة قياس جديد.'
          : 'يمكنك عرض السجل الحالي؛ إضافة قياس جديد متاحة أثناء الاشتراك المدفوع.';
    }
  }

  function measurementDateLabel(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? escapeHtml(value)
      : date.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

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
    const body = $('weightTableBody');
    if (!body) return;
    if (!measurementState.logs.length) {
      body.innerHTML = '<tr><td colspan="10" class="measurements-state">لا توجد قياسات مسجلة لهذا المريض.</td></tr>';
      return;
    }
    const labels = { excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', poor: 'ضعيف' };
    body.innerHTML = measurementState.logs.map((log, index) => `
      <tr>
        <td data-label="التاريخ">${measurementDateLabel(log.date)}</td>
        <td data-label="الوزن (كجم)" class="measurement-weight">${Number(log.weight).toFixed(1)}</td>
        <td data-label="نسبة الدهون">${log.bodyFat == null ? '—' : Number(log.bodyFat).toFixed(1)+'%'}</td>
        <td data-label="نسبة العضلات">${log.muscle == null ? '—' : Number(log.muscle).toFixed(1)+'%'}</td>
        <td data-label="نسبة الماء">${log.water == null ? '—' : Number(log.water).toFixed(1)+'%'}</td>
        <td data-label="محيط الوسط (سم)">${log.waist == null ? '—' : Number(log.waist).toFixed(1)}</td>
        <td data-label="محيط الأرداف (سم)">${log.hip == null ? '—' : Number(log.hip).toFixed(1)}</td>
        <td data-label="الالتزام">${escapeHtml(labels[log.adherence] || '—')}</td>
        <td data-label="ملاحظات المريض" class="measurement-notes-cell">${escapeHtml(log.notes || '—')}</td>
        <td data-label="إجراء" class="no-print"><button type="button" class="measurement-delete-button" data-measurement-delete="${index}" aria-label="حذف القياس"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td>
      </tr>`).join('');
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

  function openMeasurementEntry() {
    if (!canWrite()) { showMeasurementError('إضافة القياسات متاحة أثناء الاشتراك المدفوع فقط.'); return; }
    if (!measurementState.loaded) { void loadMeasurements().then(() => { if (measurementState.loaded) openMeasurementEntry(); }); return; }
    const body = $('weightTableBody');
    if (!body || body.querySelector('[data-measurement-editor]')) return;
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const row = document.createElement('tr'); row.className = 'measurement-entry-row'; row.dataset.measurementEditor = 'true';
    row.innerHTML = '<td><input data-field="date" type="date" value="' + localDate + '" aria-label="تاريخ القياس"></td>' +
      '<td><input data-field="weight" type="number" min="0.1" step="0.1" placeholder="إلزامي" aria-label="الوزن بالكيلوجرام" required></td>' +
      '<td><input data-field="bodyFat" type="number" min="0" max="100" step="0.1" placeholder="—" aria-label="نسبة الدهون"></td>' +
      '<td><input data-field="muscle" type="number" min="0" max="100" step="0.1" placeholder="—" aria-label="نسبة العضلات"></td>' +
      '<td><input data-field="water" type="number" min="0" max="100" step="0.1" placeholder="—" aria-label="نسبة الماء"></td>' +
      '<td><input data-field="waist" type="number" min="0.1" step="0.1" placeholder="—" aria-label="محيط الوسط"></td>' +
      '<td><input data-field="hip" type="number" min="0.1" step="0.1" placeholder="—" aria-label="محيط الأرداف"></td>' +
      '<td><select data-field="adherence" aria-label="الالتزام الغذائي"><option value="">لم يحدد</option><option value="excellent">ممتاز</option><option value="good">جيد</option><option value="fair">متوسط</option><option value="poor">ضعيف</option></select></td>' +
      '<td><textarea data-field="notes" rows="2" placeholder="ملاحظات المريض ومشكلاته مع النظام الغذائي" aria-label="ملاحظات المريض"></textarea></td>' +
      '<td class="measurement-entry-actions"><button type="button" class="measurement-save-button" data-measurement-save>حفظ</button><button type="button" class="measurement-cancel-button" data-measurement-cancel>إلغاء</button></td>';
    body.prepend(row); row.querySelector('[data-field="weight"]')?.focus();
    const errorBox = $('measurementsError'); if (errorBox) errorBox.hidden = true;
  }

  async function saveMeasurementEntry(row) {
    if (!row || row.dataset.saving === 'true') return;
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
      const { data, error } = await supabase.from('weight_logs').insert({ patient_id: patientId, weight: payload.weight, measurement_date: payload.date, body_fat_percent: payload.bodyFat, muscle_percent: payload.muscle, water_percent: payload.water, waist_cm: payload.waist, hip_cm: payload.hip, diet_adherence: payload.adherence, notes: payload.notes }).select('id,patient_id,weight,measurement_date,body_fat_percent,muscle_percent,water_percent,waist_cm,hip_cm,diet_adherence,notes,created_at').single();
      if (error) throw error;
      measurementState.logs.push({ id: data.id, date: data.measurement_date, createdAt: data.created_at || '', weight: Number(data.weight), bodyFat: data.body_fat_percent == null ? null : Number(data.body_fat_percent), muscle: data.muscle_percent == null ? null : Number(data.muscle_percent), water: data.water_percent == null ? null : Number(data.water_percent), waist: data.waist_cm == null ? null : Number(data.waist_cm), hip: data.hip_cm == null ? null : Number(data.hip_cm), adherence: data.diet_adherence || '', notes: data.notes || '' });
      measurementState.logs.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt))); renderMeasurements();
    } catch (error) {
      console.error('Save patient measurement failed:', error); row.dataset.saving = 'false';
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'حفظ'; }
      showMeasurementError(error?.message || error?.details || error?.hint || 'تحقق من الاتصال وصلاحيات الحفظ.');
    }
  }

  function showMeasurementError(message) { const box = $('measurementsError'); if (box) { box.textContent = String(message || 'حدث خطأ غير متوقع.'); box.hidden = false; } }

  async function deleteMeasurement(index) {
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

    const result = await Swal.fire({
      title: 'حذف القياس',
      text: 'هل أنت متأكد من حذف القياس المحدد؟',
      showCancelButton: true,
      confirmButtonText: 'حذف',
      cancelButtonText: 'إلغاء',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#ffffff',
      reverseButtons: true,
      width: '290px',
      padding: '.85rem 1rem .7rem',
      customClass: {
        popup: 'visit-delete-popup',
        title: 'visit-delete-title',
        htmlContainer: 'visit-delete-text',
        confirmButton: 'visit-delete-confirm',
        cancelButton: 'visit-delete-cancel'
      },
      buttonsStyling: true,
      heightAuto: false,
      allowOutsideClick: () => !Swal.isLoading(),
      showLoaderOnConfirm: true,
      preConfirm: async () => {
        try {
          const { error } = await supabase.from('weight_logs')
            .delete()
            .eq('id', entry.id)
            .eq('patient_id', patientId);
          if (error) throw error;
          return true;
        } catch (error) {
          console.error('Delete patient measurement failed:', error);
          Swal.showValidationMessage('تعذر حذف القياس من قاعدة البيانات. حاول مرة أخرى.');
          return false;
        }
      }
    });

    if (!result.isConfirmed) return;

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

      row.append(openButton, deleteButton);
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
      script.src = 'js/visit-diet-plan.js?v=20261120-direct-patient-plan-v5';
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
      script.src = 'js/visit-exchange-plan.js?v=20261120-exchange-confirm-fix-v4';
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
        '#planWorkspace, #foodModal, #fixedMealsModal, #addMealModal, #confirmModal, #printSettingsModal, #dayDetailsModal'
      )
    );

    document.addEventListener('click', async (event) => {
      const confirmButton = event.target.closest('#confirmOkBtn');
      if (confirmButton && isDietPlanElement(confirmButton)) {
        event.preventDefault();
        if (await window.exchangePlan?.hasPendingConfirm?.()) await window.exchangePlan.confirmAction();
        else await window.dietPlan?.confirmAction?.();
        return;
      }

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
      if (action === 'dietPlan.closeConfirmModal' && await window.exchangePlan?.hasPendingConfirm?.()) {
        event.preventDefault();
        window.exchangePlan.closeConfirmModal();
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
    if (!canWrite()) {
      alert('حذف الخطط متاح أثناء الاشتراك المدفوع فقط.');
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
    const result = await Swal.fire({
      title: 'حذف الخطة الغذائية',
      text: `هل تريد حذف "${plan.plan_name || 'الخطة'}"؟ سيتم حذف الأيام والوجبات والأصناف التابعة لها.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'حذف الخطة',
      cancelButtonText: 'إلغاء',
      confirmButtonColor: '#dc2626',
      reverseButtons: true
    });
    if (!result.isConfirmed) return;

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
    if (!canWrite()) {
      alert('إضافة الخطط متاحة أثناء الاشتراك المدفوع فقط.');
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
    if (!canWrite()) {
      alert('إضافة الخطط متاحة أثناء الاشتراك المدفوع فقط.');
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
    $('genderInput').value = patient.gender || '';
    $('birthDateInput').value = patient.birth_date || '';
    $('ageInput').value = patient.age ?? '';
    $('heightInput').value = patient.height ?? '';
    $('diagnosisInput').value = patient.diagnosis || '';
    $('complaintsInput').value = patient.complaints || '';
    $('notesInput').value = patient.clinical_notes || '';
  }

  const patientFieldIds = [
    'nameInput',
    'phoneInput',
    'genderInput',
    'birthDateInput',
    'ageInput',
    'heightInput',
    'diagnosisInput',
    'complaintsInput',
    'notesInput'
  ];

  const patientFinanceFieldIds = [
    'pfInputStart', 'pfInputMonths', 'pfInputAmount', 'pfInputDiscount',
    'pfInputPaid', 'pfInputLastVisit', 'pfInputNextFollowUp'
  ];

  function setEditing(enabled) {
    state.isEditing = Boolean(enabled);
    const canEdit = state.isEditing && canWrite() && !state.isSaving;
    [...patientFieldIds, ...patientFinanceFieldIds].forEach((id) => {
      const field = $(id);
      if (field) field.disabled = !canEdit;
    });
    updatePatientFinanceWriteAccess();

    const saveArea = $('saveArea');
    const editButton = $('editButton');
    if (saveArea) saveArea.hidden = !enabled;
    if (editButton) editButton.hidden = enabled;
  }

  async function enableEditing() {
    if (!canWrite()) {
      alert('تعديل بيانات المريض والاشتراك متاح أثناء الاشتراك المدفوع فقط.');
      return;
    }

    const details = $('patientDataDetails');
    const financeDetails = $('patientFinanceDetails');
    

    // Load finance before opening its disclosure to avoid a duplicate toggle-triggered request.
    const financeReady = await loadPatientFinance();
    if (!financeReady) {
      alert('تعذر تحميل بيانات الاشتراك. لم يتم تفعيل التعديل لتجنب استبدال بيانات محفوظة.');
      return;
    }

    if (financeDetails) financeDetails.open = true;
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    fillPatientData();
    void loadPatientFinance(true);
    const details = $('patientDataDetails');
    const financeDetails = $('patientFinanceDetails');
    
    if (financeDetails) financeDetails.open = false;
  }

  async function savePatientSection() {
    if (!canWrite() || !state.isEditing) return false;

    const payload = {
      name: $('nameInput').value.trim() || 'مريض',
      phone: $('phoneInput').value.trim() || null,
      gender: $('genderInput').value || null,
      birth_date: $('birthDateInput').value || null,
      age: $('ageInput').value !== '' ? Number($('ageInput').value) : null,
      height: $('heightInput').value !== '' ? Number($('heightInput').value) : null,
      diagnosis: $('diagnosisInput').value.trim() || null,
      complaints: $('complaintsInput').value.trim() || null,
      clinical_notes: $('notesInput').value.trim() || null
    };

    const { data, error } = await supabase
      .from('patients')
      .update(payload)
      .eq('id', patientId)
      .select('id,user_id,name,phone,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
      .single();

    if (error) {
      console.error('Save patient failed:', error);
      alert('تعذر حفظ تعديلات المريض. لم يتم إغلاق وضع التعديل.');
      return false;
    }

    state.patient = data;
    return true;
  }

  const patientFinanceState = { loaded: false, loading: false, recordId: null };

  function calculateSubscriptionEndDate(startValue, monthsValue) {
    if (!startValue || !monthsValue) return '';
    const [year, month, day] = String(startValue).slice(0, 10).split('-').map(Number);
    const months = Number(monthsValue);
    if (![year, month, day, months].every(Number.isFinite) || months < 1 || !Number.isInteger(months)) return '';
    const firstOfTargetMonth = new Date(year, month - 1 + months, 1);
    const lastDay = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
    firstOfTargetMonth.setDate(Math.min(day, lastDay));
    const y = firstOfTargetMonth.getFullYear();
    const m = String(firstOfTargetMonth.getMonth() + 1).padStart(2, '0');
    const d = String(firstOfTargetMonth.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function updateSubscriptionEndPreview(savedValue = null) {
    const output = $('pfInputEndDate');
    if (!output) return;
    const value = savedValue || calculateSubscriptionEndDate($('pfInputStart')?.value, $('pfInputMonths')?.value);
    if (!value) { output.textContent = '—'; return; }
    const [year, month, day] = value.split('-');
    output.textContent = `${day}/${month}/${year}`;
  }

  function updateFinancePreview() {
    const amountRaw = $('pfInputAmount')?.value ?? '';
    const discountRaw = $('pfInputDiscount')?.value ?? '0';
    const amount = amountRaw === '' ? null : Number(amountRaw);
    const discount = discountRaw === '' ? 0 : Number(discountRaw);
    const output = $('pfInputDiscountedPreview');
    updateSubscriptionEndPreview();
    if (!output) return;
    output.textContent = amount !== null && Number.isFinite(amount) && amount >= 0 &&
      Number.isFinite(discount) && discount >= 0 && discount <= 100
      ? (amount * (1 - discount / 100)).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' جنيه'
      : '—';
  }

  function updatePatientFinanceWriteAccess() {
    const allowed = canWrite();
    [
      'pfInputStart', 'pfInputMonths', 'pfInputAmount', 'pfInputDiscount',
      'pfInputPaid', 'pfInputLastVisit', 'pfInputNextFollowUp'
    ].forEach((id) => {
      const field = $(id);
      if (field) field.disabled = !allowed || !state.isEditing || state.isSaving || patientFinanceState.loading;
    });
    const note = $('patientFinanceAccessNote');
    if (note) {
      note.textContent = state.isAdmin
        ? 'وضع المدير: يمكنك تعديل بيانات الاشتراك.'
        : state.hasActiveSubscription
          ? 'الاشتراك فعال — يمكنك تعديل بيانات الاشتراك.'
          : 'عرض البيانات متاح؛ التعديل والحفظ متاحان أثناء الاشتراك المدفوع فقط.';
    }
  }

  async function loadPatientFinance(force = false) {
    if (patientFinanceState.loading) return false;
    if (patientFinanceState.loaded && !force) return true;
    if (!patientId || !supabase) return false;

    if (!state.user) {
      try {
        state.user = await access?.getCurrentUser?.();
        if (state.user) void refreshWriteAccess();
      } catch (sessionError) {
        console.error('Patient finance session lookup failed:', sessionError);
        const errorBox = $('patientFinanceError');
        if (errorBox) {
          errorBox.textContent = 'تعذر التحقق من جلسة تسجيل الدخول. أعد تحميل الصفحة وحاول مرة أخرى.';
          errorBox.hidden = false;
        }
        return false;
      }
    }
    if (!state.user?.id) {
      const errorBox = $('patientFinanceError');
      if (errorBox) {
        errorBox.textContent = 'يجب تسجيل الدخول لعرض بيانات الاشتراك.';
        errorBox.hidden = false;
      }
      return false;
    }

    patientFinanceState.loading = true;
    const loading = $('patientFinanceLoading');
    const form = $('patientFinanceForm');
    const empty = $('patientFinanceEmpty');
    const errorBox = $('patientFinanceError');
    if (loading) { loading.hidden = false; loading.textContent = 'جاري تحميل بيانات الاشتراك...'; }
    if (form) form.hidden = true;
    if (empty) empty.hidden = true;
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    updatePatientFinanceWriteAccess();

    try {
      const { data, error } = await supabase
        .from('patient_finances')
        .select('id,patient_id,user_id,subscription_start_date,subscription_months,subscription_end_date,subscription_amount,discount_percent,discounted_amount,is_paid,last_visit_date,next_follow_up_date')
        .eq('patient_id', patientId)
        .eq('user_id', state.user.id)
        .maybeSingle();
      if (error) throw error;

      patientFinanceState.recordId = data?.id || null;
      $('pfInputStart').value = data?.subscription_start_date || '';
      $('pfInputMonths').value = data?.subscription_months ?? '';
      $('pfInputAmount').value = data?.subscription_amount ?? '';
      $('pfInputDiscount').value = data?.discount_percent ?? 0;
      $('pfInputPaid').value = String(Boolean(data?.is_paid));
      $('pfInputLastVisit').value = data?.last_visit_date || '';
      $('pfInputNextFollowUp').value = data?.next_follow_up_date || '';
      updateSubscriptionEndPreview(data?.subscription_end_date || null);

      if (empty) empty.hidden = Boolean(data);
      if (form) form.hidden = false;
      patientFinanceState.loaded = true;
      updateFinancePreview();
      if (data?.discounted_amount != null) {
        $('pfInputDiscountedPreview').textContent =
          Number(data.discounted_amount).toLocaleString('ar-EG', { maximumFractionDigits: 2 }) + ' جنيه';
      }
      return true;
    } catch (error) {
      console.error('Patient finance load failed:', error);
      if (errorBox) {
        errorBox.textContent = 'تعذر تحميل بيانات الاشتراك. ' + (error.message || 'تحقق من الاتصال وصلاحيات قاعدة البيانات.');
        errorBox.hidden = false;
      }
      return false;
    } finally {
      patientFinanceState.loading = false;
      if (loading) loading.hidden = true;
      updatePatientFinanceWriteAccess();
    }
  }

  async function savePatientFinance() {
    if (!canWrite() || !state.isEditing || !state.user?.id || !patientId) return false;

    const errorBox = $('patientFinanceError');
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }

    const start = $('pfInputStart').value || null;
    const monthsRaw = $('pfInputMonths').value;
    const months = monthsRaw === '' ? null : Number(monthsRaw);
    const amountRaw = $('pfInputAmount').value;
    const amount = amountRaw === '' ? null : Number(amountRaw);
    const discountRaw = $('pfInputDiscount').value;
    const discount = discountRaw === '' ? 0 : Number(discountRaw);

    if ((start && !months) || (!start && months)) {
      errorBox.textContent = 'أدخل تاريخ بداية الاشتراك ومدة الاشتراك معًا.';
      errorBox.hidden = false;
      return false;
    }
    if (months !== null && (!Number.isInteger(months) || months < 1)) {
      errorBox.textContent = 'مدة الاشتراك يجب أن تكون عددًا صحيحًا يبدأ من شهر واحد.';
      errorBox.hidden = false;
      return false;
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      errorBox.textContent = 'قيمة الاشتراك غير صحيحة.';
      errorBox.hidden = false;
      return false;
    }
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      errorBox.textContent = 'نسبة الخصم يجب أن تكون بين 0 و100%.';
      errorBox.hidden = false;
      return false;
    }

    const payload = {
      patient_id: patientId,
      user_id: state.user.id,
      subscription_start_date: start,
      subscription_months: months,
      subscription_amount: amount,
      discount_percent: discount,
      is_paid: $('pfInputPaid').value === 'true',
      last_visit_date: $('pfInputLastVisit').value || null,
      next_follow_up_date: $('pfInputNextFollowUp').value || null
    };

    try {
      // Update the exact loaded row; insert only when no finance row exists.
      // This avoids relying on an assumed UNIQUE(patient_id) constraint for upsert.
      let writeQuery = supabase.from('patient_finances');
      if (patientFinanceState.recordId) {
        writeQuery = writeQuery
          .update(payload)
          .eq('id', patientFinanceState.recordId)
          .eq('patient_id', patientId)
          .eq('user_id', state.user.id);
      } else {
        writeQuery = writeQuery.insert(payload);
      }
      const { data: savedRow, error } = await writeQuery
        .select('id')
        .single();
      if (error) throw error;
      patientFinanceState.recordId = savedRow.id;
      patientFinanceState.loaded = false;
      const refreshed = await loadPatientFinance(true);
      if (!refreshed) return false;
      return true;
    } catch (error) {
      console.error('Patient finance save failed:', error);
      if (errorBox) {
        errorBox.textContent = 'فشل حفظ بيانات الاشتراك: ' + (error.message || 'تحقق من صلاحيات الكتابة (RLS).');
        errorBox.hidden = false;
      }
    } finally {
      updatePatientFinanceWriteAccess();
    }
  }

  async function saveAllPatientData() {
    if (!canWrite() || !state.isEditing || state.isSaving) return;

    state.isSaving = true;
    // Lock both sections while the single shared save operation is running.
    setEditing(true);
    const saveButton = $('savePatientButton');
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = 'جارٍ حفظ القسمين...';
    }

    try {
      const patientSaved = await savePatientSection();
      if (!patientSaved) return;

      const financeSaved = await savePatientFinance();
      if (!financeSaved) return;

      fillPatientData();
      setEditing(false);
      showPatientFinanceSuccess();
    } catch (error) {
      console.error('Saving patient profile and finance failed:', error);
      const financeError = $('patientFinanceError');
      if (financeError) {
        financeError.textContent = 'تعذر إكمال الحفظ: ' + (error?.message || 'حدث خطأ غير متوقع.');
        financeError.hidden = false;
      } else {
        alert('تعذر إكمال حفظ التعديلات. راجع وحدة التحكم لمعرفة التفاصيل.');
      }
    } finally {
      state.isSaving = false;
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'حفظ التعديلات';
      }
      updatePatientFinanceWriteAccess();
      if (state.isEditing) setEditing(true);
    }
  }

  function showPatientFinanceSuccess() {
    let toast = $('patientFinanceSuccessToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'patientFinanceSuccessToast';
      toast.className = 'patient-finance-success-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.textContent = 'تم حفظ بيانات المريض والاشتراك بنجاح';
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
      'nutrition-support': { tab: 'nutritionSupportTab', panel: 'nutritionSupportPanel' }
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
      tab.addEventListener('click', () => {
        const nextModule = tab.classList.contains('is-active') ? null : tab.dataset.module;
        activatePatientModule(nextModule);
      });
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
        const modal = $('supportDayDeleteModal');
        if (!modal) return;
        const message = modal.querySelector('[data-delete-message]');
        const confirm = modal.querySelector('[data-delete-confirm]');
        const cancel = modal.querySelector('[data-delete-cancel]');
        if (!message || !confirm || !cancel) return;

        message.textContent = String(event.data.message || 'هل تريد حذف يوم المتابعة المحدد؟');
        modal.hidden = false;
        document.body.classList.add('support-delete-modal-open');
        const close = (approved) => {
          modal.hidden = true;
          document.body.classList.remove('support-delete-modal-open');
          confirm.onclick = null;
          cancel.onclick = null;
          modal.onclick = null;
          frame.contentWindow?.postMessage({ type: 'dp-nsp-delete-modal-result', approved }, window.location.origin);
        };
        confirm.onclick = () => close(true);
        cancel.onclick = () => close(false);
        modal.onclick = (clickEvent) => { if (clickEvent.target === modal) close(false); };
        cancel.focus();
      }
    });
    // Keep the workspace compact on first load; open a module only after an explicit selection.
    activatePatientModule(null);
  }

  function bindEvents() {
    bindPatientModuleTabs();
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
    $('addPlanButton')?.addEventListener('click', addNutritionPlan);
    $('addExchangePlanButton')?.addEventListener('click', addExchangeNutritionPlan);
    $('visitsList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-plan]');
      if (!button) return;
      openPlanWorkspace(button.dataset.openPlan, button.dataset.planType);
    });
    $('addMeasurementRowBtn')?.addEventListener('click', openMeasurementEntry);
    $('weightTableBody')?.addEventListener('click', (event) => {
      const save = event.target.closest('[data-measurement-save]');
      const cancel = event.target.closest('[data-measurement-cancel]');
      const remove = event.target.closest('[data-measurement-delete]');
      if (save) void saveMeasurementEntry(save.closest('[data-measurement-editor]'));
      else if (cancel) cancel.closest('[data-measurement-editor]')?.remove();
      else if (remove) void deleteMeasurement(Number(remove.dataset.measurementDelete));
    });
    $('patientFinanceDetails')?.addEventListener('toggle', (event) => {
      if (event.currentTarget.open) void loadPatientFinance();
    });
    ['pfInputAmount', 'pfInputDiscount'].forEach((id) => {
      $(id)?.addEventListener('input', updateFinancePreview);
    });
    ['pfInputStart', 'pfInputMonths'].forEach((id) => {
      $(id)?.addEventListener('input', () => updateSubscriptionEndPreview());
      $(id)?.addEventListener('change', () => updateSubscriptionEndPreview());
    });

  }

  async function init() {
    try {
      bindEvents();

      if (!access || !supabase) {
        throw new Error('تعذر تهيئة الاتصال بقاعدة البيانات.');
      }

      // Patient data loading is not blocked by a separate session lookup.
      // Supabase applies the existing authenticated session and RLS to the query.
      // User/role lookup only controls write permissions after the page has started.
      void Promise.resolve()
        .then(() => access.getCurrentUser?.())
        .then((user) => {
          state.user = user || null;
          if (state.user) {
            void refreshWriteAccess();
          } else {
            updateWriteControls();
          }
        })
        .catch((error) => {
          console.error('Patient profile session lookup failed:', error);
          state.user = null;
          updateWriteControls();
        });

      await loadPatient();
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
