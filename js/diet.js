/* Diet Planner — Diet Library
 * Page logic only.
 * Supabase client: js/supabase.js
 * Authorization: js/access.js → DietPlannerAccess.getPageAccess("diet")
 * Backend remains the final security boundary (RLS/RPC).
 */
(() => {
  "use strict";

  const supabase = window.DietPlannerSupabase?.client;
  const access = window.DietPlannerAccess;

  if (!access || !supabase) {
    console.error("diet.js requires js/supabase.js and js/access.js.");
    return;
  }

  const $ = (id) => document.getElementById(id);
  const num = (value) => Number(value || 0);
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char]));

  const state = {
    user: null,
    foods: [],
    diets: [],
    authors: {},
    editingId: null,
    activeMealIndex: null,
    selectedFood: null,
    day: {
      day_number: 1,
      day_name: "اليوم",
      meals: []
    },
    renderLimit: 40
  };

  const CACHE_TTL = 5 * 60 * 1000;
  const DIET_SELECT =
    "id,name,description,notes,target_calories,target_protein,target_carb,target_fat,target_fluid,goal,visibility,required_feature,created_by,publisher_name,created_at,updated_at";
  const FOOD_SELECT =
    "id,name_ar,name_en,is_custom,household,kcal,protein,carb,fat,sodium,potassium,phosphorus";

  function toast(message, success = true) {
    const element = $("toast");
    if (!element) return;

    element.textContent = message;
    element.className =
      `fixed bottom-5 left-5 z-[150] max-w-sm rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-xl ${
        success ? "bg-brand-600" : "bg-red-600"
      }`;

    element.classList.remove("hidden");
    clearTimeout(window.__dietToastTimer);
    window.__dietToastTimer = setTimeout(
      () => element.classList.add("hidden"),
      3200
    );
  }

  async function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.error("Diet user lookup failed:", error);
      return null;
    }

    return data?.user || null;
  }

  async function getPageAccess() {
    if (typeof access.getPageAccess !== "function") {
      console.error("DietPlannerAccess.getPageAccess is unavailable.");
      return null;
    }

    try {
      return await withTimeout(
        access.getPageAccess("diet"),
        10000,
        "انتهت مهلة التحقق من صلاحيات الصفحة."
      );
    } catch (error) {
      console.error("Diet page access check failed:", error);
      return null;
    }
  }

  async function requireAccess(action, message = "ليس لديك صلاحية تنفيذ هذه العملية.") {
    const permissions = await getPageAccess();

    if (permissions?.[action] === true) return true;

    toast(message, false);
    return false;
  }

  const cacheKey = (type) =>
    `diet-library:${type}:${state.user?.id || "guest"}`;

  function readCache(type) {
    try {
      const raw = localStorage.getItem(cacheKey(type));
      if (!raw) return null;

      const cached = JSON.parse(raw);
      if (!cached?.timestamp || Date.now() - cached.timestamp > CACHE_TTL) {
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
        JSON.stringify({ timestamp: Date.now(), data })
      );
    } catch {
      // Cache is optional.
    }
  }

  function clearCache(type) {
    try {
      localStorage.removeItem(cacheKey(type));
    } catch {
      // Ignore cache failures.
    }
  }

  async function loadFoods(force = false) {
    if (!force && state.foods.length) return true;

    if (!force) {
      const cached = readCache("foods");
      if (cached) {
        state.foods = cached;
        return true;
      }
    }

    try {
      const { data, error } = await withTimeout(
        supabase.from("foods").select(FOOD_SELECT).order("name_ar", { ascending: true }),
        15000,
        "انتهت مهلة تحميل مكتبة الأغذية."
      );

      if (error) throw error;

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

      writeCache("foods", state.foods);
      return true;
    } catch (error) {
      console.error("Food library load failed:", error);
      toast(`تعذر تحميل مكتبة الأغذية: ${error.message}`, false);
      return false;
    }
  }

  async function loadDiets(force = false) {
    const status = $("statusStat");
    if (status) status.textContent = "جاري التحميل...";

    if (!force) {
      const cached = readCache("diets");
      if (cached?.diets) {
        state.diets = cached.diets;
        state.authors = cached.authors || {};
        renderDiets();
      }
    }

    try {
      const { data, error } = await withTimeout(
        supabase.from("diet_templates").select(DIET_SELECT).order("updated_at", { ascending: false }),
        15000,
        "انتهت مهلة تحميل مكتبة الدايت."
      );

      if (error) throw error;

      state.diets = data || [];
      state.authors = {};

      const ids = [
        ...new Set(
          [
            ...state.diets.filter((diet) => diet.visibility === "public").map((diet) => diet.created_by).filter(Boolean),
            state.user.id
          ].filter(Boolean)
        )
      ];

      if (ids.length) {
        try {
          const { data: profiles, error: profileError } = await withTimeout(
            supabase.from("profiles").select("id,full_name").in("id", ids),
            5000,
            "انتهت مهلة تحميل أسماء الناشرين."
          );

          if (!profileError) {
            (profiles || []).forEach((profile) => {
              state.authors[profile.id] = profile.full_name || "";
            });
          }
        } catch (error) {
          console.warn("Publisher names were not loaded:", error);
        }
      }

      if (!state.authors[state.user.id]) {
        state.authors[state.user.id] = state.user.user_metadata?.full_name || state.user.user_metadata?.name || "";
      }

      state.diets.forEach((diet) => {
        if (diet.publisher_name) state.authors[diet.created_by] = diet.publisher_name;
      });

      writeCache("diets", { diets: state.diets, authors: state.authors });

      if (status) {
        status.textContent = "متصل";
        status.className = "mt-1 text-sm font-extrabold text-brand-600";
      }

      renderDiets();
      return true;
    } catch (error) {
      console.error("Diet library load failed:", error);

      if (status) {
        status.textContent = "خطأ";
        status.className = "mt-1 text-sm font-extrabold text-red-600";
      }

      toast(`تعذر تحميل مكتبة الدايت: ${error.message}`, false);
      return false;
    }
  }

  function renderDiets() {
    const query = $("search")?.value.trim().toLowerCase() || "";
    const visibility = $("visibilityFilter")?.value || "all";

    const filtered = state.diets.filter((diet) => {
      const matchesSearch =
        !query || `${diet.name} ${diet.description || ""} ${diet.notes || ""}`.toLowerCase().includes(query);

      const matchesVisibility =
        visibility === "all" ||
        (visibility === "mine" && diet.created_by === state.user.id) ||
        (visibility === "public" && diet.visibility === "public");

      return matchesSearch && matchesVisibility;
    });

    const visible = filtered.slice(0, state.renderLimit);
    const grid = $("dietGrid");
    if (!grid) return;

    grid.innerHTML = visible.map((diet) => dietCard(diet)).join("");
    $("empty")?.classList.toggle("hidden", visible.length > 0);

    if ($("countBadge")) $("countBadge").textContent = `${state.diets.length} دايت`;
    if ($("totalStat")) $("totalStat").textContent = state.diets.length;
    if ($("mineStat")) {
      $("mineStat").textContent = state.diets.filter((diet) => diet.created_by === state.user.id).length;
    }
    if ($("publicStat")) {
      $("publicStat").textContent = state.diets.filter((diet) => diet.visibility === "public").length;
    }

    $("loadMoreDiets")?.remove();

    if (visible.length < filtered.length) {
      const button = document.createElement("button");
      button.id = "loadMoreDiets";
      button.type = "button";
      button.className = "mx-auto mt-5 block rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50";
      button.innerHTML = '<i class="fa-solid fa-chevron-down ml-1"></i> عرض المزيد';
      button.onclick = () => {
        state.renderLimit += 40;
        renderDiets();
      };
      grid.insertAdjacentElement("afterend", button);
    }
  }

  function summaryMetric(label, value, unit, tone) {
    const tones = {
      amber: "bg-amber-50 text-amber-700",
      slate: "bg-slate-100 text-slate-700",
      emerald: "bg-emerald-50 text-emerald-700"
    };

    return `
      <div class="rounded-xl ${tones[tone] || tones.slate} p-3">
        <div class="text-[10px] font-bold opacity-70">${label}</div>
        <div class="mt-1 text-sm font-extrabold">${num(value)} <span class="text-[9px] font-bold opacity-70">${unit}</span></div>
      </div>
    `;
  }

  function dietCard(diet) {
    const mine = diet.created_by === state.user.id;
    const published = diet.visibility === "public";
    const author = state.authors[diet.created_by] || "";
    const authorText = author
      ? `نشر بواسطة <strong class="text-slate-600">د. ${esc(author)}</strong>`
      : "نشر بواسطة طبيب";

    return `
      <article class="glass overflow-hidden rounded-3xl">
        <div class="border-b border-slate-100 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap gap-2">
                <span class="rounded-full ${published ? "bg-indigo-50 text-indigo-600" : "bg-brand-50 text-brand-700"} px-2.5 py-1 text-[10px] font-extrabold">${published ? "منشور" : "خاص"}</span>
                ${mine ? '<span class="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">ملكي</span>' : ""}
              </div>
              <h3 class="mt-3 text-lg font-extrabold text-slate-800">${esc(diet.name)}</h3>
              <p class="mt-1 text-xs text-slate-400 line-clamp-2">${esc(diet.description || "بدون وصف")}</p>
              ${published ? `<div class="mt-3 flex items-center gap-2 text-[10px] text-slate-400"><span class="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"><i class="fa-solid fa-user-doctor"></i></span><span>${authorText}</span></div>` : ""}
            </div>
            <i class="fa-solid fa-utensils text-2xl text-brand-100"></i>
          </div>
          <div class="mt-5 grid grid-cols-4 gap-2">
            ${summaryMetric("سعرات", diet.target_calories, "kcal", "amber")}
            ${summaryMetric("بروتين", diet.target_protein, "g", "slate")}
            ${summaryMetric("كارب", diet.target_carb, "g", "amber")}
            ${summaryMetric("دهون", diet.target_fat, "g", "emerald")}
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 bg-slate-50/70 p-4">
          <div class="flex flex-wrap gap-2">
            <button data-open="${esc(diet.id)}" class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><i class="fa-solid fa-eye ml-1"></i> فتح الدايت</button>
            <button data-duplicate="${esc(diet.id)}" class="rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200"><i class="fa-solid fa-copy ml-1"></i> نسخ</button>
            ${mine ? `
              <button data-edit="${esc(diet.id)}" class="rounded-xl bg-brand-600 px-3 py-2 text-[11px] font-bold text-white"><i class="fa-solid fa-pen ml-1"></i> تعديل</button>
              <button data-del="${esc(diet.id)}" class="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600 ring-1 ring-red-100"><i class="fa-solid fa-trash ml-1"></i> حذف</button>
            ` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function openModal(id, display = "flex") {
    const modal = $(id);
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add(display);
  }

  function closeModal(id, display = "flex") {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove(display);
  }

  function resetEditor() {
    state.editingId = null;
    state.activeMealIndex = null;
    state.selectedFood = null;
    state.day = { day_number: 1, day_name: "اليوم", meals: [] };

    if ($("editorTitle")) $("editorTitle").textContent = "إنشاء دايت جديد";
    if ($("dietName")) $("dietName").value = "";
    if ($("description")) $("description").value = "";
    if ($("notes")) $("notes").value = "";
    if ($("visibility")) $("visibility").value = "private";
    if ($("dietAccess")) $("dietAccess").value = "";
    renderDay();
  }

  async function openEditor(id = null) {
    const action = id ? "update" : "add";
    const message = id ? "ليس لديك صلاحية تعديل الدايت." : "ليس لديك صلاحية إنشاء دايت.";
    if (!(await requireAccess(action, message))) return;

    resetEditor();

    if (id) {
      const diet = state.diets.find((item) => String(item.id) === String(id));
      if (!diet) return;

      state.editingId = id;
      if ($("editorTitle")) $("editorTitle").textContent = "تعديل الدايت";
      if ($("dietName")) $("dietName").value = diet.name || "";
      if ($("description")) $("description").value = diet.description || "";
      if ($("notes")) $("notes").value = diet.notes || "";
      if ($("visibility")) $("visibility").value = diet.visibility || "private";
      if ($("dietAccess")) $("dietAccess").value = diet.required_feature || "";
      await loadDietStructure(id);
    }

    openModal("editor", "flex");
  }

  async function loadDietStructure(id) {
    try {
      const { data: days, error } = await withTimeout(
        supabase.from("diet_template_days").select("id,day_number,day_name").eq("template_id", id).order("day_number", { ascending: true }),
        10000,
        "انتهت مهلة تحميل أيام الدايت."
      );
      if (error) throw error;

      const day = days?.[0];
      if (!day) return;

      const { data: meals, error: mealsError } = await withTimeout(
        supabase.from("diet_template_meals").select("id,meal_name,meal_order").eq("day_id", day.id).order("meal_order", { ascending: true }),
        10000,
        "انتهت مهلة تحميل وجبات الدايت."
      );
      if (mealsError) throw mealsError;

      const mealIds = (meals || []).map((meal) => meal.id);
      let items = [];

      if (mealIds.length) {
        const { data, error: itemsError } = await withTimeout(
          supabase.from("diet_template_items").select("id,meal_id,food_id,quantity,unit,repeat_count,notes").in("meal_id", mealIds).order("id", { ascending: true }),
          10000,
          "انتهت مهلة تحميل أصناف الدايت."
        );
        if (itemsError) throw itemsError;
        items = data || [];
      }

      state.day = {
        day_number: day.day_number || 1,
        day_name: day.day_name || "اليوم",
        meals: (meals || []).map((meal) => ({
          id: meal.id,
          name: meal.meal_name || "وجبة",
          items: items.filter((item) => item.meal_id === meal.id).map((item) => ({
            id: item.id,
            food_id: item.food_id,
            quantity: num(item.quantity),
            unit: item.unit || "g",
            repeat_count: num(item.repeat_count) || 1,
            notes: item.notes || ""
          }))
        }))
      };

      renderDay();
    } catch (error) {
      console.error("Diet structure load failed:", error);
      toast(`تعذر تحميل تفاصيل الدايت: ${error.message}`, false);
    }
  }

  function renderDay() {
    const container = $("mealsEditor");
    if (!container) return;

    container.innerHTML = state.day.meals.map((meal, mealIndex) => `
      <div class="rounded-2xl border border-slate-200 bg-white p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input value="${esc(meal.name)}" data-meal-name="${mealIndex}" class="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
          <div class="flex flex-wrap gap-2">
            <button type="button" data-add-food="${mealIndex}" class="rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700">إضافة صنف</button>
            <button type="button" data-move-meal="${mealIndex}:up" class="rounded-xl bg-slate-100 px-3 py-2 text-xs">↑</button>
            <button type="button" data-move-meal="${mealIndex}:down" class="rounded-xl bg-slate-100 px-3 py-2 text-xs">↓</button>
            <button type="button" data-remove-meal="${mealIndex}" class="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">حذف</button>
          </div>
        </div>
        <div class="mt-3 space-y-2">${meal.items.map((item, itemIndex) => renderItem(item, mealIndex, itemIndex)).join("")}</div>
      </div>
    `).join("");

    updateSummary();
  }

  function renderItem(item, mealIndex, itemIndex) {
    const food = state.foods.find((entry) => String(entry.id) === String(item.food_id));
    if (!food) return `<div class="rounded-xl bg-red-50 p-3 text-xs text-red-600">الصنف غير موجود في مكتبة الأغذية.</div>`;

    return `
      <div class="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_110px_110px_auto] sm:items-center">
        <div><div class="text-sm font-bold text-slate-700">${esc(food.name_ar || food.name_en || "صنف")}</div><div class="mt-1 text-[10px] text-slate-400">${num(food.kcal)} kcal / 100g</div></div>
        <input type="number" min="0" step="0.1" value="${num(item.quantity)}" data-item-quantity="${mealIndex}:${itemIndex}" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
        <input type="number" min="1" step="1" value="${num(item.repeat_count) || 1}" data-item-repeat="${mealIndex}:${itemIndex}" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
        <button type="button" data-remove-item="${mealIndex}:${itemIndex}" class="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">حذف</button>
      </div>
    `;
  }

  function updateSummary() {
    const totals = { kcal: 0, protein: 0, carb: 0, fat: 0, sodium: 0, potassium: 0, phosphorus: 0 };

    state.day.meals.forEach((meal) => {
      meal.items.forEach((item) => {
        const food = state.foods.find((entry) => String(entry.id) === String(item.food_id));
        if (!food) return;

        const factor = (num(item.quantity) / 100) * (num(item.repeat_count) || 1);
        totals.kcal += num(food.kcal) * factor;
        totals.protein += num(food.protein) * factor;
        totals.carb += num(food.carb) * factor;
        totals.fat += num(food.fat) * factor;
        totals.sodium += num(food.sodium) * factor;
        totals.potassium += num(food.potassium) * factor;
        totals.phosphorus += num(food.phosphorus) * factor;
      });
    });

    const summary = $("dailySummary");
    if (!summary) return;

    summary.innerHTML = [
      summaryMetric("سعرات", totals.kcal.toFixed(0), "kcal", "amber"),
      summaryMetric("بروتين", totals.protein.toFixed(1), "g", "slate"),
      summaryMetric("كارب", totals.carb.toFixed(1), "g", "amber"),
      summaryMetric("دهون", totals.fat.toFixed(1), "g", "emerald"),
      summaryMetric("صوديوم", totals.sodium.toFixed(0), "mg", "slate"),
      summaryMetric("بوتاسيوم", totals.potassium.toFixed(0), "mg", "slate"),
      summaryMetric("فوسفور", totals.phosphorus.toFixed(0), "mg", "slate")
    ].join("");
  }

  function openConfirm(title, message, onConfirm) {
    const modal = $("confirmModal");
    if (!modal) {
      if (window.confirm(message)) onConfirm();
      return;
    }

    if ($("confirmTitle")) $("confirmTitle").textContent = title;
    if ($("confirmMessage")) $("confirmMessage").textContent = message;
    openModal("confirmModal", "flex");

    const confirmButton = $("confirmAction");
    if (!confirmButton) return;

    confirmButton.onclick = () => {
      closeModal("confirmModal", "flex");
      onConfirm();
    };
  }

  async function saveDiet() {
    const action = state.editingId ? "update" : "add";
    const message = state.editingId ? "ليس لديك صلاحية تعديل الدايت." : "ليس لديك صلاحية إنشاء دايت.";
    if (!(await requireAccess(action, message))) return;

    const name = $("dietName")?.value.trim();
    if (!name) {
      toast("اكتب اسم الدايت أولًا.", false);
      return;
    }

    const payload = {
      id: state.editingId || null,
      name,
      description: $("description")?.value.trim() || null,
      notes: $("notes")?.value.trim() || null,
      visibility: $("visibility")?.value || "private",
      required_feature: $("dietAccess")?.value || null,
      day: state.day
    };

    const button = $("saveDiet");
    if (button) {
      button.disabled = true;
      button.classList.add("opacity-60", "pointer-events-none");
    }

    try {
      const { error } = await withTimeout(
        supabase.rpc("save_diet_template", { p_payload: payload }),
        20000,
        "انتهت مهلة حفظ الدايت."
      );
      if (error) throw error;

      clearCache("diets");
      closeModal("editor", "flex");
      toast("تم حفظ الدايت بنجاح.");
      await loadDiets(true);
    } catch (error) {
      console.error("Diet save failed:", error);
      toast(`تعذر حفظ الدايت: ${error.message}`, false);
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove("opacity-60", "pointer-events-none");
      }
    }
  }

  async function duplicateDiet(id) {
    if (!(await requireAccess("add", "ليس لديك صلاحية إنشاء نسخة من الدايت."))) return;

    const source = state.diets.find((diet) => String(diet.id) === String(id));
    if (!source) return;

    state.editingId = null;
    if ($("editorTitle")) $("editorTitle").textContent = "نسخ الدايت";
    if ($("dietName")) $("dietName").value = `${source.name} - نسخة`;
    if ($("description")) $("description").value = source.description || "";
    if ($("notes")) $("notes").value = source.notes || "";
    if ($("visibility")) $("visibility").value = "private";
    if ($("dietAccess")) $("dietAccess").value = "";

    await loadDietStructure(id);
    openModal("editor", "flex");
  }

  async function deleteDiet(id) {
    if (!(await requireAccess("delete", "ليس لديك صلاحية حذف الدايت."))) return;

    openConfirm("حذف الدايت", "هل أنت متأكد من حذف هذا القالب بكل بياناته؟", async () => {
      try {
        const { error } = await withTimeout(
          supabase.from("diet_templates").delete().eq("id", id),
          15000,
          "انتهت مهلة حذف الدايت."
        );
        if (error) throw error;

        clearCache("diets");
        toast("تم حذف الدايت.");
        await loadDiets(true);
      } catch (error) {
        console.error("Diet delete failed:", error);
        toast(`تعذر حذف الدايت: ${error.message}`, false);
      }
    });
  }

  function bindEvents() {
    $("newBtn")?.addEventListener("click", () => openEditor());
    $("cancelEditor")?.addEventListener("click", () => closeModal("editor", "flex"));
    $("saveDiet")?.addEventListener("click", saveDiet);
    $("addMeal")?.addEventListener("click", () => {
      state.day.meals.push({ name: `وجبة ${state.day.meals.length + 1}`, items: [] });
      renderDay();
    });
    $("refreshBtn")?.addEventListener("click", () => loadDiets(true));
    $("search")?.addEventListener("input", () => {
      state.renderLimit = 40;
      renderDiets();
    });
    $("visibilityFilter")?.addEventListener("change", () => {
      state.renderLimit = 40;
      renderDiets();
    });
    $("closePicker")?.addEventListener("click", () => closeModal("foodPicker", "flex"));

    $("dietGrid")?.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.dataset.open) {
        await openEditor(button.dataset.open);
        return;
      }
      if (button.dataset.duplicate) {
        await duplicateDiet(button.dataset.duplicate);
        return;
      }
      if (button.dataset.edit) {
        await openEditor(button.dataset.edit);
        return;
      }
      if (button.dataset.del) await deleteDiet(button.dataset.del);
    });

    $("mealsEditor")?.addEventListener("input", (event) => {
      const mealIndex = event.target.dataset.mealName;
      const quantity = event.target.dataset.itemQuantity;
      const repeat = event.target.dataset.itemRepeat;

      if (mealIndex !== undefined) state.day.meals[Number(mealIndex)].name = event.target.value;
      if (quantity) {
        const [meal, item] = quantity.split(":").map(Number);
        state.day.meals[meal].items[item].quantity = num(event.target.value);
        updateSummary();
      }
      if (repeat) {
        const [meal, item] = repeat.split(":").map(Number);
        state.day.meals[meal].items[item].repeat_count = num(event.target.value) || 1;
        updateSummary();
      }
    });

    $("mealsEditor")?.addEventListener("click", async (event) => {
      let button = event.target.closest("[data-add-food]");
      if (button) {
        state.activeMealIndex = Number(button.dataset.addFood);
        await openFoodPicker();
        return;
      }

      button = event.target.closest("[data-remove-item]");
      if (button) {
        const [mealIndex, itemIndex] = button.dataset.removeItem.split(":").map(Number);
        openConfirm("حذف الصنف", "هل أنت متأكد من حذف هذا الصنف من الوجبة؟", () => {
          state.day.meals[mealIndex].items.splice(itemIndex, 1);
          renderDay();
        });
        return;
      }

      button = event.target.closest("[data-remove-meal]");
      if (button) {
        const mealIndex = Number(button.dataset.removeMeal);
        openConfirm("حذف الوجبة", "هل أنت متأكد من حذف الوجبة بكل أصنافها؟", () => {
          state.day.meals.splice(mealIndex, 1);
          renderDay();
        });
        return;
      }

      button = event.target.closest("[data-move-meal]");
      if (button) {
        const [mealIndex, direction] = button.dataset.moveMeal.split(":");
        const from = Number(mealIndex);
        const to = direction === "up" ? from - 1 : from + 1;
        if (to < 0 || to >= state.day.meals.length) return;
        [state.day.meals[from], state.day.meals[to]] = [state.day.meals[to], state.day.meals[from]];
        renderDay();
      }
    });
  }

  async function openFoodPicker() {
    if (!state.foods.length && !(await loadFoods())) return;

    const list = $("foodList");
    if (list) {
      list.innerHTML = state.foods.map((food) => `
        <button type="button" data-food-id="${esc(food.id)}" class="block w-full rounded-xl border border-slate-100 bg-white p-3 text-right hover:bg-slate-50">
          <div class="font-bold text-sm">${esc(food.name_ar || food.name_en || "صنف")}</div>
          <div class="mt-1 text-[10px] text-slate-400">${num(food.kcal)} kcal / 100g</div>
        </button>
      `).join("");
    }

    openModal("foodPicker", "flex");
  }

  $("foodList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-food-id]");
    if (!button) return;

    const food = state.foods.find((item) => String(item.id) === String(button.dataset.foodId));
    if (!food || state.activeMealIndex === null) return;

    state.day.meals[state.activeMealIndex].items.push({
      food_id: food.id,
      quantity: 100,
      unit: "g",
      repeat_count: 1,
      notes: ""
    });

    closeModal("foodPicker", "flex");
    renderDay();
  });

  async function initialize() {
    try {
      state.user = await getCurrentUser();

      if (!state.user) {
        location.replace("index.html");
        return;
      }

      const permissions = await getPageAccess();
      if (permissions?.read !== true) {
        toast("ليس لديك صلاحية قراءة مكتبة الدايت.", false);
        setTimeout(() => location.replace("index.html"), 700);
        return;
      }

      bindEvents();
      await loadDiets();
    } catch (error) {
      console.error("Diet page initialization failed:", error);
      toast("تعذر تشغيل صفحة مكتبة الدايت.", false);
    } finally {
      $("loading")?.style.setProperty("display", "none");
    }
  }

  initialize();
})();
