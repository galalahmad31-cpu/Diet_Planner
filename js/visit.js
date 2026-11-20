/* =========================================================
 * VISIT PAGE — CORE
 * Patient context and nutrition-plan module navigation,
 * and page-level confirmation handling.
 *
 * Dependencies:
 *   1) Supabase CDN
 *   2) js/auth-access.js
 * ========================================================= */


const db = window.DietPlannerAccess?.supabaseClient;
  if (!db) console.error("Diet Planner access layer is unavailable.");

  let patientContext = null;

  function showError(message) {
    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('visitContent').classList.add('hidden');
    document.getElementById('errorState').classList.remove('hidden');
    document.getElementById('errorText').textContent = message;
  }

  async function loadVisit() {
    const patientId = new URLSearchParams(window.location.search).get('patient_id')
      || new URLSearchParams(window.location.search).get('id');
    if (!patientId || !db) {
      showError('لم يتم تحديد المريض.');
      return;
    }

    const { data, error } = await db
      .from('patients')
      .select('id,user_id,name,energy_equation,energy_gender,energy_age,energy_height_cm,energy_weight_kg,energy_activity_factor,energy_bmr,energy_tdee,energy_adjustment,energy_target_calories,energy_protein_percent,energy_carb_percent,energy_fat_percent,energy_target_protein,energy_target_carb,energy_target_fat,energy_approved_at')
      .eq('id', patientId)
      .maybeSingle();

    if (error || !data) {
      console.error('Load patient for nutrition plan failed:', error);
      showError('تعذر تحميل ملف المريض أو لا تملك صلاحية الوصول إليه.');
      return;
    }

    patientContext = { patient_id: data.id, patients: data };
    window.currentPatientId = data.id;
    window.currentPatientEnergy = data;

    const patientName = document.getElementById('patientName');
    if (patientName) patientName.textContent = data.name || 'بدون اسم';
    const visitNumber = document.getElementById('visitNumber');
    if (visitNumber) visitNumber.textContent = '—';
    const visitDate = document.getElementById('visitDate');
    if (visitDate) visitDate.textContent = 'ملف المريض';

    document.getElementById('loadingState')?.classList.add('hidden');
    document.getElementById('visitContent')?.classList.remove('hidden');
    const params = new URLSearchParams(window.location.search);
    const planType = params.get('plan_type') || '';
    const autoOpenGrams = params.get('auto_open_grams') === '1';
    if (planType.includes('الجرامات') || autoOpenGrams) {
      void toggleModule('dietPlan');
    } else if (planType.includes('البدائل')) {
      void toggleModule('exchangePlan');
    }
    // Without an explicit plan type, both module choices remain available.
  }

  const moduleLoaders = {
    dietPlan: {
      preloaded: true,
      ready: () => !!window.dietPlan?.init
    },
    exchangePlan: {
      src: 'js/visit-exchange-plan.js?v=20261120-exchange-rings-v3',
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

    if (config.preloaded) {
      const reason = window.__dpDietPlanLoadError || 'ملف الوحدة لم ينشئ window.dietPlan.init';
      const error = new Error('Gram diet module unavailable: ' + reason);
      console.error(error);
      showError('تعذر تهيئة وحدة خطة الجرامات. ' + reason);
      return Promise.resolve(false);
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
      dietPlan: document.getElementById('dietPlanContent'),
      exchangePlan: document.getElementById('exchangePlanContent')
    };

    const content = contents[module];
    if (!content) return;

    const isOpen = !content.classList.contains('hidden');
    Object.values(contents).forEach(el => el?.classList.add('hidden'));
    const moduleCardIds = {dietPlan:'dietPlanCard',exchangePlan:'exchangePlanCard'};
    Object.entries(moduleCardIds).forEach(([key, cardId]) => {
      const card = document.getElementById(cardId);
      if (card) card.classList.toggle('module-active', key === module && !isOpen);
    });

    if (isOpen) return;

    content.classList.remove('hidden');

    try {
      const loaded = await loadModule(module);
      if (!loaded) {
        content.classList.add('hidden');
        return;
      }

      if (module === 'dietPlan') {
        await window.dietPlan.init();
      }

      if (module === 'exchangePlan') {
        await window.exchangePlan.init();
      }
    } catch (error) {
      console.error('Nutrition plan module initialization failed:', error);
      content.classList.remove('hidden');
      const status = content.querySelector('#exchangePlanStatus');
      if (status && module === 'exchangePlan') status.textContent = error?.message || 'تعذر تحميل خطة البدائل.';
      return;
    }

    content.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToPatient() {
    if (new URLSearchParams(window.location.search).get('embed') === '1' && window.parent !== window) {
      window.parent.postMessage({ type: 'dp-plan-close' }, window.location.origin);
      return;
    }

    if (patientContext?.patient_id) {
      window.location.href =
        'patient-profile.html?id=' + encodeURIComponent(patientContext.patient_id);
      return;
    }

    window.history.back();
  }


  
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

/* Embedded visit view: report the rendered document height to the patient-profile host. */
(function bindVisitEmbedSizing() {
  if (new URLSearchParams(window.location.search).get('embed') !== '1' || window.parent === window) return;

  const getContentHeight = () => {
    const main = document.querySelector('body > main');
    if (!main) return 0;

    // Measure the real content wrapper, not the iframe viewport or document canvas.
    // Fixed-position dialogs and unused viewport space must not enlarge the embed.
    const height = Math.ceil(main.getBoundingClientRect().height);
    return Number.isFinite(height) && height > 0 ? height : 0;
  };

  const notifyHeight = () => {
    const height = getContentHeight();
    if (height > 0) {
      window.parent.postMessage({ type: 'dp-plan-embed-height', height }, window.location.origin);
    }
  };

  if ('ResizeObserver' in window) {
    window.__dpVisitEmbedResizeObserver = new ResizeObserver(notifyHeight);
    const main = document.querySelector('body > main');
    if (main) window.__dpVisitEmbedResizeObserver.observe(main);
  }
  window.addEventListener('load', notifyHeight);
  window.addEventListener('resize', notifyHeight);
  if (document.fonts?.ready) document.fonts.ready.then(notifyHeight).catch(() => {});
  notifyHeight();
})();

document.addEventListener('DOMContentLoaded', () => {
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

