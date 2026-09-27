/* =========================================================
 * VISIT PAGE — CORE
 * Patient/visit context, assessment, module navigation,
 * and page-level confirmation handling.
 *
 * Dependencies:
 *   1) Supabase CDN
 *   2) js/auth-access.js
 * ========================================================= */


const db = window.DietPlannerAccess?.supabaseClient;
  if (!db) console.error("Diet Planner access layer is unavailable.");

  const visitId = new URLSearchParams(window.location.search).get('id');

  let visit = null;

  function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('visitContent').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorText').textContent = message;
  }

  async function refreshVisitWriteAccess() {
    const accessStatus = await window.DietPlannerAccess?.getAccessStatus?.();
    if (!accessStatus?.authenticated) return false;
    if (accessStatus.isAdmin === true) return true;
    return (await window.DietPlannerAccess?.hasActiveSubscription?.(
      accessStatus.user.id
    )) === true;
  }

  function formatVisitDate(date) {
    if (!date) return 'بدون تاريخ';
    const d = new Date(date + 'T00:00:00');
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(d);
  }

  async function loadVisit() {
    if (!visitId) {
      showError('لم يتم تحديد الزيارة.');
      return;
    }

    const { data, error } = await db
      .from('patient_visits')
      .select(`
        id,
        patient_id,
        user_id,
        visit_number,
        visit_date,
        patients (
          id,
          name
        )
      `)
      .eq('id', visitId)
      .maybeSingle();

    if (error) {
      console.error(error);
      showError('تعذر تحميل بيانات الزيارة.');
      return;
    }

    if (!data) {
      showError('الزيارة غير موجودة أو لا تملك صلاحية الوصول إليها.');
      return;
    }

    visit = data;

    document.getElementById('patientName').textContent =
      data.patients?.name || 'بدون اسم';

    document.getElementById('visitNumber').textContent =
      data.visit_number ?? '—';

    document.getElementById('visitDate').textContent =
      formatVisitDate(data.visit_date);

    window.visitContext = { id: data.id, patient_id: data.patient_id };

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('visitContent').classList.remove('hidden');
  }

  const moduleLoaders = {
    calculator: {
      src: 'js/visit-calculator.js',
      ready: () => typeof initCalculator === 'function'
    },
    dietPlan: {
      src: 'js/visit-diet-plan.js?v=20260922-2',
      ready: () => !!window.dietPlan?.init
    },
    exchangePlan: {
      src: 'js/visit-exchange-plan.js?v=20260923-1',
      ready: () => !!window.exchangePlan?.init
    }
  };

  const modulePromises = {};

  function loadModule(module) {
    const config = moduleLoaders[module];

    if (!config) {
      return Promise.resolve(true);
    }

    if (config.ready()) {
      return Promise.resolve(true);
    }

    if (modulePromises[module]) {
      return modulePromises[module];
    }

    modulePromises[module] = new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = config.src;
      script.defer = true;

      script.onload = () => {
        if (!config.ready()) {
          reject(new Error(`Module loaded but did not initialize: ${module}`));
          return;
        }

        resolve(true);
      };

      script.onerror = () => {
        reject(new Error(`Failed to load visit module: ${module}`));
      };

      document.head.appendChild(script);
    }).catch(error => {
      delete modulePromises[module];
      console.error(error);
      showError('تعذر تحميل هذه الوحدة. يرجى إعادة المحاولة.');
      return false;
    });

    return modulePromises[module];
  }

  async function toggleModule(module) {
    const contents = {
      assessment: document.getElementById('assessmentContent'),
      calculator: document.getElementById('calculatorContent'),
      dietPlan: document.getElementById('dietPlanContent'),
      exchangePlan: document.getElementById('exchangePlanContent')
    };

    const content = contents[module];
    if (!content) return;

    const isOpen = !content.classList.contains('hidden');
    Object.values(contents).forEach(el => el.classList.add('hidden'));
    const moduleCardIds = {assessment:'assessmentCard',calculator:'calculatorCard',dietPlan:'dietPlanCard',exchangePlan:'exchangePlanCard'};
    Object.entries(moduleCardIds).forEach(([key, cardId]) => {
      const card = document.getElementById(cardId);
      if (card) card.classList.toggle('module-active', key === module && !isOpen);
    });

    if (isOpen) return;

    content.classList.remove('hidden');

    if (module === 'assessment') {
      loadAssessment();
    } else {
      const loaded = await loadModule(module);

      if (!loaded) {
        content.classList.add('hidden');
        return;
      }

      if (module === 'calculator') {
        initCalculator();
      }

      if (module === 'dietPlan') {
        window.dietPlan.init();
      }

      if (module === 'exchangePlan') {
        window.exchangePlan.init();
      }
    }

    content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let assessmentId = null;
  let labs = [];

  let assessmentEditing = false;

  function setAssessmentSaveLabel(label){
    const button = document.getElementById('saveAssessmentBtn');
    if (!button) return;
    const labelEl = button.querySelector('span');
    if (labelEl) {
      labelEl.textContent = label;
    } else {
      button.textContent = label;
    }
}

function setAssessmentEditMode(editing){
    assessmentEditing=!!editing;
    setAssessmentSaveLabel(assessmentEditing ? 'حفظ التقييم' : (assessmentId ? 'تم الحفظ' : 'حفظ التقييم'));
    const box=document.getElementById('assessmentContent');
    if(!box)return;
    box.classList.toggle('assessment-locked',!assessmentEditing);
    box.querySelectorAll('#heightCm,#weightKg,#medicalHistory,#currentDiagnosis,#currentMedications,#nfpeGeneral,#nfpeFat,#nfpeMuscle,#nfpeFluid,#nfpeMicronutrients,#dietaryHistory').forEach(el=>el.disabled=!assessmentEditing);
    const addLabBtn=box.querySelector('[onclick="addLab()"]'); if(addLabBtn)addLabBtn.disabled=!assessmentEditing;
    box.querySelectorAll('#labsList button').forEach(btn=>btn.disabled=!assessmentEditing);
    const save=document.getElementById('saveAssessmentBtn'),edit=document.getElementById('editAssessmentBtn'),del=document.getElementById('deleteAssessmentBtn');
    if(save)save.disabled=!assessmentEditing;
    if(edit)edit.disabled=assessmentEditing||!assessmentId;
    if(del)del.disabled=assessmentEditing||!assessmentId;
  }

  function editAssessment(){if(!assessmentId)return;setAssessmentEditMode(true);document.getElementById('assessmentStatus').textContent='وضع التعديل';}
  function deleteAssessment(){if(!assessmentId)return;const m=document.getElementById('deleteAssessmentModal');if(m){m.classList.remove('hidden');m.classList.add('flex');document.body.classList.add('overflow-hidden');}}
  function closeDeleteAssessmentModal(){const m=document.getElementById('deleteAssessmentModal');if(m){m.classList.add('hidden');m.classList.remove('flex');document.body.classList.remove('overflow-hidden');}}
  async function confirmDeleteAssessment(){
    if (!(await refreshVisitWriteAccess())) { alert('حذف التقييم متاح أثناء الاشتراك المدفوع فقط.'); return; }
    if(!assessmentId)return;
    const btn=document.getElementById('confirmDeleteAssessmentBtn');if(btn){btn.disabled=true;btn.textContent='جاري الحذف...';}
    const {error}=await db.from('assessment').delete().eq('id',assessmentId);
    if(btn){btn.disabled=false;btn.textContent='نعم، حذف التقييم';}
    if(error){console.error(error);document.getElementById('assessmentStatus').textContent='تعذر حذف التقييم';return;}
    assessmentId=null;labs=[];
    ['heightCm','weightKg','medicalHistory','currentDiagnosis','currentMedications','nfpeFat','nfpeMuscle','nfpeFluid','nfpeMicronutrients','dietaryHistory'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('nfpeGeneral').value='';document.getElementById('bmi').value='';document.getElementById('bmiCategory').value='';
    renderLabs();setAssessmentEditMode(true);document.getElementById('assessmentStatus').textContent='تقييم جديد';closeDeleteAssessmentModal();
  }

  function calculateBMI() {
    const h = parseFloat(document.getElementById('heightCm').value);
    const w = parseFloat(document.getElementById('weightKg').value);
    const bmiEl = document.getElementById('bmi');
    const catEl = document.getElementById('bmiCategory');
    if (!h || !w || h <= 0 || w <= 0) { bmiEl.value = ''; catEl.value = ''; return; }
    const value = w / Math.pow(h / 100, 2);
    bmiEl.value = value.toFixed(2);
    catEl.value = value < 18.5 ? 'نقص الوزن' : value < 25 ? 'وزن طبيعي' : value < 30 ? 'زيادة الوزن' : value < 35 ? 'سمنة درجة أولى' : value < 40 ? 'سمنة درجة ثانية' : 'سمنة درجة ثالثة';
  }

  let deletingLabIndex = -1;

  function renderLabs() {
    const list = document.getElementById('labsList');
    const empty = document.getElementById('noLabs');

    list.innerHTML = '';
    empty.classList.toggle('hidden', labs.length > 0);

    labs.forEach((lab, index) => {
      const row = document.createElement('div');
      row.className =
        'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border border-slate-100 bg-slate-50 rounded-xl p-2';

      if (lab._draft) {
        row.innerHTML = `
          <input data-lab-field="name" data-index="${index}"
            value="${escapeHtml(lab.name || '')}"
            class="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold outline-none focus:border-sky-400"
            placeholder="اسم التحليل">
          <input data-lab-field="value" data-index="${index}"
            value="${escapeHtml(lab.value || '')}"
            class="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-bold outline-none focus:border-sky-400"
            placeholder="القيمة + الوحدة">
          <div class="flex items-center gap-1">
            <button type="button" onclick="deleteLab(${index})"
              class="w-8 h-8 rounded-lg bg-white text-red-600 border border-slate-200 text-xs" title="حذف">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>`;
      } else {
        row.innerHTML = `
          <div class="min-w-0 text-xs font-extrabold text-slate-700 truncate">
            ${escapeHtml(lab.name || 'تحليل بدون اسم')}
          </div>
          <div class="min-w-0 text-xs text-slate-500 truncate">
            ${escapeHtml(lab.value || '—')}
          </div>
          <div class="flex items-center gap-1">
            <button type="button" onclick="deleteLab(${index})"
              ${assessmentEditing ? '' : 'disabled'}
              class="w-8 h-8 rounded-lg bg-white text-red-600 border border-slate-200 text-xs disabled:opacity-40"
              title="حذف">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>`;
      }

      list.appendChild(row);
    });

    list.querySelectorAll('[data-lab-field]').forEach(input => {
      input.addEventListener('input', event => {
        const index = Number(event.currentTarget.dataset.index);
        const field = event.currentTarget.dataset.labField;
        if (labs[index]) labs[index][field] = event.currentTarget.value;
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function addLab() {
    if (!assessmentEditing) return;
    labs.push({ id: crypto.randomUUID(), name: '', value: '', _draft: true });
    renderLabs();
    requestAnimationFrame(() => {
      const index = labs.length - 1;
      document.querySelector(`#labsList [data-lab-field="name"][data-index="${index}"]`)?.focus();
    });
  }


  function deleteLab(index) {
    const lab = labs[index];
    if (!lab || !assessmentEditing) return;

    deletingLabIndex = index;
    document.getElementById('deleteLabText').innerHTML =
      `سيتم حذف <span class="font-extrabold text-slate-700">${escapeHtml(lab.name || 'هذا التحليل')}</span> من تقييم هذه الزيارة.`;

    const modal = document.getElementById('deleteLabModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
  }

  function closeDeleteLabModal() {
    const modal = document.getElementById('deleteLabModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
    deletingLabIndex = -1;
  }

  function handleDeleteModalBackdrop(event) {
    if (event.target.id === 'deleteLabModal') closeDeleteLabModal();
  }

  function confirmDeleteLab() {
    if (deletingLabIndex < 0 || !labs[deletingLabIndex]) {
      closeDeleteLabModal();
      return;
    }

    labs.splice(deletingLabIndex, 1);
    renderLabs();
    closeDeleteLabModal();
  }

  function handleLabModalKeydown(event) {
    if (event.key !== 'Escape') return;

    const deleteModal = document.getElementById('deleteLabModal');
    const assessmentDeleteModal = document.getElementById('deleteAssessmentModal');

    if (deleteModal && !deleteModal.classList.contains('hidden')) closeDeleteLabModal();
    if (assessmentDeleteModal && !assessmentDeleteModal.classList.contains('hidden')) closeDeleteAssessmentModal();
  }

  function setAssessmentForm(data) {
    assessmentId = data?.id || null;
    document.getElementById('heightCm').value = data?.height_cm ?? '';
    document.getElementById('weightKg').value = data?.weight_kg ?? '';
    document.getElementById('medicalHistory').value = data?.medical_history ?? '';
    document.getElementById('currentDiagnosis').value = data?.current_diagnosis ?? '';
    document.getElementById('currentMedications').value = data?.current_medications ?? '';
    document.getElementById('nfpeGeneral').value = data?.nfpe_general ?? '';
    document.getElementById('nfpeFat').value = data?.nfpe_fat ?? '';
    document.getElementById('nfpeMuscle').value = data?.nfpe_muscle ?? '';
    document.getElementById('nfpeFluid').value = data?.nfpe_fluid ?? '';
    document.getElementById('nfpeMicronutrients').value = data?.nfpe_micronutrients ?? '';
    document.getElementById('dietaryHistory').value = data?.dietary_history ?? '';
    labs = Array.isArray(data?.labs) ? data.labs : [];
    renderLabs();
    calculateBMI();
    setAssessmentEditMode(!data);
  }

  async function loadAssessment() {
    if (!visitId) return;
    document.getElementById('assessmentStatus').textContent = 'جاري التحميل...';
    const { data, error } = await db.from('assessment').select('*').eq('visit_id', visitId).maybeSingle();
    if (error) {
      console.error(error);
      document.getElementById('assessmentStatus').textContent = 'تعذر تحميل التقييم';
      return;
    }
    setAssessmentForm(data);
    document.getElementById('assessmentStatus').textContent = data ? 'تم تحميل التقييم' : 'تقييم جديد';
  }

  async function saveAssessment() {
    if (!(await refreshVisitWriteAccess())) {
      alert('تعديل التقييم متاح أثناء الاشتراك المدفوع فقط.');
      return;
    }
    const accessStatus = await window.DietPlannerAccess?.getAccessStatus?.();
    const user = accessStatus?.user || null;
    if (!user || !visit) return;
    calculateBMI();
    const payload = {
      user_id: user.id, visit_id: visit.id,
      height_cm: parseFloat(document.getElementById('heightCm').value) || null,
      weight_kg: parseFloat(document.getElementById('weightKg').value) || null,
      bmi: parseFloat(document.getElementById('bmi').value) || null,
      bmi_category: document.getElementById('bmiCategory').value || null,
      labs, medical_history: document.getElementById('medicalHistory').value.trim() || null,
      current_diagnosis: document.getElementById('currentDiagnosis').value.trim() || null,
      current_medications: document.getElementById('currentMedications').value.trim() || null,
      nfpe_general: document.getElementById('nfpeGeneral').value || null,
      nfpe_fat: document.getElementById('nfpeFat').value.trim() || null,
      nfpe_muscle: document.getElementById('nfpeMuscle').value.trim() || null,
      nfpe_fluid: document.getElementById('nfpeFluid').value.trim() || null,
      nfpe_micronutrients: document.getElementById('nfpeMicronutrients').value.trim() || null,
      dietary_history: document.getElementById('dietaryHistory').value.trim() || null
    };
    const btn = document.getElementById('saveAssessmentBtn');
    btn.disabled = true; setAssessmentSaveLabel('جاري الحفظ...');
    let result;
    if (assessmentId) {
      result = await db.from('assessment').update(payload).eq('id', assessmentId).select().single();
    } else {
      result = await db.from('assessment').insert(payload).select().single();
    }
    btn.disabled = false;
    if (result.error) {
      console.error(result.error);
      alert('تعذر حفظ التقييم الغذائي.');
      return;
    }
    assessmentId = result.data.id;
    setAssessmentEditMode(false);
    document.getElementById('assessmentStatus').textContent = 'تم الحفظ بنجاح';
  }

  function backToPatient() {
    if (visit?.patient_id) {
      window.location.href =
        'patient-profile.html?id=' + encodeURIComponent(visit.patient_id);
      return;
    }

    window.history.back();
  }

  document.addEventListener('keydown', handleLabModalKeydown);

  
/* =========================================================
 * STATIC UI ACTIONS
 * HTML uses data-action instead of inline JavaScript.
 * Dynamic diet/exchange rows keep their module APIs.
 * ========================================================= */
function resolveAction(path) {
  return String(path || '').split('.').reduce((obj, key) => obj?.[key], window);
}

function executeActivePrint() {
  const button = document.getElementById('executePrintBtn');
  const mode = button?.dataset.printMode;

  if (mode === 'diet') {
    window.dietPlan?.executePrint?.();
    return;
  }

  if (mode === 'exchange') {
    window.exchangePlan?.saveAndPrintFromSettings?.();
    return;
  }

  console.warn('No active print mode was selected.');
}

function bindPrintLifecycle() {
  window.addEventListener('afterprint', () => {
    const modal = document.getElementById('printSettingsModal');
    if (modal) modal.classList.add('hidden');

    const button = document.getElementById('executePrintBtn');
    if (button) delete button.dataset.printMode;

    const printDocument = document.getElementById('printDocument');
    if (printDocument) printDocument.setAttribute('aria-hidden', 'true');
  });
}

function bindStaticActions() {
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    if (action === 'toggleModule') {
      toggleModule(target.dataset.module);
      return;
    }

    if (action === 'selectEnergyEquation') {
      selectEnergyEquation(target.dataset.equation);
      return;
    }

    const fn = resolveAction(action);
    if (typeof fn === 'function') fn(event);
  });

  document.addEventListener('input', event => {
    const target = event.target.closest('[data-action-input]');
    if (!target) return;
    const fn = resolveAction(target.dataset.actionInput);
    if (typeof fn === 'function') fn(event);
  });

  document.addEventListener('keyup', event => {
    const target = event.target.closest('[data-action-input]');
    if (!target) return;
    const fn = resolveAction(target.dataset.actionInput);
    if (typeof fn === 'function') fn(event);
  });
}

bindStaticActions();
bindPrintLifecycle();

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('heightCm').addEventListener('input', calculateBMI);
    document.getElementById('weightKg').addEventListener('input', calculateBMI);
    loadVisit();
  });/* =========================================================
 * SHARED CONFIRMATION
 * One owner for the page-level confirmation button.
 * Diet modules expose confirmAction() through their public API.
 * ========================================================= */
document.getElementById('confirmOkBtn')?.addEventListener('click', async () => {
  if (window.dietPlan?.confirmAction) {
    const handled = await window.dietPlan.confirmAction();
    if (handled) return;
  }
  await window.exchangePlan?.confirmAction?.();
});

