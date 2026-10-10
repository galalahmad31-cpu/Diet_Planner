(function () {
    'use strict';

    const access = window.DietPlannerAccess;
    const sb = access?.supabaseClient;
    const state = {
        profiles: [],
        currentUserId: null
    };

    const $ = (id) => document.getElementById(id);

    const esc = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function showSection(show) {
        const section = $('adminRoleManagement');
        if (section) section.style.display = show ? 'block' : 'none';
    }

    function render() {
        const body = $('adminRolesBody');
        if (!body) return;

        const query = ($('doctorSearch')?.value || '').trim().toLowerCase();
        const profiles = state.profiles.filter((profile) => {
            return !query || [profile.full_name, profile.email, profile.phone]
                .some((value) => String(value || '').toLowerCase().includes(query));
        });

        body.innerHTML = profiles.map((profile) => {
            const isSelf = profile.id === state.currentUserId;
            const roleLabel = profile.role === 'admin' ? 'Admin' : 'User';
            const control = isSelf
                ? `<span class="badge active">${roleLabel}</span>`
                : `<select class="btn btn-outline" data-role-user="${esc(profile.id)}" aria-label="تغيير دور المستخدم">
                    <option value="user" ${profile.role === 'user' ? 'selected' : ''}>User</option>
                    <option value="admin" ${profile.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>`;

            return `<tr>
                <td><span class="name">${esc(profile.full_name || 'بدون اسم')}</span></td>
                <td><span class="meta">${esc(profile.email || '—')}</span></td>
                <td><span class="badge ${profile.role === 'admin' ? 'active' : 'off'}">${roleLabel}</span></td>
                <td>${control}</td>
            </tr>`;
        }).join('');
    }

    function confirmRoleChange(profile, newRole) {
        return new Promise((resolve) => {
            const bg = $('confirmBg');
            const title = $('confirmTitle');
            const text = $('confirmText');
            const yes = $('confirmYes');
            const no = $('confirmNo');
            const close = $('confirmClose');

            if (!bg || !title || !text || !yes || !no || !close) {
                resolve(window.confirm(
                    newRole === 'admin'
                        ? `هل تريد تحويل ${profile.full_name || profile.email || 'هذا المستخدم'} إلى Admin؟`
                        : `هل تريد تحويل ${profile.full_name || profile.email || 'هذا المستخدم'} إلى User؟`
                ));
                return;
            }

            title.textContent = newRole === 'admin' ? 'تغيير صلاحية المستخدم' : 'إزالة صلاحية الأدمن';
            text.innerHTML = newRole === 'admin'
                ? `هل تريد تحويل <b>${esc(profile.full_name || profile.email || 'هذا المستخدم')}</b> إلى <b>Admin</b>؟<br><span style="color:#718683">سيحصل المستخدم على صلاحيات الإدارة.</span>`
                : `هل تريد تحويل <b>${esc(profile.full_name || profile.email || 'هذا المستخدم')}</b> إلى <b>User</b>؟<br><span style="color:#718683">سيتم إزالة صلاحيات الإدارة منه.</span>`;
            bg.style.display = 'flex';

            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                bg.style.display = 'none';
                yes.removeEventListener('click', onYes);
                no.removeEventListener('click', onNo);
                close.removeEventListener('click', onNo);
                bg.removeEventListener('click', onBackground);
                resolve(value);
            };

            const onYes = (event) => {
                event.stopImmediatePropagation();
                finish(true);
            };

            const onNo = (event) => {
                event.stopImmediatePropagation();
                finish(false);
            };

            const onBackground = (event) => {
                if (event.target === event.currentTarget) finish(false);
            };

            yes.addEventListener('click', onYes);
            no.addEventListener('click', onNo);
            close.addEventListener('click', onNo);
            bg.addEventListener('click', onBackground);
        });
    }

    async function changeRole(userId, newRole, select) {
        const profile = state.profiles.find((item) => item.id === userId);
        if (!profile || userId === state.currentUserId) {
            render();
            return;
        }

        const previousRole = profile.role;
        if (newRole === previousRole) return;

        const confirmed = await confirmRoleChange(profile, newRole);

        if (!confirmed) {
            select.value = previousRole;
            return;
        }

        select.disabled = true;

        const result = await sb.rpc('admin_set_profile_role', {
            target_user_id: userId,
            new_role: newRole
        });

        if (result.error) {
            select.value = previousRole;
            select.disabled = false;
            window.alert(result.error.message || 'تعذر تغيير الدور.');
            return;
        }

        profile.role = newRole;
        render();
    }

    async function init() {
        if (!sb || !access) return;

        const accessStatus = await access.getAccessStatus();
        if (!accessStatus?.authenticated || !accessStatus.isAdmin) return;

        const userResult = await sb.auth.getUser();
        state.currentUserId = userResult.data?.user?.id || null;

        const result = await sb
            .from('profiles')
            .select('id,full_name,email,phone,role,created_at')
            .order('created_at', { ascending: false });

        if (result.error) {
            console.error(result.error);
            return;
        }

        state.profiles = result.data || [];
        showSection(true);
        render();

        $('adminRolesBody')?.addEventListener('change', (event) => {
            const select = event.target.closest('[data-role-user]');
            if (select) changeRole(select.dataset.roleUser, select.value, select);
        });

        $('doctorSearch')?.addEventListener('input', render);
    }

    init();
})();
