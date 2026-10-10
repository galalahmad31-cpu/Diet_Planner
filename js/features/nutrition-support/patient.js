(function(){

/* =========================================================
   DIET PLANNER — NUTRITION SUPPORT PATIENT
   ---------------------------------------------------------
   This file contains the page JavaScript only.

   Architecture:
   1) auth-access.js
      - owns authentication/access layer
      - exposes window.DietPlannerAccess.supabaseClient
      - exposes getCurrentUser()

   2) nutritionsupport-patient.js
      - page calculations
      - UI interactions
      - nutrition-support-days CRUD
      - patient loading
      - printing

   The Supabase client is NOT created here.
   ========================================================= */

/* =========================================================
       ACCORDIONS
       ========================================================= */

    function toggleENAccordion(contentId, arrowId) {

        const content =
            document.getElementById(contentId);

        const arrow =
            document.getElementById(arrowId);

        if (!content || !arrow) return;

        if (content.classList.contains('hidden')) {

            content.classList.remove('hidden');

            arrow.classList.add('rotate-180');

        } else {

            content.classList.add('hidden');

            arrow.classList.remove('rotate-180');

        }

    }


    /* =========================================================
       SUPPORT PROJECT MODAL
       ========================================================= */

    /* =========================================================
       PATIENT DATA COLLAPSE
       ========================================================= */

    function togglePatientHeader() {

        const content =
            document.getElementById('patient-info-content');

        const button =
            document.getElementById('patient-collapse-btn');

        if (!content || !button) {
            return;
        }

        const isCollapsed =
            content.classList.toggle('hidden');

        button.setAttribute(
            'aria-expanded',
            String(!isCollapsed)
        );

        button.innerText =
            isCollapsed
                ? 'Show patient data ▼'
                : 'Hide patient data ▲';
    }


    /* =========================================================
       GLUCOSE INPUT MODE
       ========================================================= */

    function toggleGlucoseInputMode() {

        const modeEl =
            document.getElementById('glu-input-mode');

        const girContainer =
            document.getElementById('glu-gir-input-container');

        const remainingInfo =
            document.getElementById('glu-remaining-info');

        const autoToggle =
            document.getElementById('glu-toggle-auto');

        if (!modeEl || !girContainer || !remainingInfo) {
            return;
        }

        if (modeEl.value === 'remaining-calories') {

            if (autoToggle) {

                if (
                    autoToggle.dataset.previousState === undefined
                ) {
                    autoToggle.dataset.previousState =
                        autoToggle.checked
                            ? 'true'
                            : 'false';
                }

                autoToggle.checked = true;
                autoToggle.disabled = true;

            }

            girContainer.classList.add('hidden');
            remainingInfo.classList.remove('hidden');

        }

        else {

            girContainer.classList.remove('hidden');
            remainingInfo.classList.add('hidden');

            if (autoToggle) {

                if (
                    autoToggle.dataset.previousState !== undefined
                ) {

                    autoToggle.checked =
                        autoToggle.dataset.previousState === 'true';

                    delete autoToggle.dataset.previousState;
                }

                autoToggle.disabled = false;
            }

        }

        toggleGlucoseMode();
    }


    /* =========================================================
       GLUCOSE MODE
       ========================================================= */

    function toggleGlucoseMode() {

        const autoToggle = document.getElementById('glu-toggle-auto');
        const autoDisplay = document.getElementById('res-glu-conc-display');
        const manualInput = document.getElementById('in-glu-conc-manual');

        if (!autoToggle || !autoDisplay || !manualInput) return;

        const isAuto = autoToggle.checked;

        if (isAuto) {

            autoDisplay.classList.remove('hidden');

            manualInput.classList.add('hidden');

        } else {

            autoDisplay.classList.add('hidden');

            manualInput.classList.remove('hidden');

        }

        calculateTPN();

    }


    /* =========================================================
       TPN TYPE
       ========================================================= */

    function toggleTpnTypeMode() {

        const typeEl = document.getElementById('tpn-type-select');
        const dynamicRow = document.getElementById('tpn-rate-display-row');

        if (!typeEl || !dynamicRow) return;

        const tpnType = typeEl.value;

        if (tpnType === '2in1') {

            dynamicRow.innerHTML = `

                <td colspan="6" class="p-3 bg-blue-100 text-blue-950">

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-bold">

                        <div class="flex flex-col gap-1 bg-white p-2 rounded border border-blue-300">

                            <label>
                                Lipid Infusion Duration (h):
                            </label>

                            <input
                                type="number"
                                id="tpn-lipid-hours"
                                value="24"
                                data-calc="tpn"
                                class="bg-gray-50 border text-center"
                            >

                            <span
                                id="res-lipid-rate"
                                class="text-blue-700 text-sm mt-1"
                            >
                                Lipid Rate: 0 ml/h
                            </span>

                        </div>

                        <div class="flex flex-col gap-1 bg-white p-2 rounded border border-blue-300">

                            <label>
                                Aqueous Solution Duration (h):
                            </label>

                            <input
                                type="number"
                                id="tpn-aqueous-hours"
                                value="24"
                                data-calc="tpn"
                                class="bg-gray-50 border text-center"
                            >

                            <span
                                id="res-aqueous-rate"
                                class="text-blue-700 text-sm mt-1"
                            >
                                Aqueous Rate: 0 ml/h
                            </span>

                        </div>

                    </div>

                </td>

            `;

        } else {

            dynamicRow.innerHTML = `

                <td colspan="3" class="text-sm">
                    TPN Rate:
                </td>

                <td
                    colspan="3"
                    id="res-tpn-rate"
                    class="text-lg"
                >
                    0 ml/hr
                </td>

            `;

        }

        calculateTPN();

    }


    /* =========================================================
       CALORIE BASED
       ========================================================= */

    function calculateCalorieBased() {

        const weight =
            parseFloat(
                document.getElementById('cb-weight').value
            ) || 0;

        const kcalKg =
            parseFloat(
                document.getElementById('cb-kcal-kg').value
            ) || 0;

        const targetWaterKg =
            parseFloat(
                document.getElementById('cb-target-water').value
            ) || 0;

        const targetProteinKg =
            parseFloat(
                document.getElementById('cb-target-protein').value
            ) || 0;


        const totalCalories =
            weight * kcalKg;

        const totalWater =
            weight * targetWaterKg;

        const totalProtein =
            weight * targetProteinKg;


        document.getElementById('cb-res-total-cal').innerText =
            totalCalories.toFixed(1);

        document.getElementById('cb-res-total-water').innerText =
            totalWater.toFixed(1);

        document.getElementById('cb-res-total-protein').innerText =
            totalProtein.toFixed(1);


        const freeWaterPct =
            parseFloat(
                document.getElementById('cb-free-water-pct').value
            ) || 0;

        const caloricDensity =
            parseFloat(
                document.getElementById('cb-caloric-density').value
            ) || 0;

        const proteinDensity =
            parseFloat(
                document.getElementById('cb-protein-density').value
            ) || 0;


        const feedingVolume =
            caloricDensity > 0
                ? (totalCalories / caloricDensity)
                : 0;


        document.getElementById('cb-res-feeding-volume').innerText =
            feedingVolume.toFixed(2);


        const waterFromFormula =
            (freeWaterPct * 0.01) *
            feedingVolume;

        const waterGap =
            waterFromFormula -
            totalWater;


        document.getElementById('cb-res-water-gap').innerText =
            waterGap.toFixed(2);


        const waterGapMsgEl =
            document.getElementById('cb-water-gap-msg');

        let flushDeficit = 0;


        if (waterGap > 0) {

            const targetCaloricDensityVal =
                totalWater > 0
                    ? ((totalCalories / totalWater) * 1.17).toFixed(2)
                    : "0.8";

            waterGapMsgEl.innerText =
                `Water from formula exceeds requirements, Consider increasing caloric density to >= ${targetCaloricDensityVal} Kcal/ml`;

            document
                .getElementById('cb-res-summary-flush-container')
                .classList.add('hidden');

        }

        else if (waterGap < 0) {

            flushDeficit =
                Math.abs(waterGap);

            waterGapMsgEl.innerText =
                `Provided water is short by ${flushDeficit.toFixed(2)} ml. Administer this deficit as flushing throughout the day.`;

            document
                .getElementById('cb-res-summary-flush-container')
                .classList.remove('hidden');

            document.getElementById('cb-res-summary-flush').innerText =
                flushDeficit.toFixed(2);

        }

        else {

            waterGapMsgEl.innerText =
                `Provided water meets exact requirement.`;

            document
                .getElementById('cb-res-summary-flush-container')
                .classList.add('hidden');

        }


        const providedProteinG =
            proteinDensity *
            feedingVolume *
            0.01;

        const proteinGap =
            providedProteinG -
            totalProtein;


        document.getElementById('cb-res-protein-gap').innerText =
            proteinGap.toFixed(2);


        const proteinGapMsgEl =
            document.getElementById('cb-protein-gap-msg');


        if (proteinGap < 0) {

            proteinGapMsgEl.innerText =
                `provided protein is short by ${Math.abs(proteinGap).toFixed(2)} g`;

        }

        else if (proteinGap > 0) {

            const targetProteinFormulaVal =
                feedingVolume > 0
                    ? (
                        totalProtein /
                        (feedingVolume * 0.01)
                    ).toFixed(2)
                    : "0";

            proteinGapMsgEl.innerText =
                `provided protein exceeds requirements by ${proteinGap.toFixed(2)} g. Consider a formula with a target of ${targetProteinFormulaVal} g / 100 ml`;

        }

        else {

            proteinGapMsgEl.innerText =
                `provided protein meets exact requirement.`;

        }


        const initPct =
            parseFloat(
                document.getElementById('cb-init-pct').value
            ) || 0;

        const advancePct =
            parseFloat(
                document.getElementById('cb-advance-pct').value
            ) || 0;

        const freqHours =
            parseFloat(
                document.getElementById('cb-freq-hours').value
            ) || 1;


        const goalMlD =
            feedingVolume;


        document.getElementById('cb-res-goal-mld').innerText =
            goalMlD.toFixed(2);


        const freqPerDay =
            24 / freqHours;


        const startDoseMl =
            freqPerDay > 0
                ? (
                    goalMlD *
                    (initPct * 0.01)
                ) / freqPerDay
                : 0;


        const incDoseMl =
            freqPerDay > 0
                ? (
                    goalMlD *
                    (advancePct * 0.01)
                ) / freqPerDay
                : 0;


        const maxDoseMl =
            freqPerDay > 0
                ? goalMlD / freqPerDay
                : 0;


        document.getElementById('cb-res-summary-start').innerText =
            startDoseMl.toFixed(2);

        document.getElementById('cb-res-summary-freq1').innerText =
            freqHours;

        document.getElementById('cb-res-summary-inc').innerText =
            incDoseMl.toFixed(2);

        document.getElementById('cb-res-summary-goal').innerText =
            maxDoseMl.toFixed(2);

        document.getElementById('cb-res-summary-freq2').innerText =
            freqHours;

        document.getElementById('cb-res-summary-formula').innerText =
            document.getElementById('cb-formula-name').value || "-";

        document.getElementById('cb-res-summary-fort').innerText =
            document.getElementById('cb-fort-instructions').value || "-";

    }


    /* =========================================================
       TAB SWITCHING
       ========================================================= */

    function switchTab(tab) {

        const enSection = document.getElementById('section-en');
        const tpnSection = document.getElementById('section-tpn');
        const enTab = document.getElementById('tab-en');
        const tpnTab = document.getElementById('tab-tpn');

        if (!enSection || !tpnSection || !enTab || !tpnTab) return;

        enSection.classList.toggle('hidden', tab !== 'en');
        tpnSection.classList.toggle('hidden', tab !== 'tpn');
        enTab.classList.toggle('active', tab === 'en');
        tpnTab.classList.toggle('active', tab === 'tpn');

        const content = document.getElementById('monitoring-content-actual');
        if (!content) return;

        const target = tab === 'en'
          ? document.querySelector('.monitoring-container-shared-en')
          : document.querySelector('.monitoring-container-shared-tpn');

        if (target) target.appendChild(content);
    }


    /* =========================================================
       FORTIFIER
       ========================================================= */

    function toggleFortifier() {

        const isYes =
            document.getElementById('en-fort-choice').value === 'yes';

        document
            .getElementById('fortifier-box')
            .classList.toggle('hidden', !isYes);

        document
            .getElementById('res-en-fort-display')
            .classList.toggle('hidden', !isYes);

    }


    /* =========================================================
       ENTERAL CALCULATION
       ========================================================= */

    function calculateEN() {

        const wStr =
            document.getElementById('en-weight').value;

        const w =
            parseFloat(wStr) || 0;

        const h =
            parseFloat(
                document.getElementById('en-hours').value
            ) || 1;

        const init =
            parseFloat(
                document.getElementById('en-init-rate').value
            ) || 0;

        const adv =
            parseFloat(
                document.getElementById('en-advance').value
            ) || 0;

        const goal =
            parseFloat(
                document.getElementById('en-goal').value
            ) || 0;

        const feedOptVal =
            document.getElementById('en-option').value || "-";


        const freq =
            24 / h;


        document.getElementById('res-en-start').innerText =
            ((init * w) / freq).toFixed(1);

        document.getElementById('res-en-inc').innerText =
            ((adv * w) / freq).toFixed(1);

        document.getElementById('res-en-max').innerText =
            ((goal * w) / freq).toFixed(1);

        document.getElementById('res-en-interval').innerText =
            h;

        document.getElementById('res-en-interval-2').innerText =
            h;

        document.getElementById('res-en-final-option').innerText =
            feedOptVal;

        document.getElementById('res-en-fort-text').innerText =
            document.getElementById('en-fort-instructions').value || "None";


        calculateCalorieBased();

    }


    /* =========================================================
       TPN CALCULATION
       ========================================================= */

    function calculateTPN() {

        const wStr =
            document.getElementById('tpn-weight').value;

        const w =
            parseFloat(wStr) || 0;


        const fluidTarget =
            (
                parseFloat(
                    document.getElementById('tpn-fluid-kg').value
                ) || 0
            ) * w;


        const entFluid =
            parseFloat(
                document.getElementById('tpn-enteral-fluid').value
            ) || 0;

        const otherFluid =
            parseFloat(
                document.getElementById('tpn-other-input').value
            ) || 0;


        const tpnFluid =
            fluidTarget -
            entFluid -
            otherFluid;


        document.getElementById('res-tpn-remain-fluid').innerText =
            tpnFluid.toFixed(1);


        const caloricDensity =
            parseFloat(
                document.getElementById('tpn-caloric-density').value
            ) || 0;


        const enteralEnergyTotal =
            entFluid *
            caloricDensity;


        document.getElementById('res-enteral-energy').innerText =
            enteralEnergyTotal.toFixed(1) + " kcal";


        const targetEnergyKg =
            parseFloat(
                document.getElementById('tpn-target-energy-kg').value
            ) || 0;


        document.getElementById('res-tpn-energy-need').innerText =
            Math.max(
                0,
                targetEnergyKg -
                (
                    w > 0
                        ? enteralEnergyTotal / w
                        : 0
                )
            ).toFixed(1) +
            " kcal/kg";


        const pG =
            (
                parseFloat(
                    document.getElementById('in-prot').value
                ) || 0
            ) * w;


        const pConc =
            parseFloat(
                document.getElementById('in-prot-conc').value
            ) || 0;


        const pV =
            pConc > 0
                ? pG / (pConc / 100)
                : 0;


        document.getElementById('res-prot-total').innerText =
            pG.toFixed(1);

        document.getElementById('res-prot-vol').innerText =
            pV.toFixed(1);

        document.getElementById('res-prot-kcal').innerText =
            (pG * 4).toFixed(0);


        const lG =
            (
                parseFloat(
                    document.getElementById('in-lipid').value
                ) || 0
            ) * w;


        const lConc =
            parseFloat(
                document.getElementById('in-lipid-conc').value
            ) || 0;


        const lV =
            lConc > 0
                ? lG / (lConc / 100)
                : 0;


        document.getElementById('res-lipid-total').innerText =
            lG.toFixed(1);

        document.getElementById('res-lipid-vol').innerText =
            lV.toFixed(1);

        document.getElementById('res-lipid-kcal').innerText =
            (lG * 10).toFixed(0);


        const phosTotal =
            (
                parseFloat(
                    document.getElementById('in-phos').value
                ) || 0
            ) * w;


        const naIntakeRaw =
            (
                parseFloat(
                    document.getElementById('in-nacl').value
                ) || 0
            ) * w;


        const naAdjusted =
            Math.max(
                0,
                naIntakeRaw -
                (2 * phosTotal)
            );


        const naclType =
            document.getElementById('sel-nacl-type').value;


        const naVol =
            naclType === "3"
                ? naAdjusted / 0.513
                : naAdjusted / 0.154;


        document.getElementById('res-nacl-total').innerText =
            naAdjusted.toFixed(1);

        document.getElementById('res-nacl-vol').innerText =
            naVol.toFixed(1);


        const kTotal =
            (
                parseFloat(
                    document.getElementById('in-kcl').value
                ) || 0
            ) * w;


        const kVol =
            kTotal / 2;


        document.getElementById('res-kcl-total').innerText =
            kTotal.toFixed(1);

        document.getElementById('res-kcl-vol').innerText =
            kVol.toFixed(1);


        const caTotal =
            (
                parseFloat(
                    document.getElementById('in-ca').value
                ) || 0
            ) * w;


        const caVol =
            caTotal / 0.23;


        document.getElementById('res-ca-total').innerText =
            caTotal.toFixed(1);

        document.getElementById('res-ca-vol').innerText =
            caVol.toFixed(1);


        const mgTotal =
            (
                parseFloat(
                    document.getElementById('in-mg').value
                ) || 0
            ) * w;


        const mgVol =
            mgTotal / 0.41;


        document.getElementById('res-mg-total').innerText =
            mgTotal.toFixed(1);

        document.getElementById('res-mg-vol').innerText =
            mgVol.toFixed(1);


        document.getElementById('res-phos-total').innerText =
            phosTotal.toFixed(1);

        document.getElementById('res-phos-vol').innerText =
            phosTotal.toFixed(1);


        // Vitamins / trace elements: Intake is entered as ml/kg/day.
        // Volume is calculated automatically as Intake × weight.
        const traceIntake =
            parseFloat(document.getElementById('in-trace-vol').value) || 0;
        const vitaIntake =
            parseFloat(document.getElementById('in-vitalipid-vol').value) || 0;
        const soluIntake =
            parseFloat(document.getElementById('in-soluvito-vol').value) || 0;

        const traceVol = traceIntake * w;
        const vitaVol = vitaIntake * w;
        const soluVol = soluIntake * w;

        document.getElementById('res-trace-total').innerText = traceVol.toFixed(1);
        document.getElementById('res-trace-vol').innerText = traceVol.toFixed(1);
        document.getElementById('res-vitalipid-total').innerText = vitaVol.toFixed(1);
        document.getElementById('res-vitalipid-vol').innerText = vitaVol.toFixed(1);
        document.getElementById('res-soluvito-total').innerText = soluVol.toFixed(1);
        document.getElementById('res-soluvito-vol').innerText = soluVol.toFixed(1);


        const isAutoGlucose =
            document.getElementById('glu-toggle-auto').checked;

        const glucoseModeEl =
            document.getElementById('glu-input-mode');

        const glucoseMode =
            glucoseModeEl
                ? glucoseModeEl.value
                : 'gir';


        const intakeCell =
            document.getElementById('res-glu-intake-cell');

        let tpnG_vol = 0;
        let gluConc = 0;
        let totalG_gram = 0;
        let tpnG_gram = 0;


        const otherG_gram =
            (
                parseFloat(
                    document.getElementById('in-glu-other-rate').value
                ) || 0
            ) *
            (
                parseFloat(
                    document.getElementById('in-glu-other-dur').value
                ) || 0
            ) *
            (
                parseFloat(
                    document.getElementById('in-glu-other-conc').value
                ) || 0
            ) / 100;


        /*
         * Remaining glucose volume is the same regardless of
         * the selected glucose calculation method.
         */
        tpnG_vol =
            tpnFluid -
            (
                pV +
                lV +
                naVol +
                kVol +
                caVol +
                mgVol +
                phosTotal +
                traceVol +
                vitaVol +
                soluVol
            );


        if (glucoseMode === 'remaining-calories') {

            /*
             * Glucose grams =
             * (Total TPN calories
             *  - Protein calories
             *  - Lipid calories
             *  - Other glucose calories) / 3.4
             */
            const totalTpnCalories =
                Math.max(
                    0,
                    (targetEnergyKg * w) -
                    enteralEnergyTotal
                );

            const proteinCalories =
                pG * 4;

            const lipidCalories =
                lG * 10;

            const otherGlucoseCalories =
                otherG_gram * 3.4;

            const glucoseCalories =
                Math.max(
                    0,
                    totalTpnCalories -
                    proteinCalories -
                    lipidCalories -
                    otherGlucoseCalories
                );

            totalG_gram =
                glucoseCalories / 3.4;

            tpnG_gram =
                Math.max(
                    0,
                    totalG_gram - otherG_gram
                );

            gluConc =
                tpnG_vol > 0
                    ? (
                        tpnG_gram /
                        tpnG_vol
                    ) * 100
                    : 0;

            if (intakeCell) {
                intakeCell.innerText =
                    "Remaining calories";
            }

            document.getElementById('res-glu-conc-display').innerText =
                isFinite(gluConc)
                    ? gluConc.toFixed(1) + "%"
                    : "0%";

        }

        else if (isAutoGlucose) {

            intakeCell.innerText =
                "Auto (GIR)";

            const gir =
                parseFloat(
                    document.getElementById('in-gir').value
                ) || 0;

            totalG_gram =
                (
                    gir *
                    w *
                    1440
                ) / 1000;

            tpnG_gram =
                totalG_gram -
                otherG_gram;

            gluConc =
                tpnG_vol > 0
                    ? (
                        tpnG_gram /
                        tpnG_vol
                    ) * 100
                    : 0;

            document.getElementById('res-glu-conc-display').innerText =
                isFinite(gluConc)
                    ? gluConc.toFixed(1) + "%"
                    : "0%";

        }

        else {

            gluConc =
                parseFloat(
                    document.getElementById('in-glu-conc-manual').value
                ) || 0;

            const calcGir =
                w > 0
                    ? (
                        tpnG_vol *
                        gluConc
                    ) / (
                        w *
                        144
                    )
                    : 0;

            if (intakeCell) {
                intakeCell.innerText =
                    isFinite(calcGir)
                        ? calcGir.toFixed(2) + " (GIR)"
                        : "0 (GIR)";
            }

            tpnG_gram =
                tpnG_vol *
                (gluConc / 100);

            totalG_gram =
                tpnG_gram +
                otherG_gram;

        }


        document.getElementById('res-glu-total-final').innerText =
            totalG_gram.toFixed(1) + " g";

        document.getElementById('res-glu-total-tpn').innerText =
            tpnG_gram.toFixed(1);

        document.getElementById('res-glu-vol-tpn').innerText =
            tpnG_vol.toFixed(1);

        document.getElementById('res-glu-kcal-tpn').innerText =
            (tpnG_gram * 3.4).toFixed(0);


        document.getElementById('res-glu-conc').innerText =
            isFinite(gluConc)
                ? gluConc.toFixed(1) + "%"
                : "0%";


        const tpnEnergy =
            (pG * 4) +
            (lG * 10) +
            (tpnG_gram * 3.4);


        document.getElementById('res-tpn-total-vol').innerText =
            tpnFluid.toFixed(1);

        document.getElementById('res-tpn-total-kcal').innerText =
            tpnEnergy.toFixed(0);


        const tpnType =
            document.getElementById('tpn-type-select').value;


        const infusionHours =
            parseFloat(
                document.getElementById('tpn-infusion-hours').value
            ) || 24;


        if (tpnType === '3in1') {

            const tpnRate =
                tpnFluid / infusionHours;


            const rateEl =
                document.getElementById('res-tpn-rate');


            if (rateEl) {

                rateEl.innerText =
                    isFinite(tpnRate)
                        ? tpnRate.toFixed(1) + " ml/hr"
                        : "0 ml/hr";

            }

        }

        else {

            const lipidHours =
                parseFloat(
                    document.getElementById('tpn-lipid-hours').value
                ) || 24;


            const aqueousHours =
                parseFloat(
                    document.getElementById('tpn-aqueous-hours').value
                ) || 24;


            const lipidRate =
                lipidHours > 0
                    ? lV / lipidHours
                    : 0;


            const aqueousVolume =
                tpnFluid -
                lV;


            const aqueousRate =
                aqueousHours > 0
                    ? aqueousVolume / aqueousHours
                    : 0;


            const lipidRateEl =
                document.getElementById('res-lipid-rate');


            const aqueousRateEl =
                document.getElementById('res-aqueous-rate');


            if (lipidRateEl) {

                lipidRateEl.innerText =
                    `Lipid Rate: ${
                        isFinite(lipidRate)
                            ? lipidRate.toFixed(1)
                            : "0"
                    } ml/h`;

            }


            if (aqueousRateEl) {

                aqueousRateEl.innerText =
                    `Aqueous Rate: ${
                        isFinite(aqueousRate)
                            ? aqueousRate.toFixed(1)
                            : "0"
                    } ml/h`;

            }

        }


        const osm =
            (
                pG * 10 +
                tpnG_gram * 5 +
                (
                    naAdjusted +
                    kTotal +
                    caTotal +
                    mgTotal
                ) * 2
            ) /
            (tpnFluid / 1000);


        document.getElementById('res-osmolarity').innerText =
            isFinite(osm)
                ? Math.round(osm)
                : "0";



    }


    /* =========================================================
       GLUCOSE MIXING TOOL
       ---------------------------------------------------------
       Restored from the previous TPN version.
       Kept independent from calculateTPN() so it cannot alter
       the existing TPN calculations.
       ========================================================= */

    function runGlucoseMixing() {
      const targetC = parseFloat(document.getElementById('mix-target-conc')?.value);
      const targetV = parseFloat(document.getElementById('mix-target-vol')?.value);
      const c1 = parseFloat(document.getElementById('mix-c1')?.value);
      const c2 = parseFloat(document.getElementById('mix-c2')?.value);
      const resultEl = document.getElementById('mix-result');
      const breakdownEl = document.getElementById('res-glu-mix-breakdown');

      if (!resultEl || !breakdownEl) return;

      if (![targetC, targetV, c1, c2].every(Number.isFinite) || targetC <= 0 || targetV <= 0 || c1 <= 0 || c2 < 0 || c1 === c2) {
        resultEl.innerText = 'Enter valid values to calculate the mixture.';
        breakdownEl.innerText = '';
        return;
      }

      const v1 = targetV * (targetC - c2) / (c1 - c2);
      const v2 = targetV - v1;

      if (v1 < 0 || v2 < 0) {
        resultEl.innerText = 'Target concentration must be between the two source concentrations.';
        breakdownEl.innerText = '';
        return;
      }

      const txt = `D${c1}%: ${v1.toFixed(1)} ml | D${c2}%: ${v2.toFixed(1)} ml`;
      resultEl.innerText = txt;
      breakdownEl.innerText = `(${txt})`;
    }


    /* =========================================================
       PRINT
       ========================================================= */

    const PRINT_SETTINGS_KEY = 'nutritionSupportPrintSettings';

    function loadPrintSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) || '{}');
            document.getElementById('printDoctorName').value = saved.doctor || '';
            document.getElementById('printSpecialty').value = saved.specialty || '';
            document.getElementById('printClinicName').value = saved.clinic || '';
            document.getElementById('printAddress').value = saved.address || '';
        } catch (e) {
            console.warn('Could not load saved print settings.', e);
        }
    }

    function savePrintSettings(data) {
        try { localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(data)); }
        catch (e) { console.warn('Could not save print settings.', e); }
    }

    function showPrintCompletion(message) {
        const overlay = document.getElementById('printCompletionOverlay');
        const msg = document.getElementById('printCompletionMessage');
        if (!overlay) return;
        if (msg) msg.textContent = message;
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');
    }

    function closePrintCompletion() {
        const overlay = document.getElementById('printCompletionOverlay');
        if (!overlay) return;
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function smartPrint() {

        const hasEN =
            (parseFloat(document.getElementById('en-weight')?.value) || 0) > 0 ||
            (parseFloat(document.getElementById('cb-weight')?.value) || 0) > 0;

        const hasTPN =
            (parseFloat(document.getElementById('tpn-weight')?.value) || 0) > 0;

        if (!hasEN && !hasTPN) {
            alert('من فضلك أدخل بيانات التغذية قبل طباعة التقرير.');
            return;
        }

        const overlay = document.getElementById('printSettingsOverlay');
        if (!overlay) return;
        loadPrintSettings();
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');

        setTimeout(() => {
            document.getElementById('printDoctorName')?.focus();
        }, 50);
    }

    function closePrintSettings() {
        const overlay = document.getElementById('printSettingsOverlay');
        if (!overlay) return;
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
    }

    function confirmSupportPrint() {
        const doctor = (document.getElementById('printDoctorName')?.value || '').trim();
        const specialty = (document.getElementById('printSpecialty')?.value || '').trim();
        const clinic = (document.getElementById('printClinicName')?.value || '').trim();
        const address = (document.getElementById('printAddress')?.value || '').trim();

        if (!doctor || !specialty || !clinic || !address) {
            showPrintCompletion('من فضلك أكمل اسم الطبيب والتخصص واسم العيادة والعنوان قبل الطباعة.');
            return;
        }

        savePrintSettings({doctor, specialty, clinic, address});

        document.getElementById('printHeaderDoctor').textContent = doctor;
        document.getElementById('printHeaderSpecialty').textContent = specialty;
        document.getElementById('printHeaderClinic').textContent = clinic;
        document.getElementById('printHeaderAddress').textContent = address;

        const hasEN =
            (parseFloat(document.getElementById('en-weight')?.value) || 0) > 0 ||
            (parseFloat(document.getElementById('cb-weight')?.value) || 0) > 0;
        const hasTPN =
            (parseFloat(document.getElementById('tpn-weight')?.value) || 0) > 0;

        document.body.classList.remove('print-en', 'print-tpn');
        if (hasEN) document.body.classList.add('print-en');
        if (hasTPN) document.body.classList.add('print-tpn');

        closePrintSettings();
        setTimeout(() => window.print(), 80);
    }

/* =========================================================
   PAGE / SUPABASE / PATIENT / SUPPORT-DAYS LOGIC
   ========================================================= */

const access = window.DietPlannerAccess;
const supabaseClient = access?.supabaseClient;
if (!access || !supabaseClient) {
  console.error('DietPlannerAccess is not available. Check that auth-access.js is loaded from the same folder.');
  document.addEventListener('DOMContentLoaded',()=>{
    const notice=document.createElement('div');
    notice.style.cssText='padding:16px;text-align:center;color:#b91c1c;font-family:Cairo,sans-serif';
    notice.textContent='تعذر تشغيل نظام الاتصال بالتطبيق. تأكد من وجود auth-access.js بجوار الصفحة.';
    document.body.prepend(notice);
  },{once:true});
} 
const $=id=>document.getElementById(id);
const fmtDate=v=>{if(!v)return'—';const a=String(v).slice(0,10).split('-');return a.length===3?`${a[2]}/${a[1]}/${a[0]}`:v};
const gender=v=>v==='male'?'ذكر':v==='female'?'أنثى':v||'—';


/* =========================================================
   SUPPORT DAYS
   Each selected day has its own EN/TPN data.
   ========================================================= */
let supportPatientId=null;
let supportUserId=null;
let supportDays=[];
let currentSupportDayId=null;
let dayDefaults=null;
let dayEditMode=false;
let supportDayOperationBusy=false;

function dayControls(){
  return document.querySelectorAll('#section-en input,#section-en select,#section-en textarea,#section-tpn input,#section-tpn select,#section-tpn textarea');
}
function activeSupportTab(){
  return document.getElementById('tab-tpn')?.classList.contains('active') ? 'tpn' : 'en';
}
function captureDayState(){
  const state={};
  dayControls().forEach(el=>{
    if(!el.id) return;
    if(el.type==='checkbox'||el.type==='radio') state[el.id]={value:el.value,checked:el.checked};
    else state[el.id]={value:el.value};
  });
  state.__tab=activeSupportTab();
  return state;
}
function restoreDayState(state){
  const st=state||{};
  dayControls().forEach(el=>{
    if(!el.id||!st[el.id]) return;
    if(el.type==='checkbox'||el.type==='radio') el.checked=!!st[el.id].checked;
    else el.value=st[el.id].value??'';
  });

  // Restore the complete state first, then recalculate once.
  switchTab(st.__tab==='tpn'?'tpn':'en');
  try { toggleFortifier(); } catch(error) { console.error('Fortifier restore failed:',error); }
  try { calculateEN(); } catch(error) { console.error('EN restore failed:',error); }
  try { toggleGlucoseInputMode(); } catch(error) { console.error('Glucose mode restore failed:',error); }
  try { calculateTPN(); } catch(error) { console.error('TPN restore failed:',error); }
  try { runGlucoseMixing(); } catch(error) { console.error('Glucose mixing restore failed:',error); }
}
function setDayEditMode(editing){
  const writable = canWriteSupportDays();
  dayEditMode = writable && !!editing;
  document.body.classList.toggle('support-day-locked', !dayEditMode);
  dayControls().forEach(el=>{
    el.disabled = !dayEditMode;
  });
  const edit=$('editDayBtn'),save=$('saveDayBtn'),add=$('addDayBtn');
  if(edit) edit.disabled = !writable || dayEditMode || !currentSupportDayId;
  if(save) save.disabled = !writable || !dayEditMode || !currentSupportDayId;
  if(add) add.disabled = !writable;
  if(add) add.classList.toggle('opacity-50', !writable);
  if(add) add.classList.toggle('cursor-not-allowed', !writable);
  document.querySelectorAll('.day-delete').forEach(btn=>{
    btn.disabled = !writable;
    btn.classList.toggle('opacity-50', !writable);
    btn.classList.toggle('cursor-not-allowed', !writable);
  });
}
function formatDayDate(v){
  if(!v)return'—';
  const a=String(v).slice(0,10).split('-');
  return a.length===3?`${a[2]}/${a[1]}/${a[0]}`:v;
}
function renderSupportDays(){
  const list=$('dayList'); if(!list)return;
  const writable = canWriteSupportDays();
  while(list.firstChild) list.removeChild(list.firstChild);
  if(!supportDays.length){
    const empty=document.createElement('div');
    empty.className='day-empty';
    empty.textContent='لا توجد أيام مضافة بعد.';
    list.appendChild(empty);
    return;
  }
  [...supportDays].sort((a,b)=>String(a.day_date).localeCompare(String(b.day_date))).forEach(d=>{
    const row=document.createElement('div'); row.className='day-row';
    const b=document.createElement('button');
    b.type='button'; b.className='day-item'+(d.id===currentSupportDayId?' active':'');
    b.textContent=formatDayDate(d.day_date); b.title='فتح هذا اليوم';
    b.addEventListener('click',()=>selectSupportDay(d.id));
    const del=document.createElement('button');
    del.type='button'; del.className='day-delete'; del.title=writable?'حذف هذا اليوم':'الحذف غير متاح حاليًا'; del.setAttribute('aria-label','حذف هذا اليوم'); del.disabled=!writable;
    del.textContent='🗑️';
    del.addEventListener('click',e=>{e.stopPropagation();deleteSupportDay(d.id);});
    row.appendChild(b); row.appendChild(del); list.appendChild(row);
  });
}
function showDeleteConfirm(dayText){
  return new Promise(resolve=>{
    const overlay=$('deleteConfirmOverlay');
    const text=$('deleteConfirmText');
    const ok=$('deleteConfirmOk');
    const cancel=$('deleteConfirmCancel');
    if(!overlay||!text||!ok||!cancel){resolve(false);return;}

    text.textContent='هل أنت متأكد من حذف يوم '+dayText+'؟\nسيتم حذف جميع بيانات Enteral و Parenteral المحفوظة لهذا اليوم نهائيًا.';
    overlay.classList.add('show');

    const close=value=>{
      overlay.classList.remove('show');
      ok.onclick=null;
      cancel.onclick=null;
      overlay.onclick=null;
      resolve(value);
    };

    ok.onclick=()=>close(true);
    cancel.onclick=()=>close(false);
    overlay.onclick=e=>{if(e.target===overlay)close(false);};
  });
}
function canWriteSupportDays() {
  const a = window.__dpNutritionSupportDayAccess || {};
  return a.hasActiveSubscription === true && a.hasFeature === true;
}

function applySupportDayAccessUI() {
  setDayEditMode(false);
  const writable = canWriteSupportDays();
  const note = $('supportAccessNotice');
  if (note) {
    note.textContent = writable
      ? ''
      : 'الوضع للقراءة فقط: تعديل أو إضافة أيام الدعم والحاسبات يتطلب اشتراكًا فعالًا مع خاصية الدعم الغذائي.';
    note.style.display = writable ? 'none' : 'block';
  }
  document.querySelectorAll('.day-delete').forEach(btn=>{
    btn.disabled = !writable;
    btn.classList.toggle('opacity-50', !writable);
    btn.classList.toggle('cursor-not-allowed', !writable);
  });
}

async function refreshSupportDayAccess(userId) {
  try {
    const [hasActiveSubscription, hasFeature] = await Promise.all([
      access?.hasActiveSubscription?.(userId),
      access?.hasFeature?.(userId, 'nutrition_support')
    ]);

    window.__dpNutritionSupportDayAccess = {
      hasActiveSubscription: hasActiveSubscription === true,
      hasFeature: hasFeature === true
    };
    applySupportDayAccessUI();
  } catch (error) {
    console.error('Nutrition support day access check failed:', error);
    window.__dpNutritionSupportDayAccess = {
      hasActiveSubscription: false,
      hasFeature: false
    };
    applySupportDayAccessUI();
  }
}

async function deleteSupportDay(id){
  if (supportDayOperationBusy) return;
  if (!canWriteSupportDays()) { alert('تعديل أيام الدعم الغذائي متاح أثناء الاشتراك المدفوع وخاصية التغذية الداعمة فقط.'); return; }
  const d=supportDays.find(x=>x.id===id); if(!d)return;
  if(!(await showDeleteConfirm(formatDayDate(d.day_date))))return;
  supportDayOperationBusy=true;
  const {error}=await supabaseClient.from('nutrition_support_days').delete()
    .eq('id',id).eq('patient_id',supportPatientId).eq('user_id',supportUserId);
  if(error){
    console.error(error);
    supportDayOperationBusy=false;
    alert('تعذر حذف اليوم: '+(error.message||'تحقق من صلاحيات قاعدة البيانات.'));
    return;
  }
  supportDayOperationBusy=false;
  supportDays=supportDays.filter(x=>x.id!==id);
  if(currentSupportDayId===id){
    const next=[...supportDays].sort((a,b)=>String(b.day_date).localeCompare(String(a.day_date)))[0];
    if(next){currentSupportDayId=next.id;restoreDayState(next.state||{});$('report-date').value=next.day_date;}
    else{currentSupportDayId=null;restoreDayState(dayDefaults||{});$('report-date').value='';setDayEditMode(false);}
  }
  renderSupportDays();
}
async function saveCurrentSupportDay(){
  if (supportDayOperationBusy) return false;
  if (!canWriteSupportDays()) { alert('تعديل أيام الدعم الغذائي متاح أثناء الاشتراك المدفوع وخاصية التغذية الداعمة فقط.'); return false; }
  if(!supportPatientId||!supportUserId||!currentSupportDayId){
    alert('أضف يومًا أولاً ثم اضغط تعديل.');
    return false;
  }
  const d=supportDays.find(x=>x.id===currentSupportDayId);
  if(!d)return false;

  supportDayOperationBusy=true;
  setDayEditMode(false);

  const state=captureDayState();
  state.__date=d.day_date;

  const {error}=await supabaseClient
    .from('nutrition_support_days')
    .update({state})
    .eq('id',d.id)
    .eq('patient_id',supportPatientId)
    .eq('user_id',supportUserId);

  if(error){
    console.error('Nutrition support day save failed:',error);
    alert('تعذر حفظ بيانات هذا اليوم: '+(error.message||'تحقق من صلاحيات قاعدة البيانات.'));
    supportDayOperationBusy=false;
    setDayEditMode(true);
    return false;
  }

  d.state=state;
  d.updated_at=new Date().toISOString();
  dayEditMode=false;
  supportDayOperationBusy=false;
  setDayEditMode(false);
  return true;
}
async function selectSupportDay(id){
  if(id===currentSupportDayId)return;
  const d=supportDays.find(x=>x.id===id);if(!d)return;
  currentSupportDayId=id;
  restoreDayState(d.state||{});
  $('report-date').value=d.day_date;
  renderSupportDays();
  setDayEditMode(false);
}
async function addSupportDay(){
  if (supportDayOperationBusy) return;
  if (!canWriteSupportDays()) { alert('إضافة أيام الدعم الغذائي متاحة أثناء الاشتراك المدفوع وخاصية التغذية الداعمة فقط.'); return; }
  const date=$('newDayDate')?.value;
  if(!date){alert('اختر تاريخ اليوم أولاً.');return;}
  if(!supportPatientId||!supportUserId){alert('لم يتم تحميل المريض بعد.');return;}
  const existing=supportDays.find(x=>String(x.day_date).slice(0,10)===date);
  if(existing){await selectSupportDay(existing.id);return;}
  supportDayOperationBusy=true;
  const blank=dayDefaults?JSON.parse(JSON.stringify(dayDefaults)):captureDayState();
  blank.__date=date;blank.__tab='en';
  const {data,error}=await supabaseClient.from('nutrition_support_days')
    .insert({patient_id:supportPatientId,user_id:supportUserId,day_date:date,state:blank})
    .select('id,patient_id,user_id,day_date,state,created_at,updated_at').single();
  if(error){
    console.error(error);
    supportDayOperationBusy=false;
    alert('تعذر إضافة اليوم: '+(error.message||'تحقق من جدول nutrition_support_days وصلاحيات RLS.'));
    return;
  }
  supportDayOperationBusy=false;
  supportDays.push(data);currentSupportDayId=data.id;
  restoreDayState(blank);$('report-date').value=date;renderSupportDays();
  setDayEditMode(true);
}
async function initSupportDays(patientId,userId){
  supportPatientId=patientId;supportUserId=userId;
  const dateEl=$('newDayDate');if(dateEl)dateEl.value=new Date().toISOString().slice(0,10);
  dayDefaults=captureDayState();dayDefaults.__tab='en';
  const {data,error}=await supabaseClient.from('nutrition_support_days')
    .select('id,patient_id,user_id,day_date,state,created_at,updated_at')
    .eq('patient_id',patientId).eq('user_id',userId).order('day_date',{ascending:true});
  if(error){
    console.error('nutrition_support_days load failed:',error);
    supportDays=[];
    currentSupportDayId=null;
    renderSupportDays();
    setDayEditMode(false);
    alert('تعذر تحميل أيام الدعم الغذائي: '+(error.message||'تحقق من RLS والجدول nutrition_support_days.'));
    return;
  }
  supportDays=data||[];
  if(supportDays.length){
    currentSupportDayId=supportDays[supportDays.length-1].id;
    restoreDayState(supportDays[supportDays.length-1].state||{});
    $('report-date').value=supportDays[supportDays.length-1].day_date;
  }
  renderSupportDays();
  setDayEditMode(false);
}

async function loadPatientData(){
  try{
    const sessionUser = await access.getCurrentUser();
    if (sessionUser) await refreshSupportDayAccess(sessionUser.id);
    if(!sessionUser){location.replace('index.html');return;}

    const supportAccess = window.__dpNutritionSupportDayAccess || {};
    if (
      supportAccess.hasActiveSubscription === true &&
      supportAccess.hasFeature !== true
    ) {
      location.replace('nutritionsupport.html');
      return;
    }

    const id=new URLSearchParams(location.search).get('patient');
    if(!id){location.replace('nutritionsupport.html');return;}
    const {data:p,error:pe}=await supabaseClient.from('patients')
      .select('id,name,gender,birth_date,age,height,diagnosis,complaints,clinical_notes')
      .eq('id',id).eq('user_id',sessionUser.id).maybeSingle();
    if(pe) throw pe;
    if(!p){
      throw new Error('لم يتم العثور على المريض أو لا توجد صلاحية لقراءة بياناته. Patient ID: '+id);
    }

    $('selectedPatientName').textContent=p.name||'—';
    $('pName').textContent=p.name||'—';
    $('pGender').textContent=gender(p.gender);
    $('pBirth').textContent=fmtDate(p.birth_date);
    $('pAge').textContent=p.age??'—';
    $('pHeight').textContent=p.height?`${p.height} سم`:'—';
    $('pDiagnosis').textContent=p.diagnosis||'—';
    $('pComplaints').textContent=p.complaints||'—';
    $('pNotes').textContent=p.clinical_notes||'—';

    const set=(id,v)=>{const e=$(id);if(e)e.value=v??''};
    set('patient-name',p.name||'');
    set('patient-id',p.id||'');
    set('report-date',new Date().toISOString().slice(0,10));
    set('clinical-diagnosis',p.diagnosis||'');
    set('nutritional-diagnosis',p.complaints||'');
    await initSupportDays(p.id, sessionUser.id);
  }catch(e){
    console.error(e);
    const notice=document.createElement('div');
    notice.style.cssText='padding:16px;text-align:center;color:#b91c1c;font-family:Cairo,sans-serif';
    notice.textContent='تعذر تحميل بيانات المريض.';
    document.body.prepend(notice);
  }
}


  /* =========================================================
     DECLARATIVE EVENT BINDINGS
     ---------------------------------------------------------
     The HTML contains no inline onclick/oninput/onchange handlers.
     Events are delegated here so all page functions stay private
     inside this module instead of leaking into window.
     ========================================================= */
  function bindDeclarativeEvents(){
    document.addEventListener('click', event=>{
      const el=event.target.closest('[data-action]');
      const action=el?.dataset.action;

      if(action){
        switch(action){
          case 'smart-print':
            smartPrint();
            break;
          case 'toggle-patient-header':
            togglePatientHeader();
            break;
          case 'tab-en':
            switchTab('en');
            break;
          case 'tab-tpn':
            switchTab('tpn');
            break;
          case 'accordion-en-volume':
            toggleENAccordion('en-volume-content','en-volume-arrow');
            break;
          case 'accordion-en-calories':
            toggleENAccordion('en-calories-content','en-calories-arrow');
            break;
          case 'print-confirm':
            confirmSupportPrint();
            break;
          case 'print-cancel':
            closePrintSettings();
            break;
          case 'print-completion-close':
            closePrintCompletion();
            break;
        }
        return;
      }

      // The print/delete overlays are placed after the script tag in the HTML.
      // Use delegated IDs so their buttons work even when they are created after
      // the page initializer has already run.
      const id=event.target.closest('button')?.id;
      if(id==='printConfirmBtn') confirmSupportPrint();
      else if(id==='printCancelBtn') closePrintSettings();
      else if(id==='printCompletionBtn') closePrintCompletion();
    });

    document.addEventListener('input', event=>{
      const mixEl=event.target.closest('[data-mix="glucose"]');
      if(mixEl){
        runGlucoseMixing();
        return;
      }

      const el=event.target.closest('[data-calc]');
      if(!el) return;

      switch(el.dataset.calc){
        case 'en':
          calculateEN();
          break;
        case 'calorie':
          calculateCalorieBased();
          break;
        case 'tpn':
          calculateTPN();
          break;
      }
    });

    document.addEventListener('change', event=>{
      const calcEl=event.target.closest('[data-calc-change]');
      if(calcEl && calcEl.dataset.calcChange==='tpn'){
        calculateTPN();
        return;
      }

      const el=event.target.closest('[data-action]');
      if(!el) return;

      switch(el.dataset.action){
        case 'fortifier-change':
          toggleFortifier();
          calculateEN();
          break;
        case 'glucose-mode-change':
          toggleGlucoseMode();
          break;
        case 'glucose-input-mode-change':
          toggleGlucoseInputMode();
          break;
        case 'tpn-type-change':
          toggleTpnTypeMode();
          calculateTPN();
          break;
      }
    });
  }

function initializePage(){
  // IMPORTANT: bind delegated UI events before any initializer runs.
  // Without this call, the HTML data-action/data-calc controls remain inert.
  bindDeclarativeEvents();

  const reportDate=$('report-date');
  if(reportDate) reportDate.value=new Date().toISOString().slice(0,10);

  // Bind page controls FIRST. A calculation error must never disable the UI.
  $('patientDataToggle')?.addEventListener('click',()=>{
    const content=$('patientDataContent');
    const arrow=$('patientDataArrow');
    if(!content||!arrow)return;
    const isOpen=content.style.display!=='none';
    content.style.display=isOpen?'none':'grid';
    $('patientDataToggle').setAttribute('aria-expanded',String(!isOpen));
    arrow.className=isOpen?'fa-solid fa-chevron-down':'fa-solid fa-chevron-up';
  });

  $('addDayBtn')?.addEventListener('click',()=>{
    if (!canWriteSupportDays()) {
      alert('إضافة يوم دعم غذائي تتطلب اشتراكًا فعالًا مع خاصية الدعم الغذائي.');
      return;
    }
    addSupportDay();
  });
  $('editDayBtn')?.addEventListener('click',()=>{
    if (!canWriteSupportDays()) {
      alert('تعديل يوم الدعم الغذائي يتطلب اشتراكًا فعالًا مع خاصية الدعم الغذائي.');
      return;
    }
    if(currentSupportDayId)setDayEditMode(true);
  });
  $('saveDayBtn')?.addEventListener('click',saveCurrentSupportDay);

  $('printCompletionOverlay')?.addEventListener('click',e=>{
    if(e.target.id==='printCompletionOverlay')closePrintCompletion();
  });
  $('printSettingsOverlay')?.addEventListener('click',e=>{
    if(e.target.id==='printSettingsOverlay')closePrintSettings();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closePrintSettings();
  });

  setDayEditMode(false);

  // Initialize visual/calculation state after all event handlers are attached.
  // Each initializer is isolated so one optional calculator cannot break the page.
  try { switchTab('en'); } catch (error) { console.error('Tab initialization failed:', error); }
  try { calculateCalorieBased(); } catch (error) { console.error('EN calorie initialization failed:', error); }
  try { toggleGlucoseInputMode(); } catch (error) { console.error('TPN glucose initialization failed:', error); }

  if (!access || !supabaseClient) return;
  loadPatientData();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',initializePage,{once:true});
}else{
  initializePage();
}

})();
