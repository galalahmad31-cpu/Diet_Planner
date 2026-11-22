(function(){
'use strict';
const supabase = window.DietPlannerAccess?.supabaseClient;

const $ = (id) => document.getElementById(id);

let user = null;
let rows = [];
let selected = null;
let toastTimer = null;

async function refreshFinanceWriteAccess() {
    try {
        const accessStatus = await window.DietPlannerAccess?.getAccessStatus?.();
        const currentUser = accessStatus?.user || null;
        if (!currentUser) {
            window.__dpFinanceAccess = { isAdmin:false, hasActiveSubscription:false };
            applyFinanceWriteAccessUI();
            return null;
        }
        const isAdmin = accessStatus?.isAdmin === true;
        const hasActiveSubscription =
            (await window.DietPlannerAccess?.hasActiveSubscription?.(currentUser.id)) === true;
        window.__dpFinanceAccess = { isAdmin, hasActiveSubscription };
        applyFinanceWriteAccessUI();
        return currentUser;
    } catch (error) {
        console.error('Finance access check failed:', error);
        window.__dpFinanceAccess = { isAdmin:false, hasActiveSubscription:false };
        applyFinanceWriteAccessUI();
        return null;
    }
}

function canWriteFinance() {
    const accessState = window.__dpFinanceAccess || {};
    return accessState.isAdmin === true || accessState.hasActiveSubscription === true;
}

function applyFinanceWriteAccessUI() {
    const canWrite = canWriteFinance();
    document.querySelectorAll('[data-finance-write]').forEach((element) => {
        element.disabled = !canWrite;
        element.classList.toggle('opacity-50', !canWrite);
        element.classList.toggle('cursor-not-allowed', !canWrite);
    });
}

function showFinanceAccessMessage() {
    showToast('تعديل البيانات المالية متاح أثناء الاشتراك المدفوع فقط.', true);
}

/* =========================================================
   Date helpers
   ========================================================= */

function todayISO() {
    const now = new Date();
    return formatISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addMonths(dateValue, months) {
    if (!dateValue || !months) return null;

    const [y, m, d] = String(dateValue).slice(0, 10).split('-').map(Number);
    if (![y, m, d].every(Number.isFinite)) return null;

    const date = new Date(y, m - 1, d);
    date.setMonth(date.getMonth() + Number(months));

    // Preserve end-of-month behavior.
    if (date.getDate() !== d) {
        date.setDate(0);
    }

    return formatISODate(date);
}

function fmt(value) {
    if (!value) return '—';

    const [y, m, d] = String(value).slice(0, 10).split('-');
    if (!y || !m || !d) return '—';

    return `${d}/${m}/${y}`;
}

/* =========================================================
   General helpers
   ========================================================= */

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function showToast(message, isError = false) {
    const element = $('toast');

    element.textContent = message;
    element.className =
        'fixed bottom-5 left-1/2 z-[100] rounded-xl px-5 py-3 text-sm font-bold text-white shadow-xl toast ' +
        (isError ? 'bg-red-600' : 'bg-brand-600');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.add('hidden'), 2800);
}

/* =========================================================
   Subscription / follow-up calculations
   ========================================================= */

function updateSubscriptionPreview() {
    $('endDate').textContent = addMonths(
        $('startDate').value,
        $('months').value
    )
        ? fmt(addMonths($('startDate').value, $('months').value))
        : '—';
}

function updateDiscountPreview() {
    const amount = Number($('amount').value);
    const discount = Number($('discount').value) || 0;

    $('discountedAmount').textContent =
        Number.isFinite(amount) && amount >= 0
            ? `${(amount * (1 - discount / 100)).toFixed(2).replace(/\.00$/, '')} جنيه`
            : '—';
}

function updatePaymentText() {
    $('paidText').textContent =
        $('paid').checked ? 'تم سداد الاشتراك' : 'لم يتم السداد';
}

/* =========================================================
   Status
   ========================================================= */

function getSubscriptionStatus(finance) {
    if (
        finance.subscription_end_date &&
        finance.subscription_end_date < todayISO()
    ) {
        return ['منتهي', 'bg-red-50 text-red-700'];
    }

    if (finance.is_paid) {
        return ['مسدد', 'bg-emerald-50 text-emerald-700'];
    }

    return ['غير مسدد', 'bg-amber-50 text-amber-700'];
}

/* =========================================================
   Data loading
   ========================================================= */

async function loadData() {
    const { data: patients, error: patientsError } = await supabase
        .from('patients')
        .select('id,name')
        .eq('user_id', user.id)
        .order('name');

    if (patientsError) throw patientsError;

    const { data: finances, error: financesError } = await supabase
        .from('patient_finances')
        .select(`
            id,
            patient_id,
            subscription_start_date,
            subscription_months,
            subscription_end_date,
            subscription_amount,
            discount_percent,
            discounted_amount,
            is_paid,
            last_visit_date,
            next_follow_up_date
        `)
        .eq('user_id', user.id);

    if (financesError) throw financesError;

    const financeMap = new Map(
        (finances || []).map((finance) => [finance.patient_id, finance])
    );

    rows = (patients || []).map((patient) => ({
        ...patient,
        finance: financeMap.get(patient.id) || {
            patient_id: patient.id,
            is_paid: false
        }
    }));

    renderPatients();
}

/* =========================================================
   Patient cards
   ========================================================= */

function getDiscountedSubscriptionAmount(finance) {
    if (Number.isFinite(Number(finance.discounted_amount)) && finance.discounted_amount !== null) {
        return Math.max(0, Number(finance.discounted_amount));
    }
    if (finance.subscription_amount === null || finance.subscription_amount === undefined || finance.subscription_amount === '') return null;
    const amount = Number(finance.subscription_amount);
    const discount = Number(finance.discount_percent || 0);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(discount)) return null;
    return Math.max(0, amount * (1 - discount / 100));
}

function formatMoney(value) {
    if (value === null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(value) + ' ج.م';
}

function getFinancePeriodRange() {
    const mode = $('financePeriod').value;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (mode === 'previous') {
        start.setMonth(start.getMonth() - 1);
        end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
    } else if (mode === '3months' || mode === '6months') {
        start.setMonth(start.getMonth() - (mode === '3months' ? 2 : 5));
    } else if (mode === 'year') {
        start.setMonth(0, 1);
    } else if (mode === 'custom') {
        return { from: $('financeFrom').value, to: $('financeTo').value };
    }
    return { from: formatISODate(start), to: formatISODate(end) };
}

function updateFinancialSummary() {
    const range = getFinancePeriodRange();
    const custom = $('financePeriod').value === 'custom';
    const validRange = range.from && range.to && range.from <= range.to;
    const periodRows = validRange ? rows.filter((row) => {
        const start = String(row.finance.subscription_start_date || '').slice(0, 10);
        return start && start >= range.from && start <= range.to;
    }) : [];
    let total = 0, paid = 0, unpaid = 0, knownAmounts = 0;
    periodRows.forEach((row) => {
        const amount = getDiscountedSubscriptionAmount(row.finance);
        if (amount === null) return;
        knownAmounts++;
        total += amount;
        if (row.finance.is_paid) paid += amount;
        else unpaid += amount;
    });
    $('periodTotal').textContent = validRange && knownAmounts ? formatMoney(total) : '—';
    $('periodPaid').textContent = validRange && knownAmounts ? formatMoney(paid) : '—';
    $('periodUnpaid').textContent = validRange && knownAmounts ? formatMoney(unpaid) : '—';
    $('periodCount').textContent = validRange ? String(periodRows.length) : '—';
    $('financeCustomRange').hidden = !custom;
    const invalid = custom && range.from && range.to && range.from > range.to;
    $('periodTotal').title = invalid ? 'تاريخ البداية يجب أن يسبق تاريخ النهاية.' : '';
}

function renderPatients() {
    const query = $('search').value.trim().toLowerCase();
    const statusFilter = $('statusFilter').value;
    const sortMode = $('sortPatients').value;
    const today = todayISO();
    const visibleRows = rows.filter((row) => {
        const finance = row.finance;
        const matchesName = !query || String(row.name || '').toLowerCase().includes(query);
        const expired = Boolean(finance.subscription_end_date && finance.subscription_end_date < today);
        const paid = Boolean(finance.is_paid);
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'active' && !expired) ||
            (statusFilter === 'expired' && expired) ||
            (statusFilter === 'paid' && paid) ||
            (statusFilter === 'unpaid' && !paid);
        return matchesName && matchesStatus;
    });

    visibleRows.sort((a, b) => {
        if (sortMode === 'end-asc') return String(a.finance.subscription_end_date || '9999-12-31').localeCompare(String(b.finance.subscription_end_date || '9999-12-31'));
        if (sortMode === 'due-desc') return (getDiscountedSubscriptionAmount(b.finance) || 0) * Number(!b.finance.is_paid) - (getDiscountedSubscriptionAmount(a.finance) || 0) * Number(!a.finance.is_paid);
        return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });

    const grid = $('grid');
    grid.replaceChildren();
    $('empty').classList.toggle('hidden', visibleRows.length > 0);

    let paidCount = 0, unpaidCount = 0, expiredCount = 0, activeCount = 0;
    rows.forEach((row) => {
        const finance = row.finance;
        const expired = Boolean(finance.subscription_end_date && finance.subscription_end_date < today);
        if (finance.is_paid) paidCount++; else unpaidCount++;
        if (expired) expiredCount++; else if (finance.subscription_end_date) activeCount++;
    });
    $('totalCount').textContent = rows.length;
    $('activeCount').textContent = activeCount;
    $('unpaidCount').textContent = unpaidCount;
    $('expiredCount').textContent = expiredCount;
    updateFinancialSummary();

    visibleRows.forEach((row) => {
        const finance = row.finance;
        const [statusText, statusClass] = getSubscriptionStatus(finance);
        const amount = getDiscountedSubscriptionAmount(finance);
        const remaining = amount === null ? null : (finance.is_paid ? 0 : amount);
        const card = document.createElement('article');
        card.className = 'card glass rounded-3xl p-5 text-right shadow-sm cursor-pointer';
        card.dataset.id = row.id;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', 'فتح بيانات اشتراك ' + row.name);
        card.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><i class="fa-solid fa-user"></i></div>
                    <div class="min-w-0"><h3 class="truncate text-base font-extrabold text-slate-800">${esc(row.name)}</h3><p class="mt-1 text-xs text-slate-400">بيانات الاشتراك</p></div>
                </div>
                <span class="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${statusClass}">${statusText}</span>
            </div>
            <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                <div><div class="text-[11px] text-slate-400">قيمة الاشتراك</div><div class="mt-1 text-sm font-extrabold">${formatMoney(amount)}</div></div>
                <div><div class="text-[11px] text-slate-400">المتبقي</div><div class="mt-1 text-sm font-extrabold ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}">${formatMoney(remaining)}</div></div>
                <div><div class="text-[11px] text-slate-400">مدة الاشتراك</div><div class="mt-1 text-sm font-bold">${finance.subscription_months ? esc(finance.subscription_months) + ' شهر' : '—'}</div></div>
                <div><div class="text-[11px] text-slate-400">حالة السداد</div><div class="mt-1 text-sm font-bold">${finance.is_paid ? 'مسدد' : 'غير مسدد'}</div></div>
                <div><div class="text-[11px] text-slate-400">تاريخ البداية</div><div class="mt-1 text-sm font-bold">${fmt(finance.subscription_start_date)}</div></div>
                <div><div class="text-[11px] text-slate-400">تاريخ الانتهاء</div><div class="mt-1 text-sm font-bold">${fmt(finance.subscription_end_date)}</div></div>
                <div><div class="text-[11px] text-slate-400">آخر زيارة</div><div class="mt-1 text-sm font-bold">${fmt(finance.last_visit_date)}</div></div>
                <div><div class="text-[11px] text-slate-400">موعد المتابعة القادم</div><div class="mt-1 text-sm font-bold">${fmt(finance.next_follow_up_date)}</div></div>
            </div>
            <div class="mt-4 border-t pt-3 text-xs font-extrabold text-brand-700"><i class="fa-solid fa-pen ml-1"></i>فتح بيانات الاشتراك</div>`;
        grid.appendChild(card);
    });
}
/* =========================================================
   Subscription modal
   ========================================================= */

function openFinanceModal(row) {
    selected = row;

    const finance = row.finance;

    $('modalPatient').textContent = row.name;

    $('startDate').value = finance.subscription_start_date || '';
    $('months').value = finance.subscription_months || '';
    $('amount').value = finance.subscription_amount ?? '';
    $('discount').value = finance.discount_percent ?? 0;
    $('paid').checked = Boolean(finance.is_paid);

    updateSubscriptionPreview();
    updateDiscountPreview();
    updatePaymentText();

    $('lastVisit').value = finance.last_visit_date || '';
    $('nextFollowUp').value = finance.next_follow_up_date || '';

    $('editModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeFinanceModal() {
    selected = null;
    $('editModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

/* =========================================================
   Save finance data
   ========================================================= */

async function saveFinance() {
    if (!canWriteFinance()) { showFinanceAccessMessage(); return; }
    if (!selected) return;

    const startDate = $('startDate').value || null;
    const months = $('months').value ? Number($('months').value) : null;
    const amount = $('amount').value !== ''
        ? Number($('amount').value)
        : null;
    const discount = $('discount').value !== ''
        ? Number($('discount').value)
        : 0;

    if (startDate && !months) {
        showToast('أدخل مدة الاشتراك.', true);
        return;
    }

    if (months && !startDate) {
        showToast('أدخل تاريخ بداية الاشتراك.', true);
        return;
    }

    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        showToast('قيمة الاشتراك غير صحيحة.', true);
        return;
    }

    if (discount < 0 || discount > 100 || !Number.isFinite(discount)) {
        showToast('نسبة الخصم يجب أن تكون بين 0 و100%.', true);
        return;
    }

    $('save').disabled = true;

    try {
        const lastVisitDate = $('lastVisit').value || null;

        const nextFollowUpDate = $('nextFollowUp').value || null;

        const payload = {
            patient_id: selected.id,
            user_id: user.id,
            subscription_start_date: startDate,
            subscription_months: months,
            subscription_amount: amount,
            discount_percent: discount,
            is_paid: $('paid').checked,
            last_visit_date: lastVisitDate,
            next_follow_up_date: nextFollowUpDate
        };

        const { error } = await supabase
            .from('patient_finances')
            .upsert(payload, { onConflict: 'patient_id' });

        if (error) throw error;

        showToast('تم حفظ بيانات الاشتراك.');
        closeFinanceModal();
        await loadData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'حدث خطأ أثناء الحفظ.', true);
    } finally {
        $('save').disabled = false;
    }
}

/* =========================================================
   Delete subscription
   ========================================================= */

async function openDeleteConfirmation() {
    if (!selected) return;
    const confirmed = await window.DPConfirm?.ask({
        title: 'حذف بيانات الاشتراك؟',
        message: 'هل تريد حذف بيانات الاشتراك المالي لهذا المريض؟',
        confirmText: 'حذف',
        variant: 'danger'
    });
    if (confirmed) await deleteFinance();
}

async function deleteFinance() {
    if (!canWriteFinance()) { showFinanceAccessMessage(); return; }
    if (!selected) return;

    try {
        const { error } = await supabase
            .from('patient_finances')
            .delete()
            .eq('patient_id', selected.id)
            .eq('user_id', user.id);

        if (error) throw error;

        closeFinanceModal();
        showToast('تم حذف بيانات الاشتراك.');
        await loadData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'تعذر حذف بيانات الاشتراك.', true);
    } finally {
    }
}

/* =========================================================
   Events
   ========================================================= */

function bindEvents() {
    $('search').addEventListener('input', renderPatients);
    $('statusFilter').addEventListener('change', renderPatients);
    $('sortPatients').addEventListener('change', renderPatients);
    $('financePeriod').addEventListener('change', () => { updateFinancialSummary(); });
    $('financeFrom').addEventListener('change', updateFinancialSummary);
    $('financeTo').addEventListener('change', updateFinancialSummary);

    $('grid').addEventListener('click', (event) => {
        const card = event.target.closest('[data-id]');
        if (!card) return;
        const row = rows.find((item) => item.id === card.dataset.id);
        if (row) openFinanceModal(row);
    });
    $('grid').addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-id]')) {
            event.preventDefault();
            const row = rows.find((item) => item.id === event.target.dataset.id);
            if (row) openFinanceModal(row);
        }
    });

    $('closeModal').addEventListener('click', closeFinanceModal);
    $('cancel').addEventListener('click', closeFinanceModal);
    $('deleteFinance').addEventListener('click', openDeleteConfirmation);
    $('editModal').addEventListener('click', (event) => {
        if (event.target === $('editModal')) closeFinanceModal();
    });
    $('startDate').addEventListener('input', updateSubscriptionPreview);
    $('months').addEventListener('input', updateSubscriptionPreview);
    $('amount').addEventListener('input', updateDiscountPreview);
    $('discount').addEventListener('input', updateDiscountPreview);
    $('paid').addEventListener('change', updatePaymentText);
    $('save').setAttribute('data-finance-write','true');
    $('save').addEventListener('click', saveFinance);
}
/* =========================================================
   App start
   ========================================================= */

async function init() {
    try {
        if (!supabase || !window.DietPlannerAccess?.getAccessStatus) {
            throw new Error('تعذر تهيئة الاتصال الآمن بالتطبيق.');
        }

        user = await refreshFinanceWriteAccess();

        if (!user) {
            window.DietPlannerAccess?.showAccessPrompt?.({title:'تسجيل الدخول مطلوب',message:'اشتراكات المرضى متاحة للمشتركين فقط. سجّل الدخول ثم اشترك للوصول إليها.',actionLabel:'تسجيل الدخول',actionHref:'login.html'});
            $('loading')?.remove();
            return;
        }
        if (!canWriteFinance()) {
            window.DietPlannerAccess?.showAccessPrompt?.({title:'هذه الصفحة للمشتركين',message:'إدارة اشتراكات المرضى متاحة باشتراك نشط فقط. يمكنك مراجعة خطط الاشتراك من صفحتك الشخصية.',actionLabel:'عرض خطط الاشتراك',actionHref:'profile.html'});
            $('loading')?.remove();
            return;
        }

        bindEvents();
        await loadData();

        $('loading').style.display = 'none';
    } catch (error) {
        console.error(error);

        $('loading').innerHTML = `
            <div class="rounded-2xl bg-white p-6 text-center">
                <div class="text-red-600 font-bold">تعذر تحميل بيانات اشتراكات المرضى</div>
                <div class="mt-2 text-xs text-slate-400">${esc(error.message)}</div>
            </div>
        `;
    }
}

init();
})();
