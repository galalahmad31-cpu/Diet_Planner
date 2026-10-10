(function () {
  'use strict';

const supabase = window.DietPlannerAccess?.supabaseClient;
if (!supabase) throw new Error('تعذر تهيئة اتصال قاعدة البيانات.');
const $ = (id) => document.getElementById(id);

const state = {
  notifications: {
    today: [],
    tomorrow: [],
    subscriptions: []
  },
  activeTab: 'today'
};

const TAB_INFO = {
  today: {
    title: 'متابعات اليوم',
    subtitle: 'المرضى الذين موعد متابعتهم اليوم.',
    emptyTitle: 'لا توجد متابعات اليوم',
    emptyText: 'لا توجد مواعيد متابعة مسجلة لهذا اليوم.'
  },
  tomorrow: {
    title: 'متابعات الغد',
    subtitle: 'المرضى الذين موعد متابعتهم غدًا.',
    emptyTitle: 'لا توجد متابعات غدًا',
    emptyText: 'لا توجد مواعيد متابعة مسجلة للغد.'
  },
  subscriptions: {
    title: 'الاشتراكات',
    subtitle: 'الاشتراكات التي يقترب موعد انتهائها.',
    emptyTitle: 'لا توجد تنبيهات اشتراكات',
    emptyText: 'لا توجد اشتراكات تنتهي خلال يومين أو أسبوع.'
  }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

/*
 * PostgreSQL date fields are handled as calendar dates.
 * We deliberately avoid new Date('YYYY-MM-DD') because it can
 * introduce timezone-related off-by-one errors.
 */
function dateKey(value) {
  const key = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
}

function todayKey() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}


function addDaysToDateKey(baseDate, days) {
  const key = dateKey(baseDate);
  if (!key || !Number.isInteger(Number(days))) return '';

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Number(days));

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function addMonthsToDateKey(baseDate, months) {
  const key = dateKey(baseDate);
  if (!key || !Number.isInteger(Number(months))) return '';

  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setMonth(date.getMonth() + Number(months));

  // Match the finance page: preserve end-of-month behavior.
  if (date.getDate() !== day) {
    date.setDate(0);
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function daysUntil(targetDate, referenceDate) {
  const target = dateKey(targetDate);
  const reference = dateKey(referenceDate);

  const [ty, tm, td] = target.split('-').map(Number);
  const [ry, rm, rd] = reference.split('-').map(Number);

  const targetUtc = Date.UTC(ty, tm - 1, td);
  const referenceUtc = Date.UTC(ry, rm - 1, rd);

  return Math.round((targetUtc - referenceUtc) / 86400000);
}

function formatDate(value) {
  const key = dateKey(value);
  if (!key) return '—';

  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

function addNotification(list, row, details) {
  list.push({
    patientName: row.patients?.name || 'المريض',
    ...details
  });
}

function buildNotifications(rows) {
  const result = {
    today: [],
    tomorrow: [],
    subscriptions: []
  };

  const today = todayKey();

  (rows || []).forEach((row) => {
    const nextFollowUp = dateKey(row.next_follow_up_date) ||
      addDaysToDateKey(row.last_visit_date || row.subscription_start_date, row.follow_up_days);

    const subscriptionEnd = dateKey(row.subscription_end_date) ||
      addMonthsToDateKey(row.subscription_start_date, row.subscription_months);

    /*
     * Follow-up logic:
     * - Today      -> next_follow_up_date = today
     * - Tomorrow   -> next_follow_up_date = tomorrow
     * Past dates remain overdue and are NOT automatically rolled forward.
     */
    if (nextFollowUp) {
      const followUpDays = daysUntil(nextFollowUp, today);

      if (followUpDays === 0) {
        addNotification(result.today, row, {
          type: 'متابعة اليوم',
          title: 'موعد المتابعة اليوم',
          text: 'المريض لديه موعد متابعة اليوم.',
          icon: 'fa-solid fa-calendar-check',
          box: 'bg-sky-50 text-sky-700',
          date: nextFollowUp
        });
      }

      if (followUpDays === 1) {
        addNotification(result.tomorrow, row, {
          type: 'متابعة الغد',
          title: 'موعد المتابعة غدًا',
          text: 'المريض لديه موعد متابعة غدًا.',
          icon: 'fa-solid fa-calendar-plus',
          box: 'bg-indigo-50 text-indigo-700',
          date: nextFollowUp
        });
      }
    }

    /*
     * Subscription logic:
     * - Show a daily countdown from 7 days before expiry through expiry day.
     * - Example: 7, 6, 5 ... 2, 1, today.
     * - If subscription_end_date is missing, derive it from subscription_start_date + subscription_months.
     * - Keep expired subscriptions visible with a renewal action message.
     * - No database notification rows are created; notifications are
     *   calculated fresh from subscription_end_date on every page load.
     */
    if (subscriptionEnd) {
      const subscriptionDays = daysUntil(subscriptionEnd, today);

      if (subscriptionDays >= 0 && subscriptionDays <= 7) {
        const isToday = subscriptionDays === 0;
        const isTomorrow = subscriptionDays === 1;

        let type;
        let title;
        let text;
        let icon = 'fa-solid fa-calendar-days';
        let box = 'bg-sky-50 text-sky-700';

        if (isToday) {
          type = 'ينتهي اليوم';
          title = 'الاشتراك ينتهي اليوم';
          text = 'ينتهي اشتراك المريض اليوم. يُرجى التواصل معه لتجديد الاشتراك واستمرار المتابعة.';
          icon = 'fa-solid fa-triangle-exclamation';
          box = 'bg-red-50 text-red-700';
        } else if (isTomorrow) {
          type = 'ينتهي غدًا';
          title = 'الاشتراك يقترب من الانتهاء';
          text = 'يتبقى يوم واحد على انتهاء الاشتراك. يُفضّل التواصل مع المريض لتجديد الاشتراك قبل انتهائه.';
          icon = 'fa-solid fa-calendar-day';
          box = 'bg-amber-50 text-amber-700';
        } else {
          type = `ينتهي خلال ${subscriptionDays} أيام`;
          title = 'الاشتراك يقترب من الانتهاء';
          text = `يتبقى ${subscriptionDays} أيام على انتهاء الاشتراك. يُفضّل التواصل مع المريض مسبقًا لتجديد الاشتراك.`;
          box = subscriptionDays <= 3
            ? 'bg-amber-50 text-amber-700'
            : 'bg-sky-50 text-sky-700';
        }

        addNotification(result.subscriptions, row, {
          type,
          title,
          text,
          icon,
          box,
          date: subscriptionEnd
        });
      } else if (subscriptionDays < 0) {
        const expiredDays = Math.abs(subscriptionDays);
        const elapsedText = expiredDays === 1
          ? 'يوم واحد'
          : `${expiredDays} أيام`;

        addNotification(result.subscriptions, row, {
          type: 'انتهى الاشتراك',
          title: 'انتهى اشتراك المريض',
          text: `انتهى الاشتراك منذ ${elapsedText}. يُرجى التواصل مع المريض لتجديد الاشتراك واستمرار المتابعة.`,
          icon: 'fa-solid fa-circle-exclamation',
          box: 'bg-red-50 text-red-700',
          date: subscriptionEnd
        });
      }
    }
  });

  return result;
}

function render() {
  const list = state.notifications[state.activeTab] || [];
  const info = TAB_INFO[state.activeTab];

  $('count').textContent = list.length;
  $('tabTitle').textContent = info.title;
  $('tabSubtitle').textContent = info.subtitle;
  $('emptyTitle').textContent = info.emptyTitle;
  $('emptyText').textContent = info.emptyText;

  $('notifications').innerHTML = '';
  $('empty').classList.toggle('hidden', list.length > 0);

  list.forEach((notification) => {
    const element = document.createElement('div');

    element.className = 'card glass rounded-3xl p-4 sm:p-5';

    element.innerHTML = `
      <div class="flex items-start gap-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${notification.box}">
          <i class="${notification.icon}"></i>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-extrabold text-slate-800">
              ${esc(notification.patientName)}
            </h3>

            <span class="rounded-full px-2.5 py-1 text-[10px] font-bold ${notification.box}">
              ${esc(notification.type)}
            </span>
          </div>

          <p class="mt-1 text-sm font-extrabold text-slate-700">
            ${esc(notification.title)}
          </p>

          <p class="mt-1 text-sm leading-6 text-slate-500">
            ${esc(notification.text)}
          </p>

          ${
            notification.date
              ? `
                <div class="mt-2 text-xs font-bold text-slate-400">
                  <i class="fa-regular fa-calendar ml-1"></i>
                  ${formatDate(notification.date)}
                </div>
              `
              : ''
          }
        </div>
      </div>
    `;

    $('notifications').appendChild(element);
  });
}

function updateTabButtons() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const isActive = button.dataset.tab === state.activeTab;

    button.classList.toggle('active', isActive);
    button.classList.toggle('text-slate-500', !isActive);
  });
}

function showError(error) {
  console.error('Notifications error:', error);

  $('loading').innerHTML = `
    <div class="rounded-2xl bg-white p-6 text-center shadow-sm">
      <div class="text-red-600 font-bold">تعذر تحميل الإشعارات</div>
      <div class="mt-2 text-xs text-slate-400">
        ${esc(error?.message || 'حدث خطأ غير معروف')}
      </div>
    </div>
  `;
}

async function loadNotifications() {
  const user = await window.DietPlannerAccess?.getCurrentUser();

  if (!user) {
    location.replace('index.html');
    return;
  }

  const { data, error } = await supabase
    .from('patient_finances')
    .select(`
      patient_id,
      subscription_end_date,
      next_follow_up_date,
      follow_up_days,
      last_visit_date,
      subscription_start_date,
      subscription_months,
      patients(name)
    `)
    .eq('user_id', user.id);

  if (error) throw error;

  state.notifications = buildNotifications(data);

  $('todayCount').textContent = state.notifications.today.length;
  $('tomorrowCount').textContent = state.notifications.tomorrow.length;
  $('subscriptionCount').textContent = state.notifications.subscriptions.length;

  updateTabButtons();
  render();

  $('loading').style.display = 'none';
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;

  const nextTab = button.dataset.tab;
  if (!TAB_INFO[nextTab] || nextTab === state.activeTab) return;

  state.activeTab = nextTab;
  updateTabButtons();
  render();
});

(async () => {
  try {
    await loadNotifications();
  } catch (error) {
    showError(error);
  } finally {
    const loading = $('loading');
    if (loading) loading.style.display = 'none';
  }
})();
})();
