/* =========================================================
   TEAM & ACCESS ADMINISTRATION
   ========================================================= */
(function () {
    "use strict";

    const state = {
        container: null,
        rootElement: null,
        tab: "staff",
        data: Object.create(null),
        cache: new Map(),
        inFlight: new Map(),
        sectionLoaded: Object.create(null),
        sectionPromises: Object.create(null),
        sectionErrors: Object.create(null),
        sectionLoading: Object.create(null),
        indexes: Object.create(null),
        generation: 0,
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

    const ROLE_LABELS = {
        overall_admin: "Overall Admin",
        operations_client_services: "Operations & Client Services",
        documentation_admissions: "Documentation & Admissions",
        finance_manager: "Finance & Administration",
        desk_staff: "Desk Staff (legacy)"
    };

    const FUNCTIONAL_ROLES = [
        { code: "overall_admin", name: "Overall Admin", summary: "Full administrative oversight and system access.", responsibilities: "Portal administration, team access, and cross-desk oversight." },
        { code: "operations_client_services", name: "Operations & Client Services", summary: "Client and enquiry operations within assigned desks.", responsibilities: "Client records, enquiries, assessments, journeys, and follow-ups." },
        { code: "documentation_admissions", name: "Documentation & Admissions", summary: "Document and admissions work within assigned desks.", responsibilities: "Document review, admissions, and applications." },
        { code: "finance_manager", name: "Finance & Administration", summary: "Finance operations across all desks.", responsibilities: "Financial records, verification, receipts, and reporting." }
    ];

    const PERF_PREFIX = "[TeamAccess Performance]";

    function now() {
        return window.performance?.now ? window.performance.now() : Date.now();
    }

    function logPerformance(event, details = {}) {
        console.info(PERF_PREFIX, event, details);
    }

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
        return state.indexes.desksById?.get(deskId)?.name || "Unassigned";
    }

    function staffById(id) {
        return state.indexes.staffById?.get(id) || null;
    }

    async function trackedRequest(name, operation) {
        const startedAt = now();
        try {
            const { data, error } = await operation();
            if (error) throw error;
            const completedAt = now();
            const recordCount = Array.isArray(data) ? data.length : undefined;
            logPerformance("request complete", {
                request: name,
                startTimeMs: startedAt,
                completionTimeMs: completedAt,
                durationMs: completedAt - startedAt,
                success: true,
                ...(recordCount === undefined ? {} : { recordCount })
            });
            return data;
        } catch (error) {
            const completedAt = now();
            logPerformance("request complete", {
                request: name,
                startTimeMs: startedAt,
                completionTimeMs: completedAt,
                durationMs: completedAt - startedAt,
                success: false
            });
            throw error;
        }
    }

    function readTable(table, columns, orderColumn) {
        return trackedRequest(table, () => {
            let request = lordblessSupabase.from(table).select(columns);
            if (orderColumn) request = request.order(orderColumn, { ascending: true });
            return request;
        }).then(data => data || []);
    }

    const DATASET_LOADERS = {
        staff: () => trackedRequest("rpc.list_staff_directory", () => lordblessSupabase.rpc("list_staff_directory")).then(data => data || []),
        roles: () => readTable("staff_role_catalog", "role_code, display_name, description", "display_name"),
        rolePermissions: () => readTable("role_permissions", "role_code, permission_code"),
        permissions: () => readTable("permissions", "permission_code, description", "permission_code"),
        desks: () => readTable("desks", "id, code, name, active", "name"),
        staffRoles: () => readTable("staff_roles", "user_id, role_code, is_primary"),
        staffPermissions: () => readTable("staff_permissions", "user_id, permission_code"),
        staffDesks: () => readTable("staff_desks", "user_id, desk_id"),
        clients: async () => {
            try {
                return await readTable("clients", "id, client_code, full_name", "full_name");
            } catch (error) {
                if (!/client_code/i.test(error.message || "")) throw error;
                return readTable("clients", "id, full_name", "full_name");
            }
        },
        assignments: () => readTable("client_desk_assignments", "client_id, desk_id")
    };

    const SECTION_DATASETS = {
        staff: ["staff", "staffRoles", "staffDesks", "staffPermissions", "desks"],
        roles: ["roles", "rolePermissions", "permissions"],
        desks: ["staff", "staffDesks", "desks"],
        assignments: ["staff", "staffDesks", "desks"],
        clients: ["clients", "assignments", "desks"]
    };

    function loadDataset(key) {
        if (state.cache.has(key)) return Promise.resolve(state.cache.get(key));
        if (state.inFlight.has(key)) return state.inFlight.get(key);
        const request = DATASET_LOADERS[key]();
        state.inFlight.set(key, request);
        return request.then(data => {
            state.cache.set(key, data);
            state.data[key] = data;
            return data;
        }).finally(() => {
            if (state.inFlight.get(key) === request) state.inFlight.delete(key);
        });
    }

    function buildIndexes() {
        const startedAt = now();
        const byKey = (items, key, value) => {
            const result = new Map();
            (items || []).forEach(item => {
                const current = result.get(item[key]) || [];
                current.push(value ? value(item) : item);
                result.set(item[key], current);
            });
            return result;
        };
        const oneByKey = (items, key) => new Map((items || []).map(item => [item[key], item]));
        state.indexes = {
            staffById: oneByKey(state.data.staff, "user_id"),
            rolesByStaff: byKey(state.data.staffRoles, "user_id", item => item.role_code),
            desksByStaff: byKey(state.data.staffDesks, "user_id", item => item.desk_id),
            permissionsByStaff: byKey(state.data.staffPermissions, "user_id", item => item.permission_code),
            rolePermissionsByRole: byKey(state.data.rolePermissions, "role_code", item => item.permission_code),
            rolesByCode: oneByKey(state.data.roles, "role_code"),
            permissionsByCode: oneByKey(state.data.permissions, "permission_code"),
            desksById: oneByKey(state.data.desks, "id"),
            assignmentsByClient: oneByKey(state.data.assignments, "client_id")
        };
        state.indexes.clientsById = oneByKey(state.data.clients, "id");
        state.indexes.staffCountByDesk = new Map(
            [...byKey(state.data.staffDesks, "desk_id")].map(([id, rows]) => [id, rows.length])
        );
        state.indexes.clientCountByDesk = new Map(
            [...byKey(state.data.assignments, "desk_id")].map(([id, rows]) => [id, rows.length])
        );
        logPerformance("response processing", {
            durationMs: now() - startedAt,
            datasetCounts: Object.fromEntries(Object.entries(state.data).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]))
        });
    }

    async function loadSectionData(section) {
        const startedAt = now();
        const keys = SECTION_DATASETS[section] || [];
        await Promise.all(keys.map(loadDataset));
        buildIndexes();
        if (!staffById(state.selectedStaffId)) state.selectedStaffId = state.data.staff?.[0]?.user_id || "";
        logPerformance("section data ready", { section, durationMs: now() - startedAt, datasetCount: keys.length });
    }

    async function ensureSectionLoaded(section) {
        if (state.sectionLoaded[section]) return;
        if (!state.sectionPromises[section]) {
            state.sectionLoading[section] = true;
            state.sectionErrors[section] = "";
            if (state.tab === section) renderView();
            const sectionPromise = loadSectionData(section).then(() => {
                state.sectionLoaded[section] = true;
            }).catch(error => {
                state.sectionErrors[section] = friendlyError(error);
                throw error;
            }).finally(() => {
                state.sectionLoading[section] = false;
                delete state.sectionPromises[section];
            });
            state.sectionPromises[section] = sectionPromise;
        }
        try {
            await state.sectionPromises[section];
        } catch (error) {
            // The current section displays the error and offers an explicit retry.
        }
    }

    async function openSection(section, generation = state.generation) {
        state.tab = section;
        state.error = "";
        const displayStartedAt = now();
        if (state.sectionLoaded[section]) {
            renderView();
            logPerformance("section displayed", { section, durationMs: now() - displayStartedAt });
            return;
        }
        if (state.sectionLoading[section]) renderView();
        await ensureSectionLoaded(section);
        if (generation === state.generation && state.tab === section && isMounted()) {
            renderView();
            logPerformance("section displayed", { section, durationMs: now() - displayStartedAt });
        }
    }

    function roleCodesFor(userId) {
        return state.indexes.rolesByStaff?.get(userId) || [];
    }

    function desksFor(userId) {
        return state.indexes.desksByStaff?.get(userId) || [];
    }

    function assignedDeskFor(clientId) {
        return state.indexes.assignmentsByClient?.get(clientId)?.desk_id || "";
    }

    function isMounted() {
        return Boolean(state.container && state.rootElement && state.container.contains(state.rootElement));
    }

    function staffMarkup() {
        const rows = state.data.staff.map(staff => {
            const roles = roleCodesFor(staff.user_id);
            const desks = desksFor(staff.user_id);
            return `<tr>
                <td data-label="Staff member"><strong class="ta-staff-name">${esc(staff.display_name || "Staff member")}</strong><small>${esc(staff.email || "Email unavailable")}</small></td>
                <td data-label="Functional role">${roles.map(role => `<span class="ta-chip ${role === "overall_admin" ? "ta-chip-admin" : ""}">${esc(ROLE_LABELS[role] || role)}</span>`).join(" ") || `<span class="ta-muted">No role assigned</span>`}</td>
                <td data-label="Assigned desks">${desks.map(id => `<span class="ta-chip">${esc(deskName(id))}</span>`).join(" ") || `<span class="ta-muted">No desk assigned</span>`}</td>
                <td data-label="Status"><span class="ta-status ${staff.active ? "is-active" : "is-inactive"}">${staff.active ? "Active" : "Inactive"}</span></td>
                <td data-label="Action"><div class="ta-table-actions">
                    <button class="button button-secondary" type="button" data-manage-staff="${esc(staff.user_id)}">Manage</button>
                    ${staff.user_id !== (getCurrentUser()?.id || "") ? `<button class="button ${staff.active ? "button-secondary" : "button-primary"}" type="button" data-toggle-active="${esc(staff.user_id)}" data-active="${staff.active}">${staff.active ? "Deactivate" : "Reactivate"}</button>` : `<span class="ta-muted">Your account</span>`}
                </div></td>
            </tr>`;
        }).join("");

        return `<div class="ta-section-head"><div><h3>Staff Directory</h3><p>Existing staff identities and their current access. Staff invitations remain in the approved Auth onboarding process.</p></div><button type="button" class="button button-secondary" data-refresh ${state.sectionLoading.staff ? "disabled" : ""}>Refresh</button></div>
            <div class="ta-table-wrap"><table class="ta-table ta-staff-table"><thead><tr><th>Staff member</th><th>Functional role</th><th>Assigned desks</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="ta-empty">No staff profiles were found.</td></tr>`}</tbody></table></div>`;
    }

    function rolesMarkup() {
        const permissionsMarkup = code => {
            const permission = state.indexes.permissionsByCode?.get(code);
            return `<li><code>${esc(code)}</code><span>${esc(permission?.description || code)}</span></li>`;
        };
        const roleCard = (role, descriptor, legacy = false) => {
            const perms = state.indexes.rolePermissionsByRole?.get(role.role_code) || [];
            return `<article class="ta-role-card ${role.role_code === "overall_admin" ? "is-overall-admin" : ""} ${legacy ? "is-legacy-role" : ""}">
                <div class="ta-role-card-heading"><h3>${esc(descriptor.name || role.display_name)}</h3>${role.role_code === "overall_admin" ? `<span class="ta-status ta-role-protected">Protected access</span>` : ""}</div>
                <p>${esc(descriptor.summary || role.description || ROLE_DESCRIPTIONS[role.role_code] || "Existing role profile.")}</p>
                ${descriptor.responsibilities ? `<p class="ta-role-responsibilities"><strong>Main responsibilities:</strong> ${esc(descriptor.responsibilities)}</p>` : ""}
                <details class="ta-role-permissions"><summary>View Permissions</summary><ul>${perms.map(permissionsMarkup).join("") || `<li class="ta-muted">No permissions listed.</li>`}</ul></details>
            </article>`;
        };
        const roleRows = FUNCTIONAL_ROLES.map(descriptor => {
            const role = state.indexes.rolesByCode?.get(descriptor.code) || {
                role_code: descriptor.code,
                display_name: descriptor.name,
                description: ROLE_DESCRIPTIONS[descriptor.code]
            };
            return roleCard(role, descriptor);
        }).join("");
        const legacyRoles = state.data.roles.filter(role => !FUNCTIONAL_ROLES.some(item => item.code === role.role_code));
        const legacyMarkup = legacyRoles.length
            ? `<section class="ta-legacy-roles"><h3>Legacy Roles</h3><p>Existing legacy assignments are retained and are not changed automatically.</p><div class="ta-role-grid">${legacyRoles.map(role => roleCard(role, { name: ROLE_LABELS[role.role_code] || role.display_name }, true)).join("")}</div></section>`
            : "";
        const staff = staffById(state.selectedStaffId);
        const selectedRoles = staff ? roleCodesFor(staff.user_id) : [];
        const directPermissions = staff ? state.indexes.permissionsByStaff?.get(staff.user_id) || [] : [];
        const hasOverallAdmin = selectedRoles.includes("overall_admin");
        const isCurrentStaff = staff?.user_id === (getCurrentUser()?.id || "");
        const protectionNote = hasOverallAdmin
            ? (isCurrentStaff
                ? "Your Overall Admin access is protected. Your own access cannot be changed here; the last active Overall Admin is protected by database enforcement."
                : "This staff member has Overall Admin access. The last active Overall Admin is protected by database enforcement.")
            : "Overall Admin assignment requires existing Overall Admin authority. The last active Overall Admin is protected by database enforcement.";
        return `<div class="ta-section-head"><div><h3>Roles & Permissions</h3><p>Functional access comes from roles. Direct permission overrides remain separate.</p></div></div>
            <div class="ta-role-grid">${roleRows}</div>${legacyMarkup}
            <section class="ta-control-panel"><h3>Assign roles</h3>${staff ? `<label>Staff member<select data-selected-staff>${state.data.staff.map(item => `<option value="${esc(item.user_id)}" ${item.user_id === staff.user_id ? "selected" : ""}>${esc(item.display_name || item.email)}</option>`).join("")}</select></label>
                <p><strong>Current functional roles:</strong> ${selectedRoles.map(code => `<span class="ta-chip ${code === "overall_admin" ? "ta-chip-admin" : ""}">${esc(state.indexes.rolesByCode?.get(code)?.display_name || ROLE_LABELS[code] || code)}</span>`).join(" ") || `<span class="ta-muted">None assigned</span>`}</p>
                <p><strong>Direct permission overrides:</strong> ${directPermissions.map(esc).join(", ") || "None"}</p>
                <div class="ta-inline-form"><label>Role<select data-role-select>${state.data.roles.map(role => `<option value="${esc(role.role_code)}">${esc(role.display_name)}</option>`).join("")}</select></label><button class="button button-primary" type="button" data-role-action="true" ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Assign role</button><button class="button button-secondary" type="button" data-role-action="false" ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Remove role</button></div>
                <small class="${hasOverallAdmin ? "ta-admin-protection-note" : ""}">${esc(protectionNote)}</small>
            ` : `<p class="ta-empty">No staff profiles are available.</p>`}</section>`;
    }

    function desksMarkup() {
        const rows = state.data.desks.map(desk => {
                const staffCount = state.indexes.staffCountByDesk?.get(desk.id) || 0;
                const clientCount = state.indexes.clientCountByDesk?.get(desk.id) ?? null;
                return `<tr><td data-label="Operational desk"><strong>${esc(desk.name)}</strong></td><td data-label="Staff assigned">${staffCount}</td><td data-label="Clients allocated">${clientCount === null ? `<span class="ta-muted" aria-label="Not loaded">&mdash;</span>` : clientCount}</td><td data-label="Status"><span class="ta-status ${desk.active ? "is-active" : "is-inactive"}">${desk.active ? "Active" : "Inactive"}</span></td></tr>`;
            }).join("");
        return `<div class="ta-section-head"><div><h3>Operational Desks</h3><p>Existing operational desk assignments and current activity.</p></div></div>
            <div class="ta-table-wrap"><table class="ta-table ta-desk-table"><thead><tr><th>Operational desk</th><th>Staff assigned</th><th>Clients allocated</th><th>Status</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="ta-empty">No operational desks found.</td></tr>`}</tbody></table></div>`;
    }

    function staffAssignmentsMarkup() {
        const staff = staffById(state.selectedStaffId);
        const assigned = staff ? desksFor(staff.user_id) : [];
        return `<div class="ta-section-head"><div><h3>Staff Assignments</h3><p>Desk assignments determine which clients staff can access. Functional permissions are managed separately.</p></div></div>
            <section class="ta-control-panel"><label>Staff member<select data-selected-staff>${state.data.staff.map(item => `<option value="${esc(item.user_id)}" ${item.user_id === state.selectedStaffId ? "selected" : ""}>${esc(item.display_name || item.email)}</option>`).join("")}</select></label>
                ${staff ? `<div class="ta-checkbox-grid">${state.data.desks.filter(desk => desk.active).map(desk => `<label><input type="checkbox" name="staff_desk" value="${esc(desk.id)}" ${assigned.includes(desk.id) ? "checked" : ""} ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}> ${esc(desk.name)}</label>`).join("")}</div>
                    <button type="button" class="button button-primary" data-save-staff-desks ${staff.user_id === (getCurrentUser()?.id || "") ? "disabled" : ""}>Save desk assignments</button>` : `<p class="ta-empty">No staff profiles are available.</p>`}</section>`;
    }

    function allocationMarkup() {
        const rows = state.data.clients.map(client => {
            const deskId = assignedDeskFor(client.id);
            return `<tr><td data-label="Client"><strong class="ta-staff-name">${esc(client.full_name || "Client")}</strong><small>${esc(client.client_code || "Client ID pending")}</small></td><td data-label="Current desk"><span class="${deskId ? "" : "ta-unassigned"}">${esc(deskName(deskId))}</span></td><td data-label="Assign desk"><select data-client-desk="${esc(client.id)}"><option value="">Choose desk</option>${state.data.desks.filter(desk => desk.active).map(desk => `<option value="${esc(desk.id)}" ${desk.id === deskId ? "selected" : ""}>${esc(desk.name)}</option>`).join("")}</select></td><td data-label="Action" class="ta-actions"><div class="ta-table-actions"><button type="button" class="button button-primary" data-assign-client="${esc(client.id)}" ${state.busy ? "disabled" : ""}>${deskId ? "Reassign" : "Assign"}</button><button type="button" class="button button-secondary" data-allocation-history="${esc(client.id)}">History</button></div></td></tr>`;
        }).join("");
        return `<div class="ta-section-head"><div><h3>Client Allocation</h3><p>Only Overall Admin can allocate or reassign clients. Unallocated clients remain visible here and are hidden from desk staff.</p></div></div>
            <div class="ta-table-wrap"><table class="ta-table ta-client-table"><thead><tr><th>Client</th><th>Current desk</th><th>Assign desk</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td colspan="4">No clients found.</td></tr>`}</tbody></table></div>
            <dialog class="ta-history-dialog" data-history-dialog><div class="ta-section-head"><div><h3>Desk allocation history</h3><p data-history-client></p></div><button type="button" class="button button-secondary" data-close-history>Close</button></div><div data-history-content></div></dialog>`;
    }

    const TAB_CONTENT = {
        staff: staffMarkup,
        roles: rolesMarkup,
        desks: desksMarkup,
        assignments: staffAssignmentsMarkup,
        clients: allocationMarkup
    };

    function renderView() {
        const renderStartedAt = now();
        if (!state.container) return;
        if (state.rootElement && !isMounted()) return;
        if (!overallAdmin()) {
            state.container.innerHTML = `<section class="section"><div class="empty-state"><div class="empty-state-title">Access restricted</div><div class="empty-state-text">Overall Admin access is required to manage the team and client desk allocations.</div></div></section>`;
            state.rootElement = state.container.firstElementChild;
            logPerformance("section render", { section: state.tab, durationMs: now() - renderStartedAt });
            return;
        }
        const tabs = [["staff", "Staff Directory"], ["roles", "Roles & Permissions"], ["desks", "Desk Management"], ["assignments", "Staff Assignments"], ["clients", "Client Allocation"]];
        let panelContent;
        if (state.sectionLoading[state.tab]) {
            panelContent = `<p role="status">Loading ${esc(tabs.find(([id]) => id === state.tab)?.[1] || "section")}…</p>`;
        } else if (state.sectionErrors[state.tab]) {
            panelContent = `<p class="ta-alert" role="alert">${esc(state.sectionErrors[state.tab])}</p><button type="button" class="button button-secondary" data-retry-tab="${esc(state.tab)}">Retry</button>`;
        } else if (!state.sectionLoaded[state.tab]) {
            panelContent = `<p role="status">Loading section…</p>`;
        } else {
            panelContent = TAB_CONTENT[state.tab]();
        }
        state.container.innerHTML = `<section class="section ta-workspace">
            <div class="section-header"><div><p class="section-eyebrow">ADMINISTRATION</p><h2 class="section-title">Team & Access</h2><p class="section-subtitle">Manage staff roles, operational desks, and client allocation.</p></div></div>
            ${state.error ? `<p class="ta-alert" role="alert">${esc(state.error)}</p>` : ""}${state.message ? `<p class="ta-success" role="status">${esc(state.message)}</p>` : ""}
            <nav class="ta-tabs" aria-label="Team and access sections">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${state.tab === id}" class="${state.tab === id ? "is-current" : ""}" data-tab="${id}">${label}</button>`).join("")}</nav>
            <div class="ta-panel">${panelContent}</div>
        </section>`;
        state.rootElement = state.container.firstElementChild;
        bindEvents();
        logPerformance("section render", { section: state.tab, durationMs: now() - renderStartedAt });
    }

    function bindEvents() {
        state.container.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => void openSection(button.dataset.tab)));
        state.container.querySelector("[data-retry-tab]")?.addEventListener("click", () => {
            const section = state.container.querySelector("[data-retry-tab]").dataset.retryTab;
            state.sectionLoaded[section] = false;
            state.sectionErrors[section] = "";
            void openSection(section);
        });
        state.container.querySelector("[data-refresh]")?.addEventListener("click", () => void refreshSection("staff"));
        state.container.querySelectorAll("[data-manage-staff]").forEach(button => button.addEventListener("click", () => { state.selectedStaffId = button.dataset.manageStaff; void openSection("roles"); }));
        state.container.querySelectorAll("[data-selected-staff]").forEach(select => select.addEventListener("change", () => { state.selectedStaffId = select.value; renderView(); }));
        state.container.querySelectorAll("[data-role-action]").forEach(button => button.addEventListener("click", () => void changeRole(button.dataset.roleAction === "true")));
        state.container.querySelector("[data-save-staff-desks]")?.addEventListener("click", () => void saveStaffDesks());
        state.container.querySelectorAll("[data-toggle-active]").forEach(button => button.addEventListener("click", () => void toggleStaff(button)));
        state.container.querySelectorAll("[data-assign-client]").forEach(button => button.addEventListener("click", () => void assignClient(button.dataset.assignClient)));
        state.container.querySelectorAll("[data-allocation-history]").forEach(button => button.addEventListener("click", () => void showHistory(button.dataset.allocationHistory)));
        state.container.querySelector("[data-close-history]")?.addEventListener("click", () => state.container.querySelector("[data-history-dialog]")?.close());
    }

    async function refreshDatasets(keys) {
        keys.forEach(key => state.cache.delete(key));
        await Promise.all(keys.map(loadDataset));
        buildIndexes();
    }

    async function refreshSection(section) {
        const generation = state.generation;
        state.sectionLoaded[section] = false;
        state.sectionErrors[section] = "";
        state.sectionLoading[section] = true;
        renderView();
        const startedAt = now();
        try {
            await refreshDatasets(SECTION_DATASETS[section] || []);
            state.sectionLoaded[section] = true;
        } catch (error) {
            state.sectionErrors[section] = friendlyError(error);
        } finally {
            state.sectionLoading[section] = false;
            if (generation === state.generation && state.tab === section && isMounted()) {
                renderView();
                logPerformance("section refreshed", { section, durationMs: now() - startedAt, success: state.sectionLoaded[section] });
            }
        }
    }

    async function runAction(message, action, refreshKeys = []) {
        state.busy = true;
        state.error = "";
        state.message = message;
        renderView();
        try {
            await action();
            state.message = "Changes saved.";
            if (refreshKeys.length) await refreshDatasets(refreshKeys);
        } catch (error) {
            state.error = friendlyError(error);
            state.message = "";
        } finally {
            state.busy = false;
            renderView();
        }
    }

    async function changeRole(assigned) {
        const roleCode = state.container.querySelector("[data-role-select]")?.value;
        if (!state.selectedStaffId || !roleCode) return;
        if (assigned && roleCode === "desk_staff") {
            state.error = "The legacy Desk Staff role cannot be newly assigned. Remove it only when transitioning this staff member to consolidated roles.";
            renderView();
            return;
        }
        if (assigned && roleCode === "overall_admin" && !window.confirm("Grant this staff member full Overall Admin access?")) return;
        await runAction(assigned ? "Assigning role…" : "Removing role…", async () => {
            await trackedRequest("rpc.set_staff_role", () => lordblessSupabase.rpc("set_staff_role", {
                p_staff_user_id: state.selectedStaffId, p_role_code: roleCode, p_assigned: assigned
            }));
        }, ["staffRoles"]);
    }

    async function saveStaffDesks() {
        if (!state.selectedStaffId) return;
        const deskIds = [...state.container.querySelectorAll("input[name=staff_desk]:checked")].map(input => input.value);
        await runAction("Saving desk access…", async () => {
            await trackedRequest("rpc.set_staff_desks", () => lordblessSupabase.rpc("set_staff_desks", { p_staff_user_id: state.selectedStaffId, p_desk_ids: deskIds }));
        }, ["staffDesks"]);
    }

    async function toggleStaff(button) {
        const staff = staffById(button.dataset.toggleActive);
        const active = button.dataset.active !== "true";
        if (!staff || !window.confirm(`${active ? "Reactivate" : "Deactivate"} portal access for ${staff.display_name || staff.email}?`)) return;
        await runAction(active ? "Reactivating staff access…" : "Deactivating staff access…", async () => {
            await trackedRequest("rpc.set_staff_active", () => lordblessSupabase.rpc("set_staff_active", { p_staff_user_id: staff.user_id, p_active: active }));
        }, ["staff"]);
    }

    async function assignClient(clientId) {
        const deskId = state.container.querySelector(`[data-client-desk="${CSS.escape(clientId)}"]`)?.value;
        if (!deskId) {
            state.error = "Select an active desk before saving the allocation.";
        renderView();
            return;
        }
        const currentDeskId = assignedDeskFor(clientId);
        const client = state.indexes.clientsById?.get(clientId);
        if (currentDeskId && currentDeskId !== deskId && !window.confirm(`Reassign ${client?.full_name || "this client"} from ${deskName(currentDeskId)} to ${deskName(deskId)}? This will be recorded in allocation history.`)) return;
        await runAction("Saving client allocation…", async () => {
            await trackedRequest("rpc.assign_client_to_desk", () => lordblessSupabase.rpc("assign_client_to_desk", { p_client_id: clientId, p_desk_id: deskId }));
        }, ["assignments"]);
    }

    async function showHistory(clientId) {
        state.historyClientId = clientId;
        const client = state.indexes.clientsById?.get(clientId);
        const dialog = state.container.querySelector("[data-history-dialog]");
        const content = state.container.querySelector("[data-history-content]");
        state.container.querySelector("[data-history-client]").textContent = client?.full_name || "Client";
        content.textContent = "Loading history…";
        dialog.showModal();
        let data;
        try {
            data = await trackedRequest("client_desk_assignment_history", () => lordblessSupabase.from("client_desk_assignment_history")
                .select("id, previous_desk_id, desk_id, action, changed_at, changed_by")
                .eq("client_id", clientId)
                .order("changed_at", { ascending: false })) || [];
        } catch (error) {
            content.textContent = friendlyError(error);
            return;
        }
        content.innerHTML = data.map(item => `<article class="ta-history-item"><strong>${item.action === "reassigned" ? "Reassigned" : "Assigned"}</strong><span>${esc(item.previous_desk_id ? `${deskName(item.previous_desk_id)} → ` : "")}${esc(deskName(item.desk_id))}</span><small>${esc(new Date(item.changed_at).toLocaleString("en-GB"))} · ${esc(staffById(item.changed_by)?.display_name || "Staff member")}</small></article>`).join("") || `<p class="ta-empty">No allocation changes recorded.</p>`;
    }

    async function render(container) {
        const startedAt = now();
        state.container = container;
        state.rootElement = null;
        state.generation += 1;
        state.tab = "staff";
        logPerformance("module initialisation started", { startTimeMs: startedAt });
        if (!overallAdmin()) {
            renderView();
            return;
        }
        await openSection("staff", state.generation);
        logPerformance("initial section displayed", { durationMs: now() - startedAt });
    }

    window.LORDBLESS_TEAM_ACCESS = { render };
})();
