/* =========================================================
   Diet Planner — Quick Calculator
   Calculation logic preserved from the original page.
   ========================================================= */

let ivLineCount = 1;

function addIVLine() {

        const container =
            document.getElementById('iv-lines-container');

        const index = ivLineCount++;

        const row = document.createElement('div');

        row.className =
            'iv-line-row grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-white p-3 rounded-lg border border-blue-100 shadow-sm';

        row.id = `iv-line-${index}`;

        row.innerHTML = `

            <div class="md:col-span-3">

                <label class="block text-[10px] font-bold mb-1 text-gray-600">
                    Glucose conc%
                </label>

                <input
                    type="number"
                    id="qc-iv-conc-${index}"
                    value="10"
                    step="0.1"
                    class="bg-white"
                    data-calc="gir"
                >

            </div>

            <div class="md:col-span-3">

                <label class="block text-[10px] font-bold mb-1 text-gray-600">
                    Glucose Rate Unit
                </label>

                <select
                    id="qc-iv-unit-${index}"
                    class="bg-white"
                    data-calc="gir"
                >

                    <option value="h">
                        ml / h
                    </option>

                    <option value="d">
                        ml / d
                    </option>

                </select>

            </div>

            <div class="md:col-span-5">

                <label class="block text-[10px] font-bold mb-1 text-gray-600">
                    Glucose Rate Value
                </label>

                <input
                    type="number"
                    id="qc-iv-rate-${index}"
                    value="0"
                    step="0.1"
                    class="bg-white"
                    data-calc="gir"
                >

            </div>

            <div class="md:col-span-1 flex items-end justify-center">

                <button
                    data-remove-iv="${index}"
                    class="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white font-bold px-2 py-1.5 rounded-lg text-xs transition-all border border-red-100"
                >
                    ✕
                </button>

            </div>

        `;

        container.appendChild(row);

        calculateQuickGIR();
    }

function removeIVLine(index) {

        const row =
            document.getElementById(`iv-line-${index}`);

        if (row) {

            row.remove();

            calculateQuickGIR();

        }

    }

function calculateBreastmilkFortification() {

        const targetKcal =
            parseFloat(
                document.getElementById('bmf-target-kcal').value
            ) || 0;

        const volume =
            parseFloat(
                document.getElementById('bmf-volume').value
            ) || 0;

        const requiredTsp =
            (
                volume / 90
            ) *
            (
                (targetKcal - 20) / 4
            );

        document.getElementById('bmf-res-tsp').innerText =
            `${requiredTsp.toFixed(2)} leveled tsp`;

        document.getElementById('bmf-res-instruction').innerText =
            `Add ${requiredTsp.toFixed(2)} leveled teaspoonful${Math.abs(requiredTsp - 1) < 0.0001 ? '' : 's'} of formula powder to ${volume.toFixed(0)} mL breast milk.`;

    }

function toggleQuickAccordion(contentId, arrowId) {

        const content =
            document.getElementById(contentId);

        const arrow =
            document.getElementById(arrowId);

        if (content.classList.contains('hidden')) {

            content.classList.remove('hidden');

            arrow.classList.add('rotate-180');

        } else {

            content.classList.add('hidden');

            arrow.classList.remove('rotate-180');

        }

    }

function toggleDexMode() {

        const mode =
            document.getElementById('dex-mode').value;

        const concContainer =
            document.getElementById('dex-input-conc-container');

        const weightContainer =
            document.getElementById('dex-input-weight-container');

        const girContainer =
            document.getElementById('dex-input-gir-container');

        if (mode === 'conc') {

            concContainer.classList.remove('hidden');

            weightContainer.classList.add('hidden');

            girContainer.classList.add('hidden');

        } else {

            concContainer.classList.add('hidden');

            weightContainer.classList.remove('hidden');

            girContainer.classList.remove('hidden');

        }

    }

function convertDensityToKcalPerMl(value, unit) {

        if (!isFinite(value) || value <= 0) {
            return 0;
        }

        if (unit === 'kcal/oz') {

            /*
             * 1 US fl oz = 29.5735 mL
             *
             * kcal/mL = kcal/oz ÷ 29.5735
             */

            return value / 29.5735;

        }

        return value;

    }

function calculateFormulaConcentration() {

        const normalScoops =
            parseFloat(
                document.getElementById('fc-normal-scoops').value
            ) || 0;

        const normalWater =
            parseFloat(
                document.getElementById('fc-normal-water').value
            ) || 0;

        const normalDensityInput =
            parseFloat(
                document.getElementById('fc-normal-density').value
            ) || 0;

        const normalDensityUnit =
            document.getElementById('fc-normal-density-unit').value;

        const requiredDensityInput =
            parseFloat(
                document.getElementById('fc-required-density').value
            ) || 0;

        const requiredDensityUnit =
            document.getElementById('fc-required-density-unit').value;

        const method =
            document.getElementById('fc-method').value;

        const multiplier =
            parseFloat(
                document.getElementById('fc-volume-multiplier').value
            ) || 1;

        const resultEl =
            document.getElementById('fc-res-text');

        const densityEl =
            document.getElementById('fc-res-density');

        const changeEl =
            document.getElementById('fc-res-change');

        const normalDisplayEl =
            document.getElementById('fc-normal-density-display');


        /*
         * Basic validation
         */

        if (
            normalScoops <= 0 ||
            normalWater <= 0 ||
            normalDensityInput <= 0 ||
            requiredDensityInput <= 0 ||
            multiplier <= 0
        ) {

            resultEl.innerText =
                "Enter valid parameters to calculate.";

            densityEl.innerText =
                "Required Caloric Density: —";

            changeEl.innerText = "";

            if (normalDisplayEl) {
                normalDisplayEl.innerText = "—";
            }

            return;

        }


        /*
         * Convert both values to kcal/mL
         * before performing comparison and calculation.
         */

        const normalDensity =
            convertDensityToKcalPerMl(
                normalDensityInput,
                normalDensityUnit
            );

        const requiredDensity =
            convertDensityToKcalPerMl(
                requiredDensityInput,
                requiredDensityUnit
            );


        /*
         * Display normalized normal density.
         */

        if (normalDisplayEl) {

            normalDisplayEl.innerText =
                `${normalDensity.toFixed(3)} kcal/mL`;

        }


        /*
         * The original calculator is intended
         * for concentration increase.
         */

        if (requiredDensity <= normalDensity) {

            resultEl.innerText =
                "Required Caloric Density should be higher than Normal Caloric Density for this adjustment.";

            densityEl.innerText =
                `Required Caloric Density: ${requiredDensityInput.toFixed(2)} ${requiredDensityUnit}`;

            changeEl.innerText = "";

            return;

        }


        /*
         * Original hidden calculation:
         *
         * % change = (Required − Normal) ÷ Normal × 100
         *
         * The calculation is performed using
         * the common kcal/mL unit.
         */

        const percentChange =
            (
                (requiredDensity - normalDensity)
                / normalDensity
            ) * 100;


        /*
         * Original preparation values
         */

        let finalScoops =
            normalScoops;

        let finalWater =
            normalWater;


        /*
         * Reduce Water:
         * decrease water by the same percentage
         */

        if (method === 'water') {

            finalWater =
                normalWater *
                (1 - percentChange / 100);

            finalScoops =
                normalScoops;

        }


        /*
         * Increase Powder:
         * increase scoops by the same percentage
         */

        else {

            finalScoops =
                normalScoops *
                (1 + percentChange / 100);

            finalWater =
                normalWater;

        }


        if (finalWater <= 0) {

            resultEl.innerText =
                "The calculated water volume is not valid. Please review the selected densities.";

            densityEl.innerText =
                `Required Caloric Density: ${requiredDensityInput.toFixed(2)} ${requiredDensityUnit}`;

            changeEl.innerText = "";

            return;

        }


        /*
         * Volume Multiplier:
         * multiply ALL preparation quantities
         * while maintaining the same concentration.
         */

        const scaledScoops =
            finalScoops * multiplier;

        const scaledWater =
            finalWater * multiplier;


        /*
         * Display result.
         */

        if (method === 'water') {

            resultEl.innerHTML =

                `Reduce Water:<br>` +

                `<span class="text-purple-700">` +

                `${scaledScoops.toFixed(2)} scoop(s) + ` +

                `${scaledWater.toFixed(1)} mL water` +

                `</span><br>` +

                `= ${requiredDensityInput.toFixed(2)} ${requiredDensityUnit}`;

        } else {

            resultEl.innerHTML =

                `Increase Powder:<br>` +

                `<span class="text-purple-700">` +

                `${scaledScoops.toFixed(2)} scoop(s) + ` +

                `${scaledWater.toFixed(1)} mL water` +

                `</span><br>` +

                `= ${requiredDensityInput.toFixed(2)} ${requiredDensityUnit}`;

        }


        densityEl.innerText =

            `Required Caloric Density: ` +

            `${requiredDensityInput.toFixed(2)} ${requiredDensityUnit} ` +

            `| Volume Multiplier: ×${multiplier}`;


        changeEl.innerText =

            `Concentration change: ${percentChange.toFixed(1)}%`;

    }

function calculateQuickGIR() {

        const w =
            parseFloat(
                document.getElementById('qc-weight').value
            ) || 0;


        let totalIvGIR = 0;


        const rows =
            document.querySelectorAll('.iv-line-row');


        rows.forEach(row => {

            const concInput =
                row.querySelector(
                    'input[id*="qc-iv-conc"]'
                );

            const unitSelect =
                row.querySelector(
                    'select[id*="qc-iv-unit"]'
                );

            const rateInput =
                row.querySelector(
                    'input[id*="qc-iv-rate"]'
                );


            if (
                concInput &&
                unitSelect &&
                rateInput
            ) {

                const conc =
                    parseFloat(concInput.value) || 0;

                const unit =
                    unitSelect.value;

                const rate =
                    parseFloat(rateInput.value) || 0;


                if (w > 0) {

                    if (unit === 'h') {

                        totalIvGIR +=
                            (rate * conc) /
                            (w * 6);

                    }

                    else {

                        totalIvGIR +=
                            (rate * conc) /
                            (w * 144);

                    }

                }

            }

        });


        const milkType =
            document.getElementById('qc-milk-type').value;


        const entVol =
            parseFloat(
                document.getElementById('qc-ent-vol').value
            ) || 0;


        const entFreq =
            parseFloat(
                document.getElementById('qc-ent-freq').value
            ) || 1;


        const addedCarb =
            parseFloat(
                document.getElementById('qc-ent-carb').value
            ) || 0;


        let baseCarb =
            7.1;


        if (milkType === 'preterm') {

            baseCarb =
                8.5;

        }

        if (milkType === 'custom') {

            baseCarb =
                parseFloat(
                    document.getElementById('qc-custom-base-carb').value
                ) || 0;
        }

        document
            .getElementById('qc-custom-carb-box')
            .classList.toggle('hidden', milkType !== 'custom');


        let entGIR =
            0;


        if (
            w > 0 &&
            entFreq > 0
        ) {

            entGIR =
                (
                    (
                        entVol *
                        24 /
                        entFreq
                    ) *
                    (baseCarb * 0.01) +
                    addedCarb
                ) /
                (w * 1.44);

        }


        const totalGIR =
            totalIvGIR +
            entGIR;


        document.getElementById('qc-res-iv-gir').innerText =
            totalIvGIR.toFixed(2);

        document.getElementById('qc-res-ent-gir').innerText =
            entGIR.toFixed(2);

        document.getElementById('qc-res-total-gir').innerHTML =
            `${totalGIR.toFixed(2)}
             <span class="text-sm font-normal">
                mg/kg/min
             </span>`;

    }

function calculateDextrosePrep() {

        const mode =
            document.getElementById('dex-mode').value;


        const vt =
            parseFloat(
                document.getElementById('dex-volume').value
            ) || 0;


        const c1 =
            parseFloat(
                document.getElementById('dex-c1').value
            ) || 0;


        const c2 =
            parseFloat(
                document.getElementById('dex-c2').value
            ) || 0;


        let dPct =
            0;


        if (mode === 'conc') {

            dPct =
                parseFloat(
                    document.getElementById('dex-req-conc').value
                ) || 0;

        }

        else {

            const weight =
                parseFloat(
                    document.getElementById('dex-weight').value
                ) || 0;


            const targetGir =
                parseFloat(
                    document.getElementById('dex-target-gir').value
                ) || 0;


            if (vt > 0) {

                dPct =
                    (
                        targetGir *
                        weight *
                        1.44
                    ) /
                    vt *
                    100;

            }

        }


        if (
            c1 === c2 ||
            c1 <= c2
        ) {

            document.getElementById('dex-res-text').innerText =
                "C₁ must be greater than C₂";

            return;

        }


        const v1 =
            vt *
            (dPct - c2) /
            (c1 - c2);


        const v2 =
            vt -
            v1;


        if (
            v1 < 0 ||
            v2 < 0
        ) {

            document.getElementById('dex-res-text').innerText =
                "Target concentration out of bounds for given concentrations";

            return;

        }


        const nameC1 =
            `D${c1}%`;

        const nameC2 =
            `D${c2}%`;


        document.getElementById('dex-res-text').innerText =
            `Making ${vt} mL of glucose ${dPct.toFixed(1)}% → ${v1.toFixed(1)} mL ${nameC1} + ${v2.toFixed(1)} mL ${nameC2}`;

    }


/* =========================================================
   Quick Calculator — event wiring + page access
   ========================================================= */

document.addEventListener('click', function (event) {
  const accordion = event.target.closest('[data-quick-accordion]');
  if (accordion) {
    const contentId = accordion.dataset.quickAccordion;
    const arrowId = accordion.dataset.quickArrow;
    if (contentId && arrowId && typeof window.toggleQuickAccordion === 'function') {
      window.toggleQuickAccordion(contentId, arrowId);
    }
    return;
  }

  const addIv = event.target.closest('[data-add-iv]');
  if (addIv && typeof window.addIVLine === 'function') {
    window.addIVLine();
    return;
  }

  const removeIv = event.target.closest('[data-remove-iv]');
  if (removeIv && typeof window.removeIVLine === 'function') {
    const index = removeIv.dataset.removeIv;
    if (index !== undefined) window.removeIVLine(index);
  }
});

document.addEventListener('input', function (event) {
  const el = event.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;

  const calc = el.dataset.calc;
  if (calc === 'gir' && typeof window.calculateQuickGIR === 'function') {
    window.calculateQuickGIR();
  } else if (calc === 'dex' && typeof window.calculateDextrosePrep === 'function') {
    window.calculateDextrosePrep();
  } else if (calc === 'formula' && typeof window.calculateFormulaConcentration === 'function') {
    window.calculateFormulaConcentration();
  } else if (calc === 'bmf' && typeof window.calculateBreastmilkFortification === 'function') {
    window.calculateBreastmilkFortification();
  }
});

document.addEventListener('change', function (event) {
  const el = event.target;
  if (!(el instanceof HTMLSelectElement || el instanceof HTMLInputElement)) return;

  const calc = el.dataset.calc;
  if (el.dataset.dexToggle === 'true' && typeof window.toggleDexMode === 'function') {
    window.toggleDexMode();
  }

  if (calc === 'gir' && typeof window.calculateQuickGIR === 'function') {
    window.calculateQuickGIR();
  } else if (calc === 'dex' && typeof window.calculateDextrosePrep === 'function') {
    window.calculateDextrosePrep();
  } else if (calc === 'formula' && typeof window.calculateFormulaConcentration === 'function') {
    window.calculateFormulaConcentration();
  } else if (calc === 'bmf' && typeof window.calculateBreastmilkFortification === 'function') {
    window.calculateBreastmilkFortification();
  }
});

async function initializeQuickCalculatorAccess() {
  const access = window.DietPlannerAccess;
  if (!access?.getCurrentUser) {
    console.error('Quick Calculator: auth-access.js is not available.');
    return;
  }

  const accessStatus = await access.getAccessStatus();
  if (!accessStatus?.authenticated || !accessStatus.user) {
    window.location.replace('index.html');
    return;
  }
  const user = accessStatus.user;

  // The calculator itself is a client-side tool. Authentication is required;
  // subscription/feature authorization remains centralized in the app's access layer.
}

window.addEventListener("DOMContentLoaded", async () => {
    await initializeQuickCalculatorAccess();
    calculateQuickGIR();
    calculateDextrosePrep();
    toggleDexMode();
    calculateFormulaConcentration();
    calculateBreastmilkFortification();
});

/* =========================================================
   Quick Calculator — input validation layer
   This layer does not alter the existing calculation formulas.
   It only prevents invalid numeric states and improves feedback.
   ========================================================= */

(function () {
  function num(id) {
    const el = document.getElementById(id);
    if (!el) return NaN;
    return parseFloat(el.value);
  }

  function setResult(id, message) {
    const el = document.getElementById(id);
    if (el) el.innerText = message;
  }

  // Prevent negative values in numeric fields at input level.
  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type === 'number' && el.value !== '') {
      const min = el.getAttribute('min');
      if (min !== null && Number.isFinite(parseFloat(min))) {
        const minValue = parseFloat(min);
        const value = parseFloat(el.value);
        if (Number.isFinite(value) && value < minValue) {
          el.value = String(minValue);
        }
      }
    }
  });

  // Guard the formula concentration calculator against impossible densities.
  const originalFormulaCalc = window.calculateFormulaConcentration;
  if (typeof originalFormulaCalc === 'function') {
    window.calculateFormulaConcentration = function () {
      const normal = num('fc-normal-density');
      const required = num('fc-required-density');
      const normalWater = num('fc-normal-water');
      const scoops = num('fc-normal-scoops');
      const multiplier = num('fc-volume-multiplier');

      if (
        !Number.isFinite(normal) || normal <= 0 ||
        !Number.isFinite(required) || required <= 0 ||
        !Number.isFinite(normalWater) || normalWater <= 0 ||
        !Number.isFinite(scoops) || scoops <= 0 ||
        !Number.isFinite(multiplier) || multiplier <= 0
      ) {
        setResult('fc-res-text', 'Enter valid positive parameters to calculate.');
        setResult('fc-res-density', 'Required Caloric Density: —');
        setResult('fc-res-change', '');
        return;
      }

      return originalFormulaCalc();
    };
  }

  // Guard dextrose preparation against missing/invalid target volume.
  const originalDexCalc = window.calculateDextrosePrep;
  if (typeof originalDexCalc === 'function') {
    window.calculateDextrosePrep = function () {
      const volume = num('dex-volume');
      const c1 = num('dex-c1');
      const c2 = num('dex-c2');

      if (
        !Number.isFinite(volume) || volume <= 0 ||
        !Number.isFinite(c1) || !Number.isFinite(c2) ||
        c1 <= c2
      ) {
        setResult('dex-res-text', 'Enter valid values. C₁ must be greater than C₂.');
        return;
      }

      return originalDexCalc();
    };
  }
})();
