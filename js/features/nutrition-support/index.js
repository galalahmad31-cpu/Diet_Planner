(function () {
  'use strict';

  let patients = [];
  let currentUser = null;
  let supabase = null;
  let hasActiveSubscription = false;
  let hasNutritionSupportFeature = false;
  let canAddPatientByQuota = false;

  async function refreshNutritionSupportAccess() {
    try {
      const accessApi = window.DietPlannerAccess;
      const userId = currentUser?.id;
      if (!userId) return;
      hasActiveSubscription = (await accessApi?.hasActiveSubscription?.(userId)) === true;
      hasNutritionSupportFeature = (await accessApi?.hasFeature?.(userId, 'nutrition_support')) === true;
      canAddPatientByQuota = (await accessApi?.canAddPatient?.(userId)) === true;
    } catch (error) {
      console.error('Nutrition support access check failed:', error);
      hasActiveSubscription = false;
      hasNutritionSupportFeature = false;
      canAddPatientByQuota = false;
    }
  }

  function canWriteNutritionSupport() {
    return hasActiveSubscription && hasNutritionSupportFeature;
  }

  // Adding a patient is controlled by the patient quota only.
  // The Nutrition Support page itself is already gated by the feature.
  function canAddNutritionSupportPatient() {
    return canAddPatientByQuota;
  }

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));

  function renderPatients() {
    const grid = $('patientGrid');
    const empty = $('patientEmpty');
    const search = $('patientSearch');
    if (!grid || !empty || !search) return;

    const query = search.value.trim().toLowerCase();
    const list = patients.filter((patient) => {
      const name = String(patient.name || '').toLowerCase();
      const diagnosis = String(patient.diagnosis || '').toLowerCase();
      return !query || name.includes(query) || diagnosis.includes(query);
    });

    grid.innerHTML = '';
    empty.textContent = query && !list.length
      ? 'لا توجد نتائج مطابقة.'
      : patients.length ? '' : 'لا يوجد مرضى حاليًا.';
    empty.style.display = list.length ? 'none' : 'block';

    list.forEach((patient) => {
      const card = document.createElement('div');
      card.className = 'patient-card';
      card.dataset.id = patient.id;
      card.innerHTML = `
        <button type="button" class="patient-card-main" data-open="${esc(patient.id)}">
          <div class="pc-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="3.5"></circle><path d="M5 20c.8-4 3.1-6 7-6s6.2 2 7 6"></path>
            </svg>
          </div>
          <div><strong>${esc(patient.name || 'بدون اسم')}</strong><span>${esc(patient.diagnosis || 'بدون تشخيص')}</span></div>
        </button>
        <div class="patient-card-actions">
          <button type="button" class="patient-action patient-edit${canWriteNutritionSupport() ? '' : ' opacity-50 cursor-not-allowed'}" data-edit="${esc(patient.id)}" title="${canWriteNutritionSupport() ? 'تعديل' : 'التعديل غير متاح حاليًا'}" aria-label="تعديل" ${canWriteNutritionSupport() ? '' : 'disabled'}><i class="fa-solid fa-pen"></i><span>تعديل</span></button>
          <button type="button" class="patient-action patient-delete" data-delete="${esc(patient.id)}" title="حذف" aria-label="حذف"><i class="fa-solid fa-trash"></i><span>حذف</span></button>
        </div>`;
      grid.appendChild(card);
    });
  }

  function openPatientModal(patient = null) {
    const form = $('patientForm');
    if (!form) return;
    form.reset();
    $('patientId').value = patient?.id || '';
    $('patientName').value = patient?.name || '';
    $('patientGender').value = patient?.gender || '';
    $('patientBirthDate').value = patient?.birth_date || '';
    $('patientAge').value = patient?.age ?? '';
    $('patientHeight').value = patient?.height ?? '';
    $('patientDiagnosis').value = patient?.diagnosis || '';
    $('patientComplaints').value = patient?.complaints || '';
    $('patientClinicalNotes').value = patient?.clinical_notes || '';
    $('patientModalTitle').textContent = patient ? 'تعديل بيانات المريض' : 'إضافة مريض';
    $('patientModalOverlay').classList.add('show');
    $('patientModalOverlay').setAttribute('aria-hidden', 'false');
    setTimeout(() => $('patientName')?.focus(), 30);
  }

  function closePatientModal() {
    $('patientModalOverlay')?.classList.remove('show');
    $('patientModalOverlay')?.setAttribute('aria-hidden', 'true');
  }

  async function savePatient(event) {
    event.preventDefault();
    const id = $('patientId').value.trim();

    if (id) {
      if (!canWriteNutritionSupport()) {
        alert('تعديل بيانات المريض في الدعم الغذائي يتطلب اشتراكًا مدفوعًا فعالًا وتوفر الخاصية في خطتك.');
        return;
      }
    } else if (!canAddNutritionSupportPatient()) {
      alert('إضافة مريض جديد غير متاحة حاليًا: تحقق من حصة المرضى.');
      return;
    }
    if (!currentUser || !supabase) { location.replace('index.html'); return; }

    const payload = {
      name: $('patientName').value.trim(),
      gender: $('patientGender').value || null,
      birth_date: $('patientBirthDate').value || null,
      age: $('patientAge').value === '' ? null : Number($('patientAge').value),
      height: $('patientHeight').value === '' ? null : Number($('patientHeight').value),
      diagnosis: $('patientDiagnosis').value.trim() || null,
      complaints: $('patientComplaints').value.trim() || null,
      clinical_notes: $('patientClinicalNotes').value.trim() || null,
      updated_at: new Date().toISOString()
    };

    if (!payload.name) { alert('من فضلك أدخل اسم المريض.'); return; }

    const button = $('patientSaveBtn');
    button.disabled = true;
    try {
      let data, error;
      if (id) {
        ({ data, error } = await supabase.from('patients')
          .update(payload).eq('id', id).eq('user_id', currentUser.id)
          .select('id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes').single());
      } else {
        ({ data, error } = await supabase.from('patients')
          .insert({ ...payload, user_id: currentUser.id })
          .select('id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes').single());
      }
      if (error) throw error;

      if (id) {
        const index = patients.findIndex((patient) => patient.id === id);
        if (index >= 0) patients[index] = data;
      } else {
        patients.push(data);
      }
      patients.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
      renderPatients();
      closePatientModal();
    } catch (error) {
      console.error(error);
      alert('تعذر حفظ بيانات المريض: ' + (error.message || 'تحقق من صلاحيات قاعدة البيانات.'));
    } finally {
      button.disabled = false;
    }
  }

  function confirmDeletePatient(name) {
    return new Promise((resolve) => {
      const overlay = $('patientDeleteConfirm');
      const text = $('patientDeleteText');
      const ok = $('patientDeleteConfirmBtn');
      const cancel = $('patientDeleteCancel');
      text.textContent = 'هل أنت متأكد من حذف المريض ' + name + '؟ سيتم حذف بيانات المريض وأيام الدعم الغذائي المرتبطة به نهائيًا.';
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
      const close = (result) => {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        overlay.removeEventListener('click', onOverlay);
        resolve(result);
      };
      const onOk = () => close(true);
      const onCancel = () => close(false);
      const onOverlay = (event) => { if (event.target === overlay) close(false); };
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      overlay.addEventListener('click', onOverlay);
    });
  }

  async function deletePatient(id) {
    const patient = patients.find((item) => item.id === id);
    if (!patient) return;
    if (!(await confirmDeletePatient(patient.name || 'بدون اسم'))) return;
    if (!currentUser || !supabase) { location.replace('index.html'); return; }

    try {
      const { error } = await supabase.from('patients').delete().eq('id', id).eq('user_id', currentUser.id);
      if (error) throw error;
      patients = patients.filter((item) => item.id !== id);
      renderPatients();
    } catch (error) {
      console.error(error);
      alert('تعذر حذف المريض: ' + (error.message || 'تحقق من صلاحيات قاعدة البيانات.'));
    }
  }

  function bindEvents() {
    const grid = $('patientGrid');
    const search = $('patientSearch');
    const addButton = $('addPatientBtn');
    if (addButton) {
      const canAdd = canAddNutritionSupportPatient();
      addButton.disabled = !canAdd;
      addButton.title = canAdd ? 'إضافة مريض' : 'إضافة مريض غير متاحة حاليًا';
      addButton.classList.toggle('opacity-50', !canAdd);
      addButton.classList.toggle('cursor-not-allowed', !canAdd);
    }
    const form = $('patientForm');
    const closeButton = $('patientModalClose');
    const cancelButton = $('patientCancelBtn');
    const modal = $('patientModalOverlay');

    if (grid && !grid.dataset.bound) {
      grid.dataset.bound = 'true';
      grid.addEventListener('click', (event) => {
        const open = event.target.closest('[data-open]');
        if (open) {
          location.href = 'nutritionsupport-patient.html?patient=' + encodeURIComponent(open.dataset.open);
          return;
        }

        const edit = event.target.closest('[data-edit]');
        if (edit) {
          event.stopPropagation();
          if (!canWriteNutritionSupport()) {
            alert('تعديل بيانات المريض في الدعم الغذائي يتطلب اشتراكًا فعالًا وتوفر خاصية الدعم الغذائي.');
            return;
          }
          const patient = patients.find((item) => item.id === edit.dataset.edit);
          if (patient) openPatientModal(patient);
          return;
        }

        const del = event.target.closest('[data-delete]');
        if (del) {
          event.stopPropagation();
          deletePatient(del.dataset.delete);
        }
      });
    }

    if (search && !search.dataset.bound) {
      search.dataset.bound = 'true';
      search.addEventListener('input', renderPatients);
    }

    if (addButton && !addButton.dataset.bound) {
      addButton.dataset.bound = 'true';
      addButton.addEventListener('click', () => {
        if (!canAddNutritionSupportPatient()) {
          alert('إضافة مريض جديد غير متاحة حاليًا: تحقق من الاشتراك والخاصية وحصة المرضى.');
          return;
        }
        openPatientModal();
      });
    }

    if (form && !form.dataset.bound) {
      form.dataset.bound = 'true';
      form.addEventListener('submit', savePatient);
    }

    if (closeButton && !closeButton.dataset.bound) {
      closeButton.dataset.bound = 'true';
      closeButton.addEventListener('click', closePatientModal);
    }

    if (cancelButton && !cancelButton.dataset.bound) {
      cancelButton.dataset.bound = 'true';
      cancelButton.addEventListener('click', closePatientModal);
    }

    if (modal && !modal.dataset.bound) {
      modal.dataset.bound = 'true';
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closePatientModal();
      });
    }
  }

  async function loadPatients() {
    if (!currentUser || !supabase) return;

    const { data, error } = await supabase
      .from('patients')
      .select('id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes')
      .eq('user_id', currentUser.id)
      .order('name');

    if (error) throw error;

    patients = data || [];
    renderPatients();
  }

  async function init() {
    const access = window.DietPlannerAccess;
    supabase = access?.supabaseClient || null;

    if (!access || !supabase) {
      console.error('DietPlannerAccess is not available.');
      const empty = $('patientEmpty');
      if (empty) {
        empty.textContent = 'تعذر تشغيل صفحة الدعم الغذائي. تأكد من تحميل auth-access.js.';
        empty.style.display = 'block';
      }
      return;
    }

    try {
      const accessStatus = await access.getAccessStatus();
      currentUser = accessStatus?.user || null;
      const isAdmin = accessStatus?.isAdmin === true;

      if (!currentUser) {
        location.replace('index.html');
        return;
      }

      await refreshNutritionSupportAccess();

      // Active subscription without the feature: the service itself is unavailable.
      // Expired doctors retain read/delete access to their own historical patients.
      if (!isAdmin && hasActiveSubscription && !hasNutritionSupportFeature) {
        const area = $('supportPatientArea');
        if (area) {
          area.innerHTML = '<div style="padding:28px;text-align:center;color:#475569">خاصية الدعم الغذائي غير متاحة في باقتك الحالية.</div>';
        }
        return;
      }

      // Bind all UI events only after the access snapshot is ready.
      bindEvents();
      renderPatients();
    } catch (error) {
      console.error('Nutrition Support initialization error:', error);
      const empty = $('patientEmpty');
      if (empty) {
        empty.textContent = 'تعذر تحميل قائمة المرضى';
        empty.style.display = 'block';
      }
      return;
    }

    await loadPatients();
  }


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
