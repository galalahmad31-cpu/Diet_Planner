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
    isSaving: false
  };

  const $ = (id) => document.getElementById(id);

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
    const addVisitButton = $('addVisitButton');
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

    if (addVisitButton) {
      addVisitButton.disabled = !canWrite;
      addVisitButton.classList.toggle('opacity-50', !canWrite);
      addVisitButton.classList.toggle('cursor-not-allowed', !canWrite);
      addVisitButton.title = canWrite
        ? 'إضافة خطة جديدة'
        : 'إضافة الخطة متاحة أثناء الاشتراك المدفوع فقط';
    }

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
          'الاشتراك غير فعال — يمكنك عرض بيانات المريض والزيارات فقط. التعديل وإضافة الزيارات غير متاحين.';
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
        .select('id,user_id,name,phone,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
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
    await loadVisits();
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

  function renderMeasurements() {
    const body = $('weightTableBody');
    if (!body) return;
    if (!measurementState.logs.length) {
      body.innerHTML = '<tr><td colspan="6" class="measurements-state">لا توجد قياسات مسجلة لهذا المريض.</td></tr>';
      return;
    }
    const labels = { excellent: 'ممتاز', good: 'جيد', fair: 'متوسط', poor: 'ضعيف' };
    body.innerHTML = measurementState.logs.map((log, index) => `
      <tr>
        <td data-label="التاريخ">${measurementDateLabel(log.date)}</td>
        <td data-label="الوزن (كجم)" class="measurement-weight">${Number(log.weight).toFixed(1)}</td>
        <td data-label="محيط الوسط (سم)">${log.waist == null ? '—' : Number(log.waist).toFixed(1)}</td>
        <td data-label="محيط الأرداف (سم)">${log.hip == null ? '—' : Number(log.hip).toFixed(1)}</td>
        <td data-label="الالتزام">${escapeHtml(labels[log.adherence] || '—')}</td>
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
        .select('id,patient_id,weight,measurement_date,waist_cm,hip_cm,diet_adherence,notes,created_at')
        .eq('patient_id', patientId)
        .order('measurement_date', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      measurementState.logs = (data || []).map(item => ({
        id: item.id,
        date: item.measurement_date,
        weight: Number(item.weight),
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
    if (!canWrite()) {
      alert('إضافة القياسات متاحة أثناء الاشتراك المدفوع فقط.');
      return;
    }
    if ($('inlineMeasurementRow')) {
      $('inlineMeasurementRow').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const body = $('weightTableBody');
    if (!body) return;
    if (!measurementState.loaded) {
      void loadMeasurements().then(() => { if (measurementState.loaded) openMeasurementEntry(); });
      return;
    }
    const row = document.createElement('tr');
    row.id = 'inlineMeasurementRow';
    row.className = 'inline-measurement-row';
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    row.innerHTML = `
      <td><input type="date" id="inlineDate" value="${localDate}" aria-label="تاريخ القياس"></td>
      <td><input type="number" step="0.1" min="0.1" id="inlineWeight" placeholder="كجم" aria-label="الوزن"></td>
      <td><input type="number" step="0.1" min="0.1" id="inlineWaist" placeholder="سم" aria-label="محيط الوسط"></td>
      <td><input type="number" step="0.1" min="0.1" id="inlineHip" placeholder="سم" aria-label="محيط الأرداف"></td>
      <td><select id="inlineAdherence" aria-label="الالتزام"><option value="">—</option><option value="excellent">ممتاز</option><option value="good">جيد</option><option value="fair">متوسط</option><option value="poor">ضعيف</option></select></td>
      <td class="no-print"><div class="measurement-inline-actions"><button type="button" data-measurement-save class="measurement-save">حفظ</button><button type="button" data-measurement-cancel class="measurement-cancel">إلغاء</button></div></td>`;
    body.prepend(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('inlineWeight')?.focus();
  }

  async function saveMeasurementEntry() {
    if (!canWrite()) return;
    const date = $('inlineDate')?.value;
    const weight = Number.parseFloat($('inlineWeight')?.value);
    const waistRaw = $('inlineWaist')?.value ?? '';
    const hipRaw = $('inlineHip')?.value ?? '';
    const waist = waistRaw === '' ? null : Number.parseFloat(waistRaw);
    const hip = hipRaw === '' ? null : Number.parseFloat(hipRaw);
    const adherence = $('inlineAdherence')?.value || '';
    if (!date || !Number.isFinite(weight) || weight <= 0 ||
        (waistRaw !== '' && (!Number.isFinite(waist) || waist <= 0)) ||
        (hipRaw !== '' && (!Number.isFinite(hip) || hip <= 0))) {
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({
          icon: 'warning',
          title: 'راجع بيانات القياس',
          text: 'تأكد من إدخال تاريخ القياس والوزن بصورة صحيحة، وراجع قيم محيط الوسط والأرداف إذا أدخلتها.',
          confirmButtonText: 'حسنًا',
          buttonsStyling: false,
          customClass: {
            popup: 'patient-measurement-swal',
            title: 'patient-measurement-swal-title',
            htmlContainer: 'patient-measurement-swal-text',
            confirmButton: 'patient-measurement-swal-confirm'
          },
          allowOutsideClick: true,
          heightAuto: false
        });
      } else {
        alert('راجع بيانات القياس: تأكد من التاريخ والوزن والقياسات المدخلة.');
      }
      return;
    }
    const saveButton = document.querySelector('[data-measurement-save]');
    if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'جارٍ الحفظ...'; }
    try {
      const { data, error } = await supabase.from('weight_logs').insert({
        patient_id: patientId,
        weight,
        measurement_date: date,
        waist_cm: waist,
        hip_cm: hip,
        diet_adherence: adherence || null,
        notes: null
      }).select('id,patient_id,weight,measurement_date,waist_cm,hip_cm,diet_adherence,notes,created_at').single();
      if (error) throw error;
      measurementState.logs.push({
        id: data.id, date: data.measurement_date, weight: Number(data.weight),
        waist: data.waist_cm == null ? null : Number(data.waist_cm),
        hip: data.hip_cm == null ? null : Number(data.hip_cm),
        adherence: data.diet_adherence || '', notes: data.notes || ''
      });
      measurementState.logs.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
      renderMeasurements();
    } catch (error) {
      console.error('Save patient measurement failed:', error);
      alert('تعذر حفظ القياس. تحقق من صلاحيات قاعدة البيانات.');
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'حفظ'; }
    }
  }

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
          popup: 'patient-measurement-swal',
          title: 'patient-measurement-swal-title',
          htmlContainer: 'patient-measurement-swal-text',
          confirmButton: 'patient-measurement-swal-confirm'
        },
        heightAuto: false
      });
      return;
    }

    const result = await Swal.fire({
      icon: 'warning',
      title: 'تأكيد حذف القياس',
      text: 'هل تريد حذف قياس الوزن المحدد؟ لا يمكن التراجع عن هذا الإجراء.',
      showCancelButton: true,
      confirmButtonText: 'نعم، احذف القياس',
      cancelButtonText: 'إلغاء',
      reverseButtons: true,
      focusCancel: true,
      buttonsStyling: false,
      heightAuto: false,
      allowOutsideClick: () => !Swal.isLoading(),
      customClass: {
        popup: 'patient-measurement-swal',
        title: 'patient-measurement-swal-title',
        htmlContainer: 'patient-measurement-swal-text',
        actions: 'patient-measurement-swal-actions',
        confirmButton: 'patient-measurement-swal-danger',
        cancelButton: 'patient-measurement-swal-cancel'
      },
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

  async function loadVisits() {
    const loading = $('visitsLoading');
    const empty = $('visitsEmpty');
    const list = $('visitsList');

    if (!loading || !empty || !list) return;

    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    list.innerHTML = '';

    const { data, error } = await supabase
      .from('patient_visits')
      .select('id,visit_number,visit_date')
      .eq('patient_id', patientId)
      .order('visit_number', { ascending: false });

    loading.classList.add('hidden');

    if (error) {
      console.error('Load visits failed:', error);
      list.innerHTML = '<div class="text-center py-5 text-xs font-bold text-red-500">تعذر تحميل الزيارات.</div>';
      return;
    }

    if (!data?.length) {
      empty.classList.remove('hidden');
      return;
    }

    data.forEach((visit, index) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-emerald-300 px-4 py-3 transition' + (index === 0 ? ' latest-visit-row' : '');

      const visitLink = document.createElement('a');
      visitLink.href = `visit.html?id=${encodeURIComponent(visit.id)}`;
      visitLink.className = 'flex items-center gap-3 min-w-0 flex-1';
      visitLink.innerHTML = `
        <div class="w-10 h-10 shrink-0 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-sm">${escapeHtml(visit.visit_number)}</div>
        <div class="min-w-0">
          <div class="font-extrabold text-sm text-slate-800">خطة رقم ${escapeHtml(visit.visit_number)}</div>
          <div class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(formatVisitDate(visit.visit_date))}</div>
        </div>`;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'shrink-0 w-9 h-9 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition flex items-center justify-center';
      deleteButton.title = 'حذف الخطة';
      deleteButton.setAttribute('aria-label', 'حذف الزيارة');
      deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i>';
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteVisit(visit);
      });

      row.append(visitLink, deleteButton);
      list.appendChild(row);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function formatVisitDate(date) {
    if (!date) return 'بدون تاريخ';
    const value = new Date(`${date}T00:00:00`);
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(value);
  }

  async function deleteVisit(visit) {
    if (!state.user) {
      state.user = await access?.getCurrentUser?.();
    }

    if (!state.user) {
      await Swal.fire({
        title: 'تسجيل الدخول مطلوب',
        text: 'يجب تسجيل الدخول أولاً.',
        icon: 'warning',
        confirmButtonText: 'حسنًا',
        confirmButtonColor: '#178f84'
      });
      return;
    }

    const result = await Swal.fire({
      title: 'حذف الخطة',
      text: `هل أنت متأكد من حذف الخطة رقم ${visit.visit_number}؟`,
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
      buttonsStyling: true
    });

    if (!result.isConfirmed) return;

    const { error } = await supabase
      .from('patient_visits')
      .delete()
      .eq('id', visit.id)
      .eq('patient_id', patientId);

    if (error) {
      console.error('Delete visit failed:', error);
      await Swal.fire({
        title: 'تعذر الحذف',
        text: 'حدث خطأ أثناء حذف الزيارة.',
        icon: 'error',
        confirmButtonText: 'حسنًا',
        confirmButtonColor: '#178f84'
      });
      return;
    }

    await loadVisits();
  }

  async function addVisit() {
    if (!canWrite()) {
      alert('إضافة الخطة متاحة أثناء الاشتراك المدفوع فقط.');
      return;
    }

    const user = state.user;
    if (!user) {
      alert('تعذر تحديد المستخدم الحالي.');
      return;
    }

    const { data: lastVisit, error: lastError } = await supabase
      .from('patient_visits')
      .select('visit_number')
      .eq('patient_id', patientId)
      .order('visit_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      console.error('Get last visit failed:', lastError);
      alert('تعذر معرفة رقم الخطة التالية.');
      return;
    }

    const nextNumber = (lastVisit?.visit_number || 0) + 1;

    const { data: visit, error } = await supabase
      .from('patient_visits')
      .insert({
        patient_id: patientId,
        user_id: user.id,
        visit_number: nextNumber,
        visit_date: new Date().toISOString().slice(0, 10)
      })
      .select('id')
      .single();

    if (error) {
      console.error('Create visit failed:', error);
      alert('تعذر إنشاء الخطة.');
      return;
    }

    window.location.href = `visit.html?id=${encodeURIComponent(visit.id)}`;
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
    'pfInputPaid', 'pfInputLastVisit', 'pfInputNextFollow'
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
    if (details) details.open = true;

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
    if (details) details.open = false;
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

  function updateFinancePreview() {
    const amountRaw = $('pfInputAmount')?.value ?? '';
    const discountRaw = $('pfInputDiscount')?.value ?? '0';
    const amount = amountRaw === '' ? null : Number(amountRaw);
    const discount = discountRaw === '' ? 0 : Number(discountRaw);
    const output = $('pfInputDiscountedPreview');
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
      'pfInputPaid', 'pfInputLastVisit', 'pfInputNextFollow'
    ].forEach((id) => {
      const field = $(id);
      if (field) field.disabled = !allowed || !state.isEditing || state.isSaving || patientFinanceState.loading;
    });
    const note = $('patientFinanceAccessNote');
    if (note) {
      note.textContent = state.isAdmin
        ? 'وضع المدير: يمكنك تعديل بيانات الاشتراك والمواعيد.'
        : state.hasActiveSubscription
          ? 'الاشتراك فعال — يمكنك تعديل بيانات الاشتراك والمواعيد.'
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
    if (loading) { loading.hidden = false; loading.textContent = 'جاري تحميل بيانات الاشتراك والمواعيد...'; }
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
      $('pfInputNextFollow').value = data?.next_follow_up_date || '';

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
        errorBox.textContent = 'تعذر تحميل بيانات الاشتراك والمواعيد. ' + (error.message || 'تحقق من الاتصال وصلاحيات قاعدة البيانات.');
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
      next_follow_up_date: $('pfInputNextFollow').value || null
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
      toast.textContent = 'تم حفظ بيانات المريض والاشتراك والمواعيد بنجاح';
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
    if (moduleName === 'plans') void loadVisits();
    if (moduleName === 'nutrition-support') loadNutritionSupportFrame();
  }

  function loadNutritionSupportFrame() {
    const frame = $('nutritionSupportFrame');
    const id = state.patient?.id || patientId;
    if (!frame || !id || frame.dataset.loaded === 'true') return;
    try { sessionStorage.setItem('dpNutritionSupportPatientId', id); } catch (_) {}
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
      if (event.origin !== window.location.origin || event.data?.type !== 'dp-nsp-embed-height') return;
      const frame = $('nutritionSupportFrame');
      if (frame && event.source === frame.contentWindow) {
        const height = Number(event.data.height);
        if (Number.isFinite(height)) frame.style.height = `${Math.max(700, Math.min(height + 24, 12000))}px`;
      }
    });
    // Keep the workspace compact on first load; open a module only after an explicit selection.
    activatePatientModule(null);
  }

  function bindEvents() {
    bindPatientModuleTabs();
    // These controls live inside <summary>; cancel its toggle behavior but keep button actions.
    $('patientDataActions')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    $('editButton')?.addEventListener('click', enableEditing);
    $('savePatientButton')?.addEventListener('click', saveAllPatientData);
    $('cancelEditButton')?.addEventListener('click', cancelEditing);
    setEditing(false);
    $('addVisitButton')?.addEventListener('click', addVisit);
    $('addMeasurementRowBtn')?.addEventListener('click', openMeasurementEntry);
    $('weightTableBody')?.addEventListener('click', (event) => {
      const save = event.target.closest('[data-measurement-save]');
      const cancel = event.target.closest('[data-measurement-cancel]');
      const remove = event.target.closest('[data-measurement-delete]');
      if (save) void saveMeasurementEntry();
      else if (cancel) $('inlineMeasurementRow')?.remove();
      else if (remove) void deleteMeasurement(Number(remove.dataset.measurementDelete));
    });
    $('patientFinanceDetails')?.addEventListener('toggle', (event) => {
      if (event.currentTarget.open) void loadPatientFinance();
    });
    ['pfInputAmount', 'pfInputDiscount'].forEach((id) => {
      $(id)?.addEventListener('input', updateFinancePreview);
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
