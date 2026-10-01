(() => {
  'use strict';

  const access = window.DietPlannerAccess;
  const sb = access?.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const state = { user: null, plans: [], subscriptions: [], selectedPlanId: null, currentSubscription: null, confirmResolver: null, toastTimer: null };

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  }
  function showToast(message) {
    const t = $('toast'); if (!t) return;
    t.textContent = message; t.classList.add('show');
    clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
  }
  function errorText(error, trial = false) {
    const m = String(error?.message || error || '').toLowerCase();
    if (m.includes('permission denied') || error?.code === '42501') return 'لا توجد صلاحية لتنفيذ عملية الاشتراك حاليًا.';
    if (m.includes('authentication required')) return 'انتهت جلسة الدخول. سجل الدخول مرة أخرى.';
    if (m.includes('plan is not available')) return 'خطة الاشتراك غير متاحة حاليًا.';
    if (m.includes('invalid plan duration') || m.includes('invalid subscription duration')) return 'مدة خطة الاشتراك غير صحيحة.';
    if (m.includes('free trial has already been used')) return 'لقد تم استخدام التجربة المجانية لهذا الحساب من قبل.';
    if (m.includes('already have an active subscription')) return 'لديك اشتراك فعال بالفعل.';
    return trial ? 'تعذر بدء التجربة المجانية حاليًا. تم تسجيل المحاولة.' : 'تعذر إنشاء طلب الاشتراك حاليًا.';
  }
  function showError(title, error, trial = false) { console.error(title, error); showToast(errorText(error, trial)); }

  function showConfirmPopup(message, title = 'تأكيد العملية') {
    return new Promise(resolve => {
      state.confirmResolver = resolve;
      $('confirmTitle').textContent = title;
      $('confirmMessage').textContent = message;
      $('confirmOverlay').style.display = 'flex';
    });
  }
  function resolveConfirm(value) {
    $('confirmOverlay').style.display = 'none';
    const r = state.confirmResolver; state.confirmResolver = null; if (r) r(value);
  }
  async function logoutUser() {
    const { error } = await sb.auth.signOut();
    if (error) { showToast('تعذر تسجيل الخروج'); console.error(error); return; }
    window.location.replace('index.html');
  }

  function activeSubscription() {
    const today = new Date().toISOString().slice(0, 10);
    return state.subscriptions.find(s => s.status === 'paid' && s.start_date && s.expiry_date && s.start_date <= today && s.expiry_date >= today) || null;
  }
  function pendingSubscription() { return state.subscriptions.find(s => s.status === 'pending') || null; }
  function hasUsedFreeTrial() {
    return state.subscriptions.some(s => state.plans.find(p => p.id === s.plan_id)?.is_free_trial === true);
  }

  async function checkUser() {
    if (!sb) { showToast('تعذر تهيئة الاتصال بالنظام'); return false; }
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user) { window.location.replace('index.html'); return false; }
    state.user = data.user;

    const { data: roleData } = await sb.rpc('get_access_status');
    if (roleData?.isAdmin === true || roleData?.is_admin === true) { window.location.replace('app.html'); return false; }
    if (activeSubscription()) { window.location.replace('app.html'); return false; }
    return true;
  }

  async function loadPlans() {
    const c = $('plans');
    const { data: plans, error } = await sb.from('subscription_plans').select('*').eq('is_active', true).order('price', { ascending: true });
    if (error) { console.error(error); c.innerHTML = '<div class="empty">تعذر تحميل خطط الاشتراك</div>'; return; }
    state.plans = plans || [];
    state.subscriptions = [];
    if (state.user) {
      const r = await sb.from('subscriptions').select('id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path').eq('user_id', state.user.id).order('created_at', { ascending: false });
      if (r.error) console.error(r.error); else state.subscriptions = r.data || [];
    }
    renderPlans();
  }

  function renderPlans() {
    const c = $('plans');
    const active = activeSubscription();
    const pending = pendingSubscription();
    if (!state.plans.length) { c.innerHTML = '<div class="empty">لا توجد خطط اشتراك متاحة حاليًا.</div>'; return; }
    c.innerHTML = state.plans.map(p => {
      const isActive = active?.plan_id === p.id;
      const hasPending = pending?.plan_id === p.id;
      const trialUsed = p.is_free_trial === true && hasUsedFreeTrial();
      let action;
      if (isActive) action = '<button class="btn btn-outline" disabled>الخطة مفعّلة</button>';
      else if (hasPending) action = `<button class="btn btn-outline" data-action="open-pending" data-id="${escapeHtml(pending.id)}"><i class="fa-solid fa-clock"></i> الطلب قيد المراجعة</button>`;
      else if (trialUsed) action = '<button class="btn btn-outline" disabled>تم استخدام التجربة</button>';
      else action = `<button class="btn btn-primary" data-action="subscribe-plan" data-id="${escapeHtml(p.id)}">${p.is_free_trial ? 'ابدأ التجربة' : 'اشتراك'}</button>`;
      return `<div class="card"><div class="card-top"><h3>${escapeHtml(p.name)}</h3><span class="badge">اشتراك</span></div><div class="price">${Number(p.price).toLocaleString('ar-EG')} <span style="font-size:13px;font-weight:700">جنيه</span></div><div class="duration"><i class="fa-regular fa-calendar"></i> ${Number(p.duration_days)} يوم</div><div class="method"><strong>طريقة التحويل</strong>${escapeHtml(p.payment_method)}</div>${p.description ? `<div class="description">${escapeHtml(p.description)}</div>` : ''}<div class="card-actions">${action}</div></div>`;
    }).join('');
  }

  function setTrialMode(trial) {
    const proof = $('paymentProof')?.closest('.form-group');
    const note = $('paymentNote')?.closest('.form-group');
    if (proof) proof.style.display = trial ? 'none' : '';
    if (note) note.style.display = trial ? 'none' : '';
    if ($('submitSubscriptionBtn')) $('submitSubscriptionBtn').textContent = trial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
  }
  function resetModal() {
    if ($('submitSubscriptionBtn')) $('submitSubscriptionBtn').style.display = 'inline-block';
    if ($('pendingActions')) $('pendingActions').style.display = 'none';
    if ($('paymentProof')) $('paymentProof').value = '';
    if ($('paymentNote')) $('paymentNote').value = '';
    setTrialMode(false);
  }
  function closeSubscribeModal() {
    $('subscribeModal').style.display = 'none'; state.selectedPlanId = null; state.currentSubscription = null; resetModal();
  }

  function openSubscribeModal(id) {
    resetModal();
    const plan = state.plans.find(p => p.id === id);
    if (!state.user) { showToast('من فضلك سجل الدخول أولًا'); return; }
    if (!plan) return;
    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) { showToast('هذه الخطة غير صالحة حاليًا: مدة الاشتراك غير صحيحة'); return; }
    if (plan.is_free_trial && hasUsedFreeTrial()) { showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل'); return; }
    state.selectedPlanId = id;
    $('selectedPlanInfo').innerHTML = `<strong>${escapeHtml(plan.name)}</strong><br>المدة: ${Number(plan.duration_days)} يوم<br>السعر: ${Number(plan.price).toLocaleString('ar-EG')} جنيه<br>طريقة التحويل: ${escapeHtml(plan.payment_method)}`;
    setTrialMode(plan.is_free_trial === true);
    $('submitSubscriptionBtn').disabled = false;
    $('subscribeModal').style.display = 'flex';
  }

  function openPending(id) {
    const s = state.subscriptions.find(x => x.id === id); if (!s) return;
    const p = state.plans.find(x => x.id === s.plan_id); state.currentSubscription = s; state.selectedPlanId = s.plan_id;
    $('selectedPlanInfo').innerHTML = `<strong>${escapeHtml(p?.name || 'الخطة')}</strong><br>الحالة: <strong>قيد المراجعة</strong><br>${p ? `المدة: ${Number(p.duration_days)} يوم<br>السعر: ${Number(p.price).toLocaleString('ar-EG')} جنيه<br>` : ''}${s.notes ? `الملاحظات: ${escapeHtml(s.notes)}` : ''}`;
    $('paymentProof').value = ''; $('paymentNote').value = s.notes || ''; $('submitSubscriptionBtn').style.display = 'none'; $('pendingActions').style.display = 'flex'; $('subscribeModal').style.display = 'flex';
  }

  async function startAudit(plan, fullName) {
    const { data, error } = await sb.rpc('start_subscription_audit', { p_plan_id: plan.id, p_full_name: fullName || null });
    if (error) throw error;
    const id = typeof data === 'string' ? data : data?.id;
    if (!id) throw new Error('تعذر إنشاء سجل تدقيق الاشتراك');
    return id;
  }
  async function finishAudit(id, success, message = null) {
    if (!id) return;
    const { error } = await sb.rpc('finish_subscription_audit', { p_audit_id: id, p_success: !!success, p_error_message: message || null });
    if (error) console.error('finish_subscription_audit:', error);
  }

  async function submitSubscription() {
    if (!state.user || !state.selectedPlanId) return;
    const plan = state.plans.find(p => p.id === state.selectedPlanId); if (!plan) return;
    const trial = plan.is_free_trial === true;
    const button = $('submitSubscriptionBtn');
    const file = $('paymentProof').files[0];
    const note = $('paymentNote').value.trim();
    if (!Number.isInteger(Number(plan.duration_days)) || Number(plan.duration_days) <= 0) { showToast('مدة خطة الاشتراك غير صحيحة'); return; }
    if (trial && hasUsedFreeTrial()) { showToast('لقد تم استخدام التجربة المجانية لهذا الحساب من قبل'); return; }
    if (!trial && (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) { showToast(!file ? 'من فضلك أرفق صورة التحويل' : file.size > 5 * 1024 * 1024 ? 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت' : 'يرجى اختيار صورة صحيحة'); return; }

    button.disabled = true; button.textContent = trial ? 'جاري بدء التجربة...' : 'جاري إرسال الطلب...';
    const fullName = state.user.user_metadata?.full_name || state.user.user_metadata?.name || state.user.email || null;
    let auditId = null, filePath = null;
    try {
      auditId = await startAudit(plan, fullName);
      if (!trial) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        filePath = `${state.user.id}/transfer-${Date.now()}.${ext}`;
        const { error } = await sb.storage.from('subscription-proofs').upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (error) throw error;
      }
      const { data, error } = await sb.rpc('create_subscription', { p_plan_id: plan.id, p_full_name: fullName, p_notes: trial ? null : (note || null), p_payment_proof_path: filePath });
      if (error) throw error;
      if (!data || data.success !== true) throw new Error(data?.error || 'تعذر إتمام عملية الاشتراك');
      await finishAudit(auditId, true); auditId = null;
      if (filePath) filePath = null;
      closeSubscribeModal(); showToast(trial ? 'تم بدء التجربة المجانية بنجاح' : 'تم إرسال طلب الاشتراك بنجاح، وسيتم مراجعته وتفعيله يدويًا');
      await loadPlans();
    } catch (error) {
      console.error('subscription failed:', error);
      if (auditId) await finishAudit(auditId, false, error?.message || String(error));
      if (filePath) await sb.storage.from('subscription-proofs').remove([filePath]).catch(() => {});
      showError(trial ? 'تعذر بدء التجربة المجانية' : 'تعذر إنشاء طلب الاشتراك', error, trial);
    } finally {
      button.disabled = false; button.textContent = trial ? 'بدء التجربة المجانية' : 'إرسال طلب الاشتراك';
    }
  }

  async function replacePendingProof() {
    const s = state.currentSubscription; if (!s || s.status !== 'pending') return showToast('لا يمكن تعديل إثبات الدفع الآن');
    const file = $('paymentProof').files[0]; if (!file) return showToast('اختر صورة الإثبات الجديدة أولًا');
    if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) return showToast('صورة غير صالحة أو أكبر من 5 ميجابايت');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase(); const newPath = `${state.user.id}/transfer-${Date.now()}.${ext}`;
    try {
      const up = await sb.storage.from('subscription-proofs').upload(newPath, file, { cacheControl:'3600', upsert:false }); if (up.error) throw up.error;
      const u = await sb.from('subscriptions').update({ payment_proof_path:newPath }).eq('id',s.id).eq('user_id',state.user.id).eq('status','pending'); if (u.error) throw u.error;
      if (s.payment_proof_path) await sb.storage.from('subscription-proofs').remove([s.payment_proof_path]).catch(()=>{});
      closeSubscribeModal(); showToast('تم تعديل إثبات الدفع بنجاح'); await loadPlans();
    } catch (e) { await sb.storage.from('subscription-proofs').remove([newPath]).catch(()=>{}); showError('تعذر تعديل إثبات الدفع', e); }
  }

  async function cancelPendingSubscription() {
    const s = state.currentSubscription; if (!s || s.status !== 'pending') return showToast('لا يمكن إلغاء هذا الطلب');
    if (!await showConfirmPopup('هل أنت متأكد من إلغاء طلب الاشتراك؟')) return;
    try {
      const { error } = await sb.from('subscriptions').update({ status:'canceled' }).eq('id',s.id).eq('user_id',state.user.id).eq('status','pending');
      if (error) throw error;
      if (s.payment_proof_path) await sb.storage.from('subscription-proofs').remove([s.payment_proof_path]).catch(()=>{});
      closeSubscribeModal(); showToast('تم إلغاء طلب الاشتراك'); await loadPlans();
    } catch (e) { showError('تعذر إلغاء طلب الاشتراك', e); }
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'subscribe-plan') openSubscribeModal(id);
    else if (action === 'open-pending') openPending(id);
    else if (action === 'submit-subscription') submitSubscription();
    else if (action === 'close-subscribe') closeSubscribeModal();
    else if (action === 'replace-proof') replacePendingProof();
    else if (action === 'cancel-pending') cancelPendingSubscription();
    else if (action === 'confirm-yes') resolveConfirm(true);
    else if (action === 'confirm-no') resolveConfirm(false);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      if (!(await checkUser())) return;
      await loadPlans();
    } catch (e) { console.error(e); showToast('تعذر تحميل صفحة الاشتراكات'); }
  });

  window.logoutUser = logoutUser;
  window.resolveConfirm = resolveConfirm;
})();