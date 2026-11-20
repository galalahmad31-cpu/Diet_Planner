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
    pendingDeleteId: null,
    statusTimer: null,
    user: null,
    isAdmin: false,
    hasActiveSubscription: false,
    canAddPatient: false,
    activeSubscriptionId: null,
    accessReady: false,
    accessPromise: null,
    openingAddModal: false
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

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

      if (!state.user) {
        state.isAdmin = false;
        state.hasActiveSubscription = false;
        state.canAddPatient = false;
        state.activeSubscriptionId = null;
        updateWriteControls();
        return;
      }

      state.isAdmin = accessStatus?.isAdmin === true;

      // Administrators are explicitly exempt from subscription and patient-quota UI gates.
      // The database RLS policy remains the final authorization for INSERT.
      if (state.isAdmin) {
        state.hasActiveSubscription = true;
        state.canAddPatient = true;
        state.activeSubscriptionId = null;
        updateWriteControls();
        return;
      }

      state.hasActiveSubscription =
        (await access?.hasActiveSubscription?.(state.user.id)) === true;
      state.activeSubscriptionId = null;
      if (state.hasActiveSubscription) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: activeSub, error: subError } = await supabase
          .from('subscriptions')
          .select('id')
          .eq('user_id', state.user.id)
          .eq('status', 'paid')
          .lte('start_date', today)
          .gte('expiry_date', today)
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (subError) throw subError;
        state.activeSubscriptionId = activeSub?.id || null;
      }
      state.canAddPatient =
        (await access?.canAddPatient?.(state.user.id)) === true;

      updateWriteControls();
    } catch (error) {
      console.error('Patient access check failed:', error);
      state.isAdmin = false;
      state.hasActiveSubscription = false;
      state.canAddPatient = false;
      updateWriteControls();
    } finally {
      state.accessReady = true;
    }
  }

  function updateWriteControls() {
    const addButton = $('addPatientBtn');
    const accessBox = $('accessStatus');
    const canAdd = state.isAdmin || state.canAddPatient;

    // Do not show subscription/quota warnings on the patient directory.
    // The add action itself is controlled solely by the authoritative quota RPC.
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
    if (moreButton) {
      moreButton.disabled = true;
      moreButton.textContent = 'جاري التحميل...';
    }

    try {
      if (!supabase) throw new Error('Supabase client is not available.');

      if (reset) {
        const { count, error: countError } = await supabase
          .from('patients')
          .select('id', { count: 'exact', head: true });
        if (countError) throw countError;
        state.totalPatients = count || 0;
      }

      const from = state.patients.length;
      const to = from + state.pageSize - 1;
      const { data: patients, error: patientsError } = await supabase
        .from('patients')
        .select('id,user_id,name,diagnosis')
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);

      if (patientsError) throw patientsError;

      const pagePatients = patients || [];
      const patientIds = pagePatients.map((patient) => patient.id).filter(Boolean);
      let financeRows = [];

      if (patientIds.length) {
        const { data, error: financeError } = await supabase
          .from('patient_finances')
          .select('patient_id,subscription_start_date,subscription_end_date,next_follow_up_date')
          .in('patient_id', patientIds);

        if (financeError) throw financeError;
        financeRows = data || [];
      }

      // Resolve legacy duplicate finance rows deterministically within this page.
      financeRows.sort((a, b) =>
        String(b.subscription_start_date || '').localeCompare(String(a.subscription_start_date || '')) ||
        String(b.subscription_end_date || '').localeCompare(String(a.subscription_end_date || ''))
      );

      const financeByPatient = new Map();
      financeRows.forEach((finance) => {
        if (finance.patient_id && !financeByPatient.has(finance.patient_id)) {
          financeByPatient.set(finance.patient_id, finance);
        }
      });

      state.patients.push(...pagePatients.map((patient) => ({
        ...patient,
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

  function localDateKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

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
    const counts = { all: state.patients.length, active: 0, expired: 0, unknown: 0 };

    state.patients.forEach((patient) => {
      counts[getPatientSubscriptionStatus(patient)] += 1;
    });

    const values = {
      totalPatientsCount: state.totalPatients,
      activePatientsCount: counts.active,
      expiredPatientsCount: counts.expired,
      unknownPatientsCount: counts.unknown
    };

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
          <p>${hasPatients ? 'لا توجد ملفات مطابقة للبحث أو التصفية.' : 'لا توجد ملفات مرضى حتى الآن.'}</p>
        </div>`;
      return;
    }

    const statusLabels = {
      active: 'نشط',
      expired: 'منتهي',
      unknown: 'غير محدد'
    };

    box.innerHTML = filtered.map((patient) => {
      const status = getPatientSubscriptionStatus(patient);
      const diagnosis = patient.diagnosis
        ? escapeHtml(patient.diagnosis)
        : 'التشخيص غير مسجل';
      const followUp = formatPatientDate(patient.finance?.next_follow_up_date);

      return `
        <article class="patient-row" role="link" tabindex="0"
          data-action="open-patient" data-patient-id="${escapeHtml(patient.id)}"
          aria-label="فتح ملف المريض ${escapeHtml(patient.name || 'بدون اسم')}">
          <div class="patient-row-main">
            <h3 class="patient-name">${escapeHtml(patient.name || 'بدون اسم')}</h3>
            <div class="patient-row-meta">
              <span class="patient-diagnosis" title="التشخيص">${diagnosis}</span>
              <span class="patient-follow-up">
                <i class="fa-regular fa-calendar" aria-hidden="true"></i>
                <span>المتابعة: ${escapeHtml(followUp)}</span>
              </span>
            </div>
          </div>
          <div class="patient-row-actions">
            <span class="patient-status patient-status--${status}">${statusLabels[status]}</span>
            <button type="button" data-action="ask-delete" data-patient-id="${escapeHtml(patient.id)}"
              class="patient-delete" title="حذف المريض" aria-label="حذف المريض">
              <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
            </button>
          </div>
        </article>`;
    }).join('');
  }

  function openPatient(id) {
    if (!id) return;
    window.location.href = `patient-profile.html?id=${encodeURIComponent(id)}`;
  }

  async function openAddPatientModal() {
    // If access/quota is still being checked on initial page load, wait for
    // that same request rather than dropping the first tap.
    if (state.openingAddModal) return;
    state.openingAddModal = true;

    try {
      if (!state.accessReady) {
        state.accessPromise = state.accessPromise || refreshAccess();
        await state.accessPromise;
      }
      if (!state.isAdmin && !state.canAddPatient) return;

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
    if (!state.isAdmin && !state.canAddPatient) return;

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

      const { data, error } = await supabase
        .from('patients')
        .insert({
          user_id: user.id,
          name,
          phone: null,
          gender: null,
          birth_date: null,
          age: null,
          height: null,
          diagnosis: null,
          complaints: null,
          clinical_notes: null,
          subscription_id: state.isAdmin ? null : state.activeSubscriptionId
        })
        .select('id')
        .single();

      if (error) throw error;

      closeAddPatientModal();
      await loadPatients();
      showStatus('تم حفظ المريض بنجاح.', 'success');
    } catch (error) {
      console.error('Create patient failed:', error);
      showStatus('تعذر حفظ المريض في قاعدة البيانات.');
    }
  }

  function askDelete(id) {
    const patient = state.patients.find((item) => item.id === id);
    if (!patient) return;

    state.pendingDeleteId = id;

    const text = $('deleteText');
    if (text) {
      text.textContent = `هل أنت متأكد من حذف ملف «${patient.name || 'بدون اسم'}»؟`;
    }

    const modal = $('deleteModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  function closeDeleteModal() {
    state.pendingDeleteId = null;

    const modal = $('deleteModal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async function deletePatient() {
    const id = state.pendingDeleteId;
    if (!id) return;

    if (!state.user) {
      showStatus('يجب تسجيل الدخول أولاً.');
      return;
    }

    try {
      const { error } = await supabase
        .from('patients')
        .delete()
        .eq('id', id);

      if (error) throw error;

      state.patients = state.patients.filter((patient) => patient.id !== id);
      state.totalPatients = Math.max(0, state.totalPatients - 1);
      closeDeleteModal();
      renderPatients();
      showStatus('تم حذف المريض.', 'success');
    } catch (error) {
      console.error('Delete patient failed:', error);
      closeDeleteModal();
      showStatus('تعذر حذف المريض.');
    }
  }

  function handleClick(event) {
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
    if (action === 'close-delete') closeDeleteModal();
    if (action === 'open-patient') openPatient(target.dataset.patientId);
    if (action === 'ask-delete') {
      event.preventDefault();
      event.stopPropagation();
      askDelete(target.dataset.patientId);
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
      const card = event.target.closest('.patient-card[role="link"]');
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

    $('deleteModal')?.addEventListener('click', (event) => {
      if (event.target === $('deleteModal')) closeDeleteModal();
    });

    $('confirmDeleteBtn')?.addEventListener('click', deletePatient);
  }

  async function init() {
    bindEvents();

    state.accessPromise = refreshAccess();
    await state.accessPromise;
    if (!state.user) {
      window.DietPlannerAccess?.showAccessPrompt?.({
        title: "تسجيل الدخول مطلوب",
        message: "سجّل الدخول أولًا لعرض قائمة المرضى وملفاتهم.",
        actionLabel: "تسجيل الدخول",
        actionHref: "login.html"
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
