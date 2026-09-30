(() => {
  'use strict';

  const supabase = window.DietPlannerSupabase?.client;
  const $ = (id) => document.getElementById(id);
  const num = (value) => Number(value || 0);
  const FOOD_PAGE_SIZE = 50;

  const state = {
    foods: [],
    exchanges: [],
    user: null,
    visibleFoodCount: FOOD_PAGE_SIZE,
    deleteTarget: null
  };

  function toast(message, success = true) {
    const element = $('toast');
    if (!element) return;
    element.textContent = message;
    element.className = `fixed bottom-5 left-5 z-[120] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${success ? 'bg-brand-600' : 'bg-red-600'}`;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 3200);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[character]);
  }

  function normalizeFood(food) {
    return {
      ...food,
      id: String(food.id),
      kcal: num(food.kcal), protein: num(food.protein), carb: num(food.carb), fat: num(food.fat),
      sodium: num(food.sodium), potassium: num(food.potassium), phosphorus: num(food.phosphorus),
      water: num(food.water), is_custom: Boolean(food.is_custom)
    };
  }

  async function loadFoods() {
    const { data, error } = await supabase
      .from('foods')
      .select('id,name_ar,name_en,household,kcal,protein,carb,fat,sodium,potassium,phosphorus,water,is_custom,created_by')
      .order('name_ar', { ascending: true });

    if (error) {
      console.error('Failed to load foods:', error);
      toast(`تعذر تحميل مكتبة الأغذية: ${error.message}`, false);
      return;
    }

    state.foods = (data || []).map(normalizeFood);
    state.visibleFoodCount = FOOD_PAGE_SIZE;
    renderFoods();
  }

  function getFilteredFoods() {
    const query = $('search').value.trim().toLowerCase();
    const type = $('typeFilter').value;

    return state.foods.filter((food) => {
      const text = `${food.id} ${food.name_ar || ''} ${food.name_en || ''}`.toLowerCase();
      return (!query || text.includes(query)) &&
        (type === 'all' || (type === 'custom' ? food.is_custom : !food.is_custom));
    });
  }

  function canManageCustomFood(food) {
    return Boolean(state.user && food?.is_custom && food.created_by === state.user.id);
  }

  function renderFoods() {
    const filtered = getFilteredFoods();
    const visibleFoods = filtered.slice(0, state.visibleFoodCount);

    $('foodRows').innerHTML = visibleFoods.map((food) => `
      <tr class="border-b border-slate-100 hover:bg-slate-50/80">
        <td class="px-3 py-3"><div class="font-bold text-slate-800">${escapeHtml(food.name_ar)}</div>${food.name_en ? `<div class="mt-0.5 text-[10px] text-slate-400" dir="ltr">${escapeHtml(food.name_en)}</div>` : ''}</td>
        <td class="px-3 py-3 text-slate-600">${escapeHtml(food.household)}</td>
        <td class="px-3 py-3 text-center font-bold">${food.kcal}</td><td class="px-3 py-3 text-center">${food.carb}</td><td class="px-3 py-3 text-center">${food.protein}</td><td class="px-3 py-3 text-center">${food.fat}</td>
        <td class="px-3 py-3 text-center">${food.sodium}</td><td class="px-3 py-3 text-center">${food.potassium}</td><td class="px-3 py-3 text-center">${food.phosphorus}</td><td class="px-3 py-3 text-center">${food.water}</td>
        <td class="px-3 py-3 text-center">${food.is_custom ? '<span class="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-600">مخصص</span>' : '<span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-600">أساسي</span>'}</td>
        <td class="px-3 py-3 text-center">${canManageCustomFood(food) ? `<div class="flex justify-center gap-1"><button data-edit="${escapeHtml(food.id)}" class="edit rounded-lg bg-slate-100 px-2.5 py-2 text-slate-600 hover:bg-brand-50 hover:text-brand-600"><i class="fa-solid fa-pen"></i></button><button data-del="${escapeHtml(food.id)}" class="del rounded-lg bg-red-50 px-2.5 py-2 text-red-500 hover:bg-red-100"><i class="fa-solid fa-trash"></i></button></div>` : '<span class="text-slate-300">—</span>'}</td>
      </tr>
    `).join('');

    $('empty').classList.toggle('hidden', filtered.length > 0);
    $('shownCount').textContent = `${visibleFoods.length} من ${filtered.length} معروض`;

    const loadMoreButton = $('loadMoreFoods');
    if (loadMoreButton) {
      const hasMore = state.visibleFoodCount < filtered.length;
      loadMoreButton.classList.toggle('hidden', !hasMore);
      loadMoreButton.textContent = `عرض المزيد (${Math.min(FOOD_PAGE_SIZE, filtered.length - state.visibleFoodCount)} صنف)`;
    }

    const customCount = state.foods.filter((food) => food.is_custom).length;
    $('countBadge').textContent = `${state.foods.length} صنف`;
    $('totalStat').textContent = state.foods.length;
    $('baseStat').textContent = state.foods.length - customCount;
    $('customStat').textContent = customCount;
  }

  async function loadExchanges() {
    const { data, error } = await supabase
      .from('food_exchanges')
      .select('id,sort_order,group_name,subgroup_name,exchange_name,kcal,carb,protein,fat')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) {
      console.error('Failed to load food exchanges:', error);
      toast(`تعذر تحميل قائمة البدائل الغذائية: ${error.message}`, false);
      return;
    }

    state.exchanges = (data || []).map((exchange) => ({
      ...exchange,
      id: String(exchange.id), sort_order: Number(exchange.sort_order ?? 0),
      group_name: String(exchange.group_name ?? ''), subgroup_name: String(exchange.subgroup_name ?? ''),
      exchange_name: String(exchange.exchange_name ?? ''), kcal: String(exchange.kcal ?? ''),
      carb: String(exchange.carb ?? ''), protein: String(exchange.protein ?? ''), fat: String(exchange.fat ?? '')
    }));

    const groups = [...new Set(state.exchanges.map((item) => item.group_name).filter(Boolean))];
    $('exchangeGroupFilter').innerHTML = '<option value="all">كل المجموعات</option>' + groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
    renderExchanges();
  }

  function renderExchanges() {
    const query = $('exchangeSearch').value.trim().toLowerCase();
    const group = $('exchangeGroupFilter').value;
    const filtered = state.exchanges.filter((exchange) => {
      const text = `${exchange.group_name} ${exchange.subgroup_name} ${exchange.exchange_name}`.toLowerCase();
      return (!query || text.includes(query)) && (group === 'all' || exchange.group_name === group);
    });

    $('exchangeRows').innerHTML = filtered.map((exchange) => `
      <tr class="border-b border-slate-100 hover:bg-slate-50/80">
        <td class="px-4 py-4 font-extrabold text-brand-700">${escapeHtml(exchange.group_name)}</td><td class="px-4 py-4 font-bold text-slate-800">${escapeHtml(exchange.subgroup_name)}</td><td class="exchange-cell px-4 py-4 text-slate-800 font-medium">${escapeHtml(exchange.exchange_name)}</td>
        <td class="px-4 py-4 text-center font-bold text-slate-800">${escapeHtml(exchange.kcal)}</td><td class="px-4 py-4 text-center font-bold text-slate-800">${escapeHtml(exchange.carb)} g</td><td class="px-4 py-4 text-center font-bold text-slate-800">${escapeHtml(exchange.protein)} g</td><td class="px-4 py-4 text-center font-bold text-slate-800">${escapeHtml(exchange.fat)} g</td>
      </tr>
    `).join('');
    $('exchangeEmpty').classList.toggle('hidden', filtered.length > 0);
  }

  function switchTab(tab) {
    const showFoods = tab === 'foods';
    $('foodsTab').classList.toggle('active', showFoods); $('foodsTab').classList.toggle('text-slate-600', !showFoods);
    $('exchangesTab').classList.toggle('active', !showFoods); $('exchangesTab').classList.toggle('text-slate-600', showFoods);
    $('foodTools').classList.toggle('hidden', !showFoods); $('foodFilters').classList.toggle('hidden', !showFoods);
    $('foodSection').classList.toggle('hidden', !showFoods); $('exchangeSection').classList.toggle('hidden', showFoods);
  }

  function loadMoreFoods() {
    state.visibleFoodCount += FOOD_PAGE_SIZE;
    renderFoods();
  }

  function openFoodModal(food = null) {
    $('modal').classList.remove('hidden'); $('modal').classList.add('flex'); $('foodForm').reset();
    $('editId').value = food?.id || '';
    $('modalTitle').textContent = food ? 'تعديل صنف مخصص' : 'إضافة صنف مخصص';
    $('nameAr').value = food?.name_ar || ''; $('nameEn').value = food?.name_en || ''; $('household').value = food?.household || '';
    ['kcal', 'protein', 'carb', 'fat', 'sodium', 'potassium', 'phosphorus', 'water'].forEach((key) => { $(key).value = food?.[key] ?? ''; });
  }

  function closeFoodModal() {
    $('modal').classList.add('hidden'); $('modal').classList.remove('flex');
  }

  function openDeleteConfirm(food) {
    state.deleteTarget = food;
    $('deleteConfirmText').textContent = `هل تريد حذف الصنف المخصص "${food.name_ar}"؟ لا يمكن التراجع عن الحذف.`;
    $('deleteConfirmModal').classList.remove('hidden'); $('deleteConfirmModal').classList.add('flex');
  }

  function closeDeleteConfirm() {
    state.deleteTarget = null;
    $('deleteConfirmModal').classList.add('hidden'); $('deleteConfirmModal').classList.remove('flex');
  }

  async function deleteCustomFood() {
    const food = state.deleteTarget;
    if (!canManageCustomFood(food)) return;

    const button = $('confirmDeleteBtn');
    button.disabled = true; button.innerHTML = 'جاري الحذف...';
    const { error } = await supabase.from('foods').delete().eq('id', food.id).eq('created_by', state.user.id).eq('is_custom', true);
    button.disabled = false; button.innerHTML = '<i class="fa-solid fa-trash ml-1"></i> حذف الصنف';
    closeDeleteConfirm();

    if (error) {
      console.error('Failed to delete food:', error);
      toast(`فشل حذف الصنف: ${error.message}`, false);
      return;
    }
    toast('تم حذف الصنف');
    await loadFoods();
  }

  async function saveFood(event) {
    event.preventDefault();
    const button = $('saveBtn');
    button.disabled = true; button.textContent = 'جاري الحفظ...';

    const editId = $('editId').value;
    const existingFood = editId ? state.foods.find((food) => food.id === editId) : null;
    if (existingFood && !canManageCustomFood(existingFood)) {
      button.disabled = false; button.textContent = 'حفظ الصنف';
      toast('لا يمكن تعديل هذا الصنف', false);
      return;
    }

    const payload = {
      name_ar: $('nameAr').value.trim(), name_en: $('nameEn').value.trim(), household: $('household').value.trim(),
      kcal: num($('kcal').value), protein: num($('protein').value), carb: num($('carb').value), fat: num($('fat').value),
      sodium: num($('sodium').value), potassium: num($('potassium').value), phosphorus: num($('phosphorus').value),
      water: num($('water').value), is_custom: true, created_by: state.user.id
    };

    let error;
    if (editId) {
      ({ error } = await supabase.from('foods').update(payload).eq('id', editId).eq('created_by', state.user.id).eq('is_custom', true));
    } else {
      const id = `food_custom_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
      ({ error } = await supabase.from('foods').insert({ id, ...payload }));
    }

    button.disabled = false; button.textContent = 'حفظ الصنف';
    if (error) {
      console.error('Failed to save food:', error);
      toast(`فشل الحفظ: ${error.message}`, false);
      return;
    }
    closeFoodModal();
    toast(editId ? 'تم تعديل الصنف بنجاح' : 'تمت إضافة الصنف بنجاح');
    await loadFoods();
  }

  function bindEvents() {
    $('addBtn').onclick = () => openFoodModal(); $('closeModal').onclick = closeFoodModal; $('cancelBtn').onclick = closeFoodModal;
    $('cancelDeleteBtn').onclick = closeDeleteConfirm; $('confirmDeleteBtn').onclick = deleteCustomFood;
    $('search').oninput = () => { state.visibleFoodCount = FOOD_PAGE_SIZE; renderFoods(); };
    $('typeFilter').onchange = () => { state.visibleFoodCount = FOOD_PAGE_SIZE; renderFoods(); };
    $('refreshBtn').onclick = loadFoods; $('loadMoreFoods').onclick = loadMoreFoods; $('foodForm').onsubmit = saveFood;
    $('foodsTab').onclick = () => switchTab('foods'); $('exchangesTab').onclick = () => switchTab('exchanges');
    $('exchangeSearch').oninput = renderExchanges; $('exchangeGroupFilter').onchange = renderExchanges;

    $('foodRows').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit]');
      const deleteButton = event.target.closest('[data-del]');
      if (editButton) {
        const food = state.foods.find((item) => item.id === editButton.dataset.edit);
        if (canManageCustomFood(food)) openFoodModal(food);
        return;
      }
      if (deleteButton) {
        const food = state.foods.find((item) => item.id === deleteButton.dataset.del);
        if (canManageCustomFood(food)) openDeleteConfirm(food);
      }
    });
  }

  async function init() {
    if (!supabase) {
      toast('تعذر تهيئة الاتصال بالتطبيق', false);
      return;
    }

    const user = await window.DietPlannerAuth?.getCurrentUser?.();
    if (!user) {
      location.replace('index.html');
      return;
    }

    state.user = user;
    bindEvents();
    await Promise.all([loadFoods(), loadExchanges()]);
    $('loading').style.display = 'none';
  }

  init();
})();
