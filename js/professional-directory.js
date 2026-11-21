(()=>{
"use strict";

const db = window.DietPlannerAccess?.supabaseClient;
const $ = id => document.getElementById(id);
const PAGE_SIZE = 20;
const state = { profiles: [], offset: 0, loading: false };

const labels = {
  online: "أونلاين",
  in_person: "حضوري",
  phone: "هاتفي"
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const asArray = value => Array.isArray(value) ? value : [];

function getFilteredProfiles() {
  const query = $("directorySearch").value.trim().toLocaleLowerCase();
  const governorate = $("directoryGovernorate").value;
  const mode = $("directoryMode").value;

  return state.profiles.filter(profile => {
    const specialties = asArray(profile.specialties);
    const serviceModes = asArray(profile.service_modes);
    const searchable = [
      profile.display_name,
      profile.professional_title,
      profile.bio,
      profile.city,
      profile.governorate,
      ...specialties
    ].filter(Boolean).join(" ").toLocaleLowerCase();

    return (!query || searchable.includes(query))
      && (!governorate || profile.governorate === governorate)
      && (!mode || serviceModes.includes(mode));
  });
}

function renderProfiles() {
  const profiles = getFilteredProfiles();
  const cards = $("directoryCards");

  cards.innerHTML = profiles.map(profile => {
    const specialties = asArray(profile.specialties);
    const serviceModes = asArray(profile.service_modes);
    const location = [profile.city, profile.governorate]
      .filter(Boolean)
      .map(value => '<span class="directory-chip">' + escapeHtml(value) + '</span>')
      .join("");
    const specialtyChips = specialties
      .map(value => '<span class="directory-chip">' + escapeHtml(value) + '</span>')
      .join("");
    const modeChips = serviceModes
      .map(value => '<span class="directory-chip">' + escapeHtml(labels[value] || value) + '</span>')
      .join("");
    const experience = profile.experience_years == null
      ? ""
      : '<span class="directory-chip">' + escapeHtml(profile.experience_years) + ' سنة خبرة</span>';

    return '<article class="directory-card">'
      + '<h2>' + escapeHtml(profile.display_name || "مختص تغذية") + '</h2>'
      + '<div class="title">' + escapeHtml(profile.professional_title || "") + '</div>'
      + '<div class="verified"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ملف معتمد</div>'
      + '<p>' + escapeHtml(profile.bio || "") + '</p>'
      + '<div>' + specialtyChips + '</div>'
      + '<div>' + location + experience + modeChips + '</div>'
      + '<button type="button" data-connect="' + escapeHtml(profile.user_id) + '">طلب متابعة</button>'
      + '</article>';
  }).join("");

  $("directoryStatus").textContent = profiles.length
    ? "عدد النتائج المحمّلة: " + profiles.length
    : "لا توجد ملفات مهنية معتمدة منشورة حاليًا.";

  cards.querySelectorAll("[data-connect]").forEach(button => {
    button.addEventListener("click", () => connect(button.dataset.connect, button));
  });
}

function renderGovernorates() {
  const select = $("directoryGovernorate");
  const selected = select.value;
  const governorates = [...new Set(
    state.profiles.map(profile => profile.governorate).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ar"));

  select.innerHTML = '<option value="">كل المحافظات</option>'
    + governorates.map(value =>
      '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>'
    ).join("");

  select.value = governorates.includes(selected) ? selected : "";
}

async function loadProfiles() {
  if (state.loading) return;

  if (!db) {
    $("directoryStatus").textContent = "تعذر تهيئة الاتصال بقاعدة البيانات. حدّث الصفحة وحاول مرة أخرى.";
    $("directoryMore").hidden = true;
    return;
  }

  state.loading = true;
  const moreButton = $("directoryMore");
  moreButton.disabled = true;
  $("directoryStatus").textContent = state.profiles.length
    ? "جاري تحميل المزيد من المتخصصين..."
    : "جاري تحميل المتخصصين...";

  try {
    const from = state.offset;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await db
      .from("professional_directory_profiles")
      .select("user_id,display_name,professional_title,bio,specialties,city,governorate,experience_years,service_modes")
      .order("governorate")
      .range(from, to);

    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    state.profiles.push(...page);
    state.offset += page.length;

    renderGovernorates();
    renderProfiles();

    moreButton.hidden = page.length < PAGE_SIZE;
    if (!state.profiles.length) {
      $("directoryStatus").textContent = "لا توجد ملفات مهنية معتمدة منشورة حاليًا.";
    }
  } catch (error) {
    console.error("[Professional Directory] Loading failed:", error);
    $("directoryStatus").textContent = "تعذر تحميل المتخصصين. تحقق من الاتصال ثم أعد تحميل الصفحة.";
    moreButton.hidden = state.profiles.length === 0;
  } finally {
    state.loading = false;
    moreButton.disabled = false;
  }
}

async function connect(professionalId, button) {
  const access = window.DietPlannerAccess;
  const user = await access?.getCurrentUser();

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const message = window.prompt("رسالة مختصرة للمختص (اختياري):", "");
  if (message === null) return;

  button.disabled = true;
  try {
    const { error } = await db.rpc("request_professional_connection", {
      p_professional_id: professionalId,
      p_message: message
    });

    if (error) {
      const messages = {
        patient_account_not_linked: "يجب ربط حسابك بملفك الصحي أولًا.",
        already_in_care_team: "هذا المختص مرتبط بالفعل بملفك.",
        professional_not_available: "الملف غير متاح حاليًا."
      };
      window.alert(messages[error.message] || "تعذر إرسال الطلب: " + error.message);
      return;
    }

    button.textContent = "تم إرسال الطلب";
    button.disabled = true;
  } catch (error) {
    console.error("[Professional Directory] Connection request failed:", error);
    window.alert("حدث خطأ أثناء إرسال الطلب. حاول مرة أخرى.");
    button.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("directoryMore").addEventListener("click", loadProfiles);
  ["directorySearch", "directoryGovernorate", "directoryMode"].forEach(id => {
    $(id).addEventListener(id === "directorySearch" ? "input" : "change", renderProfiles);
  });

  // Public directory loading must never wait for authentication/account-type checks.
  loadProfiles();

  const access = window.DietPlannerAccess;
  Promise.resolve()
    .then(() => access?.getCurrentUser())
    .then(user => user
      ? access?.getUserAccountType(user.id)
      : null
    )
    .then(accountType => {
      $("directoryProfessionalProfile").hidden = accountType !== "professional";
    })
    .catch(error => {
      console.warn("[Professional Directory] Optional account UI check failed:", error);
      $("directoryProfessionalProfile").hidden = true;
    });
});
})();