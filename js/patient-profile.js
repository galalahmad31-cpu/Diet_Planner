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
    setLink('financeLink', 'finance.html');
    const nutritionSupportLink = $('nutritionSupportLink');
    if (nutritionSupportLink && patientId) {
      // The patient support page reads the patient identifier from ?patient=.
      nutritionSupportLink.href = `nutritionsupport-patient.html?patient=${encodeURIComponent(patientId)}`;
    }

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

  function closePatientModal() {
    const details = document.querySelector('.patient-data-card .dashboard-details');
    if (details) details.open = false;
    cancelEditing();
  }

  function financeDate(value) {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0,10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ar-EG',{year:'numeric',month:'short',day:'numeric'}).format(date);
  }

  function showPatientFinanceSuccess() {
    let toast = $('patientFinanceSuccessToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'patientFinanceSuccessToast';
      toast.className = 'patient-finance-success-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.textContent = 'تم حفظ ماليات المريض بنجاح';
      document.body.appendChild(toast);
    }

    toast.classList.remove('is-visible');
    // Restart the short entrance animation when the toast is shown again.
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    window.clearTimeout(toast.dismissTimer);
    toast.dismissTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1800);
  }

  function closePatientFinanceModal() {
    $('patientFinanceModal')?.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }

  let currentFinance = null;
  function updateFinancePreview() {
    const amount=Number($('pfInputAmount').value)||0;
    const discount=Number($('pfInputDiscount').value)||0;
    $('pfInputDiscountedPreview').textContent=(amount*(1-discount/100)).toLocaleString('ar-EG',{maximumFractionDigits:2})+' جنيه';
    const start=$('pfInputStart').value,months=Number($('pfInputMonths').value);
    if(start&&months>0){const d=new Date(start+'T00:00:00');d.setMonth(d.getMonth()+months);$('pfInputEndPreview').textContent=financeDate(d.toISOString().slice(0,10));}
    else $('pfInputEndPreview').textContent='—';
  }
  async function openPatientFinanceModal() {
    if (!$('patientFinanceModal')?.classList.contains('hidden')) return;
    closePatientModal();
    if(!patientId||!state.user){alert('تعذر تحديد المستخدم أو المريض.');return;}
    $('patientFinanceModal').classList.remove('hidden');document.body.classList.add('overflow-hidden');
    $('patientFinanceName').textContent=state.patient?.name||'';
    $('patientFinanceLoading').classList.remove('hidden');$('patientFinanceForm').classList.add('hidden');
    $('patientFinanceEmpty').classList.add('hidden');$('patientFinanceError').classList.add('hidden');
    try{
      const {data,error}=await supabase.from('patient_finances').select('*').eq('patient_id',patientId).eq('user_id',state.user.id).maybeSingle();
      if(error)throw error;currentFinance=data||null;
      $('pfInputStart').value=data?.subscription_start_date||'';
      $('pfInputMonths').value=data?.subscription_months??'';
      $('pfInputAmount').value=data?.subscription_amount??'';
      $('pfInputDiscount').value=data?.discount_percent??0;
      $('pfInputPaid').value=String(Boolean(data?.is_paid));
      $('pfInputFollowDays').value=data?.follow_up_days??'';
      $('pfInputLastVisit').value=data?.last_visit_date||'';
      $('pfInputNextFollow').value=data?.next_follow_up_date||'';
      $('patientFinanceLoading').classList.add('hidden');
      if(!data)$('patientFinanceEmpty').classList.remove('hidden');
      $('patientFinanceForm').classList.remove('hidden');updateFinancePreview();
    }catch(e){console.error('Finance load error',e);$('patientFinanceLoading').textContent='تعذر تحميل الماليات: '+(e.message||'تحقق من صلاحيات قاعدة البيانات');}
  }
  async function savePatientFinance() {
    if(!state.user||!patientId)return;
    const err=$('patientFinanceError');err.classList.add('hidden');
    const start=$('pfInputStart').value||null,months=$('pfInputMonths').value?Number($('pfInputMonths').value):null;
    const amount=$('pfInputAmount').value!==''?Number($('pfInputAmount').value):null;
    const discount=Number($('pfInputDiscount').value)||0,follow=$('pfInputFollowDays').value?Number($('pfInputFollowDays').value):null;
    if((start&&!months)||(!start&&months)){err.textContent='أدخل تاريخ البداية ومدة الاشتراك معًا.';err.classList.remove('hidden');return;}
    if(discount<0||discount>100||!Number.isFinite(discount)){err.textContent='الخصم يجب أن يكون بين 0 و100%.';err.classList.remove('hidden');return;}
    if(amount!==null&&(!Number.isFinite(amount)||amount<0)){err.textContent='قيمة الاشتراك غير صحيحة.';err.classList.remove('hidden');return;}
    if(follow!==null&&(!Number.isFinite(follow)||follow<1)){err.textContent='مدة المتابعة يجب أن تكون يومًا على الأقل.';err.classList.remove('hidden');return;}
    const last = $('pfInputLastVisit').value || null;
    const next = $('pfInputNextFollow').value || null;

    // subscription_end_date and discounted_amount are GENERATED ALWAYS columns.
    // PostgreSQL calculates them from the source fields; never include them in writes.
    const payload = {
      patient_id: patientId,
      user_id: state.user.id,
      subscription_start_date: start,
      subscription_months: months,
      subscription_amount: amount,
      discount_percent: discount,
      is_paid: $('pfInputPaid').value === 'true',
      follow_up_days: follow,
      last_visit_date: last,
      next_follow_up_date: next
    };
    const btn=$('savePatientFinance');btn.disabled=true;btn.textContent='جارٍ الحفظ...';
    try{const {error}=await supabase.from('patient_finances').upsert(payload,{onConflict:'patient_id'});if(error)throw error;closePatientFinanceModal();showPatientFinanceSuccess();}
    catch(e){console.error(e);err.textContent=e.message||'تعذر حفظ البيانات. تحقق من صلاحيات الكتابة (RLS).';err.classList.remove('hidden');}
    finally{btn.disabled=false;btn.textContent='حفظ الماليات';}
  }

  function bindEvents() {
    $('editButton')?.addEventListener('click', enableEditing);
    $('savePatientButton')?.addEventListener('click', savePatient);
    $('cancelEditButton')?.addEventListener('click', cancelEditing);
    $('addVisitButton')?.addEventListener('click', addVisit);
    $('openPatientFinance')?.addEventListener('click', openPatientFinanceModal);
    $('savePatientFinance')?.addEventListener('click', savePatientFinance);
    $('cancelPatientFinance')?.addEventListener('click', closePatientFinanceModal);
    ['pfInputStart','pfInputMonths','pfInputAmount','pfInputDiscount'].forEach(id=>$(id)?.addEventListener('input',updateFinancePreview));
    $('closePatientFinance')?.addEventListener('click', closePatientFinanceModal);
    $('patientFinanceCloseBottom')?.addEventListener('click', closePatientFinanceModal);
    $('patientFinanceModal')?.addEventListener('click', (event) => { if (event.target.matches('[data-close-finance]')) closePatientFinanceModal(); });
    document.addEventListener('keydown', (event) => { if(event.key==='Escape') closePatientFinanceModal(); });

    // Use delegation so the close control remains reliable inside the modal.
    document.addEventListener('click', (event) => {
      const closeButton = event.target.closest('#closePatientModal');
      if (closeButton) {
        event.preventDefault();
        event.stopPropagation();
        closePatientModal();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePatientModal();
    });
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
