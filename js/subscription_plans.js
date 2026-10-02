(() => {
  'use strict';

  const sb = window.DietPlannerAccess?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, plans: [], subscriptions: [], selectedPlanId: null, currentSubscription: null, confirm: null, toastTimer: null };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function errorMessage(error, trial = false) {
    const m = String(error?.message || error || '').toLowerCase();
    if (m.includes('authentication required')) return 'انتهت جلسة الدخول. سجل الدخول مرة أخرى.';
    if (m.includes('permission denied') || error?.code === '42501') return 'لا توجد صلاحية لتنفيذ العملية حاليًا.';
    if (m.includes('plan is not available') || m.includes('subscription plan is not available')) return 'خطة الاشتراك غير متاحة حاليًا.';
    if (m.includes('invalid plan duration') || m.includes('invalid subscription duration')) return 'مدة خطة الاشتراك غير صحيحة.';
    if (m.includes('free trial has already been used')) return 'لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.';
    if (m.includes('already have an active subscription')) return 'لديك اشتراك فعال بالفعل.';
    return trial ? 'تعذر بدء التجربة المجانية حاليًا. تم تسجيل المحاولة.' : 'تعذر إنشاء طلب الاشتراك حاليًا.';
  }

  function showError(context, error, trial = false) {
    console.error(context, error);
    toast(errorMessage(error, trial));
  }

  async function loadUser() {
    if (!sb) throw new Error('Supabase client is unavailable');
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    if (!data?.user) {
      window.location.replace('index.html');
      return false;
    }
    state.user = data.user;
    return true;
  }

  async function loadData() {
    const { data: plans, error: planError } = await sb
      .from('subscription_plans').select('*').eq('is_active', true).order('price', { ascending: true });
    if (planError) throw planError;

    const { data: subscriptions, error: subError } = await sb
      .from('subscriptions')
      .select('id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false });
    if (subError) throw subError;

    state.plans = plans || [];
    state.subscriptions = subscriptions || [];
    render();
  }

  function activeSubscription() {
    const today = new Date().toISOString().slice(0, 10);
    return state.subscriptions.find(s => s.status === 'paid' && s.start_date && s.expiry_date && s.start_date <= today && s.expiry_date >= today) || null;
  }

  function pendingSubscription() {
    return state.subscriptions.find(s => s.status === 'pending') || null;
  }

  function trialUsed() {
    return state.subscriptions.some(s => state.plans.some(p => p.id === s.plan_id && p.is_free_trial === true));
  }

  function render() {
    const c = $('plans');
    if (!c) return;
    const active = activeSubscription();
    const pending = pendingSubscription();
    if (!state.plans.length) {
      c.innerHTML = '<div class="empty">لا توجد خطط اشتراك متاحة حاليًا.</div>';
      return;
    }
    c.innerHTML = state.plans.map(plan => {
      const isActive = active?.plan_id === plan.id;
      const isPending = pending?.plan_id === plan.id;
      const used = plan.is_free_trial === true && trialUsed();
      let button;
      if (isActive) button = '<button class="btn btn-outline" disabled>الخطة مفعّلة</button>';
      else if (isPending) button = `<button class="btn btn-outline" data-action="open-pending" data-id="${esc(pending.id)}">الطلب قيد المراجعة</button>`;
      else if (used) button = '<button class="btn btn-outline" disabled>تم استخدام التجربة</button>';
      else button = `<button class="btn btn-primary" data-action="subscribe" data-id="${esc(plan.id)}">${plan.is_free_trial ? 'ابدأ التجربة' : 'اشتراك'}</button>`;
      return `<div class="card"><div class="card-top"><h3>${esc(plan.name)}</h3><span class="badge">اشتراك</span></div><div class="price">${Number(plan.price).toLocaleString('ar-EG')} <span style="font-size:13px;font-weight:700">جنيه</span></div><div class="duration"><i class="fa-regular fa-calendar"></i> ${Number(plan.duration_days)} يوم</div><div class="method"><strong>طريقة التحويل</strong>${esc(plan.payment_method)}</div>${plan.description ? `<div class="description">${esc(plan.description)}</div>` : ''}<div class="card-actions">${button}</div></div>`;
    }).join('');
  }

  function setTrialMode(isTrial) {
    const proof = $('paymentProof')?.closest('.form-group');
    const note = $('paymentNote')?.closest('.form-group');
    if (proof) proof.style.display = isTrial ? 'none' : '';
    if (note) note.style.display = isTrial ? 'none' : '';
    if ($('submitSubscriptionBtn')) $('submitSubscriptionBtn').textContent = isTrial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
  }

  function resetModal() {
    if ($('submitSubscriptionBtn')) { $('submitSubscriptionBtn').style.display = 'inline-block'; $('submitSubscriptionBtn').disabled = false; }
    if ($('pendingActions')) $('pendingActions').style.display = 'none';
    if ($('paymentProof')) $('paymentProof').value = '';
    if ($('paymentNote')) $('paymentNote').value = '';
    setTrialMode(false);
  }

  function closeModal() {
    if ($('subscribeModal')) $('subscribeModal').style.display = 'none';
    state.selectedPlanId = null;
    state.currentSubscription = null;
    resetModal();
  }

  function openSubscribe(planId) {
    const plan = state.plans.find(p => p.id === planId);
    if (!state.user) return toast('من فضلك سجل الدخول أولًا.');
    if (!plan) return;
    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) return toast('مدة خطة الاشتراك غير صحيحة.');
    if (plan.is_free_trial === true && trialUsed()) return toast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.');

    resetModal();
    state.selectedPlanId = plan.id;
    $('selectedPlanInfo').innerHTML = `<strong>${esc(plan.name)}</strong><br>المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>طريقة التحويل: ${esc(plan.payment_method)}`;
    setTrialMode(plan.is_free_trial === true);
    $('subscribeModal').style.display = 'flex';
  }

  function openPending(id) {
    const sub = state.subscriptions.find(s => s.id === id);
    if (!sub) return;
    const plan = state.plans.find(p => p.id === sub.plan_id);
    state.currentSubscription = sub;
    state.selectedPlanId = sub.plan_id;
    $('selectedPlanInfo').innerHTML = `<strong>${esc(plan?.name || 'الخطة')}</strong><br>الحالة: <strong>قيد المراجعة</strong><br>${plan ? `المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>` : ''}${sub.notes ? `الملاحظات: ${esc(sub.notes)}` : ''}`;
    $('paymentProof').value = '';
    $('paymentNote').value = sub.notes || '';
    $('submitSubscriptionBtn').style.display = 'none';
    $('pendingActions').style.display = 'flex';
    $('subscribeModal').style.display = 'flex';
  }

  async function submitSubscription() {
    const plan = state.plans.find(p => p.id === state.selectedPlanId);
    if (!state.user || !plan) return;

    const trial = plan.is_free_trial === true;
    const button = $('submitSubscriptionBtn');
    const file = $('paymentProof').files[0];
    const note = $('paymentNote').value.trim();
    const fullName = state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email || null;

    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) return toast('مدة خطة الاشتراك غير صحيحة.');
    if (trial && trialUsed()) return toast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.');
    if (!trial) {
      if (!file) return toast('من فضلك أرفق صورة التحويل.');
      if (!file.type.startsWith('image/')) return toast('يرجى اختيار صورة صحيحة.');
      if (file.size > 5 * 1024 * 1024) return toast('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
    }

    button.disabled = true;
    button.textContent = trial ? 'جاري بدء التجربة...' : 'جاري إرسال الطلب...';

    let filePath = null;
    try {
      if (!trial) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        filePath = `${state.user.id}/transfer-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('subscription-proofs').upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
      }

      const { data, error } = await sb.rpc('create_subscription', {
        p_plan_id: plan.id,
        p_full_name: fullName,
        p_notes: trial ? null : (note || null),
        p_payment_proof_path: filePath
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'تعذر إتمام عملية الاشتراك.');

      filePath = null;
      closeModal();
      toast(trial ? 'تم بدء التجربة المجانية بنجاح.' : 'تم إرسال طلب الاشتراك بنجاح، وسيتم مراجعته وتفعيله يدويًا.');
      await loadData();
    } catch (error) {
      console.error('subscription failed:', error);
      if (filePath) await sb.storage.from('subscription-proofs').remove([filePath]).catch(() => {});
      showError('subscription failed', error, trial);
    } finally {
      button.disabled = false;
      button.textContent = trial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
    }
  }

  async function replacePendingProof() {
    const sub = state.currentSubscription;
    const file = $('paymentProof').files[0];
    if (!sub || sub.status !== 'pending') return toast('لا يمكن تعديل إثبات الدفع الآن.');
    if (!file) return toast('اختر صورة الإثبات الجديدة أولًا.');
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return toast('صورة غير صالحة أو أكبر من 5 ميجابايت.');

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const newPath = `${state.user.id}/transfer-${Date.now()}.${ext}`;
    try {
      const upload = await sb.storage.from('subscription-proofs').upload(newPath, file, { cacheControl: '3600', upsert: false });
      if (upload.error) throw upload.error;
      const update = await sb.from('subscriptions').update({ payment_proof_path: newPath }).eq('id', sub.id).eq('user_id', state.user.id).eq('status', 'pending');
      if (update.error) throw update.error;
      if (sub.payment_proof_path) await sb.storage.from('subscription-proofs').remove([sub.payment_proof_path]).catch(() => {});
      closeModal();
      toast('تم تعديل إثبات الدفع بنجاح.');
      await loadData();
    } catch (error) {
      await sb.storage.from('subscription-proofs').remove([newPath]).catch(() => {});
      showError('replace proof failed', error);
    }
  }

  async function cancelPending() {
    const sub = state.currentSubscription;
    if (!sub || sub.status !== 'pending') return;
    const ok = await new Promise(resolve => { state.confirm = resolve; $('confirmTitle').textContent = 'تأكيد الإلغاء'; $('confirmMessage').textContent = 'هل أنت متأكد من إلغاء طلب الاشتراك؟'; $('confirmOverlay').style.display = 'flex'; });
    if (!ok) return;
    try {
      const { error } = await sb.from('subscriptions').update({ status: 'canceled' }).eq('id', sub.id).eq('user_id', state.user.id).eq('status', 'pending');
      if (error) throw error;
      if (sub.payment_proof_path) await sb.storage.from('subscription-proofs').remove([sub.payment_proof_path]).catch(() => {});
      closeModal();
      toast('تم إلغاء طلب الاشتراك.');
      await loadData();
    } catch (error) { showError('cancel subscription failed', error); }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'subscribe') openSubscribe(id);
    else if (action === 'open-pending') openPending(id);
    else if (action === 'submit-subscription') submitSubscription();
    else if (action === 'replace-proof') replacePendingProof();
    else if (action === 'cancel-pending') cancelPending();
    else if (action === 'close-modal') closeModal();
    else if (action === 'dashboard') window.location.href = 'app.html';
    else if (action === 'profile') window.location.href = 'profile.html';
    else if (action === 'confirm-yes') { $('confirmOverlay').style.display = 'none'; state.confirm?.(true); state.confirm = null; }
    else if (action === 'confirm-no') { $('confirmOverlay').style.display = 'none'; state.confirm?.(false); state.confirm = null; }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      if (!(await loadUser())) return;
      await loadData();
    } catch (error) {
      console.error('subscription page initialization failed:', error);
      const c = $('plans');
      if (c) c.innerHTML = '<div class="empty">تعذر تحميل صفحة الاشتراكات. أعد تحميل الصفحة.</div>';
    }
  });

  window.openSubscribeModal = openSubscribe;
  window.closeSubscribeModal = closeModal;
  window.submitSubscription = submitSubscription;
  window.replacePendingProof = replacePendingProof;
  window.cancelPendingSubscription = cancelPending;
})();
