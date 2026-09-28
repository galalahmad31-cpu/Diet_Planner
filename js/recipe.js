(function () {
    'use strict';

    const supabase = window.DietPlannerAccess?.supabaseClient;

    let currentUser = null;
    let isAdmin = false;
    let hasActiveSubscription = false;
    let recipes = [];
    let deleteTarget = null;

    const $ = (id) => document.getElementById(id);

    const numberValue = (id) => Number($(id).value || 0);

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));

    function showToast(message, success = true) {
        const toast = $('toast');
        toast.textContent = message;
        toast.className = `fixed bottom-5 left-5 z-[120] rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${success ? 'bg-brand-600' : 'bg-red-600'}`;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }

    function openModal(recipe = null) {
        $('recipeModal').classList.remove('hidden');
        $('modalTitle').textContent = recipe ? 'تعديل وصفة' : 'إضافة وصفة';
        $('editId').value = recipe?.id || '';
        $('name').value = recipe?.name || '';
        $('servings').value = recipe?.servings || 1;
        $('ingredients').value = recipe?.ingredients || '';
        $('instructions').value = recipe?.instructions || '';
        $('calories').value = recipe?.calories ?? 0;
        $('carbohydrates').value = recipe?.carbohydrates ?? 0;
        $('protein').value = recipe?.protein ?? 0;
        $('fat').value = recipe?.fat ?? 0;
        $('potassium').value = recipe?.potassium ?? 0;
        $('phosphorus').value = recipe?.phosphorus ?? 0;
        $('sodium').value = recipe?.sodium ?? 0;
    }

    function closeModal() {
        $('recipeModal').classList.add('hidden');
        $('recipeForm').reset();
        $('editId').value = '';
        $('servings').value = 1;
    }

    function openView(recipe) {
        $('viewTitle').textContent = recipe.name;
        $('viewAuthor').textContent = `بواسطة ${recipe.authorName || 'متخصص تغذية'}`;

        const nutrition = [
            ['السعرات', `${recipe.calories} kcal`],
            ['الكربوهيدرات', `${recipe.carbohydrates} g`],
            ['البروتين', `${recipe.protein} g`],
            ['الدهون', `${recipe.fat} g`],
            ['البوتاسيوم', `${recipe.potassium} mg`],
            ['الفسفور', `${recipe.phosphorus} mg`],
            ['الصوديوم', `${recipe.sodium} mg`],
            ['عدد الحصص', recipe.servings]
        ];

        $('viewNutrition').innerHTML = nutrition.map(([label, value]) => `
            <div class="nutrition-item">
                <div class="text-[11px] font-semibold text-slate-400">${escapeHtml(label)}</div>
                <div class="mt-1 font-extrabold text-slate-800">${escapeHtml(value)}</div>
            </div>
        `).join('');

        $('viewIngredients').textContent = recipe.ingredients || 'لم تُسجل مكونات.';
        $('viewInstructions').textContent = recipe.instructions || 'لم تُسجل طريقة التحضير.';
        $('viewModal').classList.remove('hidden');
    }

    function closeView() {
        $('viewModal').classList.add('hidden');
    }

    function openDelete(recipe) {
        deleteTarget = recipe;
        $('deleteText').textContent = `هل تريد حذف وصفة «${recipe.name}»؟ لا يمكن التراجع عن الحذف.`;
        $('deleteModal').classList.remove('hidden');
        $('deleteModal').classList.add('flex');
    }

    function closeDelete() {
        deleteTarget = null;
        $('deleteModal').classList.add('hidden');
        $('deleteModal').classList.remove('flex');
    }

    function render() {
        const query = $('search').value.trim().toLowerCase();
        const filtered = recipes.filter((recipe) => {
            const text = `${recipe.name} ${recipe.ingredients}`.toLowerCase();
            return !query || text.includes(query);
        });

        $('grid').innerHTML = filtered.map((recipe) => {
            const owner = recipe.created_by === currentUser.id;
            const canDelete = isAdmin || (owner && hasActiveSubscription);
            const canEdit = isAdmin || owner;

            return `
                <article class="recipe-card glass rounded-3xl p-5 shadow-sm">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                            <i class="fa-solid fa-bowl-food text-xl"></i>
                        </div>

                        <div class="flex gap-1">
                            ${canEdit ? `
                                <button data-edit="${escapeHtml(recipe.id)}" type="button" class="h-9 w-9 rounded-xl bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-600" title="تعديل">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            ` : ''}
                            ${canDelete ? `
                                <button data-delete="${escapeHtml(recipe.id)}" type="button" class="h-9 w-9 rounded-xl bg-red-50 text-red-500 hover:bg-red-100" title="حذف">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>

                    <h2 class="mt-5 text-lg font-extrabold text-slate-800">${escapeHtml(recipe.name)}</h2>

                    <p class="mt-2 line-clamp-3 text-sm leading-7 text-slate-500">
                        ${escapeHtml(recipe.ingredients || 'بدون مكونات مسجلة')}
                    </p>

                    <div class="mt-4 flex flex-wrap gap-2">
                        <span class="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">${recipe.calories} kcal</span>
                        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">${recipe.protein} g بروتين</span>
                        <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">${recipe.servings} حصة</span>
                    </div>

                    <div class="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                        <span class="text-xs text-slate-400">${escapeHtml(recipe.authorName || 'متخصص تغذية')}</span>
                        <button data-view="${escapeHtml(recipe.id)}" type="button" class="rounded-xl bg-brand-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-brand-700">
                            عرض الوصفة
                        </button>
                    </div>
                </article>
            `;
        }).join('');

        $('empty').classList.toggle('hidden', filtered.length > 0);
    }

    async function loadSubscriptionStatus() {
        const { data, error } = await supabase
            .from('subscriptions')
            .select('status, expiry_date')
            .eq('user_id', currentUser.id)
            .eq('status', 'paid')
            .gte('expiry_date', new Date().toISOString().slice(0, 10))
            .limit(1);

        if (error) {
            console.error(error);
            hasActiveSubscription = false;
            return;
        }

        hasActiveSubscription = Boolean(data?.length);
    }

    async function loadRecipes() {
        const { data, error } = await supabase
            .from('recipes')
            .select('id,created_by,name,ingredients,instructions,servings,calories,carbohydrates,protein,fat,potassium,phosphorus,sodium,created_at,updated_at')
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            showToast('تعذر تحميل الوصفات: ' + error.message, false);
            return;
        }

        const authorIds = [...new Set((data || []).map((recipe) => recipe.created_by))];
        let profiles = [];

        if (authorIds.length) {
            const profileResult = await supabase
                .from('profiles')
                .select('id,full_name,profession')
                .in('id', authorIds);

            if (!profileResult.error) profiles = profileResult.data || [];
        }

        const authorMap = new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.profession || 'متخصص تغذية']));

        recipes = (data || []).map((recipe) => ({
            ...recipe,
            calories: Number(recipe.calories || 0),
            carbohydrates: Number(recipe.carbohydrates || 0),
            protein: Number(recipe.protein || 0),
            fat: Number(recipe.fat || 0),
            potassium: Number(recipe.potassium || 0),
            phosphorus: Number(recipe.phosphorus || 0),
            sodium: Number(recipe.sodium || 0),
            servings: Number(recipe.servings || 1),
            authorName: authorMap.get(recipe.created_by)
        }));

        render();
    }

    async function saveRecipe(event) {
        event.preventDefault();

        const button = $('saveBtn');
        const editId = $('editId').value;

        const payload = {
            name: $('name').value.trim(),
            ingredients: $('ingredients').value.trim(),
            instructions: $('instructions').value.trim(),
            servings: Math.max(1, Math.trunc(numberValue('servings'))),
            calories: numberValue('calories'),
            carbohydrates: numberValue('carbohydrates'),
            protein: numberValue('protein'),
            fat: numberValue('fat'),
            potassium: numberValue('potassium'),
            phosphorus: numberValue('phosphorus'),
            sodium: numberValue('sodium')
        };

        button.disabled = true;
        button.textContent = 'جاري الحفظ...';

        const result = editId
            ? await supabase.from('recipes').update(payload).eq('id', editId)
            : await supabase.from('recipes').insert({ ...payload, created_by: currentUser.id });

        button.disabled = false;
        button.textContent = 'حفظ الوصفة';

        if (result.error) {
            showToast('فشل حفظ الوصفة: ' + result.error.message, false);
            return;
        }

        closeModal();
        showToast(editId ? 'تم تعديل الوصفة بنجاح' : 'تم نشر الوصفة بنجاح');
        await loadRecipes();
    }

    async function deleteRecipe() {
        if (!deleteTarget) return;

        const button = $('confirmDelete');
        button.disabled = true;
        button.textContent = 'جاري الحذف...';

        const { error } = await supabase
            .from('recipes')
            .delete()
            .eq('id', deleteTarget.id);

        button.disabled = false;
        button.textContent = 'حذف الوصفة';

        if (error) {
            showToast('تعذر حذف الوصفة: ' + error.message, false);
            closeDelete();
            return;
        }

        closeDelete();
        showToast('تم حذف الوصفة');
        await loadRecipes();
    }

    $('addBtn').addEventListener('click', () => openModal());
    $('closeModal').addEventListener('click', closeModal);
    $('cancelBtn').addEventListener('click', closeModal);
    $('closeView').addEventListener('click', closeView);
    $('cancelDelete').addEventListener('click', closeDelete);
    $('confirmDelete').addEventListener('click', deleteRecipe);
    $('search').addEventListener('input', render);
    $('recipeForm').addEventListener('submit', saveRecipe);

    $('grid').addEventListener('click', (event) => {
        const viewButton = event.target.closest('[data-view]');
        const editButton = event.target.closest('[data-edit]');
        const deleteButton = event.target.closest('[data-delete]');

        if (viewButton) {
            const recipe = recipes.find((item) => item.id === viewButton.dataset.view);
            if (recipe) openView(recipe);
        }

        if (editButton) {
            const recipe = recipes.find((item) => item.id === editButton.dataset.edit);
            if (recipe) openModal(recipe);
        }

        if (deleteButton) {
            const recipe = recipes.find((item) => item.id === deleteButton.dataset.delete);
            if (recipe) openDelete(recipe);
        }
    });

    async function init() {
        if (!supabase) {
            showToast('تعذر تهيئة الاتصال بالتطبيق', false);
            return;
        }

        const accessStatus = await window.DietPlannerAccess?.getAccessStatus?.();

        if (!accessStatus?.authenticated || !accessStatus.user) {
            location.replace('index.html');
            return;
        }

        currentUser = accessStatus.user;
        isAdmin = Boolean(accessStatus.isAdmin || accessStatus.profile?.role === 'admin');

        await Promise.all([
            loadSubscriptionStatus(),
            loadRecipes()
        ]);

        $('loading').style.display = 'none';
    }

    init();
})();
