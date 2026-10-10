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

      await Promise.all([loadProfile(), loadSubscription()]);
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
