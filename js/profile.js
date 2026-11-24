(function () {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const state = {
    user: null,
    profile: { full_name: '', profession: '', phone: '' },
    subscription: null,
    subscriptions: [],
    planName: '',
    plans: [],
    selectedPlan: null,
    toastTimer: null
  };

  function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('ar-EG', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  const todayKey = window.DPDate.todayKey;

  function isActive(subscription) {
    const today = todayKey();
    return subscription?.status === 'paid'
      && subscription.start_date
      && subscription.expiry_date
      && subscription.start_date <= today
      && subscription.expiry_date >= today;
  }

  function sortByCreatedDesc(items) {
    return [...items].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  function chooseSubscription(subscriptions) {
    const items = Array.isArray(subscriptions) ? subscriptions : [];
    return items.find(isActive)
      || sortByCreatedDesc(items.filter((item) => item.status === 'pending'))[0]
      || sortByCreatedDesc(items)[0]
      || null;
  }

  function setSubscriptionStatus(text, className, note) {
    const status = $('subscriptionStatus');
    const noteEl = $('subscriptionNote');
    if (status) {
      status.textContent = text;
      status.className = className;
    }
    if (noteEl) noteEl.textContent = note || '';
  }

  function renderProfile() {
    $('profileDoctorName').textContent = state.profile.full_name || '—';
    $('doctorSpecialty').textContent = state.profile.profession || '—';
    $('doctorPhone').textContent = state.profile.phone || '—';
    $('doctorEmail').textContent = state.user?.email || '—';
  }

  function renderSubscription() {
    const sub = state.subscription;
    $('planName').textContent = state.planName || '—';
    $('startDate').textContent = formatDate(sub?.start_date);
    $('expiryDate').textContent = formatDate(sub?.expiry_date);

    if (!sub) {
      setSubscriptionStatus(
        'غير مفعل',
        'rounded-full bg-red-100 px-3 py-1 text-[11px] font-black text-red-700',
        'لم يتم تسجيل اشتراك لهذا الحساب بعد.'
      );
      return;
    }

    if (isActive(sub)) {
      const expiry = new Date(`${sub.expiry_date}T23:59:59`);
      const today = new Date(`${todayKey()}T00:00:00`);
      const days = Math.max(0, Math.ceil((expiry - today) / 86400000));
      setSubscriptionStatus(
        'ساري',
        'rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-700',
        `الاشتراك مفعّل — متبقي ${days} يوم`
      );
      return;
    }

    if (sub.status === 'pending') {
      setSubscriptionStatus(
        'قيد المراجعة',
        'rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-700',
        'طلب الاشتراك قيد المراجعة والتفعيل.'
      );
      return;
    }

    if (sub.status === 'paid' && sub.expiry_date && sub.expiry_date < todayKey()) {
      setSubscriptionStatus(
        'منتهي',
        'rounded-full bg-red-100 px-3 py-1 text-[11px] font-black text-red-700',
        'انتهت صلاحية الاشتراك.'
      );
      return;
    }

    setSubscriptionStatus(
      sub.status || 'غير مفعل',
      'rounded-full bg-slate-200 px-3 py-1 text-[11px] font-black text-slate-600',
      'لا يوجد اشتراك فعّال حاليًا.'
    );
  }

  async function loadProfile() {
    const user = state.user;
    $('doctorEmail').textContent = user?.email || '—';

    const { data, error } = await supabase
      .from('profiles')
      .select('full_name,profession,phone')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw new Error(`تعذر قراءة بيانات الطبيب: ${error.message}`);

    state.profile = {
      full_name: data?.full_name || user.user_metadata?.name || user.user_metadata?.full_name || '',
      profession: data?.profession || user.user_metadata?.specialty || '',
      phone: data?.phone || user.user_metadata?.phone || ''
    };

    renderProfile();
  }

  async function loadSubscription() {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id,user_id,start_date,expiry_date,status,notes,plan_id,is_free_trial,created_at,subscription_plans(name)')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`تعذر قراءة بيانات الاشتراك: ${error.message}`);

    const subscriptions = Array.isArray(data) ? data : [];
    state.subscriptions = subscriptions;
    state.subscription = chooseSubscription(subscriptions);

    const plan = state.subscription?.subscription_plans;
    state.planName = Array.isArray(plan) ? (plan[0]?.name || '') : (plan?.name || '');

    renderSubscription();
  }


  function pendingSubscriptionForPlan(planId) {
    return state.subscriptions
      .filter((item) => item.status === 'pending' && String(item.plan_id) === String(planId))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function loadPlans() {
    const container = $('profilePlansList');
    if (!container) return;

    container.innerHTML = '<div class="profile-plans-loading"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل الخطط...</div>';
    try {
      const request = supabase
        .from('subscription_plans')
        .select('id,name,price,duration_days,description,payment_method,payment_methods,is_free_trial')
        .eq('is_active', true)
        .order('price', { ascending: true });

      let timeoutId;
      try {
        const timeout = new Promise((_, reject) => {
          timeoutId = window.setTimeout(() => reject(new Error('انتهت مهلة تحميل الخطط. تحقق من الاتصال ثم أعد المحاولة.')), 15000);
        });
        const { data, error } = await Promise.race([request, timeout]);
        if (error) throw error;
        state.plans = Array.isArray(data) ? data : [];
        renderPlans();
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Subscription plans loading failed:', error);
      container.innerHTML = '<div class="profile-plans-empty">تعذر تحميل خطط الاشتراك. تحقق من الاتصال ثم <button type="button" data-plans-retry style="color:var(--dp-primary,#159b78);font-weight:800;text-decoration:underline">أعد المحاولة</button>.</div>';
    }
  }

  function renderPlans() {
    const container = $('profilePlansList');
    if (!container) return;
    if (!state.plans.length) {
      container.innerHTML = '<div class="profile-plans-empty">لا توجد خطط اشتراك متاحة حاليًا.</div>';
      return;
    }

    const active = state.subscriptions.find(isActive) || null;
    const trialUsed = state.subscriptions.some((item) => item.is_free_trial === true);
    const pending = sortByCreatedDesc(state.subscriptions.filter((item) => item.status === 'pending'))[0] || null;

    container.innerHTML = state.plans.map((plan, index) => {
      const isCurrent = Boolean(active && String(active.plan_id) === String(plan.id));
      const planPending = pending && String(pending.plan_id) === String(plan.id) ? pending : null;
      const isTrial = plan.is_free_trial === true;
      const price = Number(plan.price || 0);
      const duration = Number(plan.duration_days || 0);
      let action = '';
      let status = '';

      if (isCurrent) {
        status = '<span class="profile-plan-status is-current"><i class="fa-solid fa-circle-check"></i> اشتراكك الحالي</span>';
        action = '<button type="button" class="profile-plan-action" disabled>مفعّلة حاليًا</button>';
      } else if (planPending) {
        status = '<span class="profile-plan-status is-pending"><i class="fa-regular fa-clock"></i> قيد المراجعة</span>';
        action = '<button type="button" class="profile-plan-action is-secondary" data-action="open-pending" data-id="' + escapeHTML(planPending.id) + '">متابعة الطلب</button>';
      } else if (active) {
        status = '<span class="profile-plan-status">لديك اشتراك فعّال</span>';
        action = '<button type="button" class="profile-plan-action" disabled>غير متاحة حاليًا</button>';
      } else if (isTrial && trialUsed) {
        status = '<span class="profile-plan-status">تم استخدام التجربة</span>';
        action = '<button type="button" class="profile-plan-action" disabled>تم استخدام التجربة</button>';
      } else if (pending) {
        status = '<span class="profile-plan-status is-pending">لديك طلب قيد المراجعة</span>';
        action = '<button type="button" class="profile-plan-action is-secondary" data-action="open-pending" data-id="' + escapeHTML(pending.id) + '">متابعة الطلب</button>';
      } else {
        action = '<button type="button" class="profile-plan-action" data-action="subscribe" data-id="' + escapeHTML(plan.id) + '">' + (isTrial ? 'ابدأ مجانًا' : 'اشترك الآن') + '</button>';
      }

      return '<article class="profile-plan-card' + (index === state.plans.length - 1 ? ' is-last' : '') + (isCurrent ? ' is-current' : '') + '">' +
        '<div class="profile-plan-card-top"><span class="profile-plan-tier">' + escapeHTML(isTrial ? 'FREE' : (plan.name || 'SUBSCRIPTION')) + '</span>' + status + '</div>' +
        '<div class="profile-plan-price">' + (isTrial || price === 0 ? '<strong>مجاني</strong>' : '<strong>' + price.toLocaleString('ar-EG') + '</strong><span>جنيه</span>') + '</div>' +
        '<div class="profile-plan-duration">' + (duration > 0 ? 'لمدة ' + duration.toLocaleString('ar-EG') + ' يوم' : 'مدة الاشتراك حسب الخطة') + '</div>' +
        action +
      '</article>';
    }).join('');
  }

  function openProfileEditor() {
    const readView = $('profileReadView');
    const editForm = $('profileEditForm');
    if (!readView || !editForm) return;

    $('editDoctorName').value = state.profile.full_name || '';
    $('editDoctorSpecialty').value = state.profile.profession || '';
    $('editDoctorPhone').value = state.profile.phone || '';
    $('editDoctorEmail').textContent = state.user?.email || '—';

    readView.hidden = true;
    editForm.hidden = false;
    $('editDoctorName').focus();
  }

  function closeProfileEditor() {
    const readView = $('profileReadView');
    const editForm = $('profileEditForm');
    if (!readView || !editForm) return;

    editForm.reset();
    editForm.hidden = true;
    readView.hidden = false;
  }

  async function canWriteProfile() {
    const accessStatus = await access?.getAccessStatus?.();
    if (!accessStatus?.authenticated) return false;
    if (accessStatus.isAdmin === true) return true;

    return (await access?.hasActiveSubscription?.(
      accessStatus.user.id
    )) === true;
  }

  async function saveProfile() {
    if (!(await canWriteProfile())) {
        showToast('تعديل الملف الشخصي متاح أثناء الاشتراك المدفوع فقط.');
        return;
    }

    const name = $('editDoctorName').value.trim();
    const specialty = $('editDoctorSpecialty').value.trim();
    const phone = $('editDoctorPhone').value.trim();
    if (!name) {
      showToast('من فضلك اكتب اسم الطبيب');
      return;
    }

    const button = $('saveProfileBtn');
    button.disabled = true;
    button.textContent = 'جاري الحفظ...';

    try {
      const user = state.user;
      if (!user) throw new Error('انتهت جلسة تسجيل الدخول. يرجى تسجيل الدخول مرة أخرى.');

      const payload = { full_name: name, profession: specialty, phone };
      const { data, error } = await supabase
        .from('profiles')
        .update(payload)
        .eq('id', user.id)
        .select('id,full_name,profession,phone')
        .maybeSingle();

      if (error) throw new Error(`تعذر حفظ بيانات الطبيب: ${error.message}`);
      if (!data) throw new Error('لم يتم العثور على ملف الطبيب لتحديثه.');

      const { error: syncError } = await supabase
        .from('diet_templates')
        .update({ publisher_name: data.full_name })
        .eq('created_by', user.id)
        .eq('visibility', 'public');

      if (syncError) console.warn('تعذر مزامنة اسم الناشر:', syncError);

      state.profile = {
        full_name: data.full_name || '',
        profession: data.profession || '',
        phone: data.phone || ''
      };
      renderProfile();
      closeProfileEditor();
      showToast('تم حفظ بيانات الطبيب بنجاح');
    } catch (error) {
      console.error('Profile save failed:', error);
      showToast(error.message || 'حدث خطأ أثناء حفظ البيانات');
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-check ml-1"></i> حفظ التعديلات';
    }
  }

  function bindEvents() {
    $('profilePlansList')?.addEventListener('click', (event) => {
      const retry = event.target.closest('[data-plans-retry]');
      if (retry) loadPlans();
    });
    $('editProfileBtn')?.addEventListener('click', openProfileEditor);
    $('cancelProfileBtn')?.addEventListener('click', closeProfileEditor);
    $('profileEditForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      saveProfile();
    });
  }

  window.addEventListener('dietplanner:subscription-updated', async () => {
    try {
      await loadSubscription();
      renderPlans();
    } catch (error) {
      console.error('Profile subscription refresh failed:', error);
      showToast('تم تنفيذ الطلب، لكن تعذر تحديث حالة الاشتراك. أعد تحميل الصفحة.');
    }
  });

  async function init() {
    try {
      if (!supabase || typeof access.getAccessStatus !== 'function') {
        throw new Error('تعذر تهيئة نظام الحساب.');
      }

      const accessStatus = await access.getAccessStatus();
      state.user = accessStatus?.user || null;

      if (!state.user) {
        setSubscriptionStatus(
          'سجّل الدخول',
          'rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-700',
          'سجّل الدخول لعرض بيانات حسابك وإدارة اشتراكك.'
        );
        $('editProfileBtn')?.setAttribute('hidden', '');
        await loadPlans();
        return;
      }

      await Promise.all([loadProfile(), loadSubscription(), loadPlans()]);
    } catch (error) {
      console.error('Profile initialization failed:', error);
      showToast(error.message || 'تعذر تحميل الصفحة الشخصية.');
    } finally {
      $('loading')?.remove();
    }
  }

  bindEvents();
  init();
})();
