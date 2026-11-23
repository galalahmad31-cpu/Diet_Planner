(function () {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;

  const state = {
    patients: [],
    totalPatients: 0,
    pageSize: 50,
    hasMorePatients: false,
    isLoadingPatients: false,
    statusFilter: 'all',
    showArchived: false,
    statusTimer: null,
    user: null,
    accountType: null,
    isAdmin: false,
    canCreatePatient: false,
    accessReady: false,
    accessPromise: null,
    openingAddModal: false
  };

  const $ = (id) => document.getElementById(id);

  const escapeHtml = window.DPUtils.escapeHtml;

  function showStatus(message, type = 'error') {
    const box = $('statusBox');
    if (!box) return;

    clearTimeout(state.statusTimer);

    const styles = type === 'success'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : 'bg-red-50 border-red-200 text-red-700';

    box.innerHTML = `
      <div class="border ${styles} rounded-xl px-4 py-3 text-xs font-bold">
        ${escapeHtml(message)}
      </div>`;

    state.statusTimer = setTimeout(() => {
      if (box) box.innerHTML = '';
    }, 3500);
  }

  function showLoadError() {
    const box = $('patientsList');
    if (!box) return;

    box.innerHTML = `
      <div class="text-center py-10 text-red-600 text-sm font-bold">
        تعذر تحميل ملفات المرضى.
      </div>`;
  }

  async function refreshAccess() {
    state.accessReady = false;
    try {
      const accessStatus = await access?.getAccessStatus?.();
      state.user = accessStatus?.user || null;
      state.accountType = accessStatus?.accountType || null;

      if (!state.user) {
        state.isAdmin = false;
        state.canCreatePatient = false;
        updateWriteControls();
        return;
      }

      state.isAdmin = accessStatus?.isAdmin === true;

      // Admin accounts with a professional profile use their own isolated workspace.
      if (state.accountType !== 'professional') {
        state.canCreatePatient = false;
        updateWriteControls();
        return;
      }

      state.canCreatePatient = true;

      updateWriteControls();
    } catch (error) {
      console.error('Patient access check failed:', error);
      state.isAdmin = false;
      state.canCreatePatient = false;
      updateWriteControls();
    } finally {
      state.accessReady = true;
    }
  }

  function updateWriteControls() {
    const addButton = $('addPatientBtn');
    const accessBox = $('accessStatus');
    const canAdd = state.accountType === 'professional' && state.canCreatePatient;

    // Patient creation is available to every authenticated professional account.
    if (addButton) {
      addButton.disabled = !canAdd;
      addButton.classList.toggle('opacity-50', !canAdd);
      addButton.classList.toggle('cursor-not-allowed', !canAdd);
      addButton.title = canAdd ? 'إضافة مريض جديد' : '';
    }
    if (accessBox) {
      accessBox.textContent = '';
      accessBox.className = 'hidden';
    }
  }

  async function loadPatients({ reset = true } = {}) {
    const box = $('patientsList');
    const pagination = $('patientsPagination');
    const moreButton = $('loadMorePatientsBtn');
    if (!box || state.isLoadingPatients) return;

    if (reset) {
      state.patients = [];
      state.totalPatients = 0;
      state.hasMorePatients = false;
      box.innerHTML = '<div class="loading text-center text-sm text-slate-400 py-10">جاري تحميل المرضى...</div>';
      if (pagination) pagination.style.display = 'none';
    }

    state.isLoadingPatients = true;
    document.querySelectorAll('[data-record-view]').forEach((button) => { button.disabled = true; });
    if (moreButton) {
      moreButton.disabled = true;
      moreButton.textContent = 'جاري التحميل...';
    }

    try {
      if (!supabase) throw new Error('Supabase client is not available.');
      if (!state.user || state.accountType !== 'professional') {
        throw new Error('Professional-only patient workspace access required.');
      }

      const from = state.patients.length;
      const { data: pagePatients, error: patientsError } = await supabase.rpc(
        'list_my_professional_patients',
        { p_limit: state.pageSize, p_offset: from, p_include_archived: state.showArchived }
      );

      if (patientsError) throw patientsError;

      const rows = pagePatients || [];
      if (reset) state.totalPatients = Number(rows[0]?.total_count || 0);

      const patientIds = rows.map(patient => patient.id).filter(Boolean);
      let financeRows = [];

      if (patientIds.length) {
        const { data, error: financeError } = await supabase
          .from('patient_finances')
          .select('patient_id,subscription_start_date,subscription_end_date,next_follow_up_date')
          .eq('user_id', state.user.id)
          .in('patient_id', patientIds);
        if (financeError) throw financeError;
        financeRows = data || [];
      }

      const financeByPatient = new Map(financeRows.map(finance => [finance.patient_id, finance]));
      state.patients.push(...rows.map(patient => ({
        ...patient,
        isLinked: Boolean(patient.is_linked),
        isArchived: Boolean(patient.is_archived),
        finance: financeByPatient.get(patient.id) || null
      })));

      state.hasMorePatients = state.patients.length < state.totalPatients;
      renderPatients();
      updatePatientsPagination();
    } catch (error) {
      console.error('Patient directory load failed:', error);
      if (reset || !state.patients.length) showLoadError();
      else showStatus('تعذر تحميل الدفعة التالية من المرضى.');
    } finally {
      state.isLoadingPatients = false;
      document.querySelectorAll('[data-record-view]').forEach((button) => { button.disabled = false; });
      updatePatientsPagination();
    }
  }

  function updatePatientsPagination() {
    const pagination = $('patientsPagination');
    const button = $('loadMorePatientsBtn');
    const summary = $('patientsLoadSummary');
    if (!pagination || !button || !summary) return;

    const loaded = state.patients.length;
    pagination.style.display = loaded ? 'flex' : 'none';
    summary.textContent = `تم تحميل ${loaded} من ${state.totalPatients} مريض`;
    button.style.display = state.hasMorePatients ? 'inline-flex' : 'none';
    button.disabled = state.isLoadingPatients;
    button.textContent = state.isLoadingPatients ? 'جاري التحميل...' : 'عرض المزيد';
  }

  const localDateKey = window.DPDate.todayKey;

  function getPatientSubscriptionStatus(patient) {
    const expiryDate = String(patient.finance?.subscription_end_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return 'unknown';
    return expiryDate >= localDateKey() ? 'active' : 'expired';
  }

  function formatPatientDate(value) {
    if (!value) return 'غير محدد';
    const dateKey = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return 'غير محدد';
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  function updatePatientStats() {
    const counts = { all: state.patients.length, active: 0, expired: 0, unknown: 0, linked: state.patients.filter(patient => patient.isLinked).length };

    state.patients.forEach((patient) => {
      counts[getPatientSubscriptionStatus(patient)] += 1;
    });

    const values = {
      totalPatientsCount: state.totalPatients,
      activePatientsCount: counts.active,
      expiredPatientsCount: counts.expired,
      unknownPatientsCount: counts.unknown,
      linkedPatientsCount: counts.linked
    };

    const stats = $('patientStats');
    if (stats) stats.hidden = state.showArchived;

    document.querySelectorAll('[data-record-view]').forEach((button) => {
      const selected = button.dataset.recordView === (state.showArchived ? 'archived' : 'active');
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    Object.entries(values).forEach(([id, value]) => {
      const element = $(id);
      if (element) element.textContent = String(value);
    });

    document.querySelectorAll('[data-status-filter]').forEach((button) => {
      const selected = button.dataset.statusFilter === state.statusFilter;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function renderPatients() {
    const box = $('patientsList');
    const input = $('searchInput');
    if (!box || !input) return;

    updatePatientStats();

    const query = input.value.trim().toLocaleLowerCase('ar-EG');
    const filtered = state.patients.filter((patient) => {
      const matchesQuery = !query ||
        String(patient.name || '').toLocaleLowerCase('ar-EG').includes(query) ||
        String(patient.diagnosis || '').toLocaleLowerCase('ar-EG').includes(query);
      const matchesStatus = state.statusFilter === 'all' ||
        getPatientSubscriptionStatus(patient) === state.statusFilter;
      return matchesQuery && matchesStatus;
    });

    if (!filtered.length) {
      const hasPatients = state.patients.length > 0;
      box.innerHTML = `
        <div class="patient-empty">
          <i class="fa-solid fa-user-group" aria-hidden="true"></i>
          <p>${hasPatients ? 'لا توجد ملفات مطابقة للبحث أو التصفية.' : state.showArchived ? 'لا توجد ملفات مؤرشفة.' : 'لا توجد ملفات مرضى حتى الآن.'}</p>
        </div>`;
      return;
    }

    const statusLabels = {
      active: 'نشط',
      expired: 'منتهي',
      unknown: 'غير محدد',
    };

    box.innerHTML = filtered.map((patient) => {
      const status = patient.isArchived ? 'archived' : getPatientSubscriptionStatus(patient);
      const diagnosis = patient.diagnosis
        ? escapeHtml(patient.diagnosis)
        : 'التشخيص غير مسجل';
      const followUp = formatPatientDate(patient.finance?.next_follow_up_date);
      const followUpLabel = 'المتابعة القادمة';

      const actionButton = patient.isArchived
        ? `<button type="button" data-action="ask-restore" data-patient-id="${escapeHtml(patient.id)}"
              class="patient-record-action patient-record-action--restore" title="استعادة الملف" aria-label="استعادة الملف">
              <i class="fa-solid fa-rotate-left" aria-hidden="true"></i>
            </button>`
        : `<button type="button" data-action="ask-archive" data-patient-id="${escapeHtml(patient.id)}"
              class="patient-record-action patient-record-action--archive" title="أرشفة الملف" aria-label="أرشفة الملف">
              <i class="fa-solid fa-box-archive" aria-hidden="true"></i>
            </button>`;

      return `
        <article class="patient-row" ${patient.isArchived ? '' : `role="link" tabindex="0" data-action="open-patient" data-patient-id="${escapeHtml(patient.id)}"`}
          aria-label="${patient.isArchived ? 'ملف مؤرشف' : 'فتح ملف المريض'} ${escapeHtml(patient.name || 'بدون اسم')}">
          <div class="patient-row-main">
            <h3 class="patient-name">${escapeHtml(patient.name || 'بدون اسم')}</h3>
            <div class="patient-row-meta">
              <span class="patient-diagnosis" title="التشخيص">${diagnosis}</span>
              ${patient.isArchived ? '<span class="patient-follow-up">ملف مؤرشف</span>' : `<span class="patient-follow-up">
                <i class="fa-regular fa-calendar" aria-hidden="true"></i>
                <span>${followUpLabel}: ${escapeHtml(followUp)}</span>
              </span>`}
            </div>
          </div>
          <div class="patient-row-actions">
            <span class="patient-status patient-status--${status}">${patient.isArchived ? 'مؤرشف' : statusLabels[status]}</span>
            ${actionButton}
          </div>
        </article>`;
    }).join('');
  }

  function openPatient(id) {
    const validId = typeof id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    if (!validId) {
      window.alert("تعذر فتح ملف المريض لأن معرّف الملف غير صالح. حدّث قائمة المرضى وحاول مرة أخرى.");
      return;
    }
    window.location.href = `patient-profile.html?id=${encodeURIComponent(id)}`;
  }

  async function openAddPatientModal() {
    // Wait for the account type check before opening the patient form.
    if (state.openingAddModal) return;
    state.openingAddModal = true;

    try {
      if (!state.accessReady) {
        state.accessPromise = state.accessPromise || refreshAccess();
        await state.accessPromise;
      }
      if (state.accountType !== 'professional' || !state.canCreatePatient) return;

      const modal = $('addPatientModal');
      if (!modal) return;

      modal.classList.remove('hidden');
      modal.classList.add('flex');
      setTimeout(() => $('newPatientName')?.focus(), 50);
    } finally {
      state.openingAddModal = false;
    }
  }

  function closeAddPatientModal() {
    const modal = $('addPatientModal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');

    const input = $('newPatientName');
    if (input) input.value = '';
  }

  async function createPatient() {
    if (state.accountType !== 'professional' || !state.canCreatePatient) return;

    const input = $('newPatientName');
    const name = input?.value.trim();

    if (!name) {
      showStatus('أدخل اسم المريض أولاً.');
      input?.focus();
      return;
    }

    try {
      const user = state.user;
      if (!user) throw new Error('No authenticated user.');

      const { data: patientId, error } = await supabase.rpc(
        'create_professional_patient',
        { p_name: name }
      );

      if (error) throw error;
      if (!patientId) throw new Error('Patient creation returned no record ID.');

      closeAddPatientModal();
      await loadPatients();
      showStatus('تم حفظ المريض بنجاح.', 'success');
    } catch (error) {
      console.error('Create patient failed:', error);
      showStatus(error?.message || 'تعذر حفظ المريض في قاعدة البيانات.');
    }
  }

  async function confirmArchiveAction(id, archived) {
    const patient = state.patients.find((item) => item.id === id);
    if (!patient || patient.isArchived === archived) return;

    const confirmed = await window.DPConfirm?.ask({
      title: archived ? "أرشفة ملف المريض؟" : "استعادة ملف المريض؟",
      message: archived
        ? `سيُنقل ملف «${patient.name || 'بدون اسم'}» إلى الأرشيف. ستظل بياناته محفوظة ويمكنك استعادته لاحقًا.`
        : `سيعود ملف «${patient.name || 'بدون اسم'}» إلى قائمة الملفات النشطة.`,
      confirmText: archived ? "أرشفة الملف" : "استعادة الملف",
      variant: archived ? "warning" : "primary"
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('set_patient_archive_status', {
        p_patient_id: id,
        p_archived: archived
      });
      if (error) throw error;

      await loadPatients();
      showStatus(archived ? 'تمت أرشفة الملف مع الاحتفاظ ببياناته.' : 'تمت استعادة الملف بنجاح.', 'success');
    } catch (error) {
      console.error(archived ? 'Archive patient failed:' : 'Restore patient failed:', error);
      showStatus(archived ? 'تعذرت أرشفة الملف.' : 'تعذرت استعادة الملف.');
    }
  }

  function handleClick(event) {
    const recordViewButton = event.target.closest('[data-record-view]');
    if (recordViewButton) {
      const nextArchived = recordViewButton.dataset.recordView === 'archived';
      if (nextArchived !== state.showArchived) {
        state.showArchived = nextArchived;
        state.statusFilter = 'all';
        void loadPatients();
      }
      return;
    }

    const filterButton = event.target.closest('[data-status-filter]');
    if (filterButton) {
      state.statusFilter = filterButton.dataset.statusFilter || 'all';
      renderPatients();
      return;
    }

    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    if (action === 'open-add-patient') {
      event.preventDefault();
      void openAddPatientModal();
    }
    if (action === 'close-add-patient') closeAddPatientModal();
    if (action === 'create-patient') createPatient();
    if (action === 'open-patient') openPatient(target.dataset.patientId);
    if (action === 'ask-archive') {
      event.preventDefault();
      event.stopPropagation();
      void confirmArchiveAction(target.dataset.patientId, true);
    }
    if (action === 'ask-restore') {
      event.preventDefault();
      event.stopPropagation();
      void confirmArchiveAction(target.dataset.patientId, false);
    }
  }

  function handleCardKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    openPatient(event.currentTarget.dataset.patientId);
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
    $('patientsList')?.addEventListener('keydown', (event) => {
      const card = event.target.closest('.patient-row[role="link"]');
      if (card) handleCardKeydown({ key: event.key, target: event.target, currentTarget: card, preventDefault: () => event.preventDefault() });
    });
    $('searchInput')?.addEventListener('input', renderPatients);
    $('loadMorePatientsBtn')?.addEventListener('click', () => {
      if (state.hasMorePatients && !state.isLoadingPatients) void loadPatients({ reset: false });
    });

    $('newPatientName')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') createPatient();
      if (event.key === 'Escape') closeAddPatientModal();
    });

    $('addPatientModal')?.addEventListener('click', (event) => {
      if (event.target === $('addPatientModal')) closeAddPatientModal();
    });

  }

  async function init() {
    bindEvents();

    state.accessPromise = refreshAccess();
    await state.accessPromise;
    if (!state.user || state.accountType !== 'professional') {
      window.DietPlannerAccess?.showAccessPrompt?.({
        title: "حساب المختص مطلوب",
        message: "سجّل الدخول بحساب مختص لعرض قائمة مرضاك وملفاتهم، بما في ذلك حسابات الإدارة ذات نوع الحساب المهني.",
        actionLabel: "العودة للرئيسية",
        actionHref: "app.html"
      });
      const list = $("patientsList");
      if (list) list.innerHTML = "";
      return;
    }
    await loadPatients();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
