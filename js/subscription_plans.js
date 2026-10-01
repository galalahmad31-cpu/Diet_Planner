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
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
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

  function showDetailedError(title, error) {
    console.error(title, error);
    const message = getSubscriptionErrorMessage(error, title.includes('التجربة'));
    showToast(message);
  }

  function goDashboard() { window.location.href = 'app.html'; }
  function goProfile() { window.location.href = 'profile.html'; }

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
    $('selectedPlanInfo').innerHTML = `<strong>${escapeHtml(plan?.name || 'الخطة')}</strong><br>الحالة: <strong>قيد المراجعة</strong><br>${plan ? `المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>` : ''}${subscription.notes ? `الملاحظات: ${escapeHtml(subscription.notes)}` : ''}`;
    $('paymentProof').value = '';
    $('paymentNote').value = subscription.notes || '';
    $('submitSubscriptionBtn').style.display = 'none';
    $('pendingActions').style.display = 'flex';
    $('subscribeModal').style.display = 'flex';
  }

  async function loadPlans() {
    const container = $('plans');
    if (!supabase) throw new Error('Supabase client is unavailable.');
    const { data: plans, error: plansError } = await supabase.from('subscription_plans').select('*').eq('is_active', true).order('price', { ascending: true });
    if (plansError) {
      console.error('subscription_plans load error:', plansError);
      container.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-exclamation"></i><div style="margin-top:8px">تعذر تحميل خطط الاشتراك</div></div>';
      return;
    }
    state.plans = plans || [];
    state.subscriptions = [];
    if (state.user) {
      const { data: subscriptions, error: subscriptionsError } = await supabase.from('subscriptions').select('id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path').eq('user_id', state.user.id).order('created_at', { ascending: false });
      if (subscriptionsError) console.error('subscriptions load error:', subscriptionsError);
      else state.subscriptions = subscriptions || [];
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
      if (isActive) action = '<button class="btn btn-outline" disabled style="cursor:default;opacity:.9"><i class="fa-solid fa-circle-check"></i> الخطة مفعّلة</button>';
      else if (hasPending) action = `<button class="btn btn-outline" data-action="open-pending" data-id="${escapeHtml(pendingSubscription.id)}"><i class="fa-solid fa-clock"></i> الطلب قيد المراجعة</button>`;
      else if (trialUsed) action = '<button class="btn btn-outline" disabled style="cursor:default;opacity:.75"><i class="fa-solid fa-circle-check"></i> تم استخدام التجربة</button>';
      else action = `<button class="btn btn-primary" data-action="subscribe" data-id="${escapeHtml(plan.id)}">${plan.is_free_trial ? 'ابدأ التجربة' : 'اشتراك'}</button>`;
      return `<div class="card"><div class="card-top"><h3>${escapeHtml(plan.name)}</h3><span class="badge">اشتراك</span></div><div class="price">${Number(plan.price).toLocaleString('ar-EG')} <span style="font-size:13px;font-weight:700">جنيه</span></div><div class="duration"><i class="fa-regular fa-calendar"></i> ${Number(plan.duration_days)} يوم</div><div class="method"><strong>طريقة التحويل</strong>${escapeHtml(plan.payment_method)}</div>${plan.description ? `<div class="description">${escapeHtml(plan.description)}</div>` : ''}<div class="card-actions">${action}</div></div>`;
    }).join('');
  }

  function openSubscribeModal(planId) {
    resetSubscriptionModal();
    if (!state.user) { showToast('من فضلك سجل الدخول أولًا لإرسال الطلب'); return; }
    const plan = state.plans.find((item) => item.id === planId);
    if (!plan) return;
    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) {
      showToast('هذه الخطة غير صالحة حاليًا: مدة الاشتراك غير صحيحة');
      console.error('Invalid subscription plan duration:', plan);
      return;
    }
    if (plan.is_free_trial && hasUsedFreeTrial()) { showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل'); return; }
    state.selectedPlanId = planId;
    const isTrial = plan.is_free_trial === true;
    $('selectedPlanInfo').innerHTML = `<strong>${escapeHtml(plan.name)}</strong><br>المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>طريقة التحويل: ${escapeHtml(plan.payment_method)}`;
    $('paymentProof').value = '';
    $('paymentNote').value = '';
    $('submitSubscriptionBtn').disabled = false;
    setTrialModalMode(isTrial);
    $('subscribeModal').style.display = 'flex';
  }

  function getSubscriptionErrorMessage(error, isTrial) {
    const code = String(error?.code || '');
    const message = String(error?.message || '').toLowerCase();
    if (code === '42501' || message.includes('permission denied')) return 'لا توجد صلاحية لتنفيذ عملية الاشتراك حاليًا. تم تسجيل المحاولة، حاول مرة أخرى.';
    if (message.includes('authentication required')) return 'انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم حاول.';
    if (message.includes('plan is not available') || message.includes('subscription plan is not available')) return 'خطة الاشتراك غير متاحة حاليًا.';
    if (message.includes('invalid plan duration') || message.includes('invalid subscription duration')) return 'مدة خطة الاشتراك غير صحيحة. تم إيقاف العملية لحماية بيانات الاشتراك.';
    if (message.includes('free trial has already been used')) return 'لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.';
    if (message.includes('already have an active subscription')) return 'لديك اشتراك فعال بالفعل.';
    return isTrial ? 'تعذر بدء التجربة المجانية حاليًا. تم تسجيل سبب الخطأ في النظام.' : 'تعذر إنشاء طلب الاشتراك حاليًا. حاول مرة أخرى.';
  }

  async function startSubscriptionAudit(plan, fullName) {
    const { data, error } = await supabase.rpc('start_subscription_audit', {
      p_plan_id: plan.id,
      p_full_name: fullName || null
    });
    if (error) throw error;
    const auditId = typeof data === 'string' ? data : data?.id;
    if (!auditId) throw new Error('تعذر إنشاء سجل تدقيق الاشتراك.');
    return auditId;
  }

  async function finishSubscriptionAudit(auditId, success, errorMessage = null) {
    if (!auditId) return;
    const { error } = await supabase.rpc('finish_subscription_audit', {
      p_audit_id: auditId,
      p_success: Boolean(success),
      p_error_message: errorMessage || null
    });
    if (error) console.error('finish_subscription_audit failed:', error);
  }

  async function submitSubscription() {
    if (!state.user || !state.selectedPlanId) return;
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session?.user) { showToast('انتهت جلسة الدخول. سجل الدخول مرة أخرى.'); return; }
    state.user = sessionData.session.user;
    const plan = state.plans.find((item) => item.id === state.selectedPlanId);
    if (!plan) return;
    const durationDays = Number(plan.duration_days);
    if (!Number.isInteger(durationDays) || durationDays <= 0) { showToast('تعذر بدء الاشتراك: مدة الخطة غير صحيحة.'); console.error('Invalid plan duration before RPC:', plan); return; }
    const isTrial = plan.is_free_trial === true;
    const file = $('paymentProof').files[0];
    const note = $('paymentNote').value.trim();
    const button = $('submitSubscriptionBtn');
    if (isTrial) {
      if (hasUsedFreeTrial()) { showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل'); return; }
    } else {
      if (!file) { showToast('من فضلك أرفق صورة التحويل'); return; }
      if (!file.type.startsWith('image/')) { showToast('يرجى اختيار صورة صحيحة'); return; }
      if (file.size > 5 * 1024 * 1024) { showToast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت'); return; }
    }
    button.disabled = true;
    button.textContent = isTrial ? 'جاري بدء التجربة...' : 'جاري إرسال الطلب...';
    let filePath = null;
    let auditId = null;
    const fullName = state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email || null;
    try {
      auditId = await startSubscriptionAudit(plan, fullName);
      if (!isTrial) {
        const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
        filePath = `${state.user.id}/transfer-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('subscription-proofs').upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (uploadError) throw uploadError;
      }
      const { data: rpcData, error: insertError } = await supabase.rpc('create_subscription', {
        p_plan_id: plan.id,
        p_full_name: fullName,
        p_notes: isTrial ? null : (note || null),
        p_payment_proof_path: filePath
      });
      if (insertError) throw insertError;
      if (!rpcData || rpcData.success !== true) {
        const backendMessage = rpcData?.error || 'تعذر إتمام عملية الاشتراك.';
        throw new Error(backendMessage);
      }
      await finishSubscriptionAudit(auditId, true);
      auditId = null;
      if (filePath) filePath = null;
      closeSubscribeModal();
      button.disabled = false;
      button.textContent = 'إرسال طلب الاشتراك';
      showToast(isTrial ? 'تم بدء التجربة المجانية بنجاح' : 'تم إرسال طلب الاشتراك بنجاح، وسيتم مراجعته وتفعيله يدويًا');
      await loadPlans();
    } catch (error) {
      console.error('create_subscription failed:', error);
      if (auditId) await finishSubscriptionAudit(auditId, false, error?.message || String(error));
      if (filePath) await supabase.storage.from('subscription-proofs').remove([filePath]).catch(() => {});
      button.disabled = false;
      button.textContent = isTrial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
      showDetailedError(isTrial ? 'تعذر بدء التجربة المجانية' : 'خطأ إنشاء طلب الاشتراك', error);
    }
  }

  async function replacePendingProof() {
    const subscription = state.currentSubscription;
    if (!subscription || subscription.status !== 'pending') { showToast('لا يمكن تعديل إثبات الدفع الآن'); return; }
    const file = $('paymentProof').files[0];
    if (!file) { showToast('اختر صورة الإثبات الجديدة أولًا'); return; }
    if (!file.type.startsWith('image/')) { showToast('يرجى اختيار صورة صحيحة'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت'); return; }
    const oldPath = subscription.payment_proof_path;
    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const newPath = `${state.user.id}/transfer-${Date.now()}.${extension}`;
    try {
      const { error: uploadError } = await supabase.storage.from('subscription-proofs').upload(newPath, file, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;
      const { error: updateError } = await supabase.from('subscriptions').update({ payment_proof_path: newPath }).eq('id', subscription.id).eq('user_id', state.user.id).eq('status', 'pending');
      if (updateError) { await supabase.storage.from('subscription-proofs').remove([newPath]).catch(() => {}); throw updateError; }
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
    if (!subscription || subscription.status !== 'pending') { showToast('لا يمكن إلغاء هذا الطلب'); return; }
    const confirmed = await showConfirmPopup('هل أنت متأكد من إلغاء طلب الاشتراك؟ سيتم إلغاء الطلب الحالي.');
    if (!confirmed) return;
    try {
      const { error } = await supabase.from('subscriptions').update({ status: 'canceled' }).eq('id', subscription.id).eq('user_id', state.user.id).eq('status', 'pending');
      if (error) throw error;
      if (subscription.payment_proof_path) await supabase.storage.from('subscription-proofs').remove([subscription.payment_proof_path]).catch(() => {});
      showToast('تم إلغاء طلب الاشتراك');
      closeSubscribeModal();
      await loadPlans();
    } catch (error) {
      console.error('cancelPendingSubscription failed:', error);
      showDetailedError('تعذر إلغاء طلب الاشتراك', error);
    }
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset;
    if (!action) return;
    if (action.action === 'subscribe') openSubscribeModal(action.id);
    if (action.action === 'open-pending') openPendingSubscription(action.id);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { data } = await supabase.auth.getUser();
      state.user = data?.user || null;
      await loadPlans();
    } catch (error) {
      console.error('subscription page initialization failed:', error);
      showToast('تعذر تحميل صفحة الاشتراكات');
    }
  });

  window.goDashboard = goDashboard;
  window.goProfile = goProfile;
  window.openSubscribeModal = openSubscribeModal;
  window.closeSubscribeModal = closeSubscribeModal;
  window.resolveConfirm = resolveConfirm;
  window.submitSubscription = submitSubscription;
  window.replacePendingProof = replacePendingProof;
  window.cancelPendingSubscription = cancelPendingSubscription;
})();
