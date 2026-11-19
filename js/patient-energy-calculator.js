(() => {
/* =========================================================

 * ENERGY / MACRO CALCULATOR
 * ========================================================= */

const calcDb = window.DietPlannerAccess?.supabaseClient;
if (!calcDb) console.error("Diet Planner access layer is unavailable to the calculator.");
const urlParams = new URLSearchParams(window.location.search);
let calcResolvedPatientId = urlParams.get('id') || urlParams.get('patient') || urlParams.get('patient_id');
let calcInitialized = false;
let lastEnergyCalculation = null;
let selectedEnergyEquation = 'mifflin';

function calcShowToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const bgColor = type === 'error' ? 'bg-rose-600' : 'bg-emerald-600';
    const toast = document.createElement('div');
    toast.className = `${bgColor} text-white font-bold text-xs px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 transition-all transform translate-y-2 opacity-0 pointer-events-auto`;
    toast.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

        function selectEnergyEquation(eq) {
            selectedEnergyEquation = eq === 'schofield' ? 'schofield' : 'mifflin';

            const heightField = document.getElementById('heightField');
            const schInfo = document.getElementById('schofieldInfo');
            const mifflinBtn = document.getElementById('eqBtnMifflin');
            const schofieldBtn = document.getElementById('eqBtnSchofield');

            heightField?.classList.toggle('hidden', selectedEnergyEquation !== 'mifflin');
            schInfo?.classList.toggle('hidden', selectedEnergyEquation !== 'schofield');

            const active = 'flex-1 lg:flex-none px-5 py-2.5 rounded-lg text-xs font-extrabold transition bg-white text-emerald-700 shadow-sm';
            const inactive = 'flex-1 lg:flex-none px-5 py-2.5 rounded-lg text-xs font-extrabold transition text-slate-500';
            if (mifflinBtn) mifflinBtn.className = selectedEnergyEquation === 'mifflin' ? active : inactive;
            if (schofieldBtn) schofieldBtn.className = selectedEnergyEquation === 'schofield' ? active : inactive;

            const equationLabel = document.getElementById('resEquation');
            if (equationLabel) equationLabel.textContent =
                selectedEnergyEquation === 'mifflin' ? 'Mifflin-St Jeor' : 'Schofield';

        }

        function calculateSelectedEnergy() {
            const gender = document.getElementById('energyGender').value;
            const age = parseFloat(document.getElementById('energyAge').value);
            const weight = parseFloat(document.getElementById('energyWeight').value);
            const activity = parseFloat(document.getElementById('calcActivity').value) || 1.2;

            if (!Number.isFinite(age) || age < 0 || !Number.isFinite(weight) || weight <= 0) {
                calcShowToast('أدخل العمر والوزن بشكل صحيح أولاً', 'error');
                return;
            }

            let bmr;
            let group;

            if (selectedEnergyEquation === 'mifflin') {
                const height = parseFloat(document.getElementById('energyHeight').value);
                if (!Number.isFinite(height) || height <= 0) {
                    calcShowToast('أدخل الطول لأن معادلة Mifflin-St Jeor تحتاج الطول', 'error');
                    return;
                }
                bmr = (10 * weight) + (6.25 * height) - (5 * age) + (gender === 'male' ? 5 : -161);
                group = '—';
            } else {
                const s = schofieldBMR(gender, age, weight);
                if (!s) {
                    calcShowToast('تعذر تحديد معادلة Schofield لهذه البيانات', 'error');
                    return;
                }
                bmr = s.bmr;
                group = s.group;
            }

            const tdee = Math.round(bmr * activity);
            lastEnergyCalculation = { bmr: Math.round(bmr), tdee, group, activity };
            const approveButton = document.getElementById('approveEnergyTargetsBtn');
            if (approveButton) approveButton.disabled = false;

            document.getElementById('resBMR').textContent = Math.round(bmr);
            document.getElementById('resTDEE').textContent = tdee;

            document.getElementById('resEquation').textContent =
                selectedEnergyEquation === 'mifflin' ? 'Mifflin-St Jeor' : 'Schofield';

            updateTargetAndMacros();
        }

        // Schofield 1985 / FAO-WHO-UNU equations, BMR from body weight.
        // kcal/day; W = body weight in kg.
        function schofieldBMR(gender, age, weight) {
            let bmr = 0;
            let group = '';

            if (age < 3) {
                if (gender === 'male') {
                    bmr = 59.512 * weight - 30.4;
                    group = '<3 سنوات — ذكر';
                } else {
                    bmr = 58.317 * weight - 31.1;
                    group = '<3 سنوات — أنثى';
                }
            } else if (age < 10) {
                if (gender === 'male') {
                    bmr = 22.706 * weight + 504.3;
                    group = '3–10 سنوات — ذكر';
                } else {
                    bmr = 20.315 * weight + 485.9;
                    group = '3–10 سنوات — أنثى';
                }
            } else if (age < 18) {
                if (gender === 'male') {
                    bmr = 17.686 * weight + 658.2;
                    group = '10–18 سنوات — ذكر';
                } else {
                    bmr = 13.384 * weight + 692.6;
                    group = '10–18 سنة — أنثى';
                }
            } else if (age < 30) {
                if (gender === 'male') {
                    bmr = 15.057 * weight + 692.2;
                    group = '18–30 سنة — ذكر';
                } else {
                    bmr = 14.818 * weight + 486.6;
                    group = '18–30 سنة — أنثى';
                }
            } else if (age < 60) {
                if (gender === 'male') {
                    bmr = 11.472 * weight + 873.1;
                    group = '30–60 سنة — ذكر';
                } else {
                    bmr = 8.126 * weight + 845.6;
                    group = '30–60 سنة — أنثى';
                }
            } else {
                if (gender === 'male') {
                    bmr = 11.711 * weight + 587.7;
                    group = '≥60 سنة — ذكر';
                } else {
                    bmr = 9.082 * weight + 658.5;
                    group = '≥60 سنة — أنثى';
                }
            }

            return { bmr, group };
        }

        function updateTargetAndMacros() {
            const tdee = parseInt(document.getElementById('resTDEE').textContent) || 0;
            const rawAdj = document.getElementById('calcAdjustment').value;
            const adj = (rawAdj === '' || rawAdj === '-' || isNaN(parseInt(rawAdj, 10))) ? 0 : parseInt(rawAdj, 10);
            
            const targetCal = tdee > 0 ? (tdee + adj) : (adj > 0 ? adj : 0);
            document.getElementById('finalTargetCal').textContent = Math.max(0, targetCal);

            const pPercent = parseFloat(document.getElementById('macroProPercent').value) || 0;
            const cPercent = parseFloat(document.getElementById('macroCarbPercent').value) || 0;
            const fPercent = parseFloat(document.getElementById('macroFatPercent').value) || 0;
            const totalPercent = pPercent + cPercent + fPercent;

            const alertEl = document.getElementById('macroTotalAlert');
            if (totalPercent !== 100) {
                alertEl.textContent = `المجموع الحالي: ${totalPercent}% (يجب أن يكون 100%)`;
                alertEl.className = "mt-2 text-[10px] font-bold text-center p-1 rounded bg-rose-100 text-rose-700 block";
            } else {
                alertEl.classList.add('hidden');
            }

            if (targetCal > 0 && totalPercent === 100) {
                document.getElementById('macroProGrams').textContent = Math.round((targetCal * (pPercent/100)) / 4) + 'g';
                document.getElementById('macroCarbGrams').textContent = Math.round((targetCal * (cPercent/100)) / 4) + 'g';
                document.getElementById('macroFatGrams').textContent = Math.round((targetCal * (fPercent/100)) / 9) + 'g';
            } else {
                document.getElementById('macroProGrams').textContent = '0g';
                document.getElementById('macroCarbGrams').textContent = '0g';
                document.getElementById('macroFatGrams').textContent = '0g';
            }
        }


async function loadCalculatorPatientData() {
    const authUser = await window.DietPlannerAccess?.getCurrentUser?.();
    if (!authUser) {
        calcShowToast('يجب تسجيل الدخول أولاً', 'error');
        return false;
    }
    if (!calcResolvedPatientId) {
        calcShowToast('لم يتم تحديد المريض', 'error');
        return false;
    }

    const { data, error } = await calcDb
        .from('patients')
        .select('*')
        .eq('id', calcResolvedPatientId)
        .maybeSingle();

    if (error || !data) {
        console.error('Patient energy calculator patient load failed:', error);
        calcShowToast('تعذر تحميل بيانات المريض', 'error');
        return false;
    }

    document.getElementById('energyGender').value = data.energy_gender || data.gender || 'male';
    document.getElementById('energyAge').value = data.energy_age ?? data.age ?? '';
    document.getElementById('energyHeight').value = data.energy_height_cm ?? data.height ?? '';
    document.getElementById('calcActivity').value = String(data.energy_activity_factor ?? '1.55');

    const hasApproved = Number(data.energy_target_calories) > 0 && !!data.energy_approved_at;
    if (hasApproved) {
        document.getElementById('energyWeight').value = data.energy_weight_kg ?? '';
        document.getElementById('macroProPercent').value = data.energy_protein_percent ?? 30;
        document.getElementById('macroCarbPercent').value = data.energy_carb_percent ?? 40;
        document.getElementById('macroFatPercent').value = data.energy_fat_percent ?? 30;
        document.getElementById('calcAdjustment').value = data.energy_adjustment ?? 0;
        selectEnergyEquation(data.energy_equation || 'mifflin');
        calculateSelectedEnergy();
        document.getElementById('calcAdjustment').value = data.energy_adjustment ?? 0;
        updateTargetAndMacros();

        const status = document.getElementById('energyApprovalStatus');
        if (status) {
            status.classList.add('is-approved');
            status.textContent = 'الاحتياجات معتمدة ومحفوظة لهذا المريض — آخر اعتماد: ' +
                new Date(data.energy_approved_at).toLocaleDateString('ar-EG');
        }
        return true;
    }

    const { data: weights, error: weightError } = await calcDb
        .from('weight_logs')
        .select('weight,measurement_date,created_at')
        .eq('patient_id', calcResolvedPatientId)
        .order('measurement_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);

    if (!weightError && weights?.[0]?.weight != null) {
        document.getElementById('energyWeight').value = Number(weights[0].weight);
    }

    document.getElementById('macroProPercent').value = 30;
    document.getElementById('macroCarbPercent').value = 40;
    document.getElementById('macroFatPercent').value = 30;
    document.getElementById('calcAdjustment').value = '-500';
    selectEnergyEquation('mifflin');
    updateTargetAndMacros();

    const status = document.getElementById('energyApprovalStatus');
    if (status) status.textContent = 'أدخل البيانات أو راجعها، ثم احسب الاحتياج واعتمده للمريض.';
    const approveButton = document.getElementById('approveEnergyTargetsBtn');
    if (approveButton) approveButton.disabled = true;
    return true;
}

function markEnergyCalculationStale() {
    lastEnergyCalculation = null;
    const button = document.getElementById('approveEnergyTargetsBtn');
    if (button) button.disabled = true;
    const status = document.getElementById('energyApprovalStatus');
    if (status) {
        status.classList.remove('is-approved');
        status.textContent = 'تم تغيير بيانات الحساب؛ أعد حساب الاحتياج قبل الاعتماد.';
    }
}

async function applyCustomTargetToPatient() {
    const user = await window.DietPlannerAccess?.getCurrentUser?.();
    const canWrite = user
        ? (await window.DietPlannerAccess?.canWrite?.(user.id)) === true
        : false;

    if (!canWrite) {
        calcShowToast('اعتماد احتياجات المريض متاح أثناء الاشتراك المدفوع فقط', 'error');
        return;
    }
    if (!lastEnergyCalculation) {
        calcShowToast('احسب الاحتياج بعد إدخال البيانات أولاً', 'error');
        return;
    }

    updateTargetAndMacros();
    const targetCal = Number(document.getElementById('finalTargetCal').textContent) || 0;
    const proGrams = parseInt(document.getElementById('macroProGrams').textContent, 10) || 0;
    const carbGrams = parseInt(document.getElementById('macroCarbGrams').textContent, 10) || 0;
    const fatGrams = parseInt(document.getElementById('macroFatGrams').textContent, 10) || 0;
    const proteinPercent = Number(document.getElementById('macroProPercent').value);
    const carbPercent = Number(document.getElementById('macroCarbPercent').value);
    const fatPercent = Number(document.getElementById('macroFatPercent').value);

    if (Math.abs(proteinPercent + carbPercent + fatPercent - 100) > 0.001) {
        calcShowToast('يجب أن يكون مجموع نسب الماكروز 100% بالضبط', 'error');
        return;
    }
    if (!calcResolvedPatientId || targetCal <= 0) {
        calcShowToast('راجع السعرات المستهدفة قبل الاعتماد', 'error');
        return;
    }

    const payload = {
        energy_equation: selectedEnergyEquation,
        energy_gender: document.getElementById('energyGender').value,
        energy_age: Number(document.getElementById('energyAge').value),
        energy_height_cm: Number(document.getElementById('energyHeight').value) || null,
        energy_weight_kg: Number(document.getElementById('energyWeight').value),
        energy_activity_factor: Number(document.getElementById('calcActivity').value),
        energy_bmr: lastEnergyCalculation.bmr,
        energy_tdee: lastEnergyCalculation.tdee,
        energy_adjustment: Number(document.getElementById('calcAdjustment').value) || 0,
        energy_target_calories: targetCal,
        energy_protein_percent: proteinPercent,
        energy_carb_percent: carbPercent,
        energy_fat_percent: fatPercent,
        energy_target_protein: proGrams,
        energy_target_carb: carbGrams,
        energy_target_fat: fatGrams,
        energy_approved_at: new Date().toISOString()
    };

    const button = document.getElementById('approveEnergyTargetsBtn');
    if (button) {
        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        button.textContent = 'جاري الاعتماد...';
    }

    const { data: updated, error } = await calcDb
        .from('patients')
        .update(payload)
        .eq('id', calcResolvedPatientId)
        .select('id')
        .maybeSingle();

    if (button) {
        button.disabled = false;
        button.innerHTML = button.dataset.originalText || 'اعتماد الاحتياجات للمريض';
        delete button.dataset.originalText;
    }

    if (error || !updated) {
        console.error('Patient energy approval failed:', error);
        calcShowToast('تعذر اعتماد الاحتياجات. تحقق من صلاحية التعديل والاتصال.', 'error');
        return;
    }

    const status = document.getElementById('energyApprovalStatus');
    if (status) {
        status.classList.remove('is-error');
        status.classList.add('is-approved');
        status.textContent = 'تم اعتماد وحفظ احتياجات المريض بنجاح — ' +
            new Date(payload.energy_approved_at).toLocaleDateString('ar-EG');
    }
    calcShowToast('تم اعتماد وحفظ الطاقة والماكروز للمريض بنجاح');
}

function bindPatientEnergyCalculator() {
    document.getElementById('eqBtnMifflin')?.addEventListener('click', () => {
        selectEnergyEquation('mifflin');
        markEnergyCalculationStale();
    });
    document.getElementById('eqBtnSchofield')?.addEventListener('click', () => {
        selectEnergyEquation('schofield');
        markEnergyCalculationStale();
    });
    document.getElementById('calculateEnergyBtn')?.addEventListener('click', calculateSelectedEnergy);
    document.getElementById('approveEnergyTargetsBtn')?.addEventListener('click', applyCustomTargetToPatient);

    ['energyGender', 'energyAge', 'energyWeight', 'energyHeight', 'calcActivity'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', markEnergyCalculationStale);
        document.getElementById(id)?.addEventListener('change', markEnergyCalculationStale);
    });
    ['calcAdjustment', 'macroProPercent', 'macroCarbPercent', 'macroFatPercent'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateTargetAndMacros);
    });
}

async function initCalculator() {
    if (calcInitialized) return true;

    const params = new URLSearchParams(window.location.search);
    calcResolvedPatientId = params.get('id') || params.get('patient') || params.get('patient_id');
    if (!calcResolvedPatientId) {
        calcShowToast('لم يتم تحديد المريض', 'error');
        return false;
    }

    try {
        bindPatientEnergyCalculator();
        const loaded = await loadCalculatorPatientData();
        calcInitialized = loaded === true;
        return calcInitialized;
    } catch (error) {
        console.error('Patient energy calculator initialization failed:', error);
        calcInitialized = false;
        calcShowToast('تعذر تحميل حاسبة الطاقة والماكروز', 'error');
        return false;
    }
}

window.initCalculator = initCalculator;
window.selectEnergyEquation = selectEnergyEquation;
window.calculateSelectedEnergy = calculateSelectedEnergy;
window.updateTargetAndMacros = updateTargetAndMacros;
window.applyCustomTargetToPatient = applyCustomTargetToPatient;
})();