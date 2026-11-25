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
function mapCalculatedNotifications(events, financeRows) {
  const names = new Map((financeRows || []).map(row => [row.patient_id, row.patients?.name || 'المريض']));
  const result = { today: [], tomorrow: [], subscriptions: [] };
  (events || []).forEach(event => {
    const item = { id: event.id, read_at: event.read_at, patientName: names.get(event.patient_id) || 'المريض', title: event.title, text: event.body, date: String(event.source_key || '').split(':').at(-1) };
    if (event.event_type === 'calculated_follow_up_today') result.today.push({ ...item, type: 'متابعة اليوم', icon: 'fa-solid fa-calendar-check', tone: 'info' });
    else if (event.event_type === 'calculated_follow_up_tomorrow') result.tomorrow.push({ ...item, type: 'متابعة الغد', icon: 'fa-solid fa-calendar-plus', tone: 'info' });
    else if (event.event_type === 'calculated_subscription') {
      const expired = event.title === 'انتهى اشتراك المريض';
      const today = event.title === 'الاشتراك ينتهي اليوم';
      const tomorrow = event.body.includes('يوم واحد');
      result.subscriptions.push({ ...item, type: expired ? 'انتهى الاشتراك' : today ? 'ينتهي اليوم' : tomorrow ? 'ينتهي غدًا' : 'اشتراك يقترب من الانتهاء', icon: expired || today ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-calendar-days', tone: expired || today ? 'danger' : tomorrow ? 'warning' : 'info' });
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
            <button type="button" class="notification-open-button" data-notification-open="${esc(notification.id)}" data-patient-id="${esc(notification.patient_id)}" data-actor-id="${esc(notification.actor_id)}" data-event-type="${esc(notification.event_type)}">
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

    element.className = 'card glass rounded-3xl p-4 sm:p-5 notification-card' + (notification.read_at ? ' is-read' : '');

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
          <div class="mt-3 flex items-center justify-between gap-2">
            <span class="text-xs font-bold notification-read-state">${notification.read_at ? 'تمت القراءة' : 'غير مقروء'}</span>
            ${notification.read_at ? '' : `<button type="button" class="notification-mark-read" data-mark-calculated-read="${esc(notification.id)}">تمت القراءة</button>`}
          </div>
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

  await window.DPNotificationStore.sync(user);

  const { data: events, error: eventError } = await supabase
    .from('notifications')
    .select('id,event_type,title,body,created_at,read_at,patient_id,actor_id,source_key')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (eventError) throw eventError;

  const calculated = mapCalculatedNotifications(events || [], financeRows);
  state.notifications = {
    ...calculated,
    messages: (events || []).filter(event => !String(event.event_type).startsWith('calculated_')).map(event => ({
      ...event,
      icon: event.event_type === 'message_received' ? 'fa-comment-dots' : 'fa-bowl-food'
    }))
  };

  $('todayCount').textContent = state.notifications.today.filter(item => !item.read_at).length;
  $('tomorrowCount').textContent = state.notifications.tomorrow.filter(item => !item.read_at).length;
  $('subscriptionCount').textContent = state.notifications.subscriptions.filter(item => !item.read_at).length;
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
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'patient_finances',
      filter: `user_id=eq.${currentUser.id}`
    }, () => {
      loadNotifications().catch(showError);
    })
    .subscribe();
}

document.addEventListener('click', async (event) => {
  const markReadButton = event.target.closest('[data-mark-calculated-read]');
  if (markReadButton) {
    markReadButton.disabled = true;
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', markReadButton.dataset.markCalculatedRead).eq('recipient_id', currentUser.id).is('read_at', null);
    if (error) { console.error('Unable to mark calculated notification as read:', error); markReadButton.disabled = false; return; }
    await loadNotifications();
    return;
  }

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
    const actorId = openButton.dataset.actorId;
    const eventType = openButton.dataset.eventType;
    if (currentAccountType === "professional") {
      if (eventType === "message_received") {
        location.href = actorId
          ? `communications.html?patient_id=${encodeURIComponent(actorId)}`
          : "communications.html";
      } else if (patientId) {
        location.href = `patient-profile.html?id=${encodeURIComponent(patientId)}`;
      } else {
        location.href = "communications.html";
      }
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
