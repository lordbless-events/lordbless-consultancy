/* =========================================================
   TEAM & ACCESS ADMINISTRATION
   ========================================================= */
(function () {
    "use strict";

    const state = {
        container: null,
        tab: "staff",
        data: null,
        loading: false,
        busy: false,
        error: "",
        message: "",
        selectedStaffId: "",
        historyClientId: "",
        history: []
    };

    const ROLE_DESCRIPTIONS = {
        overall_admin: "Full system access and administration.",
        operations_client_services: "Clients, enquiries, assessments, journeys, and follow-ups within assigned desks.",
        documentation_admissions: "Documents, reviews, admissions, and applications within assigned desks.",
        finance_manager: "Global finance operations and reporting without general case access.",
        desk_staff: "Legacy operational profile. Retained for existing staff."
    };

    function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        })[char]);
    }

    function overallAdmin() {
        const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        return Boolean(user && (user.isOverallAdmin || (typeof hasPermission === "function" && hasPermission(user, "admin.all"))));
    }

    function friendlyError(error) {
        if (!error) return "The operation could not be completed.";
        if (typeof error === "string") return error;
        return [error.message, error.code && `Code: ${error.code}`, error.details, error.hint && `Hint: ${error.hint}`]
            .filter(Boolean).join(" · ") || "The operation could not be completed.";
    }

    function deskName(deskId) {
        return state.data?.desks.find(desk => desk.id === deskId)?.name || "Unassigned";
    }

    function staffById(id) {
        return state.data?.staff.find(staff => staff.user_id === id) || null;
    }

    async function query(table, columns, orderColumn) {
        let request = lordblessSupabase.from(table).select(columns);
        if (orderColumn) request = request.order(orderColumn, { ascending: true });
        const { data, error } = await request;
        if (error) throw error;
        return data || [];
    }

    async function load() {
        state.loading = true;
        state.error = "";
        render();
        try {
            const [staffResult, roles, rolePermissions, permissions, desks, staffRoles, staffPermissions, staffDesks, clients, assignments] = await Promise.all([
                lordblessSupabase.rpc("list_staff_directory"),
                query("staff_role_catalog", "role_code, display_name, description", "display_name"),
                query("role_permissions", "role_code, permission_code"),
                query("permissions", "permission_code, description", "permission_code"),
                query("desks", "id, code, name, active", "name"),
                query("staff_roles", "user_id, role_code, is_primary"),
                query("staff_permissions", "user_id, permission_code"),
                query("staff_desks", "user_id, desk_id"),
                query("clients", "id, client_code, full_name", "full_name").catch(async error => {
                    if (!/client_code/i.test(error.message || "")) throw error;
                    return query("clients", "id, full_name", "full_name");
                }),
                query("client_desk_assignments", "client_id, desk_id, assigned_at")
            ]);
            if (staffResult.error) throw staffResult.error;
            state.data = {
                staff: staffResult.data || [], roles, rolePermissions, permissions,
                desks, staffRoles, staffPermissions, staffDesks, clients, assignments
            };
            if (!staffById(state.selectedStaffId)) state.selectedStaffId = state.data.staff[0]?.user_id || "";
        } catch (error) {
            state.error = friendlyError(error);
        } finally {
            state.loading = false;
            render();
        }
    }

    function roleCodesFor(userId) {
        return state.data.staffRoles.filter(item => item.user_id === userId).map(item => item.role_code);
    }

    function desksFor(userId) {
        return state.data.staffDesks.filter(item => item.user_id === userId).map(item => item.desk_id);
    }

    function assignedDeskFor(clientId) {
        return state.data.assignments.find(item => item.client_id === clientId)?.desk_id || "";
    }

    function staffMarkup() {
        const rows = state.data.staff.map(staff => {
            const roles = roleCodesFor(staff.user_id);
            const desks = desksFor(staff.user_id);
            const directPermissions = state.data.staffPermissions.filter(item => item.user_id === staff.user_id).map(item => item.permission_code);
            return `<article class="ta-staff-card">
                <div class="ta-staff-summary">
                    <div class="ta-avatar">${esc((staff.display_name || staff.email || "S").trim().slice(0, 1).toUpperCase())}</div>
                    <div class="ta-grow"><h3>${esc(staff.display_name || "Staff member")}</h3><p>${esc(staff.email || "Email unavailable")}</p><small>${esc(staff.user_id)}</small></div>
                    <span class="ta-status ${staff.active ? "is-active" : "is-inactive"}">${staff.active ? "Active" : "Inactive"}</span>
                </div>
                <div class="ta-chip-row"><strong>Roles</strong>${roles.map(role => `<span class="ta-chip">${esc(state.data.roles.find(item => item.role_code === role)?.display_name || role)}</span>`).join("") || `<span class="ta-muted">No role assigned</span>`}</div>
                <div class="ta-chip-row"><strong>Desks</strong>${desks.map(id => `<span class="ta-chip">${esc(deskName(id))}</span>`).join("") || `<span class="ta-muted">No desk assigned</span>`}</div>
                ${directPermissions.length ? `<div class="ta-chip-row"><strong>Overrides</strong>${directPermissions.map(code => `<span class="ta-chip">${esc(code)}</span>`).join("")}</div>` : ""}
                <div class="ta-card-actions">
                    <button class="button button-secondary" type="button" data-manage-staff="${esc(staff.user_id)}">Manage roles & desks</button>
                    ${staff.user_id !== (getCurrentUser()?.id || "") ? `<button class="button ${staff.active ? "button-secondary" : "button-primary"}" type="button" data-toggle-active="${esc(staff.user_id)}" data-active="${staff.active}">${staff.active ? "Deactivate access" : "Reactivate access"}</button>` : `<span class="ta-muted">Your own access is protected</span>`}
                </div>
            </article>`;
        }).join("");

        return `<div class="ta-section-head"><div><h3>Staff Directory</h3><p>Existing staff identities and their current access. Staff invitations remain in the approved Auth onboarding process.</p></div><button type="button" class="button button-secondary" data-refresh ${state.loading ? "disabled" : ""}>Refresh</button></div>
            <div class="ta-staff-grid">${rows || `<p class="ta-empty">No staff profiles were found.</p>`}</div>`;
    }

    function rolesMarkup() {
        const roleRows = state.data.roles.map(role => {
            const perms = state.data.rolePermissions.filter(item => item.role_code === role.role_code).map(item => item.permission_code);
            return `<article class="ta-role-card"><h3>${esc(role.display_name)}</h3><p>${esc(role.description || ROLE_DESCRIPTIONS[role.role_code] || "")}</p><div class="ta-permission-list">${perms.map(code => {
                const permission = state.data.permissions.find(item => item.permission_code === code);
                return `<span title="${esc(permission?.description || code)}">${esc(code)}</span>`;
            }).join("") || `<span class="ta-muted">No role permissions</span>`}</div></article>`;
        }).join("");
        const staff = staffById(state.selectedStaffId);
        const selectedRoles = staff ? roleCodesFor(staff.user_id) : [];
        const directPermissions = staff ? state.data.staffPermissions.filter(item => item.user_id === staff.user_id).map(item => item.permission_code) : [];
        return `<div class="ta-section-head"><div><h3>Roles & Permissions</h3><p>Role permissions combine. Existing direct permission overrides are preserved and not edited here.</p></div></div>
            <div class="ta-role-grid">${roleRows}</div>
            <section class="ta-control-panel"><h3>Assign roles</h3>${staff ? `<label>Staff member<select data-selected-staff>${state.data.staff.map(item => `<option value="${esc(item.user_id)}" ${item.user_id === staff.user_id ? "selected" : ""}>${esc(item.display_name || item.email)}</option>`).join("")}</select></label>
                <p>${selectedRoles.map(code => `<span class="ta-chip">${esc(state.data.roles.find(item => item.role_code === code)?.display_name || code)}</span>`).join(" ") || `<span class="ta-muted">No roles assigned</span>`}</p>
                <p>Direct permission overrides: ${directPermissions.map(esc).join(", ") || "None"}</p>
                <div class="ta-inline-form"><label>Role<select data-role-select>${state.data.roles.map(role => `<option value="${esc(role.role_code)}">${esc(role.display_name)}</option>`).join("")}</select></label><button class="button button-primary" type="button" data-role-action="true" ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Assign role</button><button class="button button-secondary" type="button" data-role-action="false" ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Remove role</button></div>
                <small>Overall Admin assignment is available only to an existing Overall Admin and the last active Overall Admin cannot be removed.</small>
            ` : `<p class="ta-empty">No staff profiles are available.</p>`}</section>`;
    }

    function desksMarkup() {
        return `<div class="ta-section-head"><div><h3>Operational Desks</h3><p>Existing stable desk IDs are retained; display names follow the approved structure.</p></div></div>
            <div class="ta-desk-grid">${state.data.desks.map(desk => {
                const staffCount = state.data.staffDesks.filter(item => item.desk_id === desk.id).length;
                const clientCount = state.data.assignments.filter(item => item.desk_id === desk.id).length;
                return `<article class="ta-desk-card"><div class="ta-desk-title"><h3>${esc(desk.name)}</h3><span class="ta-status ${desk.active ? "is-active" : "is-inactive"}">${desk.active ? "Active" : "Inactive"}</span></div><p>Code: <code>${esc(desk.code)}</code></p><div class="ta-counts"><span><strong>${staffCount}</strong> staff assigned</span><span><strong>${clientCount}</strong> clients allocated</span></div></article>`;
            }).join("")}</div>`;
    }

    function staffAssignmentsMarkup() {
        const staff = staffById(state.selectedStaffId);
        const assigned = staff ? desksFor(staff.user_id) : [];
        return `<div class="ta-section-head"><div><h3>Staff Assignments</h3><p>Desk membership scopes client work but does not grant functional permissions.</p></div></div>
            <section class="ta-control-panel"><label>Staff member<select data-selected-staff>${state.data.staff.map(item => `<option value="${esc(item.user_id)}" ${item.user_id === state.selectedStaffId ? "selected" : ""}>${esc(item.display_name || item.email)}</option>`).join("")}</select></label>
                ${staff ? `<div class="ta-checkbox-grid">${state.data.desks.filter(desk => desk.active).map(desk => `<label><input type="checkbox" name="staff_desk" value="${esc(desk.id)}" ${assigned.includes(desk.id) ? "checked" : ""} ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}> ${esc(desk.name)}</label>`).join("")}</div>
                    <button type="button" class="button button-primary" data-save-staff-desks ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Save desk assignments</button>` : `<p class="ta-empty">No staff profiles are available.</p>`}</section>`;
    }

    function allocationMarkup() {
        const rows = state.data.clients.map(client => {
            const deskId = assignedDeskFor(client.id);
            return `<tr><td><strong>${esc(client.full_name || "Client")}</strong><small>${esc(client.client_code || "Client ID pending")}</small></td><td>${esc(deskName(deskId))}</td><td><select data-client-desk="${esc(client.id)}"><option value="">Choose desk</option>${state.data.desks.filter(desk => desk.active).map(desk => `<option value="${esc(desk.id)}" ${desk.id === deskId ? "selected" : ""}>${esc(desk.name)}</option>`).join("")}</select></td><td class="ta-actions"><button type="button" class="button button-primary" data-assign-client="${esc(client.id)}" ${state.busy ? "disabled" : ""}>${deskId ? "Reassign" : "Assign"}</button><button type="button" class="button button-secondary" data-allocation-history="${esc(client.id)}">History</button></td></tr>`;
        }).join("");
        return `<div class="ta-section-head"><div><h3>Client Allocation</h3><p>Only Overall Admin can allocate or reassign a client. Unallocated clients remain visible here and are hidden from desk staff.</p></div></div>
            <div class="ta-table-wrap"><table class="ta-table"><thead><tr><th>Client</th><th>Current desk</th><th>Assign to</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No clients found.</td></tr>`}</tbody></table></div>
            <dialog class="ta-history-dialog" data-history-dialog><div class="ta-section-head"><div><h3>Desk allocation history</h3><p data-history-client></p></div><button type="button" class="button button-secondary" data-close-history>Close</button></div><div data-history-content></div></dialog>`;
    }

    const TAB_CONTENT = {
        staff: staffMarkup,
        roles: rolesMarkup,
        desks: desksMarkup,
        assignments: staffAssignmentsMarkup,
        clients: allocationMarkup
    };

    function render() {
        if (!state.container) return;
        if (!overallAdmin()) {
            state.container.innerHTML = `<section class="section"><div class="empty-state"><div class="empty-state-title">Access restricted</div><div class="empty-state-text">Overall Admin access is required to manage the team and client desk allocations.</div></div></section>`;
            return;
        }
        if (!state.data) {
            state.container.innerHTML = `<section class="section ta-workspace"><h2>Team & Access</h2>${state.error ? `<p class="ta-alert" role="alert">${esc(state.error)}</p>` : `<p role="status">Loading team access records…</p>`}</section>`;
            return;
        }
        const tabs = [["staff", "Staff Directory"], ["roles", "Roles & Permissions"], ["desks", "Desk Management"], ["assignments", "Staff Assignments"], ["clients", "Client Allocation"]];
        state.container.innerHTML = `<section class="section ta-workspace">
            <div class="section-header"><div><p class="section-eyebrow">ADMINISTRATION</p><h2 class="section-title">Team & Access</h2><p class="section-subtitle">Manage staff roles, operational desks, and client allocation.</p></div></div>
            ${state.error ? `<p class="ta-alert" role="alert">${esc(state.error)}</p>` : ""}${state.message ? `<p class="ta-success" role="status">${esc(state.message)}</p>` : ""}
            <nav class="ta-tabs" aria-label="Team and access sections">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${state.tab === id}" class="${state.tab === id ? "is-current" : ""}" data-tab="${id}">${label}</button>`).join("")}</nav>
            <div class="ta-panel">${TAB_CONTENT[state.tab]()}</div>
        </section>`;
        bindEvents();
    }

    function bindEvents() {
        state.container.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => { state.tab = button.dataset.tab; state.error = ""; render(); }));
        state.container.querySelector("[data-refresh]")?.addEventListener("click", () => void load());
        state.container.querySelectorAll("[data-manage-staff]").forEach(button => button.addEventListener("click", () => { state.selectedStaffId = button.dataset.manageStaff; state.tab = "roles"; render(); }));
        state.container.querySelectorAll("[data-selected-staff]").forEach(select => select.addEventListener("change", () => { state.selectedStaffId = select.value; render(); }));
        state.container.querySelectorAll("[data-role-action]").forEach(button => button.addEventListener("click", () => void changeRole(button.dataset.roleAction === "true")));
        state.container.querySelector("[data-save-staff-desks]")?.addEventListener("click", () => void saveStaffDesks());
        state.container.querySelectorAll("[data-toggle-active]").forEach(button => button.addEventListener("click", () => void toggleStaff(button)));
        state.container.querySelectorAll("[data-assign-client]").forEach(button => button.addEventListener("click", () => void assignClient(button.dataset.assignClient)));
        state.container.querySelectorAll("[data-allocation-history]").forEach(button => button.addEventListener("click", () => void showHistory(button.dataset.allocationHistory)));
        state.container.querySelector("[data-close-history]")?.addEventListener("click", () => state.container.querySelector("[data-history-dialog]")?.close());
    }

    async function runAction(message, action) {
        state.busy = true;
        state.error = "";
        state.message = message;
        render();
        try {
            await action();
            state.message = "Changes saved.";
            await loadDataOnly();
        } catch (error) {
            state.error = friendlyError(error);
            state.message = "";
        } finally {
            state.busy = false;
            render();
        }
    }

    async function loadDataOnly() {
        const { data: staffResult, error } = await lordblessSupabase.rpc("list_staff_directory");
        if (error) throw error;
        const [roles, rolePermissions, permissions, desks, staffRoles, staffPermissions, staffDesks, clients, assignments] = await Promise.all([
            query("staff_role_catalog", "role_code, display_name, description", "display_name"),
            query("role_permissions", "role_code, permission_code"),
            query("permissions", "permission_code, description", "permission_code"),
            query("desks", "id, code, name, active", "name"),
            query("staff_roles", "user_id, role_code, is_primary"),
            query("staff_permissions", "user_id, permission_code"),
            query("staff_desks", "user_id, desk_id"),
            query("clients", "id, client_code, full_name", "full_name").catch(async loadError => {
                if (!/client_code/i.test(loadError.message || "")) throw loadError;
                return query("clients", "id, full_name", "full_name");
            }),
            query("client_desk_assignments", "client_id, desk_id, assigned_at")
        ]);
        state.data = { staff: staffResult || [], roles, rolePermissions, permissions, desks, staffRoles, staffPermissions, staffDesks, clients, assignments };
    }

    async function changeRole(assigned) {
        const roleCode = state.container.querySelector("[data-role-select]")?.value;
        if (!state.selectedStaffId || !roleCode) return;
        if (assigned && roleCode === "desk_staff") {
            state.error = "The legacy Desk Staff role cannot be newly assigned. Remove it only when transitioning this staff member to consolidated roles.";
            render();
            return;
        }
        if (assigned && roleCode === "overall_admin" && !window.confirm("Grant this staff member full Overall Admin access?")) return;
        await runAction(assigned ? "Assigning role…" : "Removing role…", async () => {
            const { error } = await lordblessSupabase.rpc("set_staff_role", {
                p_staff_user_id: state.selectedStaffId, p_role_code: roleCode, p_assigned: assigned
            });
            if (error) throw error;
        });
    }

    async function saveStaffDesks() {
        if (!state.selectedStaffId) return;
        const deskIds = [...state.container.querySelectorAll("input[name=staff_desk]:checked")].map(input => input.value);
        await runAction("Saving desk access…", async () => {
            const { error } = await lordblessSupabase.rpc("set_staff_desks", { p_staff_user_id: state.selectedStaffId, p_desk_ids: deskIds });
            if (error) throw error;
        });
    }

    async function toggleStaff(button) {
        const staff = staffById(button.dataset.toggleActive);
        const active = button.dataset.active !== "true";
        if (!staff || !window.confirm(`${active ? "Reactivate" : "Deactivate"} portal access for ${staff.display_name || staff.email}?`)) return;
        await runAction(active ? "Reactivating staff access…" : "Deactivating staff access…", async () => {
            const { error } = await lordblessSupabase.rpc("set_staff_active", { p_staff_user_id: staff.user_id, p_active: active });
            if (error) throw error;
        });
    }

    async function assignClient(clientId) {
        const deskId = state.container.querySelector(`[data-client-desk="${CSS.escape(clientId)}"]`)?.value;
        if (!deskId) {
            state.error = "Select an active desk before saving the allocation.";
            render();
            return;
        }
        const currentDeskId = assignedDeskFor(clientId);
        const client = state.data.clients.find(item => item.id === clientId);
        if (currentDeskId && currentDeskId !== deskId && !window.confirm(`Reassign ${client?.full_name || "this client"} from ${deskName(currentDeskId)} to ${deskName(deskId)}? This will be recorded in allocation history.`)) return;
        await runAction("Saving client allocation…", async () => {
            const { error } = await lordblessSupabase.rpc("assign_client_to_desk", { p_client_id: clientId, p_desk_id: deskId });
            if (error) throw error;
        });
    }

    async function showHistory(clientId) {
        state.historyClientId = clientId;
        const client = state.data.clients.find(item => item.id === clientId);
        const dialog = state.container.querySelector("[data-history-dialog]");
        const content = state.container.querySelector("[data-history-content]");
        state.container.querySelector("[data-history-client]").textContent = client?.full_name || "Client";
        content.textContent = "Loading history…";
        dialog.showModal();
        const { data, error } = await lordblessSupabase.from("client_desk_assignment_history")
            .select("id, previous_desk_id, desk_id, action, changed_at, changed_by")
            .eq("client_id", clientId)
            .order("changed_at", { ascending: false });
        if (error) {
            content.textContent = friendlyError(error);
            return;
        }
        content.innerHTML = (data || []).map(item => `<article class="ta-history-item"><strong>${item.action === "reassigned" ? "Reassigned" : "Assigned"}</strong><span>${esc(item.previous_desk_id ? `${deskName(item.previous_desk_id)} → ` : "")}${esc(deskName(item.desk_id))}</span><small>${esc(new Date(item.changed_at).toLocaleString("en-GB"))} · ${esc(staffById(item.changed_by)?.display_name || "Staff member")}</small></article>`).join("") || `<p class="ta-empty">No allocation changes recorded.</p>`;
    }

    async function render(container) {
        state.container = container;
        if (!overallAdmin()) {
            render();
            return;
        }
        await load();
    }

    window.LORDBLESS_TEAM_ACCESS = { render };
})();
