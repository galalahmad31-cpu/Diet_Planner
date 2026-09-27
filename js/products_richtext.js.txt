(() => {
'use strict';

const access = window.DietPlannerAccess;
const sb = access?.supabaseClient;

const state = {
  categories: [],
  subcategories: [],
  products: [],
  formulas: [],
  category: '',
  subcategory: '',
  search: '',
  isAdmin: false,
  editor: { mode: null, productId: null, formulas: [] },
  pendingDelete: null,
  categoryManagerType: null
};

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const fmt = v => v == null || v === '' ? '—' : Number(v).toLocaleString('ar-EG',{maximumFractionDigits:2});

const RICH_TEXT_TAGS = new Set(['A','B','BR','DIV','EM','I','P','SPAN','STRONG','U','UL','OL','LI']);
const RICH_TEXT_STYLES = new Set(['color','font-size','text-align','direction']);

function sanitizeRichText(value) {
  const source = String(value ?? '');
  if (!source.trim()) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString('<div>' + source + '</div>', 'text/html');
  const root = doc.body.firstElementChild;

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
              allowed.push(property + ':' + propertyValue);
            }
          });
          if (allowed.length) child.setAttribute('style', allowed.join(';'));
          else child.removeAttribute('style');
        } else if (attr.name !== 'dir') {
          child.removeAttribute(attr.name);
        }
      });

      if (child.tagName === 'A' && child.hasAttribute('href')) {
        child.setAttribute('target','_blank');
        child.setAttribute('rel','noopener noreferrer');
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
  return esc(source).replace(/\r?\n/g,'<br>');
}

function richTextForDisplay(value) {
  return sanitizeRichText(richTextForEditor(value));
}

function richTextToPlain(value) {
  const html = richTextForDisplay(value);
  if (!html) return '';
  const box = document.createElement('div');
  box.innerHTML = html;
  return (box.textContent || '').replace(/\s+/g,' ').trim();
}

function richEditorMarkup(id, value = '', placeholder = 'اكتب الملاحظات هنا...') {
  return '<div class="rich-editor-toolbar" data-rich-editor-toolbar="' + esc(id) + '">' +
    '<button type="button" data-editor-action="bold" title="عريض"><i class="fa-solid fa-bold"></i></button>' +
    '<button type="button" data-editor-action="italic" title="مائل"><i class="fa-solid fa-italic"></i></button>' +
    '<button type="button" data-editor-action="underline" title="تحته خط"><i class="fa-solid fa-underline"></i></button>' +
    '<select data-editor-action="fontSize" title="حجم الخط">' +
      '<option value="3">حجم</option>' +
      '<option value="2">صغير</option>' +
      '<option value="3">متوسط</option>' +
      '<option value="4">كبير</option>' +
      '<option value="5">كبير جدًا</option>' +
    '</select>' +
    '<input type="color" data-editor-action="foreColor" value="#334155" title="لون النص">' +
    '<button type="button" data-editor-action="rtl" title="من اليمين إلى اليسار"><i class="fa-solid fa-align-right"></i></button>' +
    '<button type="button" data-editor-action="ltr" title="من اليسار إلى اليمين"><i class="fa-solid fa-align-left"></i></button>' +
    '<button type="button" data-editor-action="justifyRight" title="محاذاة يمين"><i class="fa-solid fa-align-right"></i></button>' +
    '<button type="button" data-editor-action="justifyLeft" title="محاذاة يسار"><i class="fa-solid fa-align-left"></i></button>' +
    '<button type="button" data-editor-action="link" title="إضافة رابط"><i class="fa-solid fa-link"></i></button>' +
    '<button type="button" data-editor-action="unlink" title="إزالة الرابط"><i class="fa-solid fa-link-slash"></i></button>' +
  '</div>' +
  '<div id="' + esc(id) + 'Editor" class="rich-editor-surface" contenteditable="true" spellcheck="true" dir="auto" data-placeholder="' + esc(placeholder) + '">' +
    richTextForEditor(value) +
  '</div>';
}

function getRichEditorValue(id) {
  const editor = $(id + 'Editor');
  return editor ? sanitizeRichText(editor.innerHTML).trim() || null : null;
}

function setRichEditorValue(id, value) {
  const editor = $(id + 'Editor');
  if (editor) editor.innerHTML = richTextForEditor(value);
}

let richEditorSelection = null;

function rememberRichEditorSelection(editor) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return;
  richEditorSelection = {
    editor,
    range: selection.getRangeAt(0).cloneRange()
  };
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
  document.execCommand(command, false, value);
  rememberRichEditorSelection(editor);
}

function handleRichEditorAction(action, editor, control) {
  if (!editor) return;

  if (action === 'bold' || action === 'italic' || action === 'underline' ||
      action === 'justifyLeft' || action === 'justifyRight') {
    execRichEditorCommand(editor, action);
    return;
  }

  if (action === 'fontSize') {
    execRichEditorCommand(editor, 'fontSize', control.value);
    return;
  }

  if (action === 'foreColor') {
    execRichEditorCommand(editor, 'foreColor', control.value);
    return;
  }

  if (action === 'rtl' || action === 'ltr') {
    editor.dir = action === 'rtl' ? 'rtl' : 'ltr';
    execRichEditorCommand(editor, 'formatBlock', 'div');
    editor.style.direction = editor.dir;
    return;
  }

  if (action === 'link') {
    const url = window.prompt('أدخل الرابط (https://...)');
    if (!url) return;
    const normalizedUrl = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
    execRichEditorCommand(editor, 'createLink', normalizedUrl);
    return;
  }

  if (action === 'unlink') {
    execRichEditorCommand(editor, 'unlink');
  }
}

function initRichEditors(root = document) {
  root.querySelectorAll('[data-rich-editor]').forEach(wrapper => {
    if (wrapper.dataset.richEditorReady === 'true') return;
    wrapper.dataset.richEditorReady = 'true';
    const id = wrapper.id;
    const value = wrapper.dataset.initialValue || '';
    wrapper.innerHTML = richEditorMarkup(id, value);
  });
}

function setState(msg, show = false) {
  $('state').textContent = msg;
  $('state').style.display = show ? 'none' : 'block';
  $('productsGrid').style.display = show ? 'grid' : 'none';
}

function option(label, value, selected = false) {
  return '<option value="' + esc(value) + '" ' + (selected ? 'selected' : '') + '>' + esc(label) + '</option>';
}

function showToast(message, ok = true) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-extrabold text-white shadow-xl ' + (ok ? 'bg-emerald-600' : 'bg-rose-600');
  el.style.display = 'block';
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

function populateCategories() {
  const usedSubcategoryIds = new Set(state.products.map(p => p.subcategory_id).filter(Boolean));
  const usedCategoryIds = new Set(
    state.subcategories.filter(s => usedSubcategoryIds.has(s.id)).map(s => s.category_id).filter(Boolean)
  );

  const categories = state.categories.filter(c => state.isAdmin || usedCategoryIds.has(c.id));

  $('categoryFilter').innerHTML =
    option('كل الأقسام','') +
    categories.map(c => option(c.name,c.id,c.id === state.category)).join('');

  const activeSubs = state.subcategories.filter(s =>
    (state.isAdmin || usedSubcategoryIds.has(s.id)) &&
    (!state.category || s.category_id === state.category)
  );

  if (!activeSubs.some(s => s.id === state.subcategory)) state.subcategory = '';

  $('subcategoryFilter').innerHTML =
    option('كل الأقسام الفرعية','') +
    activeSubs.map(s => option(s.name,s.id,s.id === state.subcategory)).join('');
}

function populateFormCategories(selectedCategory = '', selectedSubcategory = '') {
  $('formCategory').innerHTML =
    option('اختر القسم الرئيسي','') +
    state.categories.map(c => option(c.name,c.id,c.id === selectedCategory)).join('');

  const subs = state.subcategories.filter(s => !selectedCategory || s.category_id === selectedCategory);
  $('formSubcategory').innerHTML =
    option('اختر القسم الفرعي','') +
    subs.map(s => option(s.name,s.id,s.id === selectedSubcategory)).join('');

  $('formSubcategory').value = selectedSubcategory || '';
}

function populateSubcategoryParentSelect(selectedId = '') {
  const select = $('subcategoryParentSelect');
  select.innerHTML = option('اختر القسم الرئيسي','') +
    state.categories.map(c => option(c.name,c.id,c.id === selectedId)).join('');
}

function openCategoryModal(type) {
  if (!state.isAdmin) return;
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

async function saveNewCategory(e) {
  e.preventDefault();
  if (!state.isAdmin) return;

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

  const table = type === 'category' ? 'product_categories' : 'product_subcategories';
  const button = $('saveCategoryBtn');
  button.disabled = true;
  button.textContent = 'جاري الإضافة...';

  try {
    const { data, error } = await sb.from(table).insert(payload).select('id').single();
    if (error) throw error;

    await loadData();
    populateCategories();

    if (type === 'category') {
      populateFormCategories(data.id, '');
      $('formCategory').value = data.id;
      refreshFormSubcategories();
    } else {
      const parentId = payload.category_id;
      const selected = data.id;
      populateFormCategories(parentId, selected);
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

function refreshFormSubcategories() {
  const categoryId = $('formCategory').value;
  const current = $('formSubcategory').value;
  const subs = state.subcategories.filter(s => s.category_id === categoryId);
  $('formSubcategory').innerHTML =
    option('اختر القسم الفرعي','') +
    subs.map(s => option(s.name,s.id,s.id === current)).join('');
  if (!subs.some(s => s.id === current)) $('formSubcategory').value = '';
}

function filtered() {
  const q = state.search.toLowerCase();
  return state.products.filter(p => {
    if (state.subcategory && p.subcategory_id !== state.subcategory) return false;
    if (state.category) {
      const sub = state.subcategories.find(x => x.id === p.subcategory_id);
      if (sub?.category_id !== state.category) return false;
    }
    if (q && !([p.product_name,p.usage,richTextToPlain(p.notes)].join(' ').toLowerCase().includes(q))) return false;
    return true;
  });
}

function productFormulaRows(productId) {
  return state.formulas
    .filter(f => f.product_id === productId)
    .sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function render() {
  const rows = filtered();
  $('resultCount').textContent = 'عرض ' + rows.length + ' منتج';

  if (!rows.length) {
    setState('لا توجد منتجات مطابقة للتصفية.');
    return;
  }

  $('productsGrid').innerHTML = rows.map(p => {
    const sub = state.subcategories.find(s => s.id === p.subcategory_id);
    const cat = sub && state.categories.find(c => c.id === sub.category_id);
    const formulas = productFormulaRows(p.id);

    const adminActions = state.isAdmin
      ? '<div class="flex shrink-0 gap-2">' +
        '<button type="button" data-action="edit-product" data-id="' + esc(p.id) + '" class="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-700 hover:bg-sky-100" title="تعديل"><i class="fa-solid fa-pen"></i></button>' +
        '<button type="button" data-action="delete-product" data-id="' + esc(p.id) + '" class="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100" title="حذف"><i class="fa-solid fa-trash"></i></button>' +
        '</div>'
      : '';

    const formulaHtml = formulas.length
      ? formulas.map(formula => (
          '<div class="mt-3 rounded-2xl border border-slate-100 bg-white p-3">' +
          '<div class="flex items-start justify-between gap-2">' +
          '<div><div class="text-sm font-extrabold text-slate-800">' + esc(formula.formula_name) + '</div>' +
          '<div class="mt-1 text-[10px] font-bold text-slate-400">' +
          esc(formula.basis_amount != null ? fmt(formula.basis_amount) + ' ' + (formula.basis_unit || '') : 'أساس غير محدد') +
          '</div></div></div>' +
          '<div class="mt-3 grid grid-cols-4 gap-2 text-center">' +
          '<div><div class="text-[10px] text-slate-400">السعرات</div><div class="mt-1 text-sm font-extrabold text-amber-600">' + fmt(formula.kcal) + '</div></div>' +
          '<div><div class="text-[10px] text-slate-400">كارب</div><div class="mt-1 text-sm font-extrabold text-sky-600">' + fmt(formula.carb) + '</div></div>' +
          '<div><div class="text-[10px] text-slate-400">بروتين</div><div class="mt-1 text-sm font-extrabold text-emerald-600">' + fmt(formula.protein) + '</div></div>' +
          '<div><div class="text-[10px] text-slate-400">دهون</div><div class="mt-1 text-sm font-extrabold text-rose-600">' + fmt(formula.fat) + '</div></div>' +
          '</div>' +
          (formula.notes ? '<div class="rich-text-content mt-3 text-[11px] leading-5 text-slate-500">' + richTextForDisplay(formula.notes) + '</div>' : '') +
          '</div>'
        )).join('')
      : '<div class="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-400">لا توجد بيانات تركيبة لهذا المنتج.</div>';

    return '<article class="product-card glass rounded-3xl p-5 shadow-sm">' +
      '<div class="flex items-start justify-between gap-3">' +
      '<div class="min-w-0"><div class="text-xs font-bold text-brand-600">' + esc(cat?.name || 'غير مصنف') + ' · ' + esc(sub?.name || 'غير مصنف') + '</div>' +
      '<h2 class="mt-1 text-lg font-extrabold text-slate-800">' + esc(p.product_name) + '</h2></div>' +
      adminActions + '</div>' +
      '<div class="mt-4 rounded-2xl bg-slate-50 p-3"><div class="text-xs font-bold text-slate-500">الاستخدام</div><div class="mt-1 text-sm font-semibold leading-6 text-slate-700">' + esc(p.usage || '—') + '</div></div>' +
      formulaHtml +
      (p.notes ? '<div class="rich-text-content mt-3 text-[11px] leading-5 text-slate-500">' + richTextForDisplay(p.notes) + '</div>' : '') +
      '</article>';
  }).join('');

  setState('', true);
}

async function loadData() {
  const [c,s,p,f] = await Promise.all([
    sb.from('product_categories').select('*').eq('is_active',true).order('sort_order'),
    sb.from('product_subcategories').select('*').eq('is_active',true).order('sort_order'),
    sb.from('food_products').select('id,product_name,usage,notes,sort_order,subcategory_id,required_feature,is_active').eq('is_active',true).order('sort_order'),
    sb.from('food_product_formulas').select('id,product_id,formula_name,basis_amount,basis_unit,kcal,carb,protein,fat,notes,sort_order').order('sort_order')
  ]);
  if (c.error) throw c.error;
  if (s.error) throw s.error;
  if (p.error) throw p.error;
  if (f.error) throw f.error;

  state.categories = c.data || [];
  state.subcategories = s.data || [];
  state.products = p.data || [];
  state.formulas = f.data || [];
}

function createEmptyFormula() {
  return {
    id: null,
    formula_name: '',
    basis_amount: null,
    basis_unit: '',
    kcal: null,
    carb: null,
    protein: null,
    fat: null,
    notes: '',
    sort_order: 0
  };
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
  if (!list) return;

  const formulas = state.editor.formulas || [];

  if (!formulas.length) {
    list.innerHTML =
      '<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs font-semibold text-slate-400">' +
      'لم تتم إضافة أي تركيبة بعد. اضغط «إضافة تركيبة» لإضافة أول تركيبة.' +
      '</div>';
    return;
  }

  list.innerHTML = formulas.map((formula, index) => {
    const basisAmount = formula.basis_amount == null ? '' : esc(formula.basis_amount);
    const basisUnit = formula.basis_unit || '';
    const kcal = formula.kcal == null ? '' : esc(formula.kcal);
    const carb = formula.carb == null ? '' : esc(formula.carb);
    const protein = formula.protein == null ? '' : esc(formula.protein);
    const fat = formula.fat == null ? '' : esc(formula.fat);
    const sortOrder = Number(formula.sort_order || 0);

    return '<div class="formula-item" data-formula-index="' + index + '"' +
      (formula.id ? ' data-formula-id="' + esc(formula.id) + '"' : '') + '>' +
      '<div class="formula-item-header">' +
        '<div class="formula-item-title">التركيبة ' + (index + 1) + '</div>' +
        '<button type="button" class="formula-remove" data-formula-action="remove" data-formula-index="' + index + '" title="حذف التركيبة">' +
          '<i class="fa-solid fa-trash-can"></i>' +
        '</button>' +
      '</div>' +
      '<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">' +
        '<div><label class="field-label">اسم التركيبة *</label>' +
          '<input data-formula-field="formula_name" class="field-input" value="' + esc(formula.formula_name) + '" required></div>' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<div><label class="field-label">الكمية الأساسية</label><input data-formula-field="basis_amount" type="number" min="0" step="any" class="field-input" value="' + basisAmount + '"></div>' +
          '<div><label class="field-label">وحدة الأساس</label><select data-formula-field="basis_unit" class="field-input">' +
            '<option value="">بدون</option>' +
            '<option value="g" ' + (basisUnit === 'g' ? 'selected' : '') + '>g</option>' +
            '<option value="ml" ' + (basisUnit === 'ml' ? 'selected' : '') + '>ml</option>' +
            '<option value="serving" ' + (basisUnit === 'serving' ? 'selected' : '') + '>serving</option>' +
            '<option value="dose" ' + (basisUnit === 'dose' ? 'selected' : '') + '>dose</option>' +
          '</select></div>' +
        '</div>' +
        '<div><label class="field-label">السعرات (kcal)</label><input data-formula-field="kcal" type="number" step="any" class="field-input" value="' + kcal + '"></div>' +
        '<div><label class="field-label">الكربوهيدرات (g)</label><input data-formula-field="carb" type="number" step="any" class="field-input" value="' + carb + '"></div>' +
        '<div><label class="field-label">البروتين (g)</label><input data-formula-field="protein" type="number" step="any" class="field-input" value="' + protein + '"></div>' +
        '<div><label class="field-label">الدهون (g)</label><input data-formula-field="fat" type="number" step="any" class="field-input" value="' + fat + '"></div>' +
        '<div class="md:col-span-2"><label class="field-label">ملاحظات التركيبة</label><div class="rich-editor" data-rich-editor="formula-notes-' + index + '" data-initial-value="' + esc(formula.notes || '').replace(/\n/g,'&#10;') + '"></div></div>' +
        '<div><label class="field-label">الترتيب</label><input data-formula-field="sort_order" type="number" step="1" class="field-input" value="' + sortOrder + '"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  initRichEditors(list);
}

function readFormulaRow(row) {
  const get = field => row.querySelector('[data-formula-field="' + field + '"]');
  const basisAmount = get('basis_amount').value === '' ? null : Number(get('basis_amount').value);
  const basisUnit = get('basis_unit').value || null;

  if ((basisAmount === null) !== (basisUnit === null)) {
    throw new Error('يجب إدخال الكمية الأساسية ووحدة الأساس معًا، أو تركهما فارغين.');
  }
  if (basisAmount !== null && basisAmount <= 0) {
    throw new Error('الكمية الأساسية يجب أن تكون أكبر من صفر.');
  }

  const numOrNull = field => get(field).value === '' ? null : Number(get(field).value);

  return {
    id: row.dataset.formulaId || null,
    formula_name: get('formula_name').value.trim(),
    basis_amount: basisAmount,
    basis_unit: basisUnit,
    kcal: numOrNull('kcal'),
    carb: numOrNull('carb'),
    protein: numOrNull('protein'),
    fat: numOrNull('fat'),
    notes: getRichEditorValue('formula-notes-' + row.dataset.formulaIndex),
    sort_order: Number(get('sort_order').value || 0)
  };
}

function readAllFormulaFields() {
  const rows = Array.from($('formulaList').querySelectorAll('.formula-item'));
  const formulas = rows.map(readFormulaRow);

  if (!formulas.length) {
    throw new Error('يجب إضافة تركيبة واحدة على الأقل.');
  }

  const names = formulas.map(f => f.formula_name.trim().toLowerCase());
  if (names.some(name => !name)) {
    throw new Error('اسم التركيبة حقل مطلوب.');
  }

  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) {
    throw new Error('لا يمكن تكرار اسم التركيبة داخل المنتج نفسه.');
  }

  return formulas;
}

function syncFormulaEditor() {
  const list = $('formulaList');
  if (!list) return;

  const rows = Array.from(list.querySelectorAll('.formula-item'));
  if (!rows.length) return;

  state.editor.formulas = rows.map(readFormulaRow);
}

function addFormula(formula = null) {
  if (!formula) syncFormulaEditor();

  state.editor.formulas.push(
    normalizeFormula(formula || createEmptyFormula())
  );

  renderFormulaEditor();

  const index = state.editor.formulas.length - 1;
  $('formulaList')
    .querySelector('[data-formula-index="' + index + '"] [data-formula-field="formula_name"]')
    ?.focus();
}

function openEditor(mode, productId = null) {
  if (!state.isAdmin) return;
  if (mode !== 'add-product' && mode !== 'edit-product') return;

  const product = productId ? state.products.find(p => p.id === productId) : null;
  const existingFormulas = product ? productFormulaRows(product.id).map(normalizeFormula) : [];

  state.editor = {
    mode,
    productId,
    formulas: existingFormulas.length ? existingFormulas : [createEmptyFormula()],
  };

  $('editorModal').style.display = 'flex';
  $('editorTitle').textContent = mode === 'add-product' ? 'إضافة صنف جديد' : 'تعديل بيانات الصنف';
  $('editorSubtitle').textContent = mode === 'add-product'
    ? 'أدخل بيانات الصنف وأضف تركيبة واحدة أو أكثر.'
    : 'يمكن للمنتج الواحد أن يحتوي على أكثر من تركيبة.';

  $('productFields').style.display = 'block';
  $('formulaProductInfo').style.display = 'none';

  const sub = product?.subcategory_id ? state.subcategories.find(s => s.id === product.subcategory_id) : null;
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

function openConfirm(_type, id) {
  if (!state.isAdmin) return;
  state.pendingDelete = { type: 'product', id };

  const p = state.products.find(x => x.id === id);
  $('confirmTitle').textContent = 'تأكيد حذف الصنف';
  $('confirmMessage').textContent = 'سيتم حذف الصنف «' + (p?.product_name || '') + '» وتركيباته المرتبطة به. لا يمكن التراجع عن هذه العملية.';

  $('confirmModal').style.display = 'flex';
}

function closeConfirm() {
  $('confirmModal').style.display = 'none';
  state.pendingDelete = null;
}

async function deletePending() {
  if (!state.isAdmin || !state.pendingDelete) return;

  const { id } = state.pendingDelete;
  $('confirmDeleteBtn').disabled = true;
  $('confirmDeleteBtn').textContent = 'جاري الحذف...';

  try {
    const table = 'food_products';
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;

    closeConfirm();
    await loadData();
    populateCategories();
    render();
    showToast('تم حذف الصنف وتركيبته.');
  } catch (e) {
    console.error(e);
    showToast(e.message || 'تعذر تنفيذ الحذف.', false);
  } finally {
    $('confirmDeleteBtn').disabled = false;
    $('confirmDeleteBtn').textContent = 'حذف';
  }
}

async function saveProduct() {
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
  const { mode, productId } = state.editor;

  if (mode === 'add-product') {
    const { data, error } = await sb.from('food_products').insert(productPayload).select('id').single();
    if (error) throw error;

    const formulaRows = formulas.map(formula => {
      const { id, ...payload } = formula;
      return { ...payload, product_id: data.id };
    });

    const { error: formulaError } = await sb.from('food_product_formulas').insert(formulaRows);

    if (formulaError) {
      await sb.from('food_products').delete().eq('id', data.id);
      throw formulaError;
    }

    showToast('تمت إضافة الصنف وجميع تركيباته.');
    return;
  }

  const { error: productError } = await sb.from('food_products').update(productPayload).eq('id', productId);
  if (productError) throw productError;

  const existingIds = new Set(productFormulaRows(productId).map(formula => formula.id));
  const currentIds = new Set(formulas.map(formula => formula.id).filter(Boolean));
  const idsToDelete = [...existingIds].filter(id => !currentIds.has(id));

  if (idsToDelete.length) {
    const { error: deleteError } = await sb
      .from('food_product_formulas')
      .delete()
      .in('id', idsToDelete)
      .eq('product_id', productId);

    if (deleteError) throw deleteError;
  }

  for (const formula of formulas.filter(item => item.id)) {
    const { id, ...payload } = formula;
    const { error } = await sb
      .from('food_product_formulas')
      .update(payload)
      .eq('id', id)
      .eq('product_id', productId);

    if (error) throw error;
  }

  const newFormulas = formulas.filter(item => !item.id);
  if (newFormulas.length) {
    const rows = newFormulas.map(formula => {
      const { id, ...payload } = formula;
      return { ...payload, product_id: productId };
    });

    const { error } = await sb.from('food_product_formulas').insert(rows);
    if (error) throw error;
  }

  showToast('تم حفظ بيانات الصنف وجميع تركيباته.');
}

async function saveEditor(e) {
  e.preventDefault();
  if (!state.isAdmin) return;

  const btn = $('saveEditorBtn');
  btn.disabled = true;
  btn.textContent = 'جاري الحفظ...';

  try {
    await saveProduct();

    closeEditor();
    await loadData();
    populateCategories();
    render();
  } catch (e) {
    console.error(e);
    showToast(e.message || 'تعذر حفظ البيانات.', false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'حفظ';
  }
}

async function init() {
  try {
    if (!sb) throw new Error('تعذر الاتصال بقاعدة البيانات.');

    const status = await access.getAccessStatus();
    if (!status?.authenticated || !status.user) {
      location.replace('index.html');
      return;
    }

    state.isAdmin = status.isAdmin === true;

    if (!state.isAdmin) {
      const ok = await access.hasFeature(status.user.id,'product');
      if (ok !== true) {
        setState('هذه الخدمة غير متاحة في اشتراكك الحالي.');
        return;
      }
    } else {
      $('adminToolbar').classList.remove('hidden');
      $('adminToolbar').classList.add('flex');
    }

    await loadData();
    populateCategories();
    render();
  } catch (e) {
    console.error(e);
    setState(e.message || 'حدث خطأ أثناء تحميل المنتجات.');
  }
}

$('editorForm').addEventListener('click', e => {
  const control = e.target.closest('[data-editor-action]');
  if (!control) return;

  const toolbar = control.closest('[data-rich-editor-toolbar]');
  if (!toolbar) return;

  const editorId = toolbar.dataset.richEditorToolbar + 'Editor';
  const editor = $(editorId);
  if (!editor) return;

  e.preventDefault();
  handleRichEditorAction(control.dataset.editorAction, editor, control);
});

$('editorForm').addEventListener('change', e => {
  const control = e.target.closest('[data-editor-action="fontSize"], [data-editor-action="foreColor"]');
  if (!control) return;

  const toolbar = control.closest('[data-rich-editor-toolbar]');
  if (!toolbar) return;

  const editor = $(toolbar.dataset.richEditorToolbar + 'Editor');
  if (!editor) return;

  handleRichEditorAction(control.dataset.editorAction, editor, control);
});

$('editorForm').addEventListener('mouseup', e => {
  const editor = e.target.closest('.rich-editor-surface');
  if (editor) rememberRichEditorSelection(editor);
});

$('editorForm').addEventListener('mousedown', e => {
  const control = e.target.closest('[data-editor-action]');
  if (control) {
    const toolbar = control.closest('[data-rich-editor-toolbar]');
    const editor = toolbar ? $(toolbar.dataset.richEditorToolbar + 'Editor') : null;
    if (editor) rememberRichEditorSelection(editor);

    if (control.tagName === 'BUTTON') e.preventDefault();
  }
});

$('categoryFilter').onchange = e => {
  state.category = e.target.value;
  state.subcategory = '';
  populateCategories();
  render();
};

$('subcategoryFilter').onchange = e => {
  state.subcategory = e.target.value;
  render();
};

$('searchInput').oninput = e => {
  state.search = e.target.value.trim();
  render();
};

$('resetBtn').onclick = () => {
  state.category = '';
  state.subcategory = '';
  state.search = '';
  $('searchInput').value = '';
  populateCategories();
  render();
};

initRichEditors(document);
$('addProductBtn').onclick = () => openEditor('add-product');
$('closeEditorBtn').onclick = closeEditor;
$('cancelEditorBtn').onclick = closeEditor;
$('cancelConfirmBtn').onclick = closeConfirm;
$('confirmDeleteBtn').onclick = deletePending;
$('editorForm').addEventListener('submit', saveEditor);
$('addFormulaBtn').onclick = () => addFormula();

$('formulaList').addEventListener('click', e => {
  const btn = e.target.closest('[data-formula-action="remove"]');
  if (!btn) return;

  const index = Number(btn.dataset.formulaIndex);
  const formulas = state.editor.formulas || [];

  if (formulas.length <= 1) {
    showToast('يجب الاحتفاظ بتركيبة واحدة على الأقل.', false);
    return;
  }

  syncFormulaEditor();

  const removed = state.editor.formulas[index];
  state.editor.formulas.splice(index, 1);
  renderFormulaEditor();
});



$('formCategory').onchange = refreshFormSubcategories;
$('addCategoryBtn').onclick = () => openCategoryModal('category');
$('addSubcategoryBtn').onclick = () => {
  if (!$('formCategory').value) {
    showToast('اختر القسم الرئيسي أولاً.', false);
    return;
  }
  openCategoryModal('subcategory');
};
$('closeCategoryModalBtn').onclick = closeCategoryModal;
$('cancelCategoryBtn').onclick = closeCategoryModal;
$('categoryForm').addEventListener('submit', saveNewCategory);
$('categoryModal').addEventListener('click', e => {
  if (e.target === $('categoryModal')) closeCategoryModal();
});

$('productsGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || !state.isAdmin) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'edit-product') openEditor('edit-product', id);
  else if (action === 'delete-product') openConfirm('product', id);

});

$('editorModal').addEventListener('click', e => {
  if (e.target === $('editorModal')) closeEditor();
});

$('confirmModal').addEventListener('click', e => {
  if (e.target === $('confirmModal')) closeConfirm();
});

init();
})();
