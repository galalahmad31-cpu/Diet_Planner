(function () {
  'use strict';

const supabase = window.DietPlannerAccess?.supabaseClient;
if (!supabase) throw new Error('تعذر تهيئة اتصال قاعدة البيانات.');
const $ = (id) => document.getElementById(id);

const state = {
  notifications: {
    today: [],
    tomorrow: [],
    subscriptions: [],
    messages: []
  },
  activeTab: 'today'
};
let currentUser = null;
let currentAccountType = null;
let notificationChannel = null;

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
  },
  messages: {
    title: 'الرسائل والتنبيهات',
    subtitle: 'الرسائل والخطط الغذائية التي تمت مشاركتها معك.',
    emptyTitle: 'لا توجد تنبيهات جديدة',
    emptyText: 'ستظهر هنا الرسائل والخطط الجديدة المرتبطة بملفاتك.'
  }
};

const esc = window.DPUtils.escapeHtml;

const dateKey = window.DPDate.dateKey;
const todayKey = window.DPDate.todayKey;
const daysUntil = window.DPDate.daysUntil;

function addMonthsToDateKey(baseDate, months) {
  if (!Number.isInteger(Number(months))) return '';
  return window.DPDate.addMonths(baseDate, months);
}


const formatDate = window.DPDate.formatDMY;
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
    const nextFollowUp = dateKey(row.next_follow_up_date);

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
          tone: 'info',
          date: nextFollowUp
        });
      }

      if (followUpDays === 1) {
        addNotification(result.tomorrow, row, {
          type: 'متابعة الغد',
          title: 'موعد المتابعة غدًا',
          text: 'المريض لديه موعد متابعة غدًا.',
          icon: 'fa-solid fa-calendar-plus',
          tone: 'info',
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
        let tone = 'info';

        if (isToday) {
          type = 'ينتهي اليوم';
          title = 'الاشتراك ينتهي اليوم';
          text = 'ينتهي اشتراك المريض اليوم. يُرجى التواصل معه لتجديد الاشتراك واستمرار المتابعة.';
          icon = 'fa-solid fa-triangle-exclamation';
          tone = 'danger';
        } else if (isTomorrow) {
          type = 'ينتهي غدًا';
          title = 'الاشتراك يقترب من الانتهاء';
          text = 'يتبقى يوم واحد على انتهاء الاشتراك. يُفضّل التواصل مع المريض لتجديد الاشتراك قبل انتهائه.';
          icon = 'fa-solid fa-calendar-day';
          tone = 'warning';
        } else {
          type = `ينتهي خلال ${subscriptionDays} أيام`;
          title = 'الاشتراك يقترب من الانتهاء';
          text = `يتبقى ${subscriptionDays} أيام على انتهاء الاشتراك. يُفضّل التواصل مع المريض مسبقًا لتجديد الاشتراك.`;
          tone = subscriptionDays <= 3 ? 'warning' : 'info';
        }

        addNotification(result.subscriptions, row, {
          type,
          title,
          text,
          icon,
          tone,
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
          tone: 'danger',
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

  if (state.activeTab === 'messages') {
    list.forEach((notification) => {
      const element = document.createElement('article');
      const unread = !notification.read_at;
      const date = notification.created_at
        ? new Date(notification.created_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
        : '';
      element.className = 'card glass rounded-3xl p-4 sm:p-5 notification-card notification-event-card';
      element.innerHTML = `
        <div class="flex items-start gap-3">
          <div class="notification-event-icon"><i class="fa-solid ${notification.icon}"></i></div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-extrabold notification-patient-name">${esc(notification.title)}</h3>
              ${unread ? '<span class="notification-unread-label">جديد</span>' : ''}
            </div>
            <p class="mt-1 text-sm leading-6 notification-copy">${esc(notification.body)}</p>
            <div class="mt-2 text-xs notification-date">${esc(date)}</div>
            <button type="button" class="notification-open-button" data-notification-open="${esc(notification.id)}" data-patient-id="${esc(notification.patient_id)}">
              ${currentAccountType === 'professional' ? 'فتح الطلب أو المحادثة' : 'فتح بوابة المريض'}
              <i class="fa-solid fa-arrow-left mr-1"></i>
            </button>
          </div>
        </div>`;
      $('notifications').appendChild(element);
    });
    return;
  }

  list.forEach((notification) => {
    const element = document.createElement('div');

    element.className = 'card glass rounded-3xl p-4 sm:p-5 notification-card';

    element.innerHTML = `
      <div class="flex items-start gap-4">
        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl notification-tone notification-tone-${notification.tone}">
          <i class="${notification.icon}"></i>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-extrabold text-slate-800 notification-patient-name">
              ${esc(notification.patientName)}
            </h3>

            <span class="rounded-full px-2.5 py-1 text-[10px] font-bold notification-tone notification-tone-${notification.tone}">
              ${esc(notification.type)}
            </span>
          </div>

          <p class="mt-1 text-sm font-extrabold text-slate-700 notification-title">
            ${esc(notification.title)}
          </p>

          <p class="mt-1 text-sm leading-6 text-slate-500 notification-copy">
            ${esc(notification.text)}
          </p>

          ${
            notification.date
              ? `
                <div class="mt-2 text-xs font-bold text-slate-400 notification-date">
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
    <div class="notification-error-panel rounded-2xl p-6 text-center shadow-sm">
      <div class="notification-error-title font-bold">تعذر تحميل الإشعارات</div>
      <div class="notification-error-detail mt-2 text-xs">
        ${esc(error?.message || 'حدث خطأ غير معروف')}
      </div>
    </div>
  `;
}

async function loadNotifications() {
  const user = currentUser || await window.DietPlannerAccess?.getCurrentUser();
  if (!user) {
    location.replace('index.html');
    return;
  }
  currentUser = user;
  currentAccountType = await window.DietPlannerAccess?.getUserAccountType(user.id);

  let financeRows = [];
  if (currentAccountType !== 'patient') {
    const { data, error } = await supabase
      .from('patient_finances')
      .select(`
        patient_id,
        subscription_end_date,
        next_follow_up_date,
        subscription_start_date,
        subscription_months,
        patients(name)
      `)
      .eq('user_id', user.id);
    if (error) throw error;
    financeRows = data || [];
  }

  const { data: events, error: eventError } = await supabase
    .from('notifications')
    .select('id,event_type,title,body,created_at,read_at,patient_id')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (eventError) throw eventError;

  state.notifications = {
    ...buildNotifications(financeRows),
    messages: (events || []).map(event => ({
      ...event,
      icon: event.event_type === 'message_received' ? 'fa-comment-dots' : 'fa-bowl-food'
    }))
  };

  $('todayCount').textContent = state.notifications.today.length;
  $('tomorrowCount').textContent = state.notifications.tomorrow.length;
  $('subscriptionCount').textContent = state.notifications.subscriptions.length;
  $('messagesCount').textContent = state.notifications.messages.filter(item => !item.read_at).length;

  updateTabButtons();
  render();
  $('loading').style.display = 'none';
}

function subscribeToNotifications() {
  if (!currentUser?.id || notificationChannel) return;
  notificationChannel = supabase
    .channel(`dp-notifications-page-${currentUser.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `recipient_id=eq.${currentUser.id}`
    }, () => {
      loadNotifications().catch(showError);
    })
    .subscribe();
}

document.addEventListener('click', async (event) => {
  const openButton = event.target.closest('[data-notification-open]');
  if (openButton) {
    if (openButton.disabled) return;
    openButton.disabled = true;
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', openButton.dataset.notificationOpen)
      .eq('recipient_id', currentUser.id)
      .is('read_at', null);
    if (error) {
      console.error('Unable to mark notification as read:', error);
      openButton.disabled = false;
      return;
    }
    const patientId = openButton.dataset.patientId;
    if (currentAccountType === "professional" && patientId) {
      location.href = `patient-profile.html?id=${encodeURIComponent(patientId)}`;
    } else {
      location.href = "patient-portal.html";
    }
    return;
  }

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
    subscribeToNotifications();
  } catch (error) {
    showError(error);
  } finally {
    const loading = $('loading');
    if (loading) loading.style.display = 'none';
  }
})();
})();
