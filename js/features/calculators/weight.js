(function () {
  'use strict';

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;

  const state = {
    patientId: new URLSearchParams(window.location.search).get('id'),
    user: null,
    patient: null,
    weightLogs: [],
    isAdmin: false,
    hasActiveSubscription: false,
    toastTimer: null
  };

  const $ = (id) => document.getElementById(id);

  function showToast(message, type = 'success') {
    const el = $('toast');
    if (!el) return;
    clearTimeout(state.toastTimer);
    el.textContent = message;
    el.className =
      'fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg ' +
      (type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white');
    state.toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  function formatDate(date) {
    if (!date) return '--';
    const value = new Date(`${date}T00:00:00`);
    if (Number.isNaN(value.getTime())) return date;
    return value.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  async function refreshWriteAccess() {
    try {
      const accessStatus = await access?.getAccessStatus?.();
      state.user = accessStatus?.user || null;
      if (!accessStatus?.authenticated) {
        state.isAdmin = false;
        state.hasActiveSubscription = false;
        updateWriteControls();
        return;
      }
      state.isAdmin = accessStatus.isAdmin === true;
      state.hasActiveSubscription = state.isAdmin
        ? true
        : (await access?.hasActiveSubscription?.(state.user.id)) === true;
      updateWriteControls();
    } catch (error) {
      console.error('Weight access check failed:', error);
      state.isAdmin = false;
      state.hasActiveSubscription = false;
      updateWriteControls();
    }
  }

  function canWriteWeight() {
    return state.isAdmin || state.hasActiveSubscription;
  }

  function updateWriteControls() {
    const addButton = $('addWeightBtn');
    const accessBox = $('weightAccessStatus');
    if (addButton) {
      addButton.disabled = !canWriteWeight();
      addButton.classList.toggle('opacity-50', !canWriteWeight());
      addButton.classList.toggle('cursor-not-allowed', !canWriteWeight());
      addButton.title = canWriteWeight()
        ? 'إضافة قياس'
        : 'إضافة قياس متاحة أثناء الاشتراك المدفوع فقط';
    }
    if (accessBox) {
      accessBox.textContent = state.isAdmin
        ? 'وضع المدير: جميع الصلاحيات متاحة.'
        : state.hasActiveSubscription
          ? 'الاشتراك فعال — يمكنك إضافة وحذف قياسات الوزن.'
          : 'الاشتراك غير فعال — لا يمكنك إضافة قياسات جديدة، لكن يمكنك عرض وحذف القياسات الحالية.';
    }
  }

  async function loadPage() {
    try {
      if (!supabase) throw new Error('DietPlannerAccess is not available.');
      if (!state.patientId) throw new Error('Missing patient id.');

      await refreshWriteAccess();
      if (!state.user) {
        window.location.href = 'index.html';
        return;
      }

      const { data: patient, error: patientError } = await supabase
        .from('patients')
        .select('id,name,height')
        .eq('id', state.patientId)
        .eq('user_id', state.user.id)
        .maybeSingle();

      if (patientError) throw patientError;
      if (!patient) throw new Error('Patient not found.');

      state.patient = patient;
      $('patientName').textContent = patient.name || 'المريض';
      $('backBtn').href = `patient-profile.html?id=${encodeURIComponent(state.patientId)}`;

      const { data: weights, error: weightsError } = await supabase
        .from('weight_logs')
        .select('id,patient_id,weight,measurement_date,notes,created_at')
        .eq('patient_id', state.patientId)
        .order('measurement_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (weightsError) throw weightsError;

      state.weightLogs = (weights || []).map((item) => ({
        id: item.id,
        date: item.measurement_date,
        weight: Number(item.weight),
        notes: item.notes || ''
      }));

      $('weightLogDate').value = new Date().toISOString().slice(0, 10);
      render();
    } catch (error) {
      console.error('Weight page initialization failed:', error);
      $('patientName').textContent = 'تعذر تحميل البيانات';
      showToast('تعذر تحميل بيانات المريض أو الوزن', 'error');
    }
  }

  async function addWeightEntry() {
    if (!canWriteWeight()) {
      showToast('إضافة قياسات الوزن متاحة أثناء الاشتراك المدفوع فقط', 'error');
      return;
    }
    const date = $('weightLogDate').value;
    const weight = Number.parseFloat($('weightLogVal').value);

    if (!date || !Number.isFinite(weight) || weight <= 0) {
      showToast('أدخل تاريخًا ووزنًا صحيحًا', 'error');
      return;
    }

    try {
      if (!state.user) throw new Error('Authentication required.');

      const { data, error } = await supabase
        .from('weight_logs')
        .insert({
          patient_id: state.patientId,
          weight,
          measurement_date: date,
          notes: null
        })
        .select('id,patient_id,weight,measurement_date,notes,created_at')
        .single();

      if (error) throw error;

      state.weightLogs.push({
        id: data.id,
        date: data.measurement_date,
        weight: Number(data.weight),
        notes: data.notes || ''
      });

      sortLogs();
      render();
      $('weightLogVal').value = '';
      showToast('تم تسجيل القياس بنجاح');
    } catch (error) {
      console.error('Add weight failed:', error);
      showToast('تعذر حفظ قياس الوزن في قاعدة البيانات', 'error');
    }
  }

  function sortLogs() {
    state.weightLogs.sort((a, b) => {
      const dateDiff = String(a.date).localeCompare(String(b.date));
      return dateDiff || String(a.id).localeCompare(String(b.id));
    });
  }

  function requestDelete(index) {
    const entry = state.weightLogs[index];
    if (!entry) return;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4';
    modal.innerHTML = `
      <div class="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 text-right" dir="rtl">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <i class="fa-solid fa-trash"></i>
          </div>
          <div>
            <h3 class="font-black text-slate-800 text-sm">تأكيد حذف القياس</h3>
            <p class="text-xs text-slate-500 mt-1">هل تريد حذف قياس الوزن المحدد؟</p>
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" data-delete class="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition">حذف</button>
          <button type="button" data-cancel class="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition">إلغاء</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    const closeModal = () => modal.remove();

    modal.querySelector('[data-cancel]').addEventListener('click', closeModal);
    modal.querySelector('[data-delete]').addEventListener('click', async () => {
      closeModal();
      if (!state.user) {
        showToast('يجب تسجيل الدخول أولاً', 'error');
        return;
      }
      try {
        const { error } = await supabase
          .from('weight_logs')
          .delete()
          .eq('id', entry.id)
          .eq('patient_id', state.patientId);

        if (error) throw error;

        state.weightLogs.splice(index, 1);
        render();
        showToast('تم حذف القياس');
      } catch (error) {
        console.error('Delete weight failed:', error);
        showToast('تعذر حذف القياس من قاعدة البيانات', 'error');
      }
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
  }

  function render() {
    renderSummary();
    renderTable();
    renderWeightChart(state.weightLogs);
  }

  function renderSummary() {
    const startEl = $('kpiStartWeight');
    const currentEl = $('kpiCurrentWeight');
    const diffEl = $('kpiTotalDiff');
    const bmiEl = $('kpiBMI');
    const bmiStatus = $('kpiBMIStatus');

    if (!state.weightLogs.length) {
      startEl.textContent = currentEl.textContent = diffEl.textContent = '--';
      bmiEl.textContent = '--';
      bmiStatus.textContent = 'غير محدد';
      bmiStatus.className = 'text-xs block font-bold mt-0.5 text-slate-400';
      return;
    }

    const start = state.weightLogs[0].weight;
    const current = state.weightLogs[state.weightLogs.length - 1].weight;
    const diff = current - start;

    startEl.textContent = start.toFixed(1);
    currentEl.textContent = current.toFixed(1);
    diffEl.textContent = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`;
    diffEl.className = diff < 0
      ? 'text-2xl font-black text-emerald-600'
      : diff > 0
        ? 'text-2xl font-black text-rose-600'
        : 'text-2xl font-black text-slate-800';

    const heightCm = Number(state.patient?.height);
    const heightM = heightCm / 100;

    if (!Number.isFinite(heightCm) || heightCm <= 0 || !Number.isFinite(current) || current <= 0) {
      bmiEl.textContent = '--';
      bmiStatus.textContent = 'أدخل الطول لحسابه';
      bmiStatus.className = 'text-xs block font-bold mt-0.5 text-slate-400';
      return;
    }

    const bmi = current / (heightM * heightM);
    bmiEl.textContent = bmi.toFixed(1);

    const status = bmi < 18.5
      ? ['نقص وزن', 'text-amber-500']
      : bmi < 25
        ? ['وزن طبيعي', 'text-emerald-600']
        : bmi < 30
          ? ['زيادة وزن', 'text-amber-600']
          : ['سمنة', 'text-rose-600'];

    bmiStatus.textContent = status[0];
    bmiStatus.className = `text-xs block font-bold mt-0.5 ${status[1]}`;
  }

  function renderTable() {
    const body = $('weightTableBody');

    if (!state.weightLogs.length) {
      body.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-400 font-bold">لا توجد قياسات مسجلة</td></tr>';
      return;
    }

    body.innerHTML = state.weightLogs.map((log, index) => {
      const previous = index ? state.weightLogs[index - 1].weight : log.weight;
      const diff = log.weight - previous;
      const diffText = diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}`;
      const diffClass = diff < 0 ? 'text-emerald-600' : diff > 0 ? 'text-rose-500' : 'text-slate-400';

      return `
        <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0">
          <td class="py-2.5 px-3 font-bold">${escapeHtml(formatDate(log.date))}</td>
          <td class="py-2.5 px-3 text-center font-black text-emerald-700">${log.weight.toFixed(1)} كجم</td>
          <td class="py-2.5 px-3 text-center font-bold ${diffClass}">${diffText}</td>
          <td class="py-2.5 px-2 text-center no-print">
            <button type="button" data-action="delete-weight" data-index="${index}" class="text-rose-400 hover:text-rose-600 p-1 cursor-pointer" aria-label="حذف القياس">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>`;
    }).join('');
  }

  function getChartStep() {
    const value = Number.parseFloat($('weightAxisStep')?.value);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function formatWeight(value) {
    return Number(value).toFixed(1);
  }

  function buildSmoothPath(points, x, y) {
    if (points.length < 2) return '';

    const coords = points.map((point, index) => ({
      x: x(index),
      y: y(point.weight)
    }));

    let path = `M ${coords[0].x} ${coords[0].y}`;

    for (let i = 0; i < coords.length - 1; i += 1) {
      const current = coords[i];
      const next = coords[i + 1];
      const previous = coords[Math.max(0, i - 1)];
      const afterNext = coords[Math.min(coords.length - 1, i + 2)];
      const dx = (next.x - current.x) / 3;

      const clampY = (value) => {
        const low = Math.min(current.y, next.y);
        const high = Math.max(current.y, next.y);
        return Math.max(low, Math.min(high, value));
      };

      const control1Y = clampY(current.y + (next.y - previous.y) / 6);
      const control2Y = clampY(next.y - (afterNext.y - current.y) / 6);

      path += ` C ${current.x + dx} ${control1Y}, ${next.x - dx} ${control2Y}, ${next.x} ${next.y}`;
    }

    return path;
  }

  function buildChartTicks(minY, maxY, step) {
    const count = Math.round((maxY - minY) / step);
    const ticks = [];

    for (let i = 0; i <= count; i += 1) {
      ticks.push(Number((minY + i * step).toFixed(2)));
    }

    return ticks;
  }

  function renderWeightChart(logs) {
    const box = $('weightChartContainer');
    if (!box) return;

    if (!logs || logs.length < 2) {
      box.innerHTML = `
        <div class="chart-empty">
          <i class="fa-solid fa-chart-line"></i>
          <span>سجّل قياسين على الأقل لعرض تطور الوزن</span>
        </div>`;
      return;
    }

    const points = logs
      .map((item, index) => ({
        index,
        date: item.date,
        weight: Number(item.weight)
      }))
      .filter((item) => Number.isFinite(item.weight));

    if (points.length < 2) return;

    const width = 820;
    const height = 310;
    const pad = { top: 24, right: 28, bottom: 56, left: 62 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const step = getChartStep();

    const minValue = Math.min(...points.map((point) => point.weight));
    const maxValue = Math.max(...points.map((point) => point.weight));

    // Keep five complete Y-axis intervals below the lowest measured weight.
    // The lower bound belongs to the chart scale only; it does not alter the data.
    const lowerIntervals = 5;
    const lowestGrid = Math.floor(minValue / step) * step;
    const minY = Math.max(0, lowestGrid - (lowerIntervals * step));
    const maxY = Math.ceil(maxValue / step) * step + step;
    const yRange = Math.max(step * 2, maxY - minY);

    const x = (index) =>
      pad.left + (index / (points.length - 1)) * plotW;

    const y = (value) =>
      pad.top + ((maxY - value) / yRange) * plotH;

    const baseY = pad.top + plotH;
    const ticks = buildChartTicks(minY, maxY, step);

    // Every selected interval remains a grid line.
    // Labels are reduced only when the selected interval would create too many labels.
    const labelEvery = Math.max(1, Math.ceil(ticks.length / 10));

    const grid = ticks.map((value, index) => {
      const isMajor = index % labelEvery === 0 || index === ticks.length - 1;
      return `
        <line
          x1="${pad.left}"
          y1="${y(value)}"
          x2="${width - pad.right}"
          y2="${y(value)}"
          class="${isMajor ? 'chart-grid chart-grid-major' : 'chart-grid chart-grid-minor'}"
        />
        ${isMajor
          ? `<text x="${pad.left - 10}" y="${y(value) + 4}" text-anchor="end" class="chart-axis">${formatWeight(value)}</text>`
          : ''}
      `;
    }).join('');

    const yAxis = `
      <line
        x1="${pad.left}"
        y1="${pad.top}"
        x2="${pad.left}"
        y2="${baseY}"
        class="chart-y-axis"
      />`;

    const linePath = buildSmoothPath(points, x, y);
    const areaPath =
      `${linePath} L ${x(points.length - 1)} ${baseY} L ${x(0)} ${baseY} Z`;

    const labelIndexes = new Set([0, points.length - 1]);
    const maxLabels = 6;

    if (points.length <= maxLabels) {
      points.forEach((point) => labelIndexes.add(point.index));
    } else {
      const interval = (points.length - 1) / (maxLabels - 1);
      for (let i = 1; i < maxLabels - 1; i += 1) {
        labelIndexes.add(Math.round(i * interval));
      }
    }

    const labels = points.map((point, index) => {
      if (!labelIndexes.has(index)) return '';
      return `
        <text
          x="${x(index)}"
          y="${height - 17}"
          text-anchor="middle"
          class="chart-date"
        >${escapeHtml(formatDate(point.date))}</text>`;
    }).join('');

    const dots = points.map((point, index) => `
      <circle
        cx="${x(index)}"
        cy="${y(point.weight)}"
        r="4.5"
        class="chart-dot"
        data-chart-index="${index}"
        tabindex="0"
        role="button"
        aria-label="${escapeHtml(formatDate(point.date))}: ${formatWeight(point.weight)} كجم"
      />`
    ).join('');

    box.innerHTML = `
      <div class="chart-shell">
        <svg
          viewBox="0 0 ${width} ${height}"
          class="weight-chart"
          role="img"
          aria-label="منحنى تطور الوزن"
        >
          <defs>
            <linearGradient id="weightAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#10b981" stop-opacity=".14"/>
              <stop offset="100%" stop-color="#10b981" stop-opacity=".01"/>
            </linearGradient>
          </defs>

          ${grid}
          ${yAxis}

          <path d="${areaPath}" class="chart-area"/>
          <path d="${linePath}" class="chart-line"/>

          <line
            id="chartFocusLine"
            x1="0"
            y1="${pad.top}"
            x2="0"
            y2="${baseY}"
            class="chart-focus"
          />
          <circle id="chartFocusDot" cx="0" cy="0" r="6" class="chart-focus-dot"/>

          ${dots}
          ${labels}

          <text
            x="18"
            y="${pad.top + plotH / 2}"
            transform="rotate(-90 18 ${pad.top + plotH / 2})"
            text-anchor="middle"
            class="chart-axis"
          >الوزن (كجم)</text>
        </svg>

        <div id="weightChartTooltip" class="chart-tooltip"></div>
      </div>`;

    const shell = box.querySelector('.chart-shell');
    const svg = box.querySelector('.weight-chart');
    const tooltip = box.querySelector('#weightChartTooltip');
    const focusLine = box.querySelector('#chartFocusLine');
    const focusDot = box.querySelector('#chartFocusDot');

    const showPoint = (index) => {
      const point = points[index];
      if (!point || !shell) return;

      const svgX = x(index);
      const svgY = y(point.weight);
      const rect = svg.getBoundingClientRect();

      const renderedX = ((svgX / width) * rect.width);
      const renderedY = ((svgY / height) * rect.height);

      focusLine.setAttribute('x1', svgX);
      focusLine.setAttribute('x2', svgX);
      focusDot.setAttribute('cx', svgX);
      focusDot.setAttribute('cy', svgY);
      focusLine.style.opacity = '1';
      focusDot.style.opacity = '1';

      tooltip.innerHTML =
        `<strong>${formatWeight(point.weight)} كجم</strong>${escapeHtml(formatDate(point.date))}`;

      tooltip.style.left = `${renderedX}px`;
      tooltip.style.top = `${Math.max(10, renderedY)}px`;
      tooltip.classList.add('show');
    };

    const hidePoint = () => {
      focusLine.style.opacity = '0';
      focusDot.style.opacity = '0';
      tooltip.classList.remove('show');
    };

    box.querySelectorAll('[data-chart-index]').forEach((dot) => {
      const index = Number(dot.dataset.chartIndex);

      dot.addEventListener('mouseenter', () => showPoint(index));
      dot.addEventListener('focus', () => showPoint(index));
      dot.addEventListener('mouseleave', hidePoint);
      dot.addEventListener('blur', hidePoint);
    });

    const getNearestIndex = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const localX = clientX - rect.left;
      const svgX = (localX / rect.width) * width;
      const ratio = (svgX - pad.left) / plotW;

      return Math.max(
        0,
        Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))
      );
    };

    svg.addEventListener('mousemove', (event) => {
      showPoint(getNearestIndex(event.clientX));
    });

    svg.addEventListener('mouseleave', hidePoint);

    svg.addEventListener('touchstart', (event) => {
      const touch = event.touches[0];
      if (touch) showPoint(getNearestIndex(touch.clientX));
    }, { passive: true });

    svg.addEventListener('touchmove', (event) => {
      const touch = event.touches[0];
      if (touch) showPoint(getNearestIndex(touch.clientX));
    }, { passive: true });

    svg.addEventListener('touchend', hidePoint, { passive: true });
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'delete-weight') requestDelete(Number(event.target.closest('[data-action]').dataset.index));
    });

    $('addWeightBtn')?.addEventListener('click', addWeightEntry);
    $('weightAxisStep')?.addEventListener('change', () => {
      renderWeightChart(state.weightLogs);
    });
  }

  function init() {
    bindEvents();
    loadPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
