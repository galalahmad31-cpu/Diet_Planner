(function () {
  'use strict';

  // This page uses the central Supabase client only.
  // It does NOT use can_access() or get_page_access().
  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);

  const state = {
    user: null,
    plans: [],
    subscriptions: [],
    selectedPlanId: null,
    currentSubscription: null,
    confirmResolver: null,
    toastTimer: null
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  function showToast(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function goDashboard() {
    window.location.href = 'app.html';
  }

  function goProfile() {
    window.location.href = 'profile.html';
  }

  function showConfirmPopup(message, title = 'تأكيد العملية') {
    return new Promise((resolve) => {
      state.confirmResolver = resolve;
      $('confirmTitle').textContent = title;
      $('confirmMessage').textContent = message;
      $('confirmOverlay').style.display = 'flex';
    });
  }

  function resolveConfirm(value) {
    $('confirmOverlay').style.display = 'none';
    if (!state.confirmResolver) return;
    const resolver = state.confirmResolver;
    state.confirmResolver = null;
    resolver(value);
  }

  function getActiveSubscription() {
    if (!state.user) return null;
    const today = new Date().toISOString().slice(0, 10);
    return state.subscriptions.find((subscription) =>
      subscription.status === 'paid' &&
      subscription.start_date &&
      subscription.expiry_date &&
      subscription.start_date <= today &&
      subscription.expiry_date >= today
    ) || null;
  }

  function getPendingSubscription() {
    if (!state.user) return null;
    return state.subscriptions.find((subscription) => subscription.status === 'pending') || null;
  }

  function hasUsedFreeTrial() {
    return state.subscriptions.some((subscription) => {
      const plan = state.plans.find((item) => item.id === subscription.plan_id);
      return plan?.is_free_trial === true;
    });
  }

  function setTrialModalMode(isTrial) {
    const proofGroup = $('paymentProof')?.closest('.form-group');
    const noteGroup = $('paymentNote')?.closest('.form-group');
    const submitButton = $('submitSubscriptionBtn');
    if (proofGroup) proofGroup.style.display = isTrial ? 'none' : '';
    if (noteGroup) noteGroup.style.display = isTrial ? 'none' : '';
    if (submitButton) submitButton.textContent = isTrial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
  }

  function resetSubscriptionModal() {
    $('submitSubscriptionBtn').style.display = 'inline-block';
    $('pendingActions').style.display = 'none';
    $('paymentProof').value = '';
    $('paymentNote').value = '';
    setTrialModalMode(false);
  }

  function closeSubscribeModal() {
    $('subscribeModal').style.display = 'none';
    state.selectedPlanId = null;
    state.currentSubscription = null;
    resetSubscriptionModal();
  }

  function openPendingSubscription(subscriptionId) {
    const subscription = state.subscriptions.find((item) => item.id === subscriptionId);
    if (!subscription) return;

    const plan = state.plans.find((item) => item.id === subscription.plan_id);
    state.currentSubscription = subscription;
    state.selectedPlanId = subscription.plan_id;

    $('selectedPlanInfo').innerHTML = `
      <strong>${escapeHtml(plan?.name || 'الخطة')}</strong><br>
      الحالة: <strong>قيد المراجعة</strong><br>
      ${plan ? `المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>` : ''}
      ${subscription.notes ? `الملاحظات: ${escapeHtml(subscription.notes)}` : ''}
    `;

    $('paymentProof').value = '';
    $('paymentNote').value = subscription.notes || '';
    $('submitSubscriptionBtn').style.display = 'none';
    $('pendingActions').style.display = 'flex';
    $('subscribeModal').style.display = 'flex';
  }

  async function loadPlans() {
    const container = $('plans');
    if (!supabase) throw new Error('Supabase client is unavailable.');

    const { data: plans, error: plansError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    if (plansError) {
      console.error('subscription_plans load error:', plansError);
      container.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-exclamation"></i><div style="margin-top:8px">تعذر تحميل خطط الاشتراك</div></div>';
      return;
    }

    state.plans = plans || [];
    state.subscriptions = [];

    if (state.user) {
      const { data: subscriptions, error: subscriptionsError } = await supabase
        .from('subscriptions')
        .select('id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path')
        .eq('user_id', state.user.id)
        .order('created_at', { ascending: false });

      if (subscriptionsError) {
        console.error('subscriptions load error:', subscriptionsError);
      } else {
        state.subscriptions = subscriptions || [];
      }
    }

    renderPlans();
  }

  function renderPlans() {
    const container = $('plans');
    const activeSubscription = getActiveSubscription();
    const pendingSubscription = getPendingSubscription();

    if (!state.plans.length) {
      container.innerHTML = '<div class="empty">لا توجد خطط اشتراك متاحة حاليًا.</div>';
      return;
    }

    container.innerHTML = state.plans.map((plan) => {
      const isActive = activeSubscription?.plan_id === plan.id;
      const hasPending = pendingSubscription?.plan_id === plan.id;
      const trialUsed = plan.is_free_trial === true && hasUsedFreeTrial();

      let action;
      if (isActive) {
        action = '<button class="btn btn-outline" disabled style="cursor:default;opacity:.9"><i class="fa-solid fa-circle-check"></i> الخطة مفعّلة</button>';
      } else if (hasPending) {
        action = `<button class="btn btn-outline" data-action="open-pending" data-id="${escapeHtml(pendingSubscription.id)}"><i class="fa-solid fa-clock"></i> الطلب قيد المراجعة</button>`;
      } else if (trialUsed) {
        action = '<button class="btn btn-outline" disabled style="cursor:default;opacity:.75"><i class="fa-solid fa-circle-check"></i> تم استخدام التجربة</button>';
      } else {
        action = `<button class="btn btn-primary" data-action="subscribe" data-id="${escapeHtml(plan.id)}">${plan.is_free_trial ? 'ابدأ التجربة' : 'اشتراك'}</button>`;
      }

      return `
        <div class="card">
          <div class="card-top"><h3>${escapeHtml(plan.name)}</h3><span class="badge">اشتراك</span></div>
          <div class="price">${Number(plan.price).toLocaleString('ar-EG')} <span style="font-size:13px;font-weight:700">جنيه</span></div>
          <div class="duration"><i class="fa-regular fa-calendar"></i> ${Number(plan.duration_days)} يوم</div>
          <div class="method"><strong>طريقة التحويل</strong>${escapeHtml(plan.payment_method)}</div>
          ${plan.description ? `<div class="description">${escapeHtml(plan.description)}</div>` : ''}
          <div class="card-actions">${action}</div>
        </div>`;
    }).join('');
  }

  function openSubscribeModal(planId) {
    resetSubscriptionModal();

    if (!state.user) {
      showToast('من فضلك سجل الدخول أولًا لإرسال الطلب');
      return;
    }

    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) return;

    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) {
      showToast('هذه الخطة غير صالحة حاليًا: مدة الاشتراك غير صحيحة');
      console.error('Invalid subscription plan duration:', plan);
      return;
    }

    if (plan.is_free_trial && hasUsedFreeTrial()) {
      showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل');
      return;
    }

    state.selectedPlanId = planId;
    const isTrial = plan.is_free_trial === true;

    $('selectedPlanInfo').innerHTML = `
      <strong>${escapeHtml(plan.name)}</strong><br>
      المدة: ${Number(plan.duration_days)} يوم<br>
      السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>
      طريقة التحويل: ${escapeHtml(plan.payment_method)}
    `;

    $('paymentProof').value = '';
    $('paymentNote').value = '';
    $('submitSubscriptionBtn').disabled = false;
    setTrialModalMode(isTrial);
    $('subscribeModal').style.display = 'flex';
  }

  function getSubscriptionErrorMessage(error, isTrial) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();

    if (code === '42501' || message.includes('permission denied')) {
      return 'لا توجد صلاحية لتنفيذ عملية الاشتراك حاليًا. تم تسجيل المحاولة، حاول مرة أخرى.';
    }
    if (message.includes('authentication required')) {
      return 'انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم حاول.';
    }
    if (message.includes('plan is not available') || message.includes('subscription plan is not available')) {
      return 'خطة الاشتراك غير متاحة حاليًا.';
    }
    if (message.includes('invalid plan duration') || message.includes('invalid subscription duration')) {
      return 'مدة خطة الاشتراك غير صحيحة. تم إيقاف العملية لحماية بيانات الاشتراك.';
    }
    if (message.includes('free trial has already been used')) {
      return 'لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.';
    }
    if (message.includes('already have an active subscription')) {
      return 'لديك اشتراك فعال بالفعل.';
    }

    return isTrial
      ? 'تعذر بدء التجربة المجانية حاليًا. تم تسجيل سبب الخطأ في النظام.'
      : 'تعذر إنشاء طلب الاشتراك حاليًا. حاول مرة أخرى.';
  }

  async function submitSubscription() {
    if (!state.user || !state.selectedPlanId) return;

    // Refresh the authenticated user immediately before the write.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.user) {
      showToast('انتهت جلسة الدخول. سجل الدخول مرة أخرى.');
      return;
    }
    state.user = sessionData.session.user;

    const plan = state.plans.find((item) => item.id === state.selectedPlanId);
    if (!plan) return;

    const durationDays = Number(plan.duration_days);
    if (!Number.isInteger(durationDays) || durationDays <= 0) {
      showToast('تعذر بدء الاشتراك: مدة الخطة غير صحيحة.');
      console.error('Invalid plan duration before RPC:', plan);
      return;
    }

    const isTrial = plan.is_free_trial === true;
    const file = $('paymentProof').files[0];
    const note = $('paymentNote').value.trim();
    const button = $('submitSubscriptionBtn');

    if (isTrial) {
      if (hasUsedFreeTrial()) {
        showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل');
        return;
      }
    } else {
      if (!file) {
        showToast('من فضلك أرفق صورة التحويل');
        return;
      }
      if (!file.type.startsWith('image/')) {
        showToast('يرجى اختيار صورة صحيحة');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت');
        return;
      }
    }

    button.disabled = true;
    button.textContent = isTrial ? 'جاري بدء التجربة...' : 'جاري إرسال الطلب...';

    let filePath = null;

    try {
      if (!isTrial) {
        const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
        filePath = `${state.user.id}/transfer-${Date.now()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from('subscription-proofs')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.rpc('create_subscription', {
        p_plan_id: plan.id,
        p_full_name:
          state.user.user_metadata?.full_name ||
          state.user.user_metadata?.name ||
          state.user.email ||
          null,
        p_notes: isTrial ? null : (note || null),
        p_payment_proof_path: filePath
      });

      if (insertError) throw insertError;

      closeSubscribeModal();
      button.disabled = false;
      button.textContent = 'إرسال طلب الاشتراك';
      showToast(isTrial ? 'تم بدء التجربة المجانية بنجاح' : 'تم إرسال طلب الاشتراك بنجاح، وسيتم مراجعته وتفعيله يدويًا');
      await loadPlans();
    } catch (error) {
      console.error('create_subscription failed:', error);
      if (filePath) {
        await supabase.storage.from('subscription-proofs').remove([filePath]).catch(() => {});
      }
      button.disabled = false;
      button.textContent = isTrial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
      showDetailedError(isTrial ? 'تعذر بدء التجربة المجانية' : 'خطأ إنشاء طلب الاشتراك', error);
    }
  }

  async function replacePendingProof() {
    const subscription = state.currentSubscription;
    if (!subscription || subscription.status !== 'pending') {
      showToast('لا يمكن تعديل إثبات الدفع الآن');
      return;
    }

    const file = $('paymentProof').files[0];
    if (!file) {
      showToast('اختر صورة الإثبات الجديدة أولًا');
      return;
    }
    if (!file.type.startsWith('image/')) {
      showToast('يرجى اختيار صورة صحيحة');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت');
      return;
    }

    const oldPath = subscription.payment_proof_path;
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const newPath = `${state.user.id}/transfer-${Date.now()}.${extension}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('subscription-proofs')
        .upload(newPath, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({ payment_proof_path: newPath })
        .eq('id', subscription.id)
        .eq('user_id', state.user.id)
        .eq('status', 'pending');

      if (updateError) {
        await supabase.storage.from('subscription-proofs').remove([newPath]).catch(() => {});
        throw updateError;
      }

      if (oldPath) await supabase.storage.from('subscription-proofs').remove([oldPath]).catch(() => {});

      showToast('تم تعديل إثبات الدفع بنجاح');
      closeSubscribeModal();
      await loadPlans();
    } catch (error) {
      console.error('replacePendingProof failed:', error);
      showDetailedError('تعذر تعديل إثبات الدفع', error);
    }
  }

  async function cancelPendingSubscription() {
    const subscription = state.currentSubscription;
    if (!subscription || subscription.status !== 'pending') {
      showToast('لا يمكن إلغاء هذا الطلب');
      return;
    }

    const confirmed = await showConfirmPopup('هل أنت متأكد من إلغاء طلب الاشتراك؟ سيتم إلغاء الطلب الحالي.');
    if (!confirmed) return;

    const { error } = await supabase
      .from('subscriptions')
      .delete()
      .eq('id', subscription.id)
      .eq('user_id', state.user.id)
      .eq('status', 'pending');

    if (error) {
      showDetailedError('تعذر إلغاء طلب الاشتراك', error);
      return;
    }

    showToast('تم إلغاء طلب الاشتراك');
    closeSubscribeModal();
    await loadPlans();
  }

  function showDetailedError(title, error) {
    $('errorOverlay')?.remove();

    const rawMessage = error?.message || error?.error_description || 'خطأ غير معروف';
    const safeMessage = getSubscriptionErrorMessage(error, title.includes('التجربة'));
    const code = error?.code || '';

    document.body.insertAdjacentHTML('beforeend', `
      <div id="errorOverlay" style="position:fixed;inset:0;background:rgba(14,40,37,.58);z-index:1000;display:flex;align-items:center;justify-content:center;padding:18px">
        <div style="width:100%;max-width:560px;background:#fff;border-radius:18px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25);direction:rtl">
          <h2 style="margin:0 0 14px;font-size:19px;color:#b42318">${escapeHtml(title)}</h2>
          <div style="background:#fff5f5;border:1px solid #f1caca;border-radius:10px;padding:13px;line-height:1.8;font-size:13px;word-break:break-word">
            <strong>النتيجة:</strong><br>${escapeHtml(safeMessage)}
            ${code ? `<br><br><strong>Code:</strong> ${escapeHtml(code)}` : ''}
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:15px" data-action="close-error">إغلاق</button>
        </div>
      </div>`);

    // Keep the raw backend error in the browser console for debugging,
    // but never expose internal database details to the user.
    console.error('Subscription backend error:', rawMessage, error);
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;

      switch (button.dataset.action) {
        case 'dashboard': goDashboard(); break;
        case 'profile': goProfile(); break;
        case 'close-modal': closeSubscribeModal(); break;
        case 'submit-subscription': submitSubscription(); break;
        case 'replace-proof': replacePendingProof(); break;
        case 'cancel-pending': cancelPendingSubscription(); break;
        case 'confirm-no': resolveConfirm(false); break;
        case 'confirm-yes': resolveConfirm(true); break;
        case 'subscribe': openSubscribeModal(button.dataset.id); break;
        case 'open-pending': openPendingSubscription(button.dataset.id); break;
        case 'close-error': $('errorOverlay')?.remove(); break;
      }
    });

    $('subscribeModal')?.addEventListener('click', (event) => {
      if (event.target === event.currentTarget) closeSubscribeModal();
    });
  }

  async function init() {
    const container = $('plans');

    try {
      if (!access || !supabase || typeof access.getAccessStatus !== 'function') {
        throw new Error('نظام المصادقة المركزي غير متاح. تأكد من تحميل auth-access.js قبل subscription_plans.js.');
      }

      bindEvents();

      const accessStatus = await access.getAccessStatus();
      state.user = accessStatus?.user || null;

      if (!state.user) {
        window.location.replace('index.html');
        return;
      }

      await loadPlans();
    } catch (error) {
      console.error('Subscription plans initialization failed:', error);
      if (container) {
        container.innerHTML = `
          <div class="empty">
            <i class="fa-solid fa-circle-exclamation"></i>
            <div class="empty-title">تعذر تحميل خطط الاشتراك</div>
            <div class="empty-text">تعذر تحميل البيانات حاليًا. حاول تحديث الصفحة.</div>
          </div>`;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
