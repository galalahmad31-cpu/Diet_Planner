(() => {
  'use strict';

  /*
   * Products page
   *
   * Permission architecture:
   * - Backend/Supabase decides permissions.
   * - This page consumes only permission results.
   * - No role/admin/subscription/quota logic lives here.
   * - RLS remains the final security boundary.
   */

  const sb = window.DietPlannerSupabase?.client;
  const auth = window.DietPlannerAuth;
  const access = window.DietPlannerAccess;

  const state = {
    categories: [],
    subcategories: [],
    products: [],
    formulas: [],
    category: '',
    subcategory: '',
    search: '',
    editor: { mode: null, productId: null, formulas: [] },
    pendingDelete: null,
    categoryManagerType: null
  };

  let uiAccess = { read: false, add: false, update: false, delete: false };
  let richEditorSelection = null;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const fmt = value => value == null || value === ''
    ? '—'
    : Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 });

  const RICH_TEXT_TAGS = new Set(['A','B','BR','DIV','EM','I','P','SPAN','STRONG','U','UL','OL','LI']);
  const RICH_TEXT_STYLES = new Set(['color','font-size','text-align','direction']);

  function normalizeLegacyFontTags(root) {
    root.querySelectorAll('font').forEach(font => {
      const span = document.createElement('span');
      const styles = [];
      const sizeMap = {
        '1': '0.75rem', '2': '0.875rem', '3': '1rem', '4': '1.125rem',
        '5': '1.25rem', '6': '1.5rem', '7': '1.75rem'
      };
      const size = font.getAttribute('size');
      const color = font.getAttribute('color');

      if (sizeMap[size]) styles.push(`font-size:${sizeMap[size]}`);
      if (color && !/[<>]/.test(color)) styles.push(`color:${color}`);
      if (styles.length) span.setAttribute('style', styles.join(';'));

      while (font.firstChild) span.appendChild(font.firstChild);
      font.replaceWith(span);
    });
  }

  function sanitizeRichText(value) {
    const source = String(value ?? '');
    if (!source.trim()) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    normalizeLegacyFontTags(root);

    const cleanNode = node => {
      Array.from(node.childNodes).forEach(child => {
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
          return;
        }
        if (child.nodeType === Node.TEXT_NODE) return;

        if (child.nodeType !== Node.ELEMENT_NODE || !RICH_TEXT_TAGS.has(child.tagName)) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          child.remove();
          return;
        }

        Array.from(child.attributes).forEach(attr => {
          if (child.tagName === 'A' && attr.name === 'href') {
            const href = attr.value.trim();
            if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute('href');
          } else if (child.tagName === 'A' && (attr.name === 'target' || attr.name === 'rel')) {
            return;
          } else if (attr.name === 'style') {
            const allowed = [];
            attr.value.split(';').forEach(rule => {
              const parts = rule.split(':');
              if (parts.length < 2) return;
              const property = parts.shift().trim().toLowerCase();
              const propertyValue = parts.join(':').trim();
              if (RICH_TEXT_STYLES.has(property) && !/[<>]/.test(propertyValue)) {
                allowed.push(`${property}:${propertyValue}`);
              }
            });
            if (allowed.length) child.setAttribute('style', allowed.join(';'));
            else child.removeAttribute('style');
          } else if (attr.name !== 'dir') {
            child.removeAttribute(attr.name);
          }
        });

        if (child.tagName === 'A' && child.hasAttribute('href')) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }

        cleanNode(child);
      });
    };

    cleanNode(root);
    return root.innerHTML;
  }

  function richTextForEditor(value) {
    const source = String(value ?? '');
    if (!source.trim()) return '';
    if (/<[a-z][\s\S]*>/i.test(source)) return sanitizeRichText(source);
    return esc(source).replace(/\r?\n/g, '<br>');
  }

  function richTextForDisplay(value) {
    return sanitizeRichText(richTextForEditor(value));
  }

  function richTextToPlain(value) {
    const box = document.createElement('div');
    box.innerHTML = richTextForDisplay(value);
    return (box.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function richEditorMarkup(id, value = '', placeholder = 'اكتب الملاحظات هنا...') {
    return `
      <div class="rich-editor-toolbar" data-rich-editor-toolbar="${esc(id)}">
        <button type="button" data-editor-action="bold" title="عريض"><i class="fa-solid fa-bold"></i></button>
        <button type="button" data-editor-action="italic" title="مائل"><i class="fa-solid fa-italic"></i></button>
        <button type="button" data-editor-action="underline" title="تحته خط"><i class="fa-solid fa-underline"></i></button>
        <select data-editor-action="fontSize" title="حجم الخط">
          <option value="3">حجم</option><option value="2">صغير</option>
          <option value="3">متوسط</option><option value="4">كبير</option><option value="5">كبير جدًا</option>
        </select>
        <button type="button" data-editor-action="fontSizeIncrease" title="تكبير الخط">A<sup>+</sup></button>
        <button type="button" data-editor-action="fontSizeDecrease" title="تصغير الخط">A<sup>−</sup></button>
        <input type="color" data-editor-action="foreColor" value="#334155" title="لون النص">
        <button type="button" data-editor-action="rtl" title="من اليمين إلى اليسار"><i class="fa-solid fa-align-right"></i></button>
        <button type="button" data-editor-action="ltr" title="من اليسار إلى اليمين"><i class="fa-solid fa-align-left"></i></button>
        <button type="button" data-editor-action="justifyRight" title="محاذاة يمين"><i class="fa-solid fa-align-right"></i></button>
        <button type="button" data-editor-action="justifyLeft" title="محاذاة يسار"><i class="fa-solid fa-align-left"></i></button>
        <button type="button" data-editor-action="link" title="إضافة رابط"><i class="fa-solid fa-link"></i></button>
        <button type="button" data-editor-action="unlink" title="إزالة الرابط"><i class="fa-solid fa-link-slash"></i></button>
      </div>
      <div id="${esc(id)}Editor" class="rich-editor-surface" contenteditable="true" spellcheck="true" dir="auto" data-placeholder="${esc(placeholder)}">${richTextForEditor(value)}</div>`;
  }

  function getRichEditorValue(id) {
    const editor = $(`${id}Editor`);
    return editor ? sanitizeRichText(editor.innerHTML).trim() || null : null;
  }

  function setRichEditorValue(id, value) {
    const editor = $(`${id}Editor`);
    if (editor) editor.innerHTML = richTextForEditor(value);
  }

  function rememberRichEditorSelection(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
    richEditorSelection = { editor, range: selection.getRangeAt(0).cloneRange() };
  }

  function restoreRichEditorSelection(editor) {
    if (!richEditorSelection || richEditorSelection.editor !== editor) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(richEditorSelection.range);
  }

  function execRichEditorCommand(editor, command, value = null) {
    editor.focus();
    restoreRichEditorSelection(editor);
    if (command === 'fontSize' || command === 'foreColor') {
      document.execCommand('styleWithCSS', false, true);
    }
    document.execCommand(command, false, value);
    rememberRichEditorSelection(editor);
  }

  function adjustRichEditorFontSize(editor, step) {
    editor.focus();
    restoreRichEditorSelection(editor);
    const current = parseInt(document.queryCommandValue('fontSize'), 10);
    const base = Number.isFinite(current) && current >= 1 && current <= 7 ? current : 3;
    const next = Math.max(1, Math.min(7, base + step));
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, String(next));
    rememberRichEditorSelection(editor);
  }

  function setRichEditorDirection(editor, direction) {
    editor.focus();
    restoreRichEditorSelection(editor);
    document.execCommand('formatBlock', false, 'div');
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    Array.from(editor.querySelectorAll('div, p, li')).forEach(block => {
      try {
        if (!range.intersectsNode(block)) return;
        block.setAttribute('dir', direction);
        block.style.direction = direction;
        block.style.textAlign = direction === 'rtl' ? 'right' : 'left';
      } catch (_) {}
    });
    rememberRichEditorSelection(editor);
  }

  function handleRichEditorAction(action, editor, control) {
    if (!editor) return;
    if (['bold','italic','underline','justifyLeft','justifyRight'].includes(action)) {
      execRichEditorCommand(editor, action);
    } else if (action === 'fontSize') {
      execRichEditorCommand(editor, 'fontSize', control.value);
    } else if (action === 'fontSizeIncrease') {
      adjustRichEditorFontSize(editor, 1);
    } else if (action === 'fontSizeDecrease') {
      adjustRichEditorFontSize(editor, -1);
    } else if (action === 'foreColor') {
      execRichEditorCommand(editor, 'foreColor', control.value);
    } else if (action === 'rtl' || action === 'ltr') {
      setRichEditorDirection(editor, action === 'rtl' ? 'rtl' : 'ltr');
    } else if (action === 'link') {
      rememberRichEditorSelection(editor);
      openRichLinkModal(editor);
    } else if (action === 'unlink') {
      execRichEditorCommand(editor, 'unlink');
    }
  }

  function initRichEditors(root = document) {
    root.querySelectorAll('[data-rich-editor]').forEach(wrapper => {
      if (wrapper.dataset.richEditorReady === 'true') return;
      wrapper.dataset.richEditorReady = 'true';
      const id = wrapper.id || wrapper.dataset.richEditor;
      if (!id) return;
      wrapper.id = id;
      wrapper.innerHTML = richEditorMarkup(id, wrapper.dataset.initialValue || '');
    });
  }

  function openRichLinkModal(editor) {
    const modal = $('richLinkModal');
    const input = $('richLinkInput');
    if (!modal || !input) return;
    if (!richEditorSelection || richEditorSelection.editor !== editor) rememberRichEditorSelection(editor);
    input.value = '';
    modal.style.display = 'flex';
    input.focus();
  }

  function closeRichLinkModal() {
    if ($('richLinkModal')) $('richLinkModal').style.display = 'none';
  }

  function applyRichLink() {
    const input = $('richLinkInput');
    const editor = richEditorSelection?.editor;
    if (!input || !editor) return;
    const value = input.value.trim();
    if (!value) return input.focus();
    const url = /^(https?:|mailto:)/i.test(value) ? value : `https://${value}`;
    closeRichLinkModal();
    execRichEditorCommand(editor, 'createLink', url);
  }

  function setState(message, showGrid = false) {
    $('state').textContent = message;
    $('state').style.display = showGrid ? 'none' : 'block';
    $('productsGrid').style.display = showGrid ? 'grid' : 'none';
  }

  function option(label, value, selected = false) {
    return `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  }

  function showToast(message, ok = true) {
    const el = $('toast');
    el.textContent = message;
    el.className = `fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-extrabold text-white shadow-xl ${ok ? 'bg-emerald-600' : 'bg-rose-600'}`;
    el.style.display = 'block';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { el.style.display = 'none'; }, 3200);
  }

  async function getProductsAccess() {
    const result = await access?.getPageAccess?.('products');
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return { read: false, add: false, update: false, delete: false };
    }
    return result;
  }

  function populateCategories() {
    const usedSubcategoryIds = new Set(state.products.map(p => p.subcategory_id).filter(Boolean));
    const usedCategoryIds = new Set(
      state.subcategories.filter(s => usedSubcategoryIds.has(s.id)).map(s => s.category_id).filter(Boolean)
    );

    const categories = state.categories.filter(c => uiAccess.add || usedCategoryIds.has(c.id));
    $('categoryFilter').innerHTML = option('كل الأقسام', '') +
      categories.map(c => option(c.name, c.id, c.id === state.category)).join('');

    const activeSubs = state.subcategories.filter(s =>
      (uiAccess.add || usedSubcategoryIds.has(s.id)) &&
      (!state.category || s.category_id === state.category)
    );

    if (!activeSubs.some(s => s.id === state.subcategory)) state.subcategory = '';
    $('subcategoryFilter').innerHTML = option('كل الأقسام الفرعية', '') +
      activeSubs.map(s => option(s.name, s.id, s.id === state.subcategory)).join('');
  }

  function populateFormCategories(selectedCategory = '', selectedSubcategory = '') {
    $('formCategory').innerHTML = option('اختر القسم الرئيسي', '') +
      state.categories.map(c => option(c.name, c.id, c.id === selectedCategory)).join('');
    refreshFormSubcategories(selectedSubcategory);
  }

  function refreshFormSubcategories(selectedSubcategory = null) {
    const categoryId = $('formCategory').value;
    const current = selectedSubcategory ?? $('formSubcategory').value;
    const subs = state.subcategories.filter(s => s.category_id === categoryId);
    $('formSubcategory').innerHTML = option('اختر القسم الفرعي', '') +
      subs.map(s => option(s.name, s.id, s.id === current)).join('');
    if (!subs.some(s => s.id === current)) $('formSubcategory').value = '';
  }

  function populateSubcategoryParentSelect(selectedId = '') {
    $('subcategoryParentSelect').innerHTML = option('اختر القسم الرئيسي', '') +
      state.categories.map(c => option(c.name, c.id, c.id === selectedId)).join('');
  }

  function openCategoryModal(type) {
    if (uiAccess.add !== true) return;
    state.categoryManagerType = type;
    const isSub = type === 'subcategory';
    $('categoryModalTitle').textContent = isSub ? 'إضافة قسم فرعي جديد' : 'إضافة قسم رئيسي جديد';
    $('categoryModalHint').textContent = isSub
      ? 'اختر القسم الرئيسي ثم اكتب اسم القسم الفرعي.'
      : 'اكتب اسم القسم الرئيسي الجديد.';
    $('subcategoryParentWrap').classList.toggle('hidden', !isSub);
    $('subcategoryParentSelect').required = isSub;
    $('categoryNameInput').value = '';
    populateSubcategoryParentSelect($('formCategory').value || '');
    $('categoryModal').style.display = 'flex';
    $('categoryNameInput').focus();
  }

  function closeCategoryModal() {
    $('categoryModal').style.display = 'none';
    $('categoryForm').reset();
    state.categoryManagerType = null;
  }

  async function saveNewCategory(event) {
    event.preventDefault();
    const permission = await getProductsAccess();
    if (permission.add !== true) {
      showToast('ليس لديك صلاحية الإضافة.', false);
      return;
    }

    const name = $('categoryNameInput').value.trim();
    const type = state.categoryManagerType;
    if (!name || !type) return;

    const payload = type === 'category'
      ? { name, sort_order: 0, is_active: true }
      : { name, category_id: $('subcategoryParentSelect').value, sort_order: 0, is_active: true };

    if (type === 'subcategory' && !payload.category_id) {
      showToast('اختر القسم الرئيسي أولاً.', false);
      return;
    }

    const button = $('saveCategoryBtn');
    button.disabled = true;
    button.textContent = 'جاري الإضافة...';

    try {
      const table = type === 'category' ? 'product_categories' : 'product_subcategories';
      const { data, error } = await sb.from(table).insert(payload).select('id').single();
      if (error) throw error;

      await loadData();
      populateCategories();
      if (type === 'category') {
        populateFormCategories(data.id, '');
        $('formCategory').value = data.id;
        refreshFormSubcategories();
      } else {
        populateFormCategories(payload.category_id, data.id);
      }
      closeCategoryModal();
      showToast(type === 'category' ? 'تمت إضافة القسم الرئيسي.' : 'تمت إضافة القسم الفرعي.');
    } catch (error) {
      console.error('Category creation failed:', error);
      showToast(error.message || 'تعذر إضافة القسم.', false);
    } finally {
      button.disabled = false;
      button.textContent = 'إضافة';
    }
  }

  function filtered() {
    const q = state.search.toLowerCase();
    return state.products.filter(product => {
      if (state.subcategory && product.subcategory_id !== state.subcategory) return false;
      if (state.category) {
        const sub = state.subcategories.find(item => item.id === product.subcategory_id);
        if (sub?.category_id !== state.category) return false;
      }
      const searchable = [product.product_name, product.usage, richTextToPlain(product.notes)]
        .join(' ').toLowerCase();
      return !q || searchable.includes(q);
    });
  }

  function productFormulaRows(productId) {
    return state.formulas
      .filter(formula => formula.product_id === productId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  function render(accessResult = uiAccess) {
    const rows = filtered();
    $('resultCount').textContent = `عرض ${rows.length} منتج`;

    if (!rows.length) {
      setState('لا توجد منتجات مطابقة للتصفية.');
      return;
    }

    $('productsGrid').innerHTML = rows.map(product => {
      const sub = state.subcategories.find(item => item.id === product.subcategory_id);
      const cat = sub && state.categories.find(item => item.id === sub.category_id);
      const formulas = productFormulaRows(product.id);
      const managementActions = accessResult.update || accessResult.delete
        ? `<div class="flex shrink-0 gap-2">
            ${accessResult.update ? `<button type="button" data-action="edit-product" data-id="${esc(product.id)}" class="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100" title="تعديل"><i class="fa-solid fa-pen"></i></button>` : ''}
            ${accessResult.delete ? `<button type="button" data-action="delete-product" data-id="${esc(product.id)}" class="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100" title="حذف"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>`
        : '';

      const formulaHtml = formulas.length
        ? formulas.map(formula => `<div class="mt-3 rounded-2xl border border-slate-100 bg-white p-3">
            <div class="text-sm font-extrabold text-slate-800">${esc(formula.formula_name)}</div>
            <div class="mt-1 text-[10px] font-bold text-slate-400">${esc(formula.basis_amount != null ? `${fmt(formula.basis_amount)} ${formula.basis_unit || ''}` : 'أساس غير محدد')}</div>
            <div class="mt-3 grid grid-cols-4 gap-2 text-center">
              <div><div class="text-[10px] text-slate-400">السعرات</div><div class="mt-1 text-sm font-extrabold text-amber-600">${fmt(formula.kcal)}</div></div>
              <div><div class="text-[10px] text-slate-400">كارب</div><div class="mt-1 text-sm font-extrabold text-sky-600">${fmt(formula.carb)}</div></div>
              <div><div class="text-[10px] text-slate-400">بروتين</div><div class="mt-1 text-sm font-extrabold text-emerald-600">${fmt(formula.protein)}</div></div>
              <div><div class="text-[10px] text-slate-400">دهون</div><div class="mt-1 text-sm font-extrabold text-rose-600">${fmt(formula.fat)}</div></div>
            </div>
            ${formula.notes ? `<div class="rich-text-content mt-3 text-[11px] leading-5 text-slate-500">${richTextForDisplay(formula.notes)}</div>` : ''}
          </div>`).join('')
        : '<div class="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-400">لا توجد بيانات تركيبة لهذا المنتج.</div>';

      return `<article class="product-card glass rounded-3xl p-5 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><div class="text-xs font-bold text-brand-600">${esc(cat?.name || 'غير مصنف')} · ${esc(sub?.name || 'غير مصنف')}</div><h2 class="mt-1 text-lg font-extrabold text-slate-800">${esc(product.product_name)}</h2></div>
          ${managementActions}
        </div>
        <div class="mt-4 rounded-2xl bg-slate-50 p-3"><div class="text-xs font-bold text-slate-500">الاستخدام</div><div class="mt-1 text-sm font-semibold leading-6 text-slate-700">${esc(product.usage || '—')}</div></div>
        ${product.notes ? `<div class="rich-text-content mt-3 text-[11px] leading-5 text-slate-500">${richTextForDisplay(product.notes)}</div>` : ''}
        ${formulaHtml}
      </article>`;
    }).join('');

    setState('', true);
  }

  async function loadData() {
    const [categories, subcategories, products, formulas] = await Promise.all([
      sb.from('product_categories').select('*').eq('is_active', true).order('sort_order'),
      sb.from('product_subcategories').select('*').eq('is_active', true).order('sort_order'),
      sb.from('food_products').select('id,product_name,usage,notes,sort_order,subcategory_id,required_feature,is_active').eq('is_active', true).order('sort_order'),
      sb.from('food_product_formulas').select('id,product_id,formula_name,basis_amount,basis_unit,kcal,carb,protein,fat,notes,sort_order').order('sort_order')
    ]);

    if (categories.error) throw categories.error;
    if (subcategories.error) throw subcategories.error;
    if (products.error) throw products.error;
    if (formulas.error) throw formulas.error;

    state.categories = categories.data || [];
    state.subcategories = subcategories.data || [];
    state.products = products.data || [];
    state.formulas = formulas.data || [];
  }

  function createEmptyFormula() {
    return { id: null, formula_name: '', basis_amount: null, basis_unit: '', kcal: null, carb: null, protein: null, fat: null, notes: '', sort_order: 0 };
  }

  function normalizeFormula(formula) {
    return {
      id: formula?.id || null,
      formula_name: formula?.formula_name || '',
      basis_amount: formula?.basis_amount ?? null,
      basis_unit: formula?.basis_unit || '',
      kcal: formula?.kcal ?? null,
      carb: formula?.carb ?? null,
      protein: formula?.protein ?? null,
      fat: formula?.fat ?? null,
      notes: formula?.notes || '',
      sort_order: Number(formula?.sort_order ?? 0)
    };
  }

  function renderFormulaEditor() {
    const list = $('formulaList');
    const formulas = state.editor.formulas || [];
    if (!formulas.length) {
      list.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs font-semibold text-slate-400">لم تتم إضافة أي تركيبة بعد. اضغط «إضافة تركيبة» لإضافة أول تركيبة.</div>';
      return;
    }

    list.innerHTML = formulas.map((formula, index) => `
      <div class="formula-item" data-formula-index="${index}"${formula.id ? ` data-formula-id="${esc(formula.id)}"` : ''}>
        <div class="formula-item-header"><div class="formula-item-title">التركيبة ${index + 1}</div><button type="button" class="formula-remove" data-formula-action="remove" data-formula-index="${index}" title="حذف التركيبة"><i class="fa-solid fa-trash-can"></i></button></div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label class="field-label">اسم التركيبة *</label><input data-formula-field="formula_name" class="field-input" value="${esc(formula.formula_name)}" required></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">الكمية الأساسية</label><input data-formula-field="basis_amount" type="number" min="0" step="any" class="field-input" value="${formula.basis_amount == null ? '' : esc(formula.basis_amount)}"></div>
            <div><label class="field-label">وحدة الأساس</label><select data-formula-field="basis_unit" class="field-input"><option value="">بدون</option><option value="g" ${formula.basis_unit === 'g' ? 'selected' : ''}>g</option><option value="ml" ${formula.basis_unit === 'ml' ? 'selected' : ''}>ml</option><option value="serving" ${formula.basis_unit === 'serving' ? 'selected' : ''}>serving</option><option value="dose" ${formula.basis_unit === 'dose' ? 'selected' : ''}>dose</option></select></div>
          </div>
          <div><label class="field-label">السعرات (kcal)</label><input data-formula-field="kcal" type="number" step="any" class="field-input" value="${formula.kcal == null ? '' : esc(formula.kcal)}"></div>
          <div><label class="field-label">الكربوهيدرات (g)</label><input data-formula-field="carb" type="number" step="any" class="field-input" value="${formula.carb == null ? '' : esc(formula.carb)}"></div>
          <div><label class="field-label">البروتين (g)</label><input data-formula-field="protein" type="number" step="any" class="field-input" value="${formula.protein == null ? '' : esc(formula.protein)}"></div>
          <div><label class="field-label">الدهون (g)</label><input data-formula-field="fat" type="number" step="any" class="field-input" value="${formula.fat == null ? '' : esc(formula.fat)}"></div>
          <div class="md:col-span-2"><label class="field-label">ملاحظات التركيبة</label><div class="rich-editor" data-rich-editor="formula-notes-${index}" data-initial-value="${esc(formula.notes || '').replace(/\n/g, '&#10;')}"></div></div>
          <div><label class="field-label">الترتيب</label><input data-formula-field="sort_order" type="number" step="1" class="field-input" value="${Number(formula.sort_order || 0)}"></div>
        </div>
      </div>`).join('');

    initRichEditors(list);
  }

  function readFormulaRow(row) {
    const get = field => row.querySelector(`[data-formula-field="${field}"]`);
    const basisAmount = get('basis_amount').value === '' ? null : Number(get('basis_amount').value);
    const basisUnit = get('basis_unit').value || null;
    if ((basisAmount === null) !== (basisUnit === null)) throw new Error('يجب إدخال الكمية الأساسية ووحدة الأساس معًا، أو تركهما فارغين.');
    if (basisAmount !== null && basisAmount <= 0) throw new Error('الكمية الأساسية يجب أن تكون أكبر من صفر.');

    const numOrNull = field => get(field).value === '' ? null : Number(get(field).value);
    return {
      id: row.dataset.formulaId || null,
      formula_name: get('formula_name').value.trim(),
      basis_amount: basisAmount,
      basis_unit: basisUnit,
      kcal: numOrNull('kcal'), carb: numOrNull('carb'), protein: numOrNull('protein'), fat: numOrNull('fat'),
      notes: getRichEditorValue(`formula-notes-${row.dataset.formulaIndex}`),
      sort_order: Number(get('sort_order').value || 0)
    };
  }

  function readAllFormulaFields() {
    const formulas = Array.from($('formulaList').querySelectorAll('.formula-item')).map(readFormulaRow);
    if (!formulas.length) throw new Error('يجب إضافة تركيبة واحدة على الأقل.');
    const names = formulas.map(formula => formula.formula_name.toLowerCase());
    if (names.some(name => !name)) throw new Error('اسم التركيبة حقل مطلوب.');
    if (names.some((name, index) => names.indexOf(name) !== index)) throw new Error('لا يمكن تكرار اسم التركيبة داخل المنتج نفسه.');
    return formulas;
  }

  function syncFormulaEditor() {
    const rows = Array.from($('formulaList').querySelectorAll('.formula-item'));
    if (rows.length) state.editor.formulas = rows.map(readFormulaRow);
  }

  function addFormula(formula = null) {
    if (!formula) syncFormulaEditor();
    state.editor.formulas.push(normalizeFormula(formula || createEmptyFormula()));
    renderFormulaEditor();
    const index = state.editor.formulas.length - 1;
    $(`formulaList`).querySelector(`[data-formula-index="${index}"] [data-formula-field="formula_name"]`)?.focus();
  }

  async function openEditor(mode, productId = null) {
    const permission = await getProductsAccess();
    const allowed = mode === 'add-product' ? permission.add === true : permission.update === true;
    if (!allowed) {
      showToast('ليس لديك صلاحية تنفيذ هذه العملية.', false);
      return;
    }

    const product = productId ? state.products.find(item => item.id === productId) : null;
    const existing = product ? productFormulaRows(product.id).map(normalizeFormula) : [];
    state.editor = { mode, productId, formulas: existing.length ? existing : [createEmptyFormula()] };

    $('editorModal').style.display = 'flex';
    $('editorTitle').textContent = mode === 'add-product' ? 'إضافة صنف جديد' : 'تعديل بيانات الصنف';
    $('editorSubtitle').textContent = mode === 'add-product' ? 'أدخل بيانات الصنف وأضف تركيبة واحدة أو أكثر.' : 'يمكن للمنتج الواحد أن يحتوي على أكثر من تركيبة.';

    const sub = product?.subcategory_id ? state.subcategories.find(item => item.id === product.subcategory_id) : null;
    populateFormCategories(sub?.category_id || '', product?.subcategory_id || '');
    $('formProductName').value = product?.product_name || '';
    $('formUsage').value = product?.usage || '';
    setRichEditorValue('formProductNotes', product?.notes || '');
    $('formProductSort').value = product?.sort_order ?? 0;
    $('formRequiredFeature').value = product?.required_feature || 'product';
    $('formProductActive').checked = product ? !!product.is_active : true;
    renderFormulaEditor();
  }

  function closeEditor() {
    $('editorModal').style.display = 'none';
    state.editor = { mode: null, productId: null, formulas: [] };
  }

  async function openConfirm(id) {
    const permission = await getProductsAccess();
    if (permission.delete !== true) {
      showToast('ليس لديك صلاحية الحذف.', false);
      return;
    }

    state.pendingDelete = { id };
    const product = state.products.find(item => item.id === id);
    $('confirmTitle').textContent = 'تأكيد حذف الصنف';
    $('confirmMessage').textContent = `سيتم حذف الصنف «${product?.product_name || ''}» وتركيباته المرتبطة به. لا يمكن التراجع عن هذه العملية.`;
    $('confirmModal').style.display = 'flex';
  }

  function closeConfirm() {
    $('confirmModal').style.display = 'none';
    state.pendingDelete = null;
  }

  async function deletePending() {
    if (!state.pendingDelete) return;
    const permission = await getProductsAccess();
    if (permission.delete !== true) {
      closeConfirm();
      showToast('ليس لديك صلاحية الحذف.', false);
      return;
    }

    const { id } = state.pendingDelete;
    $('confirmDeleteBtn').disabled = true;
    $('confirmDeleteBtn').textContent = 'جاري الحذف...';

    try {
      const { error } = await sb.from('food_products').delete().eq('id', id);
      if (error) throw error;
      closeConfirm();
      await loadData();
      populateCategories();
      render(uiAccess);
      showToast('تم حذف الصنف وتركيبته.');
    } catch (error) {
      console.error('Product deletion failed:', error);
      showToast(error.message || 'تعذر تنفيذ الحذف.', false);
    } finally {
      $('confirmDeleteBtn').disabled = false;
      $('confirmDeleteBtn').textContent = 'حذف';
    }
  }

  async function saveProduct() {
    const { mode, productId } = state.editor;
    const permission = await getProductsAccess();
    const action = mode === 'add-product' ? 'add' : 'update';
    if (permission[action] !== true) throw new Error('ليس لديك صلاحية حفظ بيانات المنتجات.');

    const subcategoryId = $('formSubcategory').value;
    const name = $('formProductName').value.trim();
    if (!subcategoryId || !name) throw new Error('القسم الفرعي واسم الصنف حقول مطلوبة.');

    const productPayload = {
      product_name: name,
      usage: $('formUsage').value.trim() || null,
      notes: getRichEditorValue('formProductNotes'),
      sort_order: Number($('formProductSort').value || 0),
      required_feature: $('formRequiredFeature').value.trim() || 'product',
      subcategory_id: subcategoryId,
      is_active: $('formProductActive').checked
    };

    const formulas = readAllFormulaFields();

    if (mode === 'add-product') {
      const { data, error } = await sb.from('food_products').insert(productPayload).select('id').single();
      if (error) throw error;

      const formulaRows = formulas.map(({ id, ...formula }) => ({ ...formula, product_id: data.id }));
      const { error: formulaError } = await sb.from('food_product_formulas').insert(formulaRows);
      if (formulaError) {
        await sb.from('food_products').delete().eq('id', data.id);
        throw formulaError;
      }
      return;
    }

    const { error: productError } = await sb.from('food_products').update(productPayload).eq('id', productId);
    if (productError) throw productError;

    const existingIds = new Set(productFormulaRows(productId).map(formula => formula.id));
    const currentIds = new Set(formulas.map(formula => formula.id).filter(Boolean));
    const idsToDelete = [...existingIds].filter(id => !currentIds.has(id));

    if (idsToDelete.length) {
      const deletePermission = await getProductsAccess();
      if (deletePermission.delete !== true) throw new Error('ليس لديك صلاحية حذف التركيبات المحذوفة من المنتج.');
      const { error } = await sb.from('food_product_formulas').delete().in('id', idsToDelete).eq('product_id', productId);
      if (error) throw error;
    }

    for (const formula of formulas.filter(item => item.id)) {
      const { id, ...payload } = formula;
      const { error } = await sb.from('food_product_formulas').update(payload).eq('id', id).eq('product_id', productId);
      if (error) throw error;
    }

    const newFormulas = formulas.filter(item => !item.id);
    if (newFormulas.length) {
      const rows = newFormulas.map(({ id, ...formula }) => ({ ...formula, product_id: productId }));
      const { error } = await sb.from('food_product_formulas').insert(rows);
      if (error) throw error;
    }
  }

  async function saveEditor(event) {
    event.preventDefault();
    const button = $('saveEditorBtn');
    button.disabled = true;
    button.textContent = 'جاري الحفظ...';

    try {
      await saveProduct();
      closeEditor();
      await loadData();
      populateCategories();
      render(uiAccess);
      showToast('تم حفظ بيانات الصنف وجميع تركيباته.');
    } catch (error) {
      console.error('Product save failed:', error);
      showToast(error.message || 'تعذر حفظ البيانات.', false);
    } finally {
      button.disabled = false;
      button.textContent = 'حفظ';
    }
  }

  async function init() {
    try {
      if (!sb) throw new Error('تعذر الاتصال بقاعدة البيانات.');
      if (!auth?.getCurrentUser) throw new Error('تعذر تهيئة المصادقة.');

      const user = await auth.getCurrentUser();
      if (!user) {
        location.replace('index.html');
        return;
      }

      uiAccess = await getProductsAccess();
      if (uiAccess.read !== true) {
        setState('هذه الخدمة غير متاحة في اشتراكك الحالي.');
        return;
      }

      $('adminToolbar').classList.toggle('hidden', uiAccess.add !== true);
      $('adminToolbar').classList.toggle('flex', uiAccess.add === true);

      await loadData();
      populateCategories();
      render(uiAccess);
    } catch (error) {
      console.error('Products initialization failed:', error);
      setState(error.message || 'حدث خطأ أثناء تحميل المنتجات.');
    }
  }

  $('editorForm').addEventListener('click', event => {
    const control = event.target.closest('[data-editor-action]');
    if (!control) return;
    const toolbar = control.closest('[data-rich-editor-toolbar]');
    const editor = toolbar ? $(`${toolbar.dataset.richEditorToolbar}Editor`) : null;
    if (!editor) return;
    event.preventDefault();
    handleRichEditorAction(control.dataset.editorAction, editor, control);
  });

  $('editorForm').addEventListener('change', event => {
    const control = event.target.closest('[data-editor-action="fontSize"], [data-editor-action="foreColor"]');
    if (!control) return;
    const toolbar = control.closest('[data-rich-editor-toolbar]');
    const editor = toolbar ? $(`${toolbar.dataset.richEditorToolbar}Editor`) : null;
    if (editor) handleRichEditorAction(control.dataset.editorAction, editor, control);
  });

  $('editorForm').addEventListener('mouseup', event => {
    const editor = event.target.closest('.rich-editor-surface');
    if (editor) rememberRichEditorSelection(editor);
  });

  $('editorForm').addEventListener('mousedown', event => {
    const control = event.target.closest('[data-editor-action]');
    if (!control) return;
    const toolbar = control.closest('[data-rich-editor-toolbar]');
    const editor = toolbar ? $(`${toolbar.dataset.richEditorToolbar}Editor`) : null;
    if (editor) rememberRichEditorSelection(editor);
    if (control.tagName === 'BUTTON') event.preventDefault();
  });

  $('cancelRichLinkBtn').onclick = closeRichLinkModal;
  $('applyRichLinkBtn').onclick = applyRichLink;
  $('richLinkInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyRichLink(); }
    if (event.key === 'Escape') closeRichLinkModal();
  });
  $('richLinkModal').addEventListener('click', event => {
    if (event.target.id === 'richLinkModal') closeRichLinkModal();
  });

  $('categoryFilter').onchange = event => {
    state.category = event.target.value;
    state.subcategory = '';
    populateCategories();
    render(uiAccess);
  };

  $('subcategoryFilter').onchange = event => {
    state.subcategory = event.target.value;
    render(uiAccess);
  };

  $('searchInput').oninput = event => {
    state.search = event.target.value.trim();
    render(uiAccess);
  };

  $('resetBtn').onclick = () => {
    state.category = '';
    state.subcategory = '';
    state.search = '';
    $('searchInput').value = '';
    populateCategories();
    render(uiAccess);
  };

  $('addProductBtn').onclick = () => openEditor('add-product');
  $('closeEditorBtn').onclick = closeEditor;
  $('cancelEditorBtn').onclick = closeEditor;
  $('cancelConfirmBtn').onclick = closeConfirm;
  $('confirmDeleteBtn').onclick = deletePending;
  $('editorForm').addEventListener('submit', saveEditor);
  $('addFormulaBtn').onclick = () => addFormula();

  $('formulaList').addEventListener('click', event => {
    const button = event.target.closest('[data-formula-action="remove"]');
    if (!button) return;
    syncFormulaEditor();
    if (state.editor.formulas.length <= 1) {
      showToast('يجب الاحتفاظ بتركيبة واحدة على الأقل.', false);
      return;
    }
    state.editor.formulas.splice(Number(button.dataset.formulaIndex), 1);
    renderFormulaEditor();
  });

  $('formCategory').onchange = () => refreshFormSubcategories();
  $('addCategoryBtn').onclick = () => openCategoryModal('category');
  $('addSubcategoryBtn').onclick = async () => {
    if (!$('formCategory').value) return showToast('اختر القسم الرئيسي أولاً.', false);
    const permission = await getProductsAccess();
    if (permission.add !== true) return showToast('ليس لديك صلاحية الإضافة.', false);
    openCategoryModal('subcategory');
  };
  $('closeCategoryModalBtn').onclick = closeCategoryModal;
  $('cancelCategoryBtn').onclick = closeCategoryModal;
  $('categoryForm').addEventListener('submit', saveNewCategory);
  $('categoryModal').addEventListener('click', event => {
    if (event.target === $('categoryModal')) closeCategoryModal();
  });

  $('productsGrid').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.action === 'edit-product') await openEditor('edit-product', id);
    if (button.dataset.action === 'delete-product') await openConfirm(id);
  });

  $('editorModal').addEventListener('click', event => {
    if (event.target === $('editorModal')) closeEditor();
  });

  $('confirmModal').addEventListener('click', event => {
    if (event.target === $('confirmModal')) closeConfirm();
  });

  initRichEditors(document);
  init();
})();
