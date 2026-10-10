(() => {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const patientId = new URLSearchParams(window.location.search).get('id');

  const state = {
    patient: null,
    user: null,
    isAdmin: false,
    hasActiveSubscription: false
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

  function getUserForWrite() {
    return state.user;
  }

  async function refreshWriteAccess() {
    try {
      const accessStatus = await access?.getAccessStatus?.();
      state.user = accessStatus?.user || null;

      if (!state.user) {
        state.isAdmin = false;
        state.hasActiveSubscription = false;
        updateWriteControls();
        return;
      }

      state.isAdmin = accessStatus?.isAdmin === true;
      state.hasActiveSubscription =
        (await access?.hasActiveSubscription?.(state.user.id)) === true;

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
        ? 'إضافة زيارة'
        : 'إضافة الزيارة متاحة أثناء الاشتراك المدفوع فقط';
    }

    const accessBox = $('writeAccessStatus');
    if (accessBox) {
      if (state.isAdmin) {
        accessBox.textContent = 'وضع المدير: جميع صلاحيات التعديل متاحة.';
        accessBox.className =
          'mt-4 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2';
      } else if (state.hasActiveSubscription) {
        accessBox.textContent = 'الاشتراك فعال — يمكنك تعديل الملف وإدارة الزيارات.';
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

    const { data, error } = await supabase
      .from('patients')
      .select('id,user_id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
      .eq('id', patientId)
      .maybeSingle();

    if (error) {
      console.error('Load patient failed:', error);
      showError('تعذر تحميل ملف المريض.');
      return;
    }

    if (!data) {
      showError('ملف المريض غير موجود.');
      return;
    }

    state.patient = data;
    fillPatientData();
    await refreshWriteAccess();
    setLink('weightLink', 'weight.html');

    $('loadingState')?.classList.add('hidden');
    $('patientContent')?.classList.remove('hidden');
    $('modulesSection')?.classList.remove('hidden');

    await loadVisits();
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

    data.forEach((visit) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-emerald-300 px-4 py-3 transition';

      const visitLink = document.createElement('a');
      visitLink.href = `visit.html?id=${encodeURIComponent(visit.id)}`;
      visitLink.className = 'flex items-center gap-3 min-w-0 flex-1';
      visitLink.innerHTML = `
        <div class="w-10 h-10 shrink-0 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-sm">${escapeHtml(visit.visit_number)}</div>
        <div class="min-w-0">
          <div class="font-extrabold text-sm text-slate-800">زيارة رقم ${escapeHtml(visit.visit_number)}</div>
          <div class="text-[11px] text-slate-400 mt-0.5">${escapeHtml(formatVisitDate(visit.visit_date))}</div>
        </div>`;

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'shrink-0 w-9 h-9 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition flex items-center justify-center';
      deleteButton.title = 'حذف الزيارة';
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
      title: 'حذف الزيارة',
      text: `هل أنت متأكد من حذف الزيارة رقم ${visit.visit_number}؟`,
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
      alert('إضافة الزيارة متاحة أثناء الاشتراك المدفوع فقط.');
      return;
    }

    const user = await getUserForWrite();
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
      alert('تعذر معرفة رقم الزيارة التالية.');
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
      alert('تعذر إنشاء الزيارة.');
      return;
    }

    window.location.href = `visit.html?id=${encodeURIComponent(visit.id)}`;
  }

  function fillPatientData() {
    const patient = state.patient;
    if (!patient) return;

    $('patientName').textContent = patient.name || 'بدون اسم';
    $('nameInput').value = patient.name || '';
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
    'genderInput',
    'birthDateInput',
    'ageInput',
    'heightInput',
    'diagnosisInput',
    'complaintsInput',
    'notesInput'
  ];

  function setEditing(enabled) {
    patientFieldIds.forEach((id) => {
      const field = $(id);
      if (field) field.disabled = !enabled;
    });

    $('saveArea')?.classList.toggle('hidden', !enabled);
    $('editButton')?.classList.toggle('hidden', enabled);
  }

  function enableEditing() {
    if (!canWrite()) {
      alert('تعديل بيانات المريض متاح أثناء الاشتراك المدفوع فقط.');
      return;
    }

    setEditing(true);
  }

  function cancelEditing() {
    fillPatientData();
    setEditing(false);
  }

  async function savePatient() {
    if (!canWrite()) {
      alert('تعديل بيانات المريض متاح أثناء الاشتراك المدفوع فقط.');
      setEditing(false);
      return;
    }

    const payload = {
      name: $('nameInput').value.trim() || 'مريض',
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
      .select('id,user_id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
      .single();

    if (error) {
      console.error('Save patient failed:', error);
      alert('تعذر حفظ تعديلات المريض.');
      return;
    }

    state.patient = data;
    cancelEditing();
  }

  function bindEvents() {
    $('editButton')?.addEventListener('click', enableEditing);
    $('savePatientButton')?.addEventListener('click', savePatient);
    $('cancelEditButton')?.addEventListener('click', cancelEditing);
    $('addVisitButton')?.addEventListener('click', addVisit);
  }

  async function init() {
    try {
      bindEvents();

      if (!access || !supabase) {
        throw new Error('تعذر تهيئة الاتصال بقاعدة البيانات.');
      }

      const accessStatus = await access.getAccessStatus?.();
      state.user = accessStatus?.user || null;
      if (!state.user) {
        showError('انتهت جلسة تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى.');
        return;
      }

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
