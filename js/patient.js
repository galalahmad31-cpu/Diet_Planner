(function () {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;

  const state = {
    patients: [],
    pendingDeleteId: null,
    statusTimer: null,
    user: null,
    isAdmin: false,
    hasActiveSubscription: false,
    canAddPatient: false,
    activeSubscriptionId: null
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

  async function loadPatients() {
    const box = $('patientsList');
    if (!box) return;

    try {
      if (!supabase) {
        throw new Error('Supabase client is not available.');
      }

      const { data, error } = await supabase
        .from('patients')
        .select('id,user_id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes,created_at,updated_at')
        .order('name', { ascending: true });

      if (error) throw error;

      state.patients = data || [];
      renderPatients();
    } catch (error) {
      console.error('Patient directory load failed:', error);
      showLoadError();
    }
  }

  function renderPatients() {
    const box = $('patientsList');
    const input = $('searchInput');
    if (!box || !input) return;

    const query = input.value.trim().toLocaleLowerCase('ar-EG');

    const filtered = state.patients.filter((patient) =>
      !query || String(patient.name || '').toLocaleLowerCase('ar-EG').includes(query)
    );

    if (!filtered.length) {
      box.innerHTML = `
        <div class="text-center py-12 border border-dashed border-slate-200 rounded-2xl">
          <div class="text-3xl mb-3">👤</div>
          <p class="font-bold text-slate-600 text-sm">
            ${state.patients.length ? 'لا يوجد مريض مطابق للبحث.' : 'لا توجد ملفات مرضى حتى الآن.'}
          </p>
        </div>`;
      return;
    }

    box.innerHTML = filtered.map((patient, index) => {
      const age = patient.age ? `<span class="patient-meta"><i class="fa-solid fa-cake-candles"></i> ${escapeHtml(patient.age)} سنة</span>` : '';
      const diagnosis = patient.diagnosis ? `<span class="patient-diagnosis">${escapeHtml(patient.diagnosis)}</span>` : '';
      return `
      <article class="patient-card" role="link" tabindex="0"
        data-action="open-patient" data-patient-id="${escapeHtml(patient.id)}"
        aria-label="فتح ملف المريض ${escapeHtml(patient.name || 'بدون اسم')}">
        <div class="patient-card-head">
          <div class="patient-identity">
            <span class="patient-avatar" aria-hidden="true"><i class="fa-solid fa-user"></i></span>
            <h3 class="patient-name">${escapeHtml(patient.name || 'بدون اسم')}</h3>
          </div>
          <div class="patient-card-tools">
            <span class="patient-number">ملف ${String(index + 1).padStart(2,'0')}</span>
            <button type="button" data-action="ask-delete" data-patient-id="${escapeHtml(patient.id)}"
              class="patient-delete" title="حذف المريض" aria-label="حذف المريض">
              <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
            </button>
          </div>
        </div>
        <div class="patient-details">${age}${diagnosis}</div>
        
      </article>`;
    }).join('');
  }

  function openPatient(id) {
    if (!id) return;
    window.location.href = `patient-profile.html?id=${encodeURIComponent(id)}`;
  }

  function openAddPatientModal() {
    if (!state.isAdmin && !state.canAddPatient) return;

    const modal = $('addPatientModal');
    if (!modal) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    setTimeout(() => $('newPatientName')?.focus(), 50);
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
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;

    if (action === 'open-add-patient') openAddPatientModal();
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

    // Start loading the patient directory immediately; access checks run independently.
    const patientsLoad = loadPatients();
    await refreshAccess();
    await patientsLoad;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
