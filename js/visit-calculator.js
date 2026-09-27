/* =========================================================

 * ENERGY / MACRO CALCULATOR
 * ========================================================= */

const calcDb = window.DietPlannerAccess?.supabaseClient;
if (!calcDb) console.error("Diet Planner access layer is unavailable to the calculator.");
const urlParams = new URLSearchParams(window.location.search);
let calcVisitId = urlParams.get('visit_id');
let calcPatientId = urlParams.get('patient_id');
let calcResolvedPatientId = calcPatientId;
let calcInitialized = false;

let calcPatient = null;
let selectedEnergyEquation = 'mifflin';
let pendingSavedTargetCalories = null;

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

            heightField.classList.toggle('hidden', selectedEnergyEquation !== 'mifflin');
            schInfo.classList.toggle('hidden', selectedEnergyEquation !== 'schofield');

            const active = 'flex-1 lg:flex-none px-5 py-2.5 rounded-lg text-xs font-extrabold transition bg-white text-emerald-700 shadow-sm';
            const inactive = 'flex-1 lg:flex-none px-5 py-2.5 rounded-lg text-xs font-extrabold transition text-slate-500';
            mifflinBtn.className = selectedEnergyEquation === 'mifflin' ? active : inactive;
            schofieldBtn.className = selectedEnergyEquation === 'schofield' ? active : inactive;

            document.getElementById('resEquation').textContent =
                selectedEnergyEquation === 'mifflin' ? 'Mifflin-St Jeor' : 'Schofield';

            updateSchofieldGroupHint();
        }

        function updateSchofieldGroupHint() {
            const age = parseFloat(document.getElementById('energyAge').value);
            const hint = document.getElementById('schofieldGroupHint');
            const result = document.getElementById('resSchofieldGroup');

            if (!Number.isFinite(age)) {
                hint.textContent = 'الفئات: أقل من 3 سنوات، 3–10، 10–18، 18–30، 30–60، وأكثر من 60 سنة.';
                result.textContent = '—';
                return;
            }

            let group = '';
            if (age < 3) group = '<3 سنوات';
            else if (age < 10) group = '3–10 سنوات';
            else if (age < 18) group = '10–18 سنة';
            else if (age < 30) group = '18–30 سنة';
            else if (age < 60) group = '30–60 سنة';
            else group = '≥60 سنة';

            hint.textContent = `الفئة المختارة: ${group}. المعادلة تستخدم الوزن فقط مع العمر والجنس.`;
            result.textContent = group;
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

            // A saved target is an absolute target, while this field is an
            // adjustment from TDEE. Convert it only when loading a saved plan.
            if (pendingSavedTargetCalories != null && tdee > 0) {
                document.getElementById('calcAdjustment').value =
                    Number(pendingSavedTargetCalories) - tdee;
                pendingSavedTargetCalories = null;
            }

            document.getElementById('resBMR').textContent = Math.round(bmr);
            document.getElementById('resTDEE').textContent = tdee;
            document.getElementById('resSchofieldGroup').textContent = group;
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

        // Compatibility aliases for old saved UI references.
        function calculateTDEE() { calculateSelectedEnergy(); }
        function calculateSchofield() { selectEnergyEquation('schofield'); calculateSelectedEnergy(); }

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

    /*
     * visit.js owns and validates the patient/visit context when this
     * calculator is embedded in visit.html. Re-querying the same context
     * here creates an unnecessary dependency and can conflict with RLS.
     *
     * Priority:
     * 1) window.visitContext supplied by visit.js
     * 2) URL parameters for standalone/legacy use
     */
    const pageContext = window.visitContext || {};

    if (pageContext.patient_id) {
        calcVisitId = pageContext.id || calcVisitId || null;
        calcPatientId = pageContext.patient_id;
        calcResolvedPatientId = pageContext.patient_id;

        if (pageContext.id) {
            window.currentVisit = {
                id: pageContext.id,
                patient_id: pageContext.patient_id,
                visit_number: pageContext.visit_number ?? null,
                visit_date: pageContext.visit_date ?? null
            };
        }
    } else if (calcVisitId) {
        const { data: visit, error: visitError } = await calcDb
            .from('patient_visits')
            .select('id,patient_id,visit_number,visit_date')
            .eq('id', calcVisitId)
            .eq('user_id', authUser.id)
            .maybeSingle();

        if (visitError || !visit) {
            calcShowToast('تعذر تحميل الزيارة', 'error');
            return false;
        }

        calcResolvedPatientId = visit.patient_id;
        window.currentVisit = visit;
    }

    if (!calcResolvedPatientId) {
        calcShowToast('لم يتم تحديد المريض', 'error');
        return false;
    }

    /*
     * RLS remains the security boundary. The embedded calculator does not
     * need to duplicate the user_id ownership condition.
     */
    const { data, error } = await calcDb
        .from('patients')
        .select('id,name,gender,age,height')
        .eq('id', calcResolvedPatientId)
        .maybeSingle();

    if (error || !data) {
        console.error('Calculator patient load error:', error);
        calcShowToast('تعذر تحميل بيانات المريض', 'error');
        return false;
    }

    calcPatient = data;
    document.getElementById('energyGender').value = calcPatient.gender || 'male';
    document.getElementById('energyAge').value = calcPatient.age ?? '';
    document.getElementById('energyHeight').value = calcPatient.height ?? '';

    const { data: weights } = await calcDb
        .from('weight_logs')
        .select('weight,measurement_date,created_at')
        .eq('patient_id', calcResolvedPatientId)
        .order('measurement_date', { ascending:false })
        .order('created_at', { ascending:false })
        .limit(1);

    if (weights?.[0]?.weight != null) {
        document.getElementById('energyWeight').value = Number(weights[0].weight);
    }

    let plansQuery = calcDb
        .from('nutrition_plans')
        .select('target_calories,target_protein,target_carb,target_fat')
        .eq('patient_id', calcResolvedPatientId);

    if (calcVisitId) plansQuery = plansQuery.eq('visit_id', calcVisitId);

    const { data: plans } = await plansQuery
        .order('updated_at', { ascending:false })
        .order('created_at', { ascending:false })
        .limit(1);

    const plan = plans?.[0];
    if (plan) {
        if (plan.target_calories != null) {
            pendingSavedTargetCalories = Number(plan.target_calories);
        }
        if (plan.target_protein && plan.target_calories) {
            document.getElementById('macroProPercent').value = Math.round(Number(plan.target_protein) * 4 / Number(plan.target_calories) * 100);
        }
        if (plan.target_carb && plan.target_calories) {
            document.getElementById('macroCarbPercent').value = Math.round(Number(plan.target_carb) * 4 / Number(plan.target_calories) * 100);
        }
        if (plan.target_fat && plan.target_calories) {
            document.getElementById('macroFatPercent').value = Math.round(Number(plan.target_fat) * 9 / Number(plan.target_calories) * 100);
        }
    }

    updateSchofieldGroupHint();

    // Calculate the current TDEE first so a saved absolute target can be
    // displayed correctly as (target - TDEE) in the adjustment field.
    if (pendingSavedTargetCalories != null) {
        calculateSelectedEnergy();
    } else {
        updateTargetAndMacros();
    }
    return true;
}

async function applyCustomTargetToPatient() {
    const user = await window.DietPlannerAccess?.getCurrentUser?.();
    const canWrite = user
      ? (await window.DietPlannerAccess?.canWrite?.(user.id)) === true
      : false;
    if (!canWrite) {
        calcShowToast('حفظ أهداف المريض متاح أثناء الاشتراك المدفوع فقط', 'error');
        return;
    }
    const targetCal = parseInt(document.getElementById('finalTargetCal').textContent, 10) || 0;
    const proGrams = parseInt(document.getElementById('macroProGrams').textContent, 10) || 0;
    const carbGrams = parseInt(document.getElementById('macroCarbGrams').textContent, 10) || 0;
    const fatGrams = parseInt(document.getElementById('macroFatGrams').textContent, 10) || 0;

    const totalPercent =
        (parseFloat(document.getElementById('macroProPercent').value) || 0) +
        (parseFloat(document.getElementById('macroCarbPercent').value) || 0) +
        (parseFloat(document.getElementById('macroFatPercent').value) || 0);

    if (totalPercent !== 100) {
        calcShowToast('يجب أن يكون مجموع نسب الماكروز 100% بالضبط', 'error');
        return;
    }

    if (!calcResolvedPatientId || targetCal <= 0) return;

    const authUser = await window.DietPlannerAccess?.getCurrentUser?.();
    if (!authUser) {
        calcShowToast('يجب تسجيل الدخول أولاً', 'error');
        return;
    }

    let existingQuery = calcDb
        .from('nutrition_plans')
        .select('id,plan_name')
        .eq('patient_id', calcResolvedPatientId);

    if (calcVisitId) existingQuery = existingQuery.eq('visit_id', calcVisitId);

    const { data: existing, error: findError } = await existingQuery
        .order('updated_at', { ascending:false })
        .order('created_at', { ascending:false });

    if (findError) {
        calcShowToast('تعذر الوصول إلى خطط المريض', 'error');
        return;
    }

    const existingGramPlan = existing?.find(p => p.plan_name === 'الخطة الغذائية باستخدام الجرامات');
    const existingExchangePlan = existing?.find(p => p.plan_name === 'الخطة الغذائية باستخدام البدائل');
    const startDate = new Date().toISOString().slice(0,10);
    const sharedTargets = {
        patient_id: calcResolvedPatientId,
        visit_id: calcVisitId || null,
        start_date: startDate,
        target_calories: targetCal,
        target_protein: proGrams,
        target_carb: carbGrams,
        target_fat: fatGrams
    };

    const rows = [
        {
            id: existingGramPlan?.id || crypto.randomUUID(),
            ...sharedTargets,
            plan_name: 'الخطة الغذائية باستخدام الجرامات'
        },
        {
            id: existingExchangePlan?.id || crypto.randomUUID(),
            ...sharedTargets,
            plan_name: 'الخطة الغذائية باستخدام البدائل'
        }
    ];

    const { error } = await calcDb
        .from('nutrition_plans')
        .upsert(rows, { onConflict:'id' });

    if (error) {
        calcShowToast('تعذر حفظ خطتي الجرامات والبدائل في قاعدة البيانات', 'error');
        return;
    }

    window.__dietPlannerCalculatorApproved = true;
    window.__dietPlannerApprovedPlan = {
        patient_id: calcResolvedPatientId,
        visit_id: calcVisitId || null,
        target_calories: targetCal,
        target_protein: proGrams,
        target_carb: carbGrams,
        target_fat: fatGrams,
        gram_plan_id: rows[0].id,
        exchange_plan_id: rows[1].id
    };

    calcShowToast(`تم اعتماد الهدف (${targetCal} سعر) والماكروز وحفظ خطتي الجرامات والبدائل بنجاح`);
}

async function initCalculator(){
    if (calcInitialized) return true;

    const ctx = window.visitContext || {};
    calcVisitId = ctx.id || urlParams.get('visit_id') || null;
    calcPatientId = ctx.patient_id || urlParams.get('patient_id') || null;
    calcResolvedPatientId = calcPatientId;

    selectEnergyEquation('mifflin');
    calcInitialized = true;

    try {
        return await loadCalculatorPatientData();
    } catch (error) {
        console.error('Calculator initialization error:', error);
        calcInitialized = false;
        calcShowToast('تعذر تحميل بيانات الحاسبة', 'error');
        return false;
    }
}