(function () {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const state = {
    user: null,
    profile: { full_name: '', profession: '', phone: '' },
    subscription: null,
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

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

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
    $('doctorName').textContent = state.profile.full_name || '—';
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
      .select('id,user_id,start_date,expiry_date,status,notes,plan_id,created_at,subscription_plans(name)')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`تعذر قراءة بيانات الاشتراك: ${error.message}`);

    const subscriptions = Array.isArray(data) ? data : [];
    state.subscription = chooseSubscription(subscriptions);

    const plan = state.subscription?.subscription_plans;
    state.planName = Array.isArray(plan) ? (plan[0]?.name || '') : (plan?.name || '');

    renderSubscription();
  }


  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function loadPlans() {
    const container = $('profilePlansList');
    try {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('id,name,price,duration_days,description,payment_method,is_free_trial')
        .eq('is_active', true)
        .order('price', { ascending: true });
      if (error) throw error;
      state.plans = Array.isArray(data) ? data : [];
      renderPlans();
    } catch (error) {
      console.error('Subscription plans loading failed:', error);
      if (container) container.innerHTML = '<div class="profile-plans-empty">تعذر تحميل خطط الاشتراك حاليًا.</div>';
    }
  }

  function renderPlans() {
    const container = $('profilePlansList');
    if (!container) return;
    if (!state.plans.length) {
      container.innerHTML = '<div class="profile-plans-empty">لا توجد خطط اشتراك متاحة حاليًا.</div>';
      return;
    }
    container.innerHTML = state.plans.map((plan) => (
      '<article class="profile-plan-tile">' +
        '<div class="profile-plan-name">' + escapeHTML(plan.name || 'خطة اشتراك') + '</div>' +
        '<button type="button" class="profile-plan-details" data-plan-action="details" data-plan-id="' + escapeHTML(plan.id) + '">اضغط للتفاصيل</button>' +
      '</article>'
    )).join('');
  }

  function openPlanDetails(planId) {
    const plan = state.plans.find((item) => String(item.id) === String(planId));
    if (!plan) return;
    state.selectedPlan = plan;
    const modal = $('planDetailsModal');
    const title = $('planDetailsTitle');
    const body = $('planDetailsBody');
    if (!modal || !title || !body) return;

    title.textContent = plan.name || 'تفاصيل الخطة';
    const pendingForPlan = state.subscription?.status === 'pending'
      && String(state.subscription.plan_id) === String(plan.id);
    const price = Number(plan.price || 0).toLocaleString('ar-EG');
    const rows = [
      '<div class="plan-detail-line"><strong>السعر</strong><span>' + price + ' جنيه</span></div>',
      '<div class="plan-detail-line"><strong>المدة</strong><span>' + Number(plan.duration_days || 0).toLocaleString('ar-EG') + ' يوم</span></div>',
      '<div class="plan-detail-line"><strong>نوع الخطة</strong><span>' + (plan.is_free_trial === true ? 'تجربة مجانية' : 'اشتراك مدفوع') + '</span></div>'
    ];
    if (plan.payment_method) rows.push('<div class="plan-detail-line"><strong>طريقة الدفع</strong><span>' + escapeHTML(plan.payment_method) + '</span></div>');
    if (plan.description) rows.push('<div class="plan-detail-line plan-detail-description"><strong>تفاصيل ومميزات الخطة</strong><span>' + escapeHTML(plan.description) + '</span></div>');
    body.innerHTML = rows.join('');
    const actionButton = $('planDetailsSubscribe');
    if (actionButton) {
      actionButton.innerHTML = pendingForPlan
        ? '<i class="fa-solid fa-xmark"></i> إلغاء طلب الاشتراك'
        : '<i class="fa-solid fa-check"></i> الاشتراك الآن';
      actionButton.setAttribute('aria-label', pendingForPlan ? 'إلغاء طلب الاشتراك لهذه الخطة' : 'الاشتراك في هذه الخطة');
    }
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('planDetailsSubscribe')?.focus();
  }

  function closePlanDetails() {
    const modal = $('planDetailsModal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    state.selectedPlan = null;
  }

  async function continueToSubscription() {
    const selectedPlan = state.selectedPlan;
    if (!selectedPlan) return;

    const isPending = state.subscription?.status === 'pending'
      && String(state.subscription.plan_id) === String(selectedPlan.id);
    const button = $('planDetailsSubscribe');
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }

    try {
      if (isPending) {
        if (typeof window.cancelPendingSubscriptionForPlan !== 'function') {
          showToast('تعذر إلغاء طلب الاشتراك. حدّث الصفحة وحاول مرة أخرى.');
          return;
        }
        const cancelled = await window.cancelPendingSubscriptionForPlan(String(selectedPlan.id));
        if (cancelled) {
          closePlanDetails();
          await loadSubscription();
          renderPlans();
        }
        return;
      }

      if (typeof window.openSubscribeModal !== 'function') {
        showToast('تعذر فتح نموذج الاشتراك. حدّث الصفحة وحاول مرة أخرى.');
        return;
      }
      const opened = await window.openSubscribeModal(String(selectedPlan.id));
      if (opened) {
        closePlanDetails();
        document.body.style.overflow = 'hidden';
      } else {
        showToast('تعذر فتح نموذج الاشتراك لهذه الخطة. حاول مرة أخرى.');
      }
    } catch (error) {
      console.error('Plan subscription action failed:', error);
      showToast('حدث خطأ أثناء تنفيذ العملية.');
    } finally {
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
    }
  }

  function openProfileEditor() {
    $('editDoctorName').value = state.profile.full_name;
    $('editDoctorSpecialty').value = state.profile.profession;
    $('editDoctorPhone').value = state.profile.phone;
    $('editDoctorEmail').textContent = state.user?.email || '—';
    $('editProfileModal').classList.remove('hidden');
    $('editProfileModal').classList.add('flex');
  }

  function closeProfileEditor() {
    $('editProfileModal').classList.add('hidden');
    $('editProfileModal').classList.remove('flex');
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

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Logout failed:', error);
    window.location.replace('index.html');
  }

  function bindEvents() {
    $('profilePlansList')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-plan-action="details"]');
      if (button) openPlanDetails(button.dataset.planId);
    });
    $('planDetailsModal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget || event.target.closest('[data-plan-action="close"]')) closePlanDetails();
    });
    $('planDetailsSubscribe')?.addEventListener('click', continueToSubscription);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('planDetailsModal') && !$('planDetailsModal').hidden) closePlanDetails();
    });
    $('editProfileBtn')?.addEventListener('click', openProfileEditor);
    $('cancelProfileBtn')?.addEventListener('click', closeProfileEditor);
    $('saveProfileBtn')?.addEventListener('click', saveProfile);
    $('logoutBtn')?.addEventListener('click', logout);
    $('editProfileModal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeProfileEditor();
    });
  }

  async function init() {
    try {
      if (!supabase || typeof access.getAccessStatus !== 'function') {
        throw new Error('تعذر تهيئة نظام الحساب.');
      }

      const accessStatus = await access.getAccessStatus();
      state.user = accessStatus?.user || null;
      if (!state.user) {
        setSubscriptionStatus(
          'غير متاح',
          'rounded-full bg-slate-200 px-3 py-1 text-[11px] font-black text-slate-600',
          'لا توجد جلسة تسجيل دخول.'
        );
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
