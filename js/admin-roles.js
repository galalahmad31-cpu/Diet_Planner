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

    async function changeRole(userId, newRole, select) {
        const profile = state.profiles.find((item) => item.id === userId);
        if (!profile || userId === state.currentUserId) {
            render();
            return;
        }

        const previousRole = profile.role;
        if (newRole === previousRole) return;

        const confirmed = window.confirm(
            newRole === 'admin'
                ? `هل تريد تحويل ${profile.full_name || profile.email || 'هذا المستخدم'} إلى Admin؟`
                : `هل تريد تحويل ${profile.full_name || profile.email || 'هذا المستخدم'} إلى User؟`
        );

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
