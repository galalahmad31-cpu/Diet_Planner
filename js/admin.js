(() => {
  'use strict';

  /*
   * ADMIN PAGE
   * ----------
   * UI permission checks are delegated to DietPlannerAccess.
   * The backend/RLS remains the final security boundary.
   *
   * This file deliberately does not:
   * - inspect role / isAdmin
   * - calculate subscriptions or quotas for authorization
   * - use DietPlannerAccess.supabaseClient
   * - use DietPlannerPageAccess
   */

  const db = window.DietPlannerSupabase?.client;
  const access = window.DietPlannerAccess;

  const PLAN_FEATURES = [
    { key: 'nutrition_support', label: 'الدعم الغذائي' },
    { key: 'diet', label: 'الدايت المتقدم' },
    { key: 'article', label: 'المقال المتقدم' },
    { key: 'product', label: 'المنتجات الغذائية' }
  ];

  const state = {
    plans: [],
    subscriptions: [],
    profiles: [],
    patients: [],
    activeTab: 'requests'
  };

  let confirmAction = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function money(value) {
    return value == null
      ? '—'
      : `${Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
  }

  function date(value) {
    if (!value) return '—';

    return new Date(`${value}T00:00:00`).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  function dateTime(value) {
    return value
      ? new Date(value).toLocaleString('ar-EG', {
          dateStyle: 'medium',
          timeStyle: 'short'
        })
      : '—';
  }

  function planName(planId) {
    return state.plans.find((plan) => plan.id === planId)?.name || 'خطة غير معروفة';
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function toast(message) {
    const element = $('toast');
    if (!element) return;

    element.textContent = message;
    element.classList.add('show');

    window.setTimeout(() => element.classList.remove('show'), 2600);
  }

  function setState(prefix, message, showTable = false) {
    const stateElement = $(`${prefix}State`);
    const wrapElement = $(`${prefix}Wrap`);

    if (stateElement) {
      stateElement.textContent = message;
      stateElement.style.display = showTable ? 'none' : 'block';
    }

    if (wrapElement) {
      wrapElement.style.display = showTable ? 'block' : 'none';
    }
  }

  function statusBadge(status, expiryDate) {
    if (status === 'paid' && expiryDate && expiryDate < today()) {
      return '<span class="badge expired">منتهية</span>';
    }

    if (status === 'paid') {
      return '<span class="badge paid">مفعّلة</span>';
    }

    if (status === 'pending') {
      return '<span class="badge pending">قيد المراجعة</span>';
    }

    return '<span class="badge canceled">ملغاة</span>';
  }

  async function can(action) {
    if (!access?.can) {
      console.error('DietPlannerAccess.can is unavailable.');
      return false;
    }

    try {
      return (await access.can('admin', action)) === true;
    } catch (error) {
      console.error(`Admin access check failed for "${action}".`, error);
      return false;
    }
  }

  async function requireAction(action, message = 'غير مسموح بتنفيذ هذه العملية.') {
    const allowed = await can(action);

    if (!allowed) {
      toast(message);
      return false;
    }

    return true;
  }

  function closeModal() {
    const modal = $('modalBg');
    if (modal) modal.style.display = 'none';
  }

  function openModal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modalBg').style.display = 'flex';
  }

  function askConfirm(title, text, action) {
    $('confirmTitle').textContent = title;
    $('confirmText').innerHTML = text;
    $('confirmBg').style.display = 'flex';
    confirmAction = action;
  }

  function closeConfirm() {
    $('confirmBg').style.display = 'none';
    confirmAction = null;
  }

  async function loadAll() {
    if (!(await requireAction('read', 'لا يمكن تحميل بيانات الإدارة.'))) {
      location.replace('index.html');
      return;
    }

    const [plansResult, subscriptionsResult, profilesResult, patientsResult] =
      await Promise.all([
        db
          .from('subscription_plans')
          .select('*')
          .order('created_at', { ascending: true }),

        db
          .from('subscriptions')
          .select(
            'id,user_id,start_date,expiry_date,status,notes,created_at,updated_at,full_name,plan_id,payment_proof_path,duration_days_snapshot,max_patients_snapshot,features_snapshot'
          )
          .order('created_at', { ascending: false }),

        db
          .from('profiles')
          .select('id,full_name,email,phone,role,created_at')
          .eq('role', 'user')
          .order('created_at', { ascending: false }),

        db
          .from('patients')
          .select('id,user_id,subscription_id')
      ]);

    if (plansResult.error) throw plansResult.error;
    if (subscriptionsResult.error) throw subscriptionsResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (patientsResult.error) throw patientsResult.error;

    state.plans = plansResult.data || [];
    state.subscriptions = subscriptionsResult.data || [];
    state.profiles = profilesResult.data || [];
    state.patients = patientsResult.data || [];

    renderRequests();
    renderPlans();
    renderDoctors();
  }

  function renderRequests() {
    const body = $('requestsBody');
    if (!body) return;

    $('totalCount').textContent = state.subscriptions.length;
    $('pendingCount').textContent =
      state.subscriptions.filter((item) => item.status === 'pending').length;
    $('paidCount').textContent =
      state.subscriptions.filter((item) => item.status === 'paid').length;
    $('canceledCount').textContent =
      state.subscriptions.filter((item) => item.status === 'canceled').length;

    if (!state.subscriptions.length) {
      setState('request', 'لا توجد طلبات اشتراك حاليًا.');
      return;
    }

    body.innerHTML = state.subscriptions
      .map(
        (subscription) => `
          <tr>
            <td>
              <span class="name">${escapeHtml(subscription.full_name || 'بدون اسم')}</span>
              <span class="meta">${escapeHtml(
                state.profiles.find((profile) => profile.id === subscription.user_id)?.email || ''
              )}</span>
            </td>
            <td>${escapeHtml(planName(subscription.plan_id))}</td>
            <td>${money(
              state.plans.find((plan) => plan.id === subscription.plan_id)?.price
            )}</td>
            <td>${dateTime(subscription.created_at)}</td>
            <td>${date(subscription.start_date)}<br>${date(subscription.expiry_date)}</td>
            <td>${statusBadge(subscription.status, subscription.expiry_date)}</td>
            <td>
              ${
                subscription.payment_proof_path
                  ? `<button class="icon-btn" title="عرض الإثبات" data-proof="${escapeHtml(
                      subscription.id
                    )}">
                       <i class="fa-solid fa-image"></i>
                     </button>`
                  : '—'
              }
            </td>
            <td class="actions-cell">
              <button class="icon-btn" title="تعديل" data-edit-sub="${escapeHtml(
                subscription.id
              )}">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="icon-btn danger" title="حذف" data-del-sub="${escapeHtml(
                subscription.id
              )}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>
        `
      )
      .join('');

    setState('request', '', true);
  }

  function featureLabel(key) {
    return PLAN_FEATURES.find((feature) => feature.key === key)?.label || key;
  }

  function featuresText(features) {
    const labels = PLAN_FEATURES
      .filter((feature) => features?.[feature.key] === true)
      .map((feature) => feature.label);

    return labels.length ? labels.join('، ') : '—';
  }

  function renderPlans() {
    const body = $('plansBody');
    if (!body) return;

    $('planCount').textContent = state.plans.length;
    $('activePlanCount').textContent =
      state.plans.filter((plan) => plan.is_active).length;

    if (!state.plans.length) {
      setState('plan', 'لا توجد خطط.');
      return;
    }

    body.innerHTML = state.plans
      .map(
        (plan) => `
          <tr>
            <td>
              <span class="name">${escapeHtml(plan.name)}</span>
              ${plan.is_free_trial ? '<span class="meta">تجربة مجانية</span>' : ''}
            </td>
            <td>${money(plan.price)}</td>
            <td>${escapeHtml(plan.duration_days)} يوم</td>
            <td>${plan.max_patients == null ? 'غير محدود' : escapeHtml(plan.max_patients)}</td>
            <td>${escapeHtml(plan.payment_method || '—')}</td>
            <td>${escapeHtml(featuresText(plan.features))}</td>
            <td>
              <span class="badge ${plan.is_active ? 'active' : 'off'}">
                ${plan.is_active ? 'متاحة' : 'غير متاحة'}
              </span>
            </td>
            <td class="actions-cell">
              <button class="icon-btn" title="تعديل" data-edit-plan="${escapeHtml(plan.id)}">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="icon-btn danger" title="حذف" data-del-plan="${escapeHtml(plan.id)}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>
        `
      )
      .join('');

    setState('plan', '', true);
  }

  function latestSubscription(userId) {
    return state.subscriptions
      .filter((subscription) => subscription.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }

  function patientCountForSubscription(subscription) {
    if (!subscription) return 0;

    return state.patients.filter((patient) =>
      subscription.subscription_id
        ? patient.subscription_id === subscription.id
        : patient.user_id === subscription.user_id
    ).length;
  }

  function renderDoctors() {
    const search = ($('doctorSearch')?.value || '').trim().toLowerCase();

    const doctors = state.profiles.filter((profile) => {
      if (!search) return true;

      return [profile.full_name, profile.email, profile.phone].some((value) =>
        String(value || '').toLowerCase().includes(search)
      );
    });

    $('doctorCount').textContent = state.profiles.length;
    $('doctorActiveCount').textContent = state.profiles.filter((profile) => {
      const subscription = latestSubscription(profile.id);

      return (
        subscription?.status === 'paid' &&
        subscription.expiry_date >= today()
      );
    }).length;

    const body = $('doctorsBody');
    if (!body) return;

    if (!doctors.length) {
      setState('doctor', 'لا توجد نتائج.');
      return;
    }

    body.innerHTML = doctors
      .map((profile) => {
        const subscription = latestSubscription(profile.id);
        const patientCount = patientCountForSubscription(subscription);
        const maxPatients = subscription?.max_patients_snapshot;

        return `
          <tr>
            <td>
              <span class="name">${escapeHtml(profile.full_name || 'بدون اسم')}</span>
              <span class="meta">${escapeHtml(profile.email || '')}</span>
            </td>
            <td>${subscription ? escapeHtml(planName(subscription.plan_id)) : '—'}</td>
            <td>${date(subscription?.start_date)}</td>
            <td>${date(subscription?.expiry_date)}</td>
            <td>${patientCount} / ${
              maxPatients == null ? '∞' : escapeHtml(maxPatients)
            }</td>
            <td>
              ${
                subscription
                  ? statusBadge(subscription.status, subscription.expiry_date)
                  : '<span class="badge off">بدون اشتراك</span>'
              }
            </td>
            <td class="actions-cell">
              ${
                subscription
                  ? `
                    <button class="icon-btn" title="تعديل الاشتراك" data-edit-sub="${escapeHtml(
                      subscription.id
                    )}">
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="icon-btn danger" title="حذف الاشتراك" data-del-sub="${escapeHtml(
                      subscription.id
                    )}">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  `
                  : '—'
              }
            </td>
          </tr>
        `;
      })
      .join('');

    setState('doctor', '', true);
  }

  function planForm(plan) {
    const features = plan?.features || {};

    return `
      <form id="planForm">
        <div class="grid">
          <div class="field">
            <label>اسم الخطة *</label>
            <input id="f_name" required value="${escapeHtml(plan?.name || '')}">
          </div>

          <div class="field">
            <label>السعر (جنيه) *</label>
            <input id="f_price" type="number" min="0" step="0.01" required value="${plan?.price ?? 0}">
          </div>

          <div class="field">
            <label>المدة بالأيام *</label>
            <input id="f_duration" type="number" min="1" required value="${plan?.duration_days ?? 30}">
          </div>

          <div class="field">
            <label>الحد الأقصى للمرضى</label>
            <input
              id="f_max"
              type="number"
              min="1"
              placeholder="اتركه فارغًا = غير محدود"
              value="${plan?.max_patients ?? ''}"
            >
          </div>

          <div class="field">
            <label>طريقة الدفع</label>
            <input
              id="f_payment"
              placeholder="مثال: Instapay / Vodafone Cash / تحويل بنكي"
              value="${escapeHtml(plan?.payment_method || '')}"
            >
          </div>

          <div class="field">
            <label>الحالة</label>
            <select id="f_active">
              <option value="true" ${plan?.is_active !== false ? 'selected' : ''}>متاحة للاشتراك</option>
              <option value="false" ${plan?.is_active === false ? 'selected' : ''}>غير متاحة</option>
            </select>
          </div>

          <div class="field">
            <label class="check">
              <input id="f_trial" type="checkbox" ${plan?.is_free_trial ? 'checked' : ''}>
              خطة تجربة مجانية
            </label>
          </div>

          <div class="field full">
            <label>الوصف</label>
            <textarea id="f_desc">${escapeHtml(plan?.description || '')}</textarea>
          </div>

          <div class="field full">
            <label>المميزات</label>
            <div class="check-grid">
              ${PLAN_FEATURES.map(
                (feature) => `
                  <label class="check">
                    <input
                      type="checkbox"
                      class="feature-check"
                      data-key="${escapeHtml(feature.key)}"
                      ${features[feature.key] === true ? 'checked' : ''}
                    >
                    ${escapeHtml(feature.label)}
                  </label>
                `
              ).join('')}
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn btn-primary" type="submit">
            <i class="fa-solid fa-floppy-disk"></i>
            حفظ الخطة
          </button>
          <button class="btn btn-outline" type="button" id="cancelModal">
            إلغاء
          </button>
        </div>
      </form>
    `;
  }

  async function openPlan(plan) {
    const action = plan ? 'update' : 'add';

    if (
      !(await requireAction(
        action,
        plan
          ? 'غير مسموح بتعديل الخطة.'
          : 'غير مسموح بإضافة خطة.'
      ))
    ) {
      return;
    }

    openModal(plan ? 'تعديل الخطة' : 'إنشاء خطة جديدة', planForm(plan));

    $('planForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await savePlan(plan?.id || null);
    });

    $('cancelModal').onclick = closeModal;
  }

  async function savePlan(id) {
    const action = id ? 'update' : 'add';

    if (
      !(await requireAction(
        action,
        id ? 'غير مسموح بتعديل الخطة.' : 'غير مسموح بإضافة خطة.'
      ))
    ) {
      return;
    }

    const features = {};

    document
      .querySelectorAll('.feature-check:checked')
      .forEach((element) => {
        features[element.dataset.key] = true;
      });

    const payload = {
      name: $('f_name').value.trim(),
      price: Number($('f_price').value),
      duration_days: Number($('f_duration').value),
      max_patients: $('f_max').value ? Number($('f_max').value) : null,
      payment_method: $('f_payment').value.trim(),
      description: $('f_desc').value.trim() || null,
      is_active: $('f_active').value === 'true',
      is_free_trial: $('f_trial').checked,
      features
    };

    if (
      !payload.name ||
      payload.duration_days < 1 ||
      payload.price < 0 ||
      payload.max_patients === 0
    ) {
      toast('راجع بيانات الخطة');
      return;
    }

    const result = id
      ? await db.from('subscription_plans').update(payload).eq('id', id)
      : await db.from('subscription_plans').insert(payload);

    if (result.error) {
      toast(result.error.message || 'تعذر حفظ الخطة');
      return;
    }

    closeModal();
    toast('تم حفظ الخطة');
    await loadAll();
  }

  function subscriptionForm(subscription) {
    return `
      <form id="subForm">
        <div class="grid">
          <div class="field">
            <label>اسم الطبيب في سجل الاشتراك</label>
            <input id="s_name" value="${escapeHtml(subscription.full_name || '')}">
          </div>

          <div class="field">
            <label>الخطة</label>
            <select id="s_plan">
              ${state.plans
                .map(
                  (plan) => `
                    <option value="${escapeHtml(plan.id)}" ${
                      plan.id === subscription.plan_id ? 'selected' : ''
                    }>
                      ${escapeHtml(plan.name)} — ${money(plan.price)}
                    </option>
                  `
                )
                .join('')}
            </select>
          </div>

          <div class="field">
            <label>الحالة</label>
            <select id="s_status">
              <option value="pending" ${
                subscription.status === 'pending' ? 'selected' : ''
              }>قيد المراجعة</option>
              <option value="paid" ${
                subscription.status === 'paid' ? 'selected' : ''
              }>مفعّلة</option>
              <option value="canceled" ${
                subscription.status === 'canceled' ? 'selected' : ''
              }>ملغاة</option>
            </select>
          </div>

          <div class="field">
            <label>تاريخ الطلب</label>
            <input value="${escapeHtml(dateTime(subscription.created_at))}" disabled>
          </div>

          <div class="field full">
            <label>ملاحظات</label>
            <textarea id="s_notes">${escapeHtml(subscription.notes || '')}</textarea>
          </div>

          <div class="field full">
            <div style="font-size:11px;color:#718683;background:#f7faf9;border-radius:9px;padding:9px">
              عند تفعيل الاشتراك، يقوم النظام تلقائيًا بحساب تاريخ البداية والنهاية وأخذ Snapshot من الخطة.
            </div>
          </div>
        </div>

        <div class="modal-foot">
          <button class="btn btn-primary" type="submit">حفظ التعديل</button>
          <button class="btn btn-outline" type="button" id="cancelModal">إلغاء</button>
        </div>
      </form>
    `;
  }

  async function openSubscription(subscription) {
    if (!(await requireAction('update', 'غير مسموح بتعديل الاشتراك.'))) {
      return;
    }

    openModal('تعديل الاشتراك', subscriptionForm(subscription));

    $('subForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveSubscription(subscription);
    });

    $('cancelModal').onclick = closeModal;
  }

  async function saveSubscription(subscription) {
    if (!(await requireAction('update', 'غير مسموح بتعديل الاشتراك.'))) {
      return;
    }

    const selectedPlan = state.plans.find(
      (plan) => plan.id === $('s_plan').value
    );

    if (!selectedPlan) {
      toast('الخطة المحددة غير موجودة');
      return;
    }

    const payload = {
      full_name: $('s_name').value.trim() || null,
      plan_id: selectedPlan.id,
      status: $('s_status').value,
      notes: $('s_notes').value.trim() || null
    };

    if (selectedPlan.id !== subscription.plan_id) {
      payload.duration_days_snapshot = selectedPlan.duration_days;
      payload.max_patients_snapshot = selectedPlan.max_patients;
      payload.features_snapshot = selectedPlan.features || {};
    }

    const result = await db
      .from('subscriptions')
      .update(payload)
      .eq('id', subscription.id);

    if (result.error) {
      toast(result.error.message || 'تعذر تعديل الاشتراك');
      return;
    }

    closeModal();
    toast('تم تعديل الاشتراك');
    await loadAll();
  }

  async function deleteSubscription(subscription) {
    if (!(await requireAction('delete', 'غير مسموح بحذف الاشتراك.'))) {
      return;
    }

    askConfirm(
      'حذف الاشتراك',
      `هل أنت متأكد من حذف اشتراك <b>${escapeHtml(
        subscription.full_name || 'هذا الطبيب'
      )}</b>؟<br>سيتم حذف سجل الاشتراك نهائيًا. هذه العملية لا تحذف حساب الطبيب أو مرضاه.`,
      async () => {
        if (
          !(await requireAction(
            'delete',
            'غير مسموح بحذف الاشتراك.'
          ))
        ) {
          return;
        }

        const result = await db
          .from('subscriptions')
          .delete()
          .eq('id', subscription.id);

        if (result.error) {
          toast(result.error.message || 'تعذر حذف الاشتراك');
          return;
        }

        toast('تم حذف الاشتراك');
        await loadAll();
      }
    );
  }

  async function deletePlan(plan) {
    if (!(await requireAction('delete', 'غير مسموح بحذف الخطة.'))) {
      return;
    }

    const used = state.subscriptions.some(
      (subscription) => subscription.plan_id === plan.id
    );

    if (used) {
      toast('لا يمكن حذف خطة مرتبطة باشتراكات. عطّلها بدلًا من حذفها.');
      return;
    }

    askConfirm(
      'حذف الخطة',
      `هل أنت متأكد من حذف خطة <b>${escapeHtml(
        plan.name
      )}</b>؟<br>لن يمكن التراجع عن هذه العملية.`,
      async () => {
        if (
          !(await requireAction(
            'delete',
            'غير مسموح بحذف الخطة.'
          ))
        ) {
          return;
        }

        const result = await db
          .from('subscription_plans')
          .delete()
          .eq('id', plan.id);

        if (result.error) {
          toast(result.error.message || 'تعذر حذف الخطة');
          return;
        }

        toast('تم حذف الخطة');
        await loadAll();
      }
    );
  }

  async function showPaymentProof(id) {
    if (!(await requireAction('read', 'غير مسموح بعرض إثبات الدفع.'))) {
      return;
    }

    const subscription = state.subscriptions.find((item) => item.id === id);
    if (!subscription?.payment_proof_path) return;

    $('proofBody').innerHTML = 'جاري تحميل إثبات الدفع...';
    $('proofBg').style.display = 'flex';

    const result = await db.storage
      .from('subscription-proofs')
      .createSignedUrl(subscription.payment_proof_path, 300);

    if (result.error || !result.data?.signedUrl) {
      $('proofBody').innerHTML =
        '<div class="state">تعذر عرض إثبات الدفع.</div>';
      return;
    }

    $('proofBody').innerHTML = `
      <img
        src="${escapeHtml(result.data.signedUrl)}"
        style="max-width:100%;max-height:70vh;display:block;margin:auto;border-radius:12px"
        alt="إثبات الدفع"
      >
    `;
  }

  function switchTab(tab) {
    state.activeTab = tab;

    document
      .querySelectorAll('.tab')
      .forEach((button) =>
        button.classList.toggle('active', button.dataset.tab === tab)
      );

    ['requests', 'plans', 'doctors'].forEach((name) => {
      const element = $(`tab-${name}`);
      if (element) {
        element.style.display = name === tab ? 'block' : 'none';
      }
    });

    if (tab === 'doctors') {
      renderDoctors();
    }
  }

  function bindEvents() {
    document
      .querySelectorAll('.tab')
      .forEach((button) => {
        button.onclick = () => switchTab(button.dataset.tab);
      });

    $('newPlanBtn').onclick = () => openPlan(null);
    $('refreshBtn').onclick = () => loadAll();
    $('refreshDoctorsBtn').onclick = () => loadAll();
    $('doctorSearch').oninput = renderDoctors;

    $('dashboardBtn').onclick = () => {
      location.href = 'app.html';
    };

    $('logoutBtn').onclick = async () => {
      await db.auth.signOut();
      location.replace('index.html');
    };

    $('modalClose').onclick = closeModal;
    $('modalBg').onclick = (event) => {
      if (event.target === event.currentTarget) closeModal();
    };

    $('confirmClose').onclick = closeConfirm;
    $('confirmNo').onclick = closeConfirm;

    $('confirmYes').onclick = async () => {
      const action = confirmAction;
      if (!action) return;

      confirmAction = null;
      $('confirmBg').style.display = 'none';
      await action();
    };

    $('confirmBg').onclick = (event) => {
      if (event.target === event.currentTarget) closeConfirm();
    };

    $('proofClose').onclick = () => {
      $('proofBg').style.display = 'none';
    };

    $('proofBg').onclick = (event) => {
      if (event.target === event.currentTarget) {
        $('proofBg').style.display = 'none';
      }
    };

    $('requestsBody').onclick = (event) => {
      const proofButton = event.target.closest('[data-proof]');
      const editButton = event.target.closest('[data-edit-sub]');
      const deleteButton = event.target.closest('[data-del-sub]');

      if (proofButton) {
        showPaymentProof(proofButton.dataset.proof);
        return;
      }

      if (editButton) {
        const subscription = state.subscriptions.find(
          (item) => item.id === editButton.dataset.editSub
        );

        if (subscription) openSubscription(subscription);
        return;
      }

      if (deleteButton) {
        const subscription = state.subscriptions.find(
          (item) => item.id === deleteButton.dataset.delSub
        );

        if (subscription) deleteSubscription(subscription);
      }
    };

    $('plansBody').onclick = (event) => {
      const editButton = event.target.closest('[data-edit-plan]');
      const deleteButton = event.target.closest('[data-del-plan]');

      if (editButton) {
        const plan = state.plans.find(
          (item) => item.id === editButton.dataset.editPlan
        );

        if (plan) openPlan(plan);
        return;
      }

      if (deleteButton) {
        const plan = state.plans.find(
          (item) => item.id === deleteButton.dataset.delPlan
        );

        if (plan) deletePlan(plan);
      }
    };

    $('doctorsBody').onclick = (event) => {
      const editButton = event.target.closest('[data-edit-sub]');
      const deleteButton = event.target.closest('[data-del-sub]');

      if (editButton) {
        const subscription = state.subscriptions.find(
          (item) => item.id === editButton.dataset.editSub
        );

        if (subscription) openSubscription(subscription);
        return;
      }

      if (deleteButton) {
        const subscription = state.subscriptions.find(
          (item) => item.id === deleteButton.dataset.delSub
        );

        if (subscription) deleteSubscription(subscription);
      }
    };
  }

  async function init() {
    if (!db || !access) {
      console.error('Diet Planner core services are unavailable.');
      location.replace('index.html');
      return;
    }

    bindEvents();

    try {
      if (!(await requireAction('read', 'غير مسموح بدخول صفحة الإدارة.'))) {
        location.replace('index.html');
        return;
      }

      const adminContent = $('adminContent');
      if (adminContent) {
        adminContent.style.display = 'block';
      }

      await loadAll();
    } catch (error) {
      console.error(error);

      ['request', 'plan', 'doctor'].forEach((prefix) => {
        setState(prefix, error?.message || 'حدث خطأ');
      });
    }
  }

  init();
})();
