(() => {
  "use strict";

  const access = window.DietPlannerAccess;
  const supabase = access?.supabaseClient;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);

  const statusLabels = {
    pending: "في انتظار موافقة المختص",
    confirmed: "تم تأكيد الموعد",
    declined: "تم رفض الطلب",
    cancelled: "تم إلغاء الموعد",
    completed: "تمت الزيارة"
  };
  const typeLabels = { online: "أونلاين", in_person: "حضور شخصي", phone: "مكالمة هاتفية" };

  const formatDateTime = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-EG", {
      weekday: "short", day: "2-digit", month: "short",
      year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  };

  function setStatus(root, message, type = "") {
    const node = root.querySelector("[data-appointment-status]");
    if (!node) return;
    node.textContent = message || "";
    node.className = "patient-appointments-status" + (type ? " is-" + type : "");
  }

  async function mount(root, { patientId, role } = {}) {
    if (!root) return;
    if (root.dataset.appointmentsMountedFor === String(patientId || "")) return;
    if (!supabase || !access?.getCurrentUser || !patientId || !["patient","professional"].includes(role)) {
      if (root) root.textContent = "تعذر تهيئة خدمة المواعيد.";
      return;
    }
    root.dataset.appointmentsMounted = "true";
    root.dataset.appointmentsMountedFor = String(patientId);
    root.innerHTML = `
      <div class="patient-appointments-shell">
        <div class="patient-appointments-heading">
          <div><strong>${role === "patient" ? "مواعيدي" : "مواعيد المريض"}</strong><small>${role === "patient" ? "أرسل طلب موعد وانتظر تأكيد المختص" : "سجل المواعيد المتفق عليها وراجع طلبات المرضى"}</small></div>
          <button type="button" data-appointment-refresh><i class="fa-solid fa-rotate"></i> تحديث</button>
        </div>
        ${role === "patient" ? `
          <form class="patient-appointment-form" data-appointment-form>
            <div class="patient-appointment-fields">
              <div data-appointment-provider-wrap><label for="appointmentProvider">المختص</label><select id="appointmentProvider" data-appointment-provider required></select></div>
              <div><label for="appointmentDateTime">التاريخ والوقت المطلوبان</label><input id="appointmentDateTime" data-appointment-date type="datetime-local" required></div>
              <div><label for="appointmentDuration">المدة</label><select id="appointmentDuration" data-appointment-duration><option value="30">30 دقيقة</option><option value="45">45 دقيقة</option><option value="60">60 دقيقة</option></select></div>
              <div><label for="appointmentType">نوع الموعد</label><select id="appointmentType" data-appointment-type><option value="online">أونلاين</option><option value="in_person">حضور شخصي</option><option value="phone">مكالمة هاتفية</option></select></div>
              <div class="patient-appointment-note"><label for="appointmentNote">سبب الزيارة أو ملاحظات (اختياري)</label><textarea id="appointmentNote" data-appointment-note maxlength="1000" rows="2" placeholder="اكتب باختصار سبب طلب الموعد"></textarea></div>
            </div>
            <div class="patient-appointment-form-footer"><span data-appointment-status class="patient-appointments-status" role="status"></span><button type="submit" data-appointment-submit><i class="fa-regular fa-calendar-plus"></i> إرسال طلب الموعد</button></div>
          </form>
        ` : `<form class="patient-appointment-form" data-professional-appointment-form>
          <div class="patient-appointment-fields">
            <div><label for="professionalAppointmentDate">التاريخ والوقت المتفق عليهما</label><input id="professionalAppointmentDate" data-professional-appointment-date type="datetime-local" required></div>
            <div><label for="professionalAppointmentDuration">المدة</label><select id="professionalAppointmentDuration" data-professional-appointment-duration><option value="30">30 دقيقة</option><option value="45">45 دقيقة</option><option value="60">60 دقيقة</option><option value="90">90 دقيقة</option></select></div>
            <div><label for="professionalAppointmentType">نوع الموعد</label><select id="professionalAppointmentType" data-professional-appointment-type><option value="online">أونلاين</option><option value="in_person">حضور شخصي</option><option value="phone">مكالمة هاتفية</option></select></div>
            <div class="patient-appointment-note"><label for="professionalAppointmentNote">ملاحظات (اختياري)</label><textarea id="professionalAppointmentNote" data-professional-appointment-note maxlength="1000" rows="2" placeholder="ملاحظات الموعد أو ما تم الاتفاق عليه"></textarea></div>
          </div>
          <div class="patient-appointment-form-footer"><span data-appointment-status class="patient-appointments-status" role="status"></span><button type="submit" data-professional-appointment-submit><i class="fa-regular fa-calendar-plus"></i> تسجيل موعد متفق عليه</button></div>
        </form>`}
        <div class="patient-appointments-list" data-appointment-list><div class="patient-appointments-empty">جاري تحميل المواعيد...</div></div>
        <p class="patient-appointments-disclaimer">المواعيد هنا طلبات متابعة وليست خدمة طوارئ. لا يتم تحصيل أي مدفوعات من خلال هذه المرحلة.</p>
      </div>`;

    const user = await access.getCurrentUser();
    if (!user?.id) {
      root.querySelector("[data-appointment-list]").textContent = "يجب تسجيل الدخول.";
      return;
    }
    const list = root.querySelector("[data-appointment-list]");
    const refresh = root.querySelector("[data-appointment-refresh]");
    const form = root.querySelector("[data-appointment-form]");
    const submit = root.querySelector("[data-appointment-submit]");
    const professionalForm = root.querySelector("[data-professional-appointment-form]");
    const professionalSubmit = root.querySelector("[data-professional-appointment-submit]");
    const providerSelect = root.querySelector("[data-appointment-provider]");
    const professionalRole = await access.getUserRole?.(user.id);
    const hasCareManagementAccess = role === "professional" &&
      window.DietPlannerPatientProfileAccess?.canManagePatientCare?.() === true;
    const hasProfessionalSubscription = professionalRole === "admin" ||
      (await access.hasActiveSubscription?.(user.id)) === true;
    const canCreateProfessionalAppointment = hasCareManagementAccess && hasProfessionalSubscription;
    if (professionalForm) professionalForm.hidden = !canCreateProfessionalAppointment;
    let busy = false;
    let localMin = "";

    if (role === "patient") {
      try {
        const { data: team, error: teamError } = await supabase
          .from("patient_care_team")
          .select("professional_id,relationship_role")
          .eq("patient_id", patientId)
          .eq("status", "active");
        if (teamError) throw teamError;
        const { data: agreements, error: agreementError } = await supabase
          .from("professional_connection_requests")
          .select("professional_id,status,agreement_end_date")
          .eq("patient_id", patientId)
          .eq("requested_by", user.id);
        if (agreementError) throw agreementError;
        const today = new Date().toISOString().slice(0, 10);
        const requestsByProfessional = new Map();
        (agreements || []).forEach(item => {
          const rows = requestsByProfessional.get(item.professional_id) || [];
          rows.push(item);
          requestsByProfessional.set(item.professional_id, rows);
        });
        const sorted = (team || [])
          .filter(item => {
            const history = requestsByProfessional.get(item.professional_id) || [];
            if (!history.length) return true;
            return history.some(request =>
              request.status === "active" &&
              (!request.agreement_end_date || request.agreement_end_date >= today)
            );
          })
          .slice()
          .sort((a,b) =>
            (a.relationship_role === "primary" ? 0 : 1) - (b.relationship_role === "primary" ? 0 : 1)
          );
        const ids = [...new Set(sorted.map(item => item.professional_id))];
        if (!ids.length) throw new Error("لا يوجد مختص نشط مرتبط بملفك حاليًا.");
        const { data: profiles, error: profileError } = await supabase
          .from("profiles").select("id,full_name,profession").in("id", ids);
        if (profileError) throw profileError;
        const byId = new Map((profiles || []).map(item => [item.id,item]));
        providerSelect.innerHTML = sorted.filter((item,index,array) =>
          array.findIndex(x => x.professional_id === item.professional_id) === index
        ).map(item => {
          const profile = byId.get(item.professional_id);
          return `<option value="${esc(item.professional_id)}">${esc(profile?.full_name || "المختص")}${profile?.profession ? " · " + esc(profile.profession) : ""}${item.relationship_role === "primary" ? " (الأساسي)" : ""}</option>`;
        }).join("");
        root.querySelector("[data-appointment-provider-wrap]").hidden = ids.length < 2;
      } catch (error) {
        form.hidden = true;
        setStatus(root, error.message || "تعذر تحميل المختصين المرتبطين.", "error");
      }

      const dateInput = root.querySelector("[data-appointment-date]");
      const now = new Date(Date.now() + 15 * 60000);
      localMin = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      dateInput.min = localMin;
    } else {
      const now = new Date(Date.now() + 15 * 60000);
      localMin = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      root.querySelector("[data-professional-appointment-date]").min = localMin;
    }

    async function loadAppointments() {
      refresh.disabled = true;
      try {
        const { data, error } = await supabase
          .from("patient_appointments")
          .select("id,patient_id,professional_id,requested_by,scheduled_at,duration_minutes,appointment_type,status,patient_note,professional_note,cancellation_note,created_at")
          .eq("patient_id", patientId)
          .order("scheduled_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        if (!data?.length) {
          list.innerHTML = '<div class="patient-appointments-empty">لا توجد مواعيد مسجلة حتى الآن.</div>';
          return;
        }
        list.innerHTML = data.map(item => {
          const status = statusLabels[item.status] || item.status;
          const actions = role === "patient"
            ? (["pending","confirmed"].includes(item.status)
              ? `<button type="button" class="patient-appointment-action is-cancel" data-appointment-action="cancel" data-appointment-id="${esc(item.id)}">إلغاء الموعد</button>` : "")
            : (!hasCareManagementAccess ? "" : item.status === "pending"
              ? `<button type="button" class="patient-appointment-action is-confirm" data-appointment-action="confirm" data-appointment-id="${esc(item.id)}">تأكيد</button><button type="button" class="patient-appointment-action is-decline" data-appointment-action="decline" data-appointment-id="${esc(item.id)}">رفض</button><button type="button" class="patient-appointment-action is-cancel" data-appointment-action="cancel" data-appointment-id="${esc(item.id)}">إلغاء</button>`
              : item.status === "confirmed"
                ? `<button type="button" class="patient-appointment-action is-complete" data-appointment-action="complete" data-appointment-id="${esc(item.id)}">تسجيل الزيارة كمكتملة</button><button type="button" class="patient-appointment-action is-cancel" data-appointment-action="cancel" data-appointment-id="${esc(item.id)}">إلغاء</button>`
                : "");
          return `<article class="patient-appointment-card">
            <div class="patient-appointment-card-top"><strong>${esc(formatDateTime(item.scheduled_at))}</strong><span class="patient-appointment-status status-${esc(item.status)}">${esc(status)}</span></div>
            <div class="patient-appointment-meta"><span>${esc(typeLabels[item.appointment_type] || item.appointment_type)}</span><span>${Number(item.duration_minutes)} دقيقة</span></div>
            ${item.patient_note ? `<p class="patient-appointment-note-text"><b>ملاحظة المريض:</b> ${esc(item.patient_note)}</p>` : ""}
            ${item.professional_note ? `<p class="patient-appointment-note-text"><b>رد المختص:</b> ${esc(item.professional_note)}</p>` : ""}
            ${item.cancellation_note ? `<p class="patient-appointment-note-text"><b>سبب الإلغاء:</b> ${esc(item.cancellation_note)}</p>` : ""}
            ${actions ? `<div class="patient-appointment-actions">${actions}</div>` : ""}
          </article>`;
        }).join("");
      } catch (error) {
        console.error("Appointments load failed:", error);
        list.innerHTML = '<div class="patient-appointments-empty is-error">تعذر تحميل المواعيد. تحقق من صلاحيات الحساب وحاول مرة أخرى.</div>';
        setStatus(root, error.message || "تعذر تحميل المواعيد.", "error");
      } finally {
        refresh.disabled = false;
      }
    }

    if (form) {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        const dateValue = root.querySelector("[data-appointment-date]").value;
        const date = new Date(dateValue);
        if (!dateValue || Number.isNaN(date.getTime()) || date.getTime() <= Date.now() + 15 * 60000) {
          setStatus(root, "اختر تاريخًا ووقتًا مستقبليين.", "error");
          return;
        }
        busy = true;
        submit.disabled = true;
        setStatus(root, "جاري إرسال طلب الموعد...");
        try {
          const { error } = await supabase.from("patient_appointments").insert({
            patient_id: patientId,
            professional_id: providerSelect.value,
            requested_by: user.id,
            scheduled_at: date.toISOString(),
            duration_minutes: Number(root.querySelector("[data-appointment-duration]").value),
            appointment_type: root.querySelector("[data-appointment-type]").value,
            patient_note: root.querySelector("[data-appointment-note]").value.trim() || null
          });
          if (error) throw error;
          form.reset();
          root.querySelector("[data-appointment-date]").min = localMin;
          setStatus(root, "تم إرسال الطلب. الموعد في انتظار تأكيد المختص.", "success");
          await loadAppointments();
        } catch (error) {
          console.error("Appointment request failed:", error);
          setStatus(root, error.message || "تعذر إرسال طلب الموعد.", "error");
        } finally {
          busy = false;
          submit.disabled = false;
        }
      });
    }

    if (professionalForm) {
      professionalForm.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy) return;
        const dateValue = root.querySelector("[data-professional-appointment-date]").value;
        const date = new Date(dateValue);
        if (!dateValue || Number.isNaN(date.getTime()) || date.getTime() <= Date.now() + 15 * 60000) {
          setStatus(root, "اختر تاريخًا ووقتًا مستقبليين.", "error");
          return;
        }
        busy = true;
        professionalSubmit.disabled = true;
        setStatus(root, "جاري تسجيل الموعد...");
        try {
          const { error } = await supabase.rpc("create_professional_patient_appointment", {
            p_patient_id: patientId,
            p_scheduled_at: date.toISOString(),
            p_duration_minutes: Number(root.querySelector("[data-professional-appointment-duration]").value),
            p_appointment_type: root.querySelector("[data-professional-appointment-type]").value,
            p_professional_note: root.querySelector("[data-professional-appointment-note]").value.trim() || null
          });
          if (error) throw error;
          professionalForm.reset();
          root.querySelector("[data-professional-appointment-date]").min = localMin;
          setStatus(root, "تم تسجيل الموعد كموعد مؤكد متفق عليه.", "success");
          await loadAppointments();
        } catch (error) {
          console.error("Professional appointment creation failed:", error);
          const message = error.message === "appointment_time_conflict"
            ? "هذا التوقيت يتعارض مع موعد مؤكد آخر."
            : error.message || "تعذر تسجيل الموعد.";
          setStatus(root, message, "error");
        } finally {
          busy = false;
          professionalSubmit.disabled = false;
        }
      });
    }

    list.addEventListener("click", async event => {
      const button = event.target.closest("[data-appointment-action]");
      if (!button || busy) return;
      const action = button.dataset.appointmentAction;
      const appointmentId = button.dataset.appointmentId;
      busy = true;
      button.disabled = true;
      setStatus(root, "جاري تحديث حالة الموعد...");
      try {
        let result;
        if (action === "cancel") {
          result = await supabase.rpc("cancel_patient_appointment", {
            p_appointment_id: appointmentId,
            p_cancellation_note: null
          });
        } else {
          result = await supabase.rpc("respond_patient_appointment", {
            p_appointment_id: appointmentId,
            p_decision: action,
            p_professional_note: null
          });
        }
        if (result.error) throw result.error;
        setStatus(root, "تم تحديث حالة الموعد.", "success");
        await loadAppointments();
      } catch (error) {
        console.error("Appointment action failed:", error);
        setStatus(root, error.message || "تعذر تحديث الموعد.", "error");
        button.disabled = false;
      } finally {
        busy = false;
      }
    });

    refresh.addEventListener("click", () => void loadAppointments());
    await loadAppointments();
  }

  window.DietPlannerPatientAppointments = { mount };
})();
