(() => {
  'use strict';

  const access = window.DietPlannerAccess;
  const auth = window.DietPlannerAuth;
  const supabase = window.DietPlannerSupabase?.client;

  if (!access || !auth?.getCurrentUser || !supabase) {
    console.error('supabase.js, auth.js, and access.js must load before patient.js.');
    return;
  }

  const state = {
    patients: [],
    pendingDeleteId: null,
    statusTimer: null
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
      box.innerHTML = '';
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

  async function canPatient(action) {
    return access.can('patient', action);
  }

  async function updateWriteControls() {
    const addButton = $('addPatientBtn');
    const accessBox = $('accessStatus');
    const allowed = await canPatient('add');

    if (addButton) {
      addButton.disabled = !allowed;
      addButton.classList.toggle('opacity-50', !allowed);
      addButton.classList.toggle('cursor-not-allowed', !allowed);
      addButton.title = allowed
        ? 'إضافة مريض جديد'
        : 'إضافة المرضى تتطلب اشتراكًا فعالًا وساريًا ووجود مساحة ضمن الكوتة';
    }

    if (accessBox) {
      accessBox.textContent = allowed
        ? 'يمكنك إضافة مرضى جدد وفق الكوتة المتاحة.'
        : 'إضافة المرضى تتطلب اشتراكًا فعالًا وساريًا ووجود مساحة ضمن الكوتة.';
      accessBox.className = allowed
        ? 'mt-3 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2'
        : 'mt-3 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2';
    }
  }

  async function loadPatients() {
    const box = $('patientsList');
    if (!box) return;

    try {
      const allowed = await canPatient('read');
      if (!allowed) {
        showLoadError();
        return;
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

    box.innerHTML = filtered.map((patient) => `
      <div class="patient-row flex items-center gap-3 bg-slate-50 hover:bg-emerald-50 border border-slate-200 rounded-xl p-3">
        <button
          type="button"
          data-action="open-patient"
          data-patient-id="${escapeHtml(patient.id)}"
          class="flex-1 min-w-0 text-right flex items-center gap-3"
        >
          <span class="w-10 h-10 shrink-0 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg">👤</span>
          <span class="min-w-0">
            <span class="block font-extrabold text-slate-800 text-sm truncate">
              ${escapeHtml(patient.name || 'بدون اسم')}
            </span>
            <span class="block text-[10px] text-slate-400 mt-0.5">
              اضغط لفتح ملف المريض
            </span>
          </span>
        </button>

        <button
          type="button"
          data-action="ask-delete"
          data-patient-id="${escapeHtml(patient.id)}"
          class="w-9 h-9 shrink-0 rounded-lg bg-red-50 hover:bg-red-100 border border-red-100 text-red-600 flex items-center justify-center text-sm"
          title="حذف المريض"
          aria-label="حذف المريض"
        >🗑️</button>
      </div>
    `).join('');
  }

  function openPatient(id) {
    if (!id) return;
    window.location.href = `patient-profile.html?id=${encodeURIComponent(id)}`;
  }

  async function openAddPatientModal() {
    if (!(await canPatient('add'))) {
      showStatus('إضافة المرضى تتطلب اشتراكًا فعالًا وساريًا ووجود مساحة ضمن الكوتة.');
      await updateWriteControls();
      return;
    }

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
    if (!(await canPatient('add'))) {
      showStatus('إضافة المرضى تتطلب اشتراكًا فعالًا وساريًا ووجود مساحة ضمن الكوتة.');
      await updateWriteControls();
      return;
    }

    const input = $('newPatientName');
    const name = input?.value.trim();

    if (!name) {
      showStatus('أدخل اسم المريض أولاً.');
      input?.focus();
      return;
    }

    try {
      const user = await auth.getCurrentUser();
      if (!user) {
        showStatus('يجب تسجيل الدخول أولاً.');
        return;
      }

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
          clinical_notes: null
        })
        .select('id')
        .single();

      if (error) throw error;

      closeAddPatientModal();
      showStatus('تم حفظ المريض.', 'success');

      if (data?.id) {
        window.location.href = `patient-profile.html?id=${encodeURIComponent(data.id)}`;
      }
    } catch (error) {
      console.error('Create patient failed:', error);
      showStatus('تعذر حفظ المريض في قاعدة البيانات.');
    }
  }

  async function askDelete(id) {
    if (!(await canPatient('delete'))) {
      showStatus('لا تملك صلاحية حذف المرضى.');
      return;
    }

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
    if (!(await canPatient('delete'))) {
      showStatus('لا تملك صلاحية حذف المرضى.');
      closeDeleteModal();
      return;
    }

    const id = state.pendingDeleteId;
    if (!id) return;

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
    if (action === 'ask-delete') askDelete(target.dataset.patientId);
  }

  function bindEvents() {
    document.addEventListener('click', handleClick);
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
    await access.requireAuthentication();
    await updateWriteControls();
    await loadPatients();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
