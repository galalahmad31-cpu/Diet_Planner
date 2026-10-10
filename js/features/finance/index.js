(function(){
'use strict';
const supabase = window.DietPlannerAccess?.supabaseClient;

const $ = (id) => document.getElementById(id);

let user = null;
let rows = [];
let selected = null;
let pendingFollowUpPatient = null;
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

function addDays(dateValue, days) {
    if (!dateValue || !days) return null;

    const [y, m, d] = String(dateValue).slice(0, 10).split('-').map(Number);
    if (![y, m, d].every(Number.isFinite)) return null;

    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + Number(days));
    return formatISODate(date);
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

function getNextFollowUpDate(lastVisitDate, followUpDays) {
    const days = Number(followUpDays);

    if (!lastVisitDate || !Number.isFinite(days) || days < 1) {
        return null;
    }

    return addDays(lastVisitDate, days);
}

function updateFollowUpPreview() {
    const next = getNextFollowUpDate(
        $('lastVisit').value,
        $('followUpDays').value
    );

    $('nextFollowUp').textContent = next ? fmt(next) : '—';
}

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
            follow_up_days,
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

function renderPatients() {
    const query = $('search').value.trim().toLowerCase();

    const visibleRows = rows.filter((row) =>
        !query || String(row.name || '').toLowerCase().includes(query)
    );

    const grid = $('grid');
    grid.innerHTML = '';

    $('empty').classList.toggle('hidden', visibleRows.length > 0);

    let paid = 0;
    let unpaid = 0;
    let expired = 0;

    rows.forEach((row) => {
        const finance = row.finance;

        if (finance.is_paid) {
            paid++;
        } else {
            unpaid++;
        }

        if (
            finance.subscription_end_date &&
            finance.subscription_end_date < todayISO()
        ) {
            expired++;
        }
    });

    $('totalCount').textContent = rows.length;
    $('paidCount').textContent = paid;
    $('unpaidCount').textContent = unpaid;
    $('expiredCount').textContent = expired;

    visibleRows.forEach((row) => {
        const finance = row.finance;
        const [statusText, statusClass] = getSubscriptionStatus(finance);

        const card = document.createElement('div');
        card.className = 'card glass rounded-3xl p-5 text-right shadow-sm cursor-pointer';
        card.dataset.id = row.id;

        card.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="flex min-w-0 items-center gap-3">
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                        <i class="fa-solid fa-user"></i>
                    </div>
                    <div class="min-w-0">
                        <h3 class="truncate text-lg font-extrabold text-slate-800">${esc(row.name)}</h3>
                        <p class="mt-1 text-xs text-slate-400">بيانات الاشتراك</p>
                    </div>
                </div>

                <span class="shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${statusClass}">
                    ${statusText}
                </span>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-3 border-t pt-4">
                <div>
                    <div class="text-[11px] text-slate-400">بداية الاشتراك</div>
                    <div class="mt-1 text-sm font-bold">${fmt(finance.subscription_start_date)}</div>
                </div>

                <div>
                    <div class="text-[11px] text-slate-400">المدة</div>
                    <div class="mt-1 text-sm font-bold">
                        ${finance.subscription_months ? `${esc(finance.subscription_months)} شهر` : '—'}
                    </div>
                </div>

                <div>
                    <div class="text-[11px] text-slate-400">النهاية</div>
                    <div class="mt-1 text-sm font-bold">${fmt(finance.subscription_end_date)}</div>
                </div>

                <div>
                    <div class="text-[11px] text-slate-400">السداد</div>
                    <div class="mt-1 text-sm font-bold">${finance.is_paid ? 'نعم' : 'لا'}</div>
                </div>

                <div>
                    <div class="text-[11px] text-slate-400">مدة المتابعة</div>
                    <div class="mt-1 text-sm font-bold">
                        ${finance.follow_up_days ? `${esc(finance.follow_up_days)} يوم` : '—'}
                    </div>
                </div>

                <div>
                    <div class="text-[11px] text-slate-400">المتابعة القادمة</div>
                    <div class="mt-1 text-sm font-bold">${fmt(finance.next_follow_up_date)}</div>
                </div>
            </div>

            <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span class="text-xs font-bold text-brand-600">
                    <i class="fa-solid fa-pen ml-1"></i>
                    فتح بيانات الاشتراك
                </span>

                <button
                    type="button"
                    class="follow-btn inline-flex h-9 items-center justify-center rounded-xl bg-brand-50 px-3 text-xs font-extrabold text-brand-700"
                    data-follow="${esc(row.id)}"
                >
                    <i class="fa-solid fa-calendar-check ml-1"></i>
                    تسجيل حضور المتابعة
                </button>
            </div>
        `;

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
    $('followUpDays').value = finance.follow_up_days ?? '';
    $('discount').value = finance.discount_percent ?? 0;
    $('paid').checked = Boolean(finance.is_paid);

    updateSubscriptionPreview();
    updateDiscountPreview();
    updatePaymentText();

    $('lastVisit').value = finance.last_visit_date || '';

    $('nextFollowUp').textContent = finance.next_follow_up_date
        ? fmt(finance.next_follow_up_date)
        : '—';

    $('editModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeFinanceModal() {
    selected = null;
    $('editModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

/* =========================================================
   Follow-up attendance modal
   ========================================================= */

function openFollowUpConfirmation(patientId) {
    const row = rows.find((item) => item.id === patientId);

    if (!row) return;

    if (!row.finance.follow_up_days) {
        showToast('حدد مدة المتابعة أولًا من بيانات الاشتراك.', true);
        return;
    }

    pendingFollowUpPatient = patientId;
    $('followVisitDate').value = todayISO();

    $('followConfirm').classList.remove('hidden');
    $('followConfirm').classList.add('flex');
    document.body.classList.add('overflow-hidden');
}

function closeFollowUpConfirmation() {
    pendingFollowUpPatient = null;
    $('followConfirm').classList.add('hidden');
    $('followConfirm').classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
}

async function recordAttendance(patientId, actualVisitDate) {
    if (!canWriteFinance()) { showFinanceAccessMessage(); return; }
    const row = rows.find((item) => item.id === patientId);

    if (!row) return;

    const followUpDays = Number(row.finance.follow_up_days);

    if (!Number.isFinite(followUpDays) || followUpDays < 1) {
        showToast('حدد مدة المتابعة أولًا من بيانات الاشتراك.', true);
        return;
    }

    const visitDate = actualVisitDate || todayISO();
    const nextDate = addDays(visitDate, followUpDays);

    const { error } = await supabase
        .from('patient_finances')
        .update({
            last_visit_date: visitDate,
            next_follow_up_date: nextDate
        })
        .eq('patient_id', patientId)
        .eq('user_id', user.id);

    if (error) {
        console.error(error);
        showToast(error.message || 'تعذر تسجيل الحضور.', true);
        return;
    }

    showToast('تم تسجيل الحضور وتحديد موعد المتابعة القادم.');
    await loadData();
}

/* =========================================================
   Save finance data
   ========================================================= */

async function saveFinance() {
    if (!canWriteFinance()) { showFinanceAccessMessage(); return; }
    if (!selected) return;

    const startDate = $('startDate').value || null;
    const months = $('months').value ? Number($('months').value) : null;
    const followUpDays = $('followUpDays').value
        ? Number($('followUpDays').value)
        : null;
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

    if (followUpDays !== null && (!Number.isFinite(followUpDays) || followUpDays < 1)) {
        showToast('مدة المتابعة يجب أن تكون يومًا واحدًا على الأقل.', true);
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

        const nextFollowUpDate = getNextFollowUpDate(
            lastVisitDate,
            followUpDays
        );

        const payload = {
            patient_id: selected.id,
            user_id: user.id,
            subscription_start_date: startDate,
            subscription_months: months,
            subscription_amount: amount,
            discount_percent: discount,
            is_paid: $('paid').checked,
            follow_up_days: followUpDays,
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

function openDeleteConfirmation() {
    if (!selected) return;
    $('deleteConfirm').classList.remove('hidden');
    $('deleteConfirm').classList.add('flex');
}

function closeDeleteConfirmation() {
    $('deleteConfirm').classList.add('hidden');
    $('deleteConfirm').classList.remove('flex');
}

async function deleteFinance() {
    if (!canWriteFinance()) { showFinanceAccessMessage(); return; }
    if (!selected) return;

    $('deleteYes').disabled = true;

    try {
        const { error } = await supabase
            .from('patient_finances')
            .delete()
            .eq('patient_id', selected.id)
            .eq('user_id', user.id);

        if (error) throw error;

        closeDeleteConfirmation();
        closeFinanceModal();
        showToast('تم حذف بيانات الاشتراك.');
        await loadData();
    } catch (error) {
        console.error(error);
        showToast(error.message || 'تعذر حذف بيانات الاشتراك.', true);
    } finally {
        $('deleteYes').disabled = false;
    }
}

/* =========================================================
   Events
   ========================================================= */

function bindEvents() {
    $('search').addEventListener('input', renderPatients);

    $('grid').addEventListener('click', (event) => {
        const followButton = event.target.closest('[data-follow]');

        if (followButton) {
            event.preventDefault();
            event.stopPropagation();
            openFollowUpConfirmation(followButton.dataset.follow);
            return;
        }

        const card = event.target.closest('[data-id]');

        if (!card) return;

        const row = rows.find((item) => item.id === card.dataset.id);

        if (row) {
            openFinanceModal(row);
        }
    });

    $('closeModal').addEventListener('click', closeFinanceModal);
    $('cancel').addEventListener('click', closeFinanceModal);
    $('deleteFinance').addEventListener('click', openDeleteConfirmation);
    $('deleteNo').addEventListener('click', closeDeleteConfirmation);

    $('deleteConfirm').addEventListener('click', (event) => {
        if (event.target === $('deleteConfirm')) {
            closeDeleteConfirmation();
        }
    });

    $('deleteYes').setAttribute('data-finance-write','true');
    $('deleteYes').addEventListener('click', deleteFinance);

    $('editModal').addEventListener('click', (event) => {
        if (event.target === $('editModal')) {
            closeFinanceModal();
        }
    });

    $('startDate').addEventListener('input', updateSubscriptionPreview);
    $('lastVisit').addEventListener('input', updateFollowUpPreview);

    $('months').addEventListener('input', updateSubscriptionPreview);

    $('followUpDays').addEventListener('input', updateFollowUpPreview);

    $('amount').addEventListener('input', updateDiscountPreview);
    $('discount').addEventListener('input', updateDiscountPreview);

    $('paid').addEventListener('change', updatePaymentText);

    $('followNo').addEventListener('click', closeFollowUpConfirmation);

    $('followConfirm').addEventListener('click', (event) => {
        if (event.target === $('followConfirm')) {
            closeFollowUpConfirmation();
        }
    });

    $('followYes').addEventListener('click', async () => {
        if (!pendingFollowUpPatient) return;

        const patientId = pendingFollowUpPatient;
        const visitDate = $('followVisitDate').value;

        if (!visitDate) {
            showToast('اختر تاريخ الحضور.', true);
            return;
        }

        closeFollowUpConfirmation();
        await recordAttendance(patientId, visitDate);
    });

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
            location.replace('index.html');
            return;
        }

        bindEvents();
        await loadData();

        $('loading').style.display = 'none';
    } catch (error) {
        console.error(error);

        $('loading').innerHTML = `
            <div class="rounded-2xl bg-white p-6 text-center">
                <div class="text-red-600 font-bold">تعذر تحميل ماليات المرضى</div>
                <div class="mt-2 text-xs text-slate-400">${esc(error.message)}</div>
            </div>
        `;
    }
}

init();
})();
