/* =========================================================
   Diet Planner — Diet Library
   Clean feature module.
   Authentication/client are centralized.
   Permission decisions come from the backend through
   DietPlannerAccess.getPageAccess("diet").
   ========================================================= */
(function () {
  'use strict';

  const db = window.DietPlannerSupabase?.client;
  const access = window.DietPlannerAccess;

  if (!db || !access) {
    console.error('Diet Library: core services are unavailable.');
    return;
  }

  const state = {
    user: null,
    foods: [],
    diets: [],
    authors: {},
    editingId: null,
    activeMealIndex: null,
    selectedFood: null,
    day: { day_number: 1, day_name: 'اليوم', meals: [] },
    renderLimit: 40
  };

  const CACHE_TTL = 5 * 60 * 1000;
  const $ = (id) => document.getElementById(id);
  const num = (value) => Number(value || 0);
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));

  function toast(message, ok = true) {
    const element = $('toast');
    if (!element) return;

    element.textContent = message;
    element.className =
      `fixed bottom-5 left-5 z-[150] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${
        ok ? 'bg-brand-600' : 'bg-red-600'
      }`;

    element.classList.remove('hidden');
    clearTimeout(window.__dietPlannerToast);
    window.__dietPlannerToast = setTimeout(
      () => element.classList.add('hidden'),
      3200
    );
  }

  async function getAccess(action) {
    try {
      const permissions = await access.getPageAccess('diet');
      return permissions?.[action] === true;
    } catch (error) {
      console.error(`Diet access check failed for "${action}".`, error);
      return false;
    }
  }

  async function requireAccess(action, message = 'ليس لديك صلاحية تنفيذ هذه العملية.') {
    const allowed = await getAccess(action);

    if (!allowed) {
      toast(message, false);
      return false;
    }

    return true;
  }

  async function getCurrentUser() {
    const { data, error } = await db.auth.getUser();

    if (error || !data?.user) {
      location.replace('index.html');
      return false;
    }

    state.user = data.user;
    return true;
  }

  function cacheKey(type) {
    return `diet-library:${type}:${state.user?.id || 'guest'}`;
  }

  function readCache(type) {
    try {
      const raw = localStorage.getItem(cacheKey(type));
      if (!raw) return null;

      const cached = JSON.parse(raw);

      if (
        !cached?.timestamp ||
        Date.now() - cached.timestamp > CACHE_TTL
      ) {
        return null;
      }

      return cached.data;
    } catch {
      return null;
    }
  }

  function writeCache(type, data) {
    try {
      localStorage.setItem(
        cacheKey(type),
        JSON.stringify({
          timestamp: Date.now(),
          data
        })
      );
    } catch {
      // Cache is optional; application logic must continue without it.
    }
  }

  function clearCache(type) {
    try {
      localStorage.removeItem(cacheKey(type));
    } catch {
      // Cache is optional.
    }
  }

  async function loadFoods(force = false) {
    if (!force && state.foods.length) return true;

    if (!force) {
      const cached = readCache('foods');

      if (cached) {
        state.foods = cached;
        return true;
      }
    }

    const { data, error } = await db
      .from('foods')
      .select(
        'id,name_ar,name_en,is_custom,household,kcal,protein,carb,fat,sodium,potassium,phosphorus'
      )
      .order('name_ar', { ascending: true });

    if (error) {
      toast(`تعذر تحميل مكتبة الأغذية: ${error.message}`, false);
      return false;
    }

    state.foods = (data || []).map((food) => ({
      ...food,
      id: String(food.id),
      is_custom: Boolean(food.is_custom),
      kcal: num(food.kcal),
      protein: num(food.protein),
      carb: num(food.carb),
      fat: num(food.fat),
      sodium: num(food.sodium),
      potassium: num(food.potassium),
      phosphorus: num(food.phosphorus)
    }));

    writeCache('foods', state.foods);
    return true;
  }

  async function loadDiets(force = false) {
    const status = $('statusStat');
    if (status) status.textContent = 'جاري التحميل...';

    if (!force) {
      const cached = readCache('diets');

      if (cached?.diets) {
        state.diets = cached.diets;
        state.authors = cached.authors || {};

        if (status) {
          status.textContent = 'متصل';
          status.className =
            'mt-1 text-sm font-extrabold text-brand-600';
        }

        renderDiets();
      }
    }

    const { data, error } = await db
      .from('diet_templates')
      .select(
        'id,name,description,notes,target_calories,target_protein,target_carb,target_fat,target_fluid,goal,visibility,required_feature,created_by,publisher_name,created_at,updated_at'
      )
      .order('updated_at', { ascending: false });

    if (error) {
      if (!state.diets.length) {
        if (status) {
          status.textContent = 'خطأ';
          status.className =
            'mt-1 text-sm font-extrabold text-red-600';
        }

        toast(`تعذر تحميل مكتبة الدايت: ${error.message}`, false);
      }

      return false;
    }

    state.diets = data || [];
    state.authors = {};

    const ids = [
      ...new Set(
        [
          ...state.diets
            .filter((diet) => diet.visibility === 'public')
            .map((diet) => diet.created_by)
            .filter(Boolean),
          state.user.id
        ].filter(Boolean)
      )
    ];

    if (ids.length) {
      const profiles = await db
        .from('profiles')
        .select('id,full_name')
        .in('id', ids);

      if (!profiles.error) {
        (profiles.data || []).forEach((profile) => {
          state.authors[profile.id] = profile.full_name || '';
        });
      }
    }

    if (!state.authors[state.user.id]) {
      state.authors[state.user.id] =
        state.user.user_metadata?.full_name ||
        state.user.user_metadata?.name ||
        '';
    }

    state.diets.forEach((diet) => {
      if (diet.publisher_name) {
        state.authors[diet.created_by] = diet.publisher_name;
      }
    });

    writeCache('diets', {
      diets: state.diets,
      authors: state.authors
    });

    if (status) {
      status.textContent = 'متصل';
      status.className =
        'mt-1 text-sm font-extrabold text-brand-600';
    }

    renderDiets();
    return true;
  }

  function renderDiets() {
    const query = $('search')?.value.trim().toLowerCase() || '';
    const visibility = $('visibilityFilter')?.value || 'all';

    const filtered = state.diets.filter((diet) => {
      const matchesSearch =
        !query ||
        `${diet.name} ${diet.description || ''} ${diet.notes || ''}`
          .toLowerCase()
          .includes(query);

      const matchesVisibility =
        visibility === 'all' ||
        (visibility === 'mine' &&
          diet.created_by === state.user.id) ||
        (visibility === 'public' && diet.visibility === 'public');

      return matchesSearch && matchesVisibility;
    });

    const visible = filtered.slice(0, state.renderLimit);
    const grid = $('dietGrid');

    if (!grid) return;

    grid.innerHTML = visible
      .map((diet) => dietCard(diet))
      .join('');

    $('empty')?.classList.toggle('hidden', visible.length > 0);

    if ($('countBadge')) {
      $('countBadge').textContent = `${state.diets.length} دايت`;
    }

    if ($('totalStat')) $('totalStat').textContent = state.diets.length;

    if ($('mineStat')) {
      $('mineStat').textContent = state.diets.filter(
        (diet) => diet.created_by === state.user.id
      ).length;
    }

    if ($('publicStat')) {
      $('publicStat').textContent = state.diets.filter(
        (diet) => diet.visibility === 'public'
      ).length;
    }

    $('loadMoreDiets')?.remove();

    if (visible.length < filtered.length) {
      const button = document.createElement('button');

      button.id = 'loadMoreDiets';
      button.type = 'button';
      button.className =
        'mx-auto mt-5 block rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50';
      button.innerHTML =
        '<i class="fa-solid fa-chevron-down ml-1"></i> عرض المزيد';

      button.onclick = () => {
        state.renderLimit += 40;
        renderDiets();
      };

      grid.insertAdjacentElement('afterend', button);
    }
  }

  function dietCard(diet) {
    const mine = diet.created_by === state.user.id;
    const published = diet.visibility === 'public';
    const author = state.authors[diet.created_by] || '';

    const authorText = author
      ? `نشر بواسطة <strong class="text-slate-600">د. ${esc(author)}</strong>`
      : 'نشر بواسطة طبيب';

    return `
      <article class="glass overflow-hidden rounded-3xl">
        <div class="border-b border-slate-100 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap gap-2">
                <span class="rounded-full ${
                  published
                    ? 'bg-indigo-50 text-indigo-600'
                    : 'bg-brand-50 text-brand-700'
                } px-2.5 py-1 text-[10px] font-extrabold">
                  ${published ? 'منشور' : 'خاص'}
                </span>

                ${
                  mine
                    ? '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">ملكي</span>'
                    : ''
                }
              </div>

              <h3 class="mt-3 text-lg font-extrabold text-slate-800">
                ${esc(diet.name)}
              </h3>

              <p class="mt-1 text-xs text-slate-400 line-clamp-2">
                ${esc(diet.description || 'بدون وصف')}
              </p>

              ${
                published
                  ? `
                    <div class="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
                      <span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                        <i class="fa-solid fa-user-doctor"></i>
                      </span>
                      <span>${authorText}</span>
                    </div>
                  `
                  : ''
              }
            </div>

            <i class="fa-solid fa-utensils text-2xl text-brand-100"></i>
          </div>

          <div class="mt-5 grid grid-cols-4 gap-2">
            ${summaryMetric(
              'سعرات',
              diet.target_calories,
              'kcal',
              'amber'
            )}
            ${summaryMetric(
              'بروتين',
              diet.target_protein,
              'g',
              'slate'
            )}
            ${summaryMetric(
              'كارب',
              diet.target_carb,
              'g',
              'amber'
            )}
            ${summaryMetric(
              'دهون',
              diet.target_fat,
              'g',
              'emerald'
            )}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 bg-slate-50/70 p-4">
          <div class="flex flex-wrap gap-2">
            <button
              data-open="${esc(diet.id)}"
              class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"
            >
              <i class="fa-solid fa-eye ml-1"></i> فتح الدايت
            </button>

            <button
              data-duplicate="${esc(diet.id)}"
              class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"
            >
              <i class="fa-solid fa-copy ml-1"></i> نسخ
            </button>

            ${
              mine
                ? `
                  <button
                    data-edit="${esc(diet.id)}"
                    class="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white"
                  >
                    <i class="fa-solid fa-pen ml-1"></i> تعديل
                  </button>

                  <button
                    data-del="${esc(diet.id)}"
                    class="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-500"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                `
                : ''
            }
          </div>

          <span class="text-[10px] text-slate-400">يوم واحد</span>
        </div>
      </article>
    `;
  }

  function summaryMetric(label, value, unit, tone) {
    const classes = {
      amber: 'border-amber-200 bg-amber-50 text-amber-900',
      slate: 'border-slate-200 bg-slate-50 text-slate-800',
      emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900'
    };

    return `
      <div class="rounded-xl border ${classes[tone]} p-2 text-center">
        <div class="text-[9px] font-bold opacity-70">${label}</div>
        <div class="mt-1 text-sm font-extrabold">
          ${value == null ? '—' : num(value).toFixed(unit === 'kcal' ? 0 : 1)}
          ${value == null ? '' : unit}
        </div>
      </div>
    `;
  }

  function scaleHouseholdMeasure(measure, grams) {
    if (!measure) return '—';

    const value = num(grams);
    if (!Number.isFinite(value) || value < 0) return measure;

    const factor = value / 100;

    const arabicDigits = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };

    const fractions = {
      '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3,
      '¼': 0.25, '¾': 0.75, '⅕': 0.2,
      '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
      '⅙': 1 / 6, '⅚': 5 / 6,
      '⅛': 0.125, '⅜': 0.375,
      '⅝': 0.625, '⅞': 0.875
    };

    let text = String(measure).replace(
      /[٠-٩]/g,
      (digit) => arabicDigits[digit]
    );

    Object.keys(fractions).forEach((character) => {
      text = text.replaceAll(
        character,
        formatHouseholdNumber(fractions[character] * factor)
      );
    });

    text = text.replace(
      /(^|[^\d.])(\d+(?:\.\d+)?)(?=\s|$|[^\d.])/g,
      (match, before, number) =>
        before + formatHouseholdNumber(parseFloat(number) * factor)
    );

    if (text === String(measure).replace(/[٠-٩]/g, (d) => arabicDigits[d])) {
      return `${formatHouseholdNumber(factor)} × ${text}`;
    }

    return text;
  }

  function formatHouseholdNumber(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value - Math.round(value)) < 0.0001) {
      return String(Math.round(value));
    }

    return String(Math.round(value * 100) / 100)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*?)0+$/, '$1');
  }

  function calcTotals() {
    const totals = {
      kcal: 0,
      protein: 0,
      carb: 0,
      fat: 0,
      sodium: 0,
      potassium: 0,
      phosphorus: 0
    };

    state.day.meals.forEach((meal) => {
      meal.items.forEach((item) => {
        if (item.includeInCalculation === false) return;

        const food = state.foods.find(
          (entry) => entry.id === String(item.food_id)
        );

        if (!food) return;

        const factor = num(item.quantity_g) / 100;

        totals.kcal += food.kcal * factor;
        totals.protein += food.protein * factor;
        totals.carb += food.carb * factor;
        totals.fat += food.fat * factor;
        totals.sodium += food.sodium * factor;
        totals.potassium += food.potassium * factor;
        totals.phosphorus += food.phosphorus * factor;
      });
    });

    return totals;
  }

  function summaryCard(label, value, unit, classes) {
    return `
      <div class="rounded-xl border ${classes} p-3">
        <div class="text-[9px] font-bold opacity-70">${label}</div>
        <div class="mt-1 flex items-baseline gap-1">
          <span class="text-lg font-black">${value}</span>
          <small class="text-[9px] font-bold opacity-70">${unit}</small>
        </div>
      </div>
    `;
  }

  function renderSummary() {
    const totals = calcTotals();
    const summary = $('dailySummary');
    if (!summary) return;

    summary.innerHTML =
      summaryCard('🔥 السعرات', totals.kcal.toFixed(0), 'kcal', 'border-amber-200 bg-amber-50 text-amber-900') +
      summaryCard('🥩 البروتين', totals.protein.toFixed(1), 'g', 'border-slate-200 bg-slate-50 text-slate-800') +
      summaryCard('🍞 الكارب', totals.carb.toFixed(1), 'g', 'border-amber-200 bg-amber-50/60 text-amber-900') +
      summaryCard('🥑 الدهون', totals.fat.toFixed(1), 'g', 'border-emerald-200 bg-emerald-50 text-emerald-900') +
      summaryCard('🧂 الصوديوم', totals.sodium.toFixed(0), 'mg', 'border-sky-200 bg-sky-50 text-sky-900') +
      summaryCard('🍌 البوتاسيوم', totals.potassium.toFixed(0), 'mg', 'border-emerald-200 bg-emerald-50/70 text-emerald-900') +
      summaryCard('🦴 الفسفور', totals.phosphorus.toFixed(0), 'mg', 'border-purple-200 bg-purple-50 text-purple-900');
  }

  function setDietAccess(value) {
    const element = $('dietAccess');
    if (element) element.value = value || '';
  }

  function setReadOnly(readOnly) {
    [
      'dietName',
      'description',
      'notes',
      'visibility',
      'dietAccess',
      'addMeal',
      'saveDiet'
    ].forEach((id) => {
      const element = $(id);
      if (element) element.disabled = readOnly;
    });

    $('saveDiet')?.classList.toggle('hidden', readOnly);
    $('addMeal')?.classList.toggle('hidden', readOnly);

    document
      .querySelectorAll(
        '[data-add-item],[data-remove-meal],[data-remove-item],[data-pick],[data-toggle-calc],[data-move-meal]'
      )
      .forEach((element) => {
        element.classList.toggle('hidden', readOnly);
      });
  }

  function openNew() {
    state.editingId = null;
    state.day = {
      day_number: 1,
      day_name: 'اليوم',
      meals: []
    };

    $('editorTitle').textContent = 'إنشاء دايت جديد';
    $('dietName').value = '';
    $('description').value = '';
    $('notes').value = '';
    $('visibility').value = 'private';

    setDietAccess('');
    setReadOnly(false);
    renderDay();
    toggleEditor(true);
  }

  async function openDiet(id) {
    const diet = state.diets.find((item) => item.id === id);
    if (!diet) return;

    if (!(await requireAccess('read', 'ليس لديك صلاحية قراءة مكتبة الدايت.'))) {
      return;
    }

    await loadFoods();

    state.editingId = id;

    const canUpdate = await getAccess('update');
    const canEdit = diet.created_by === state.user.id && canUpdate;

    $('editorTitle').textContent = canEdit
      ? 'تعديل الدايت'
      : 'عرض الدايت';

    $('dietName').value = diet.name || '';
    $('description').value = diet.description || '';
    $('notes').value = diet.notes || '';
    $('visibility').value = diet.visibility || 'private';
    setDietAccess(diet.required_feature || '');

    const { data: days, error } = await db
      .from('diet_template_days')
      .select('id,diet_id,day_number,day_name')
      .eq('diet_id', id)
      .order('day_number', { ascending: true })
      .limit(1);

    if (error) {
      toast('تعذر تحميل اليوم', false);
      return;
    }

    const dayRow = days?.[0];

    if (!dayRow) {
      state.day = {
        day_number: 1,
        day_name: 'اليوم',
        meals: []
      };
    } else {
      const mealsResult = await db
        .from('diet_template_meals')
        .select('id,day_id,meal_name,meal_order,frequency')
        .eq('day_id', dayRow.id)
        .order('meal_order', { ascending: true });

      if (mealsResult.error) {
        toast(
          `تعذر تحميل الوجبات: ${mealsResult.error.message}`,
          false
        );
        return;
      }

      const mealIds = (mealsResult.data || []).map((meal) => meal.id);
      let items = [];

      if (mealIds.length) {
        const itemsResult = await db
          .from('diet_template_items')
          .select(
            'id,meal_id,food_id,quantity_g,household_measure,frequency,notes,item_order'
          )
          .in('meal_id', mealIds)
          .order('item_order', { ascending: true });

        if (itemsResult.error) {
          toast('تعذر تحميل الأصناف', false);
          return;
        }

        items = itemsResult.data || [];
      }

      state.day = {
        id: dayRow.id,
        day_number: 1,
        day_name: dayRow.day_name || 'اليوم',
        meals: (mealsResult.data || []).map((meal) => ({
          id: meal.id,
          name: meal.meal_name || 'وجبة',
          items: items
            .filter((item) => item.meal_id === meal.id)
            .map((item) => ({
              id: item.id,
              food_id: String(item.food_id),
              quantity_g: num(item.quantity_g),
              household_measure: item.household_measure || '',
              frequency: item.frequency || '',
              notes: item.notes || '',
              includeInCalculation: true
            }))
        }))
      };
    }

    renderDay();
    toggleEditor(true);
    setReadOnly(!canEdit);

    if (!canEdit) {
      toast('هذا الدايت متاح للعرض فقط');
    }
  }

  function setEditorVisible(show) {
    $('editor')?.classList.toggle('hidden', !show);
    $('editor')?.classList.toggle('flex', show);
  }

  const toggleEditor = setEditorVisible;

  function renderDay() {
    renderSummary();

    const editor = $('mealsEditor');
    if (!editor) return;

    editor.innerHTML = state.day.meals.length
      ? state.day.meals
          .map((meal, index) => mealHTML(index, meal))
          .join('')
      : `
        <div class="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <i class="fa-solid fa-utensils text-xl"></i>
          </div>
          <p class="mt-3 font-extrabold text-slate-600">لم تتم إضافة أي وجبة</p>
          <p class="mt-1 text-xs text-slate-400">
            ابدأ بإضافة وجبة ثم اختر الأصناف والكميات.
          </p>
        </div>
      `;

    document.querySelectorAll('.food-name-text').forEach((element) => {
      const food = state.foods.find(
        (item) => String(item.id) === String(element.dataset.foodId)
      );

      element.textContent = food?.name_ar || 'صنف غير موجود';

      if (food?.name_en) {
        const english = document.createElement('span');
        english.className = 'food-name-en';
        english.textContent = food.name_en;
        element.appendChild(english);
      }
    });

    if ($('saveDiet')?.classList.contains('hidden')) {
      setReadOnly(true);
    }
  }

  function mealHTML(index, meal) {
    return `
      <div class="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div class="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            data-meal-name="${index}"
            value="${esc(meal.name)}"
            class="flex-1 max-w-xl rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-extrabold"
            placeholder="اسم الوجبة"
          >

          <div class="flex items-center gap-2">
            <button data-move-meal="${index}:up" class="h-9 w-9 rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
              <i class="fa-solid fa-arrow-up"></i>
            </button>

            <button data-move-meal="${index}:down" class="h-9 w-9 rounded-xl bg-white text-slate-500 ring-1 ring-slate-200">
              <i class="fa-solid fa-arrow-down"></i>
            </button>

            <button data-remove-meal="${index}" class="rounded-xl bg-red-50 px-3 py-2.5 text-red-500 hover:bg-red-100 text-xs font-bold">
              <i class="fa-solid fa-trash ml-1"></i> حذف الوجبة
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="diet-table w-full text-right text-[11px] sm:text-xs">
            <thead class="bg-white text-slate-500 font-bold border-b border-slate-100">
              <tr>
                <th class="py-3 px-3 w-[30%]">اسم الصنف</th>
                <th class="py-3 px-3 text-center w-[15%]">الكمية بالجرام</th>
                <th class="py-3 px-3 text-center w-[25%]">المقياس المنزلي</th>
                <th class="py-3 px-3 text-center w-[12%]">التكرار</th>
                <th class="py-3 px-3 text-center w-[18%]">ملاحظة</th>
                <th class="py-3 px-3 text-center w-[15%]">الإجراء</th>
              </tr>
            </thead>

            <tbody>
              ${
                meal.items.length
                  ? meal.items
                      .map((item, itemIndex) =>
                        itemHTML(index, itemIndex, item)
                      )
                      .join('')
                  : `
                    <tr>
                      <td colspan="6" class="py-8 text-center text-slate-400">
                        لا توجد أصناف مضافة لهذه الوجبة بعد
                      </td>
                    </tr>
                  `
              }
            </tbody>
          </table>
        </div>

        <div class="p-3 border-t border-slate-100">
          <button data-add-item="${index}" class="rounded-xl border border-dashed border-brand-200 bg-brand-50/50 px-3 py-2 text-[11px] font-bold text-brand-700 hover:bg-brand-50">
            <i class="fa-solid fa-plus ml-1"></i> إضافة صنف
          </button>
        </div>
      </div>
    `;
  }

  function itemHTML(mealIndex, itemIndex, item) {
    const foodId = String(item.food_id);
    const food = state.foods.find(
      (entry) => String(entry.id) === foodId
    );

    const household = food?.household
      ? scaleHouseholdMeasure(food.household, num(item.quantity_g))
      : item.household_measure || '—';

    const checked = item.includeInCalculation !== false;

    return `
      <tr class="food-row hover:bg-slate-50/80">
        <td class="py-2.5 px-3">
          <div data-pick="${mealIndex}:${itemIndex}" class="food-name-cell">
            <span class="food-name-text" data-food-id="${esc(foodId)}"></span>
          </div>
        </td>

        <td class="py-2.5 px-3 text-center">
          <div class="flex items-center justify-center gap-1">
            <input
              data-qty="${mealIndex}:${itemIndex}"
              type="number"
              min="0"
              step="1"
              value="${num(item.quantity_g)}"
              class="w-24 bg-brand-50 border border-brand-200 rounded-lg px-2 py-2 text-center font-extrabold text-brand-700"
            >
            <span class="text-[9px] text-slate-400">جم</span>
          </div>
        </td>

        <td class="py-2.5 px-3 text-center text-brand-700 font-bold leading-5">
          ${esc(household)}
        </td>

        <td class="py-2.5 px-3 text-center">
          <input
            data-frequency="${mealIndex}:${itemIndex}"
            value="${esc(item.frequency || '')}"
            placeholder="7/7"
            class="w-20 max-w-full bg-sky-50 border border-sky-200 rounded-lg px-2 py-2 text-center font-extrabold text-sky-700"
          >
        </td>

        <td class="py-2.5 px-3 text-center">
          <input
            data-note="${mealIndex}:${itemIndex}"
            value="${esc(item.notes || '')}"
            placeholder="مثال: مشوي"
            class="w-full min-w-[110px] bg-amber-50 border border-amber-200 rounded-lg px-2 py-2 text-right font-semibold text-amber-800"
          >
        </td>

        <td class="py-2.5 px-3">
          <div class="flex items-center justify-center gap-3">
            <label class="flex items-center gap-1.5 cursor-pointer">
              <input
                data-toggle-calc="${mealIndex}:${itemIndex}"
                type="checkbox"
                ${checked ? 'checked' : ''}
                class="h-4 w-4 accent-brand-600"
              >
              <span class="text-[9px] font-bold text-slate-500">حساب</span>
            </label>

            <button
              data-remove-item="${mealIndex}:${itemIndex}"
              class="h-8 w-8 rounded-lg bg-red-50 text-red-500 hover:bg-red-100"
            >
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  async function openPicker(mealIndex, itemIndex = null) {
    await loadFoods();

    state.activeMealIndex = mealIndex;
    state.selectedFood = null;

    $('selectedFoodBox')?.classList.add('hidden');
    if ($('selectedFoodGrams')) $('selectedFoodGrams').value = '100';
    if ($('foodSearch')) $('foodSearch').value = '';

    $('foodPicker')?.classList.remove('hidden');
    $('foodPicker')?.classList.add('flex');

    renderPicker();

    if (itemIndex !== null) {
      state.selectedFood = { editIndex: itemIndex };
    }
  }

  function closePicker() {
    state.activeMealIndex = null;
    state.selectedFood = null;

    $('foodPicker')?.classList.add('hidden');
    $('foodPicker')?.classList.remove('flex');
  }

  function renderPicker() {
    const query = $('foodSearch')?.value.trim().toLowerCase() || '';

    const foods = state.foods.filter((food) =>
      `${food.name_ar || ''} ${food.name_en || ''} ${food.id}`
        .toLowerCase()
        .includes(query)
    );

    $('pickerList').innerHTML =
      foods
        .map(
          (food) => `
            <button data-food="${esc(food.id)}" class="flex w-full items-center justify-between gap-4 border-b border-slate-100 px-5 py-3 text-right hover:bg-brand-50">
              <div class="min-w-0">
                <div class="text-xs font-extrabold text-slate-700">${esc(food.name_ar)}</div>
                <div class="mt-1 text-[9px] text-slate-400">${esc(food.name_en || '')}</div>
              </div>

              <div class="flex shrink-0 items-center gap-2 text-[9px] text-slate-400">
                <span>${food.kcal} kcal/100g</span>
                <span class="${food.is_custom ? 'text-violet-600' : 'text-emerald-600'}">
                  ${food.is_custom ? 'مخصص' : 'أساسي'}
                </span>
                <i class="fa-solid fa-chevron-left text-slate-300"></i>
              </div>
            </button>
          `
        )
        .join('') ||
      '<div class="p-10 text-center text-xs text-slate-400">لا توجد نتائج</div>';
  }

  function chooseFood(id) {
    const food = state.foods.find(
      (entry) => entry.id === String(id)
    );

    if (!food) return;

    state.selectedFood = {
      ...food,
      editIndex: state.selectedFood?.editIndex ?? null
    };

    $('selectedFoodName').textContent =
      food.name_ar || food.name_en || food.id;

    $('selectedFoodGrams').value =
      state.selectedFood.editIndex !== null &&
      state.selectedFood.editIndex !== undefined
        ? num(
            state.day.meals[state.activeMealIndex]
              .items[state.selectedFood.editIndex]?.quantity_g
          ) || 100
        : 100;

    $('selectedFoodBox')?.classList.remove('hidden');
    $('selectedFoodGrams')?.focus();
  }

  function addSelected() {
    if (!state.selectedFood || state.activeMealIndex === null) {
      toast('اختر صنفًا أولاً', false);
      return;
    }

    const grams = num($('selectedFoodGrams')?.value);

    if (grams <= 0) {
      toast('حدد كمية صحيحة بالجرام', false);
      return;
    }

    const meal = state.day.meals[state.activeMealIndex];

    if (
      state.selectedFood.editIndex !== null &&
      state.selectedFood.editIndex !== undefined
    ) {
      const item = meal.items[state.selectedFood.editIndex];

      item.food_id = state.selectedFood.id;
      item.quantity_g = grams;
      item.household_measure = state.selectedFood.household || '';
    } else {
      meal.items.push({
        food_id: state.selectedFood.id,
        quantity_g: grams,
        household_measure: state.selectedFood.household || '',
        frequency: '',
        includeInCalculation: true
      });
    }

    closePicker();
    renderDay();
  }

  function bindEditorEvents() {
    $('mealsEditor')?.addEventListener('input', (event) => {
      let key = event.target.dataset.mealName;

      if (key !== undefined) {
        state.day.meals[+key].name = event.target.value;
        return;
      }

      key = event.target.dataset.qty;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);

        state.day.meals[mealIndex].items[itemIndex].quantity_g =
          num(event.target.value);

        renderSummary();
        return;
      }

      key = event.target.dataset.frequency;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);
        state.day.meals[mealIndex].items[itemIndex].frequency =
          event.target.value;
        return;
      }

      key = event.target.dataset.note;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);
        state.day.meals[mealIndex].items[itemIndex].notes =
          event.target.value;
      }
    });

    $('mealsEditor')?.addEventListener('change', (event) => {
      let key = event.target.dataset.qty;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);

        state.day.meals[mealIndex].items[itemIndex].quantity_g =
          Math.max(0, num(event.target.value));

        renderDay();
        return;
      }

      key = event.target.dataset.frequency;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);
        state.day.meals[mealIndex].items[itemIndex].frequency =
          event.target.value;
        return;
      }

      key = event.target.dataset.toggleCalc;

      if (key !== undefined) {
        const [mealIndex, itemIndex] = key.split(':').map(Number);

        state.day.meals[mealIndex].items[itemIndex].includeInCalculation =
          event.target.checked;

        renderDay();
      }
    });

    $('mealsEditor')?.addEventListener('click', async (event) => {
      let button = event.target.closest('[data-add-item]');

      if (button) {
        await openPicker(Number(button.dataset.addItem));
        return;
      }

      button = event.target.closest('[data-pick]');

      if (button) {
        const [mealIndex, itemIndex] =
          button.dataset.pick.split(':').map(Number);

        await openPicker(mealIndex, itemIndex);
        chooseFood(
          state.day.meals[mealIndex].items[itemIndex].food_id
        );
        return;
      }

      button = event.target.closest('[data-remove-item]');

      if (button) {
        const [mealIndex, itemIndex] =
          button.dataset.removeItem.split(':').map(Number);

        openConfirm(
          'حذف الصنف',
          'هل أنت متأكد من حذف هذا الصنف من الوجبة؟',
          () => {
            state.day.meals[mealIndex].items.splice(itemIndex, 1);
            renderDay();
          }
        );
        return;
      }

      button = event.target.closest('[data-remove-meal]');

      if (button) {
        const mealIndex = Number(button.dataset.removeMeal);

        openConfirm(
          'حذف الوجبة',
          'هل أنت متأكد من حذف هذه الوجبة بكل أصنافها؟',
          () => {
            state.day.meals.splice(mealIndex, 1);
            renderDay();
          }
        );
        return;
      }

      button = event.target.closest('[data-move-meal]');

      if (button) {
        const [mealIndex, direction] =
          button.dataset.moveMeal.split(':');

        const from = Number(mealIndex);
        const to = direction === 'up' ? from - 1 : from + 1;

        if (to < 0 || to >= state.day.meals.length) return;

        [state.day.meals[from], state.day.meals[to]] = [
          state.day.meals[to],
          state.day.meals[from]
        ];

        renderDay();
      }
    });
  }

  function bindStaticEvents() {
    $('addMeal').onclick = () => {
      state.day.meals.push({
        name: `وجبة ${state.day.meals.length + 1}`,
        items: []
      });

      renderDay();
    };

    $('foodSearch').oninput = renderPicker;
    $('closePicker').onclick = closePicker;
    $('pickerList').onclick = (event) => {
      const button = event.target.closest('[data-food]');
      if (button) chooseFood(button.dataset.food);
    };
    $('addSelectedFood').onclick = addSelected;

    $('newBtn').onclick = async () => {
      if (!(await requireAccess('add', 'ليس لديك صلاحية إنشاء دايت.'))) {
        return;
      }

      openNew();
    };

    $('visibility').onchange = () => {
      if ($('visibility').value !== 'public') {
        setDietAccess('');
      }
    };

    $('cancelEditor').onclick = () => toggleEditor(false);

    $('search').oninput = () => {
      state.renderLimit = 40;
      renderDiets();
    };

    $('visibilityFilter').onchange = () => {
      state.renderLimit = 40;
      renderDiets();
    };

    $('refreshBtn').onclick = () => loadDiets(true);
    $('saveDiet').onclick = save;
  }

  function bindConfirmEvents() {
    $('cancelDeleteBtn').onclick = closeDeleteConfirm;

    $('confirmDeleteBtn').onclick = async () => {
      const button = $('confirmDeleteBtn');
      if (!button) return;

      button.disabled = true;
      button.textContent = 'جاري التنفيذ...';

      try {
        if (confirmAction) {
          const action = confirmAction;
          confirmAction = null;
          await action();
        } else {
          const diet = deleteTarget;
          if (!diet) return;

          if (!(await requireAccess('delete', 'ليس لديك صلاحية حذف الدايت.'))) {
            return;
          }

          const { error } = await db
            .from('diet_templates')
            .delete()
            .eq('id', diet.id);

          if (error) throw error;

          clearCache('diets');
          await loadDiets(true);
          toast('تم حذف الدايت');
        }
      } catch (error) {
        toast(`فشل التنفيذ: ${error.message || error}`, false);
      } finally {
        button.disabled = false;
        closeDeleteConfirm();
      }
    };
  }

  let deleteTarget = null;
  let confirmAction = null;

  function closeDeleteConfirm() {
    deleteTarget = null;
    confirmAction = null;

    $('deleteConfirmModal')?.classList.add('hidden');
    $('deleteConfirmModal')?.classList.remove('flex');
  }

  function openConfirm(title, message, action) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmDeleteBtn').innerHTML = 'تأكيد';

    deleteTarget = null;
    confirmAction = action;

    $('deleteConfirmModal').classList.remove('hidden');
    $('deleteConfirmModal').classList.add('flex');
  }

  function openDeleteConfirm(diet) {
    deleteTarget = diet;
    confirmAction = null;

    $('confirmTitle').textContent = 'تأكيد حذف الدايت';
    $('confirmMessage').textContent =
      'هل أنت متأكد من حذف هذا الدايت؟ لا يمكن التراجع عن الحذف.';
    $('confirmDeleteBtn').innerHTML =
      '<i class="fa-solid fa-trash ml-1"></i> حذف الدايت';

    $('deleteConfirmModal').classList.remove('hidden');
    $('deleteConfirmModal').classList.add('flex');
  }

  async function duplicateDiet(id) {
    const source = state.diets.find((diet) => diet.id === id);
    if (!source) return;

    if (!(await requireAccess('add', 'ليس لديك صلاحية إنشاء نسخة من الدايت.'))) {
      return;
    }

    try {
      await loadFoods();

      const { data: days, error: dayError } = await db
        .from('diet_template_days')
        .select('id,day_number,day_name')
        .eq('diet_id', id)
        .order('day_number', { ascending: true })
        .limit(1);

      if (dayError) throw dayError;

      const dayRow = days?.[0];
      let meals = [];

      if (dayRow) {
        const { data: mealRows, error: mealError } = await db
          .from('diet_template_meals')
          .select('id,meal_name,meal_order,frequency')
          .eq('day_id', dayRow.id)
          .order('meal_order', { ascending: true });

        if (mealError) throw mealError;

        const mealIds = (mealRows || []).map((meal) => meal.id);
        let items = [];

        if (mealIds.length) {
          const result = await db
            .from('diet_template_items')
            .select(
              'meal_id,food_id,quantity_g,household_measure,frequency,notes,item_order'
            )
            .in('meal_id', mealIds)
            .order('item_order', { ascending: true });

          if (result.error) throw result.error;

          items = result.data || [];
        }

        meals = (mealRows || []).map((meal) => ({
          name: meal.meal_name || 'وجبة',
          items: items
            .filter((item) => item.meal_id === meal.id)
            .map((item) => ({
              food_id: String(item.food_id),
              quantity_g: num(item.quantity_g),
              household_measure: item.household_measure || '',
              frequency: item.frequency || '',
              notes: item.notes || '',
              includeInCalculation: true
            }))
        }));
      }

      state.editingId = null;

      $('editorTitle').textContent = 'إنشاء نسخة من الدايت';
      $('dietName').value = `${source.name || 'دايت'} - نسخة`;
      $('description').value = source.description || '';
      $('notes').value = source.notes || '';
      $('visibility').value = 'private';

      setDietAccess('');

      state.day = {
        day_number: 1,
        day_name: 'اليوم',
        meals
      };

      setReadOnly(false);
      renderDay();
      toggleEditor(true);

      toast('تم إنشاء نسخة قابلة للتعديل — اضغط حفظ لحفظها');
    } catch (error) {
      toast(
        `تعذر نسخ الدايت: ${error.message || error}`,
        false
      );
    }
  }

  async function openEditorFromCard(id) {
    const diet = state.diets.find((item) => item.id === id);
    if (!diet) return;

    const canUpdate = await getAccess('update');

    if (diet.created_by !== state.user.id || !canUpdate) {
      await openDiet(id);
      return;
    }

    await openDiet(id);
  }

  async function handleGridClick(event) {
    const openButton = event.target.closest('[data-open]');
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-del]');
    const duplicateButton = event.target.closest('[data-duplicate]');

    if (openButton) {
      await openDiet(openButton.dataset.open);
      return;
    }

    if (editButton) {
      await openEditorFromCard(editButton.dataset.edit);
      return;
    }

    if (deleteButton) {
      const diet = state.diets.find(
        (item) => item.id === deleteButton.dataset.del
      );

      if (diet) openDeleteConfirm(diet);
      return;
    }

    if (duplicateButton) {
      await duplicateDiet(duplicateButton.dataset.duplicate);
    }
  }

  function buildDietPayload(visibility, totals) {
    const currentDiet = state.editingId
      ? state.diets.find((diet) => diet.id === state.editingId)
      : null;

    const publisherName =
      visibility === 'public'
        ? currentDiet?.publisher_name ||
          state.authors[currentDiet?.created_by] ||
          state.authors[state.user.id] ||
          state.user.user_metadata?.full_name ||
          state.user.user_metadata?.name ||
          ''
        : null;

    const requiredFeature =
      visibility === 'public' &&
      $('dietAccess')?.value === 'diet'
        ? 'diet'
        : null;

    return {
      name: $('dietName').value.trim(),
      description: $('description').value.trim() || null,
      notes: $('notes').value.trim() || null,
      visibility,
      required_feature: requiredFeature,
      publisher_name: publisherName,
      target_calories: totals.kcal,
      target_protein: totals.protein,
      target_carb: totals.carb,
      target_fat: totals.fat,
      target_fluid: null,
      goal: null
    };
  }

  async function saveDietTemplateViaRpc(dietId, payload) {
    const dayId = crypto.randomUUID();

    const meals = state.day.meals.map((meal, index) => ({
      id: crypto.randomUUID(),
      meal_name: meal.name || `وجبة ${index + 1}`,
      meal_order: index + 1,
      frequency: null
    }));

    const items = [];

    state.day.meals.forEach((meal, mealIndex) => {
      const mealId = meals[mealIndex].id;

      meal.items.forEach((item, itemIndex) => {
        if (!item.food_id) return;

        const food = state.foods.find(
          (entry) => entry.id === String(item.food_id)
        );

        const householdMeasure = food?.household
          ? scaleHouseholdMeasure(
              food.household,
              num(item.quantity_g)
            )
          : item.household_measure || null;

        items.push({
          id: crypto.randomUUID(),
          meal_id: mealId,
          food_id: String(item.food_id),
          quantity_g: num(item.quantity_g),
          household_measure: householdMeasure,
          frequency: item.frequency || null,
          notes: item.notes || null,
          item_order: itemIndex + 1
        });
      });
    });

    const { data, error } = await db.rpc('save_diet_template', {
      p_diet_id: dietId || null,
      p_payload: payload,
      p_day: {
        id: dayId,
        day_number: 1,
        day_name: 'اليوم'
      },
      p_meals: meals,
      p_items: items
    });

    if (error) throw error;
    return data;
  }

  async function save() {
    if (!state.user) return;

    const isUpdate = Boolean(state.editingId);
    const action = isUpdate ? 'update' : 'add';

    if (
      !(await requireAccess(
        action,
        isUpdate
          ? 'ليس لديك صلاحية تعديل الدايت.'
          : 'ليس لديك صلاحية إنشاء دايت.'
      ))
    ) {
      return;
    }

    const name = $('dietName').value.trim();

    if (!name) {
      toast('اكتب اسم الدايت أولاً', false);
      return;
    }

    if (!state.day.meals.length) {
      toast('أضف وجبة واحدة على الأقل', false);
      return;
    }

    const visibility = $('visibility').value;
    const button = $('saveDiet');

    button.disabled = true;
    button.textContent = 'جاري الحفظ...';

    try {
      if (
        state.day.meals.some((meal) => meal.items.length) &&
        !(await loadFoods())
      ) {
        throw new Error('تعذر تحميل مكتبة الأغذية');
      }

      const payload = buildDietPayload(
        visibility,
        calcTotals()
      );

      const dietId = await saveDietTemplateViaRpc(
        state.editingId,
        payload
      );

      const existingDiet = isUpdate
        ? state.diets.find((diet) => diet.id === dietId)
        : null;

      const savedDiet = {
        id: dietId,
        name: payload.name,
        description: payload.description,
        notes: payload.notes,
        target_calories: payload.target_calories,
        target_protein: payload.target_protein,
        target_carb: payload.target_carb,
        target_fat: payload.target_fat,
        target_fluid: payload.target_fluid,
        goal: payload.goal,
        visibility: payload.visibility,
        required_feature: payload.required_feature,
        created_by: existingDiet?.created_by || state.user.id,
        publisher_name: payload.publisher_name,
        updated_at: new Date().toISOString(),
        created_at:
          existingDiet?.created_at || new Date().toISOString()
      };

      const existingIndex = state.diets.findIndex(
        (diet) => diet.id === dietId
      );

      if (existingIndex >= 0) {
        state.diets[existingIndex] = savedDiet;
      } else {
        state.diets.unshift(savedDiet);
      }

      if (payload.publisher_name) {
        state.authors[state.user.id] = payload.publisher_name;
      }

      writeCache('diets', {
        diets: state.diets,
        authors: state.authors
      });

      renderDiets();

      toast(
        isUpdate
          ? 'تم تحديث الدايت بنجاح'
          : 'تم حفظ الدايت بنجاح'
      );

      toggleEditor(false);
    } catch (error) {
      console.error('Diet save failed:', error);
      toast(
        `فشل حفظ الدايت: ${error.message || error}`,
        false
      );
    } finally {
      button.disabled = false;
      button.textContent = 'حفظ الدايت';
    }
  }

  async function initialize() {
    if (!(await getCurrentUser())) return;

    if (!(await requireAccess('read', 'ليس لديك صلاحية قراءة مكتبة الدايت.'))) {
      location.replace('index.html');
      return;
    }

    bindEditorEvents();
    bindStaticEvents();
    bindConfirmEvents();

    $('dietGrid')?.addEventListener('click', handleGridClick);

    await loadDiets();

    if ($('loading')) {
      $('loading').style.display = 'none';
    }
  }

  initialize();
})();
