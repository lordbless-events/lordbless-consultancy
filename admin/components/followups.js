/* =========================================
   LORDBLESS ADMIN
   FOLLOW-UP MANAGER
========================================= */


/* =========================================
   FOLLOW-UP UI
========================================= */

function renderFollowups(
    enquiry
) {

    const followups =
        enquiry.followups || [];


    return `

        <div class="detail-card full-width">

            <h3>
                Follow-up
            </h3>


            <div class="followup-list">

                ${
                    followups.length
                        ? followups
                            .map(
                                followup => `
                                    <div
                                        class="
                                            followup-item
                                            ${
                                                followup.completed
                                                    ? "completed"
                                                    : ""
                                            }
                                        "
                                    >

                                        <div>

                                            <strong>
                                                ${escapeHTML(
                                                    followup.date
                                                )}
                                            </strong>

                                            <div
                                                class="note-meta"
                                            >
                                                ${escapeHTML(
                                                    followup.note
                                                )}
                                            </div>

                                        </div>


                                        <button
                                            class="button button-secondary followup-complete"
                                            data-followup-id="${escapeHTML(
                                                followup.id
                                            )}"
                                        >

                                            ${
                                                followup.completed
                                                    ? "Completed"
                                                    : "Mark Complete"
                                            }

                                        </button>

                                    </div>
                                `
                            )
                            .join("")
                        : `
                            <div class="empty-state">
                                <div class="empty-state-text">
                                    No follow-ups scheduled.
                                </div>
                            </div>
                        `
                }

            </div>


            <div class="followup-composer">

                <input
                    id="followup-date"
                    class="filter-select"
                    type="date"
                >


                <input
                    id="followup-note"
                    class="search-input"
                    type="text"
                    placeholder="Follow-up note..."
                >


                <button
                    class="button"
                    id="add-followup"
                >
                    Schedule
                </button>

            </div>

            <p data-followup-message role="status" aria-live="polite"></p>

        </div>

    `;

}


/* =========================================
   FOLLOW-UP EVENTS
========================================= */

function initialiseFollowups(
    enquiry
) {

    const addButton =
        document.getElementById(
            "add-followup"
        );


    const dateInput =
        document.getElementById(
            "followup-date"
        );


    const noteInput =
        document.getElementById(
            "followup-note"
        );


    if (
        !addButton ||
        !dateInput ||
        !noteInput
    ) {
        return;
    }

    const clientId = typeof getEnquiryClientId === "function" ? getEnquiryClientId(enquiry) : enquiry?.client?.id;
    const enquiryId = enquiry?.id || null;
    const isDatabaseClient = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(clientId || ""));

    if (isDatabaseClient && typeof lordblessSupabase !== "undefined") {
        const cache = window.LORDBLESS_ENQUIRY_FOLLOWUPS_CACHE ||= new Map();
        const cacheKey = `${clientId}:${enquiryId || "none"}`;
        const statusMessage = modalContent.querySelector("[data-followup-message]");
        const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        const canWrite = typeof hasPermission === "function" && hasPermission(currentUser, "followups.write");
        addButton.disabled = !canWrite;

        const reload = async () => {
            let query = lordblessSupabase.from("portal_followups").select("*").eq("client_id", clientId);
            query = enquiryId ? query.eq("enquiry_id", enquiryId) : query.is("enquiry_id", null);
            const { data, error } = await query.order("due_date", { ascending: true });
            if (error) throw error;
            const records = (data || []).map(item => ({
                id: item.id,
                date: item.due_date,
                note: item.notes,
                completed: item.status === "completed"
            }));
            cache.set(cacheKey, records);
            enquiry.followups = records;
            if (typeof openEnquiry === "function" && !enquiryModal.classList.contains("hidden") &&
                enquiryModal.dataset.clientDetailsReference === String(enquiry.reference || enquiry.id || "")) {
                openEnquiry(enquiry.reference || enquiry.id);
            }
        };

        if (cache.has(cacheKey)) enquiry.followups = cache.get(cacheKey);
        else {
            if (statusMessage) statusMessage.textContent = "Loading saved follow-ups…";
            void reload().catch(error => {
                if (statusMessage) statusMessage.textContent = `Saved follow-ups could not be loaded: ${error?.message || error}`;
            });
        }

        addButton.addEventListener("click", async () => {
            const dueDate = dateInput.value;
            const notes = noteInput.value.trim();
            if (!canWrite || !dueDate || !notes) {
                if (statusMessage && !canWrite) statusMessage.textContent = "Follow-up write permission is required.";
                return;
            }
            addButton.disabled = true;
            try {
                const { error } = await lordblessSupabase.from("portal_followups").insert({
                    client_id: clientId,
                    enquiry_id: enquiryId,
                    assigned_to: currentUser?.id || null,
                    created_by: currentUser?.id,
                    due_date: dueDate,
                    task_type: "other",
                    notes
                });
                if (error) throw error;
                dateInput.value = "";
                noteInput.value = "";
                await reload();
            } catch (error) {
                if (statusMessage) statusMessage.textContent = error?.message || "Unable to save the follow-up.";
                addButton.disabled = false;
            }
        });

        document.querySelectorAll(".followup-complete").forEach(button => {
            button.addEventListener("click", async () => {
                const item = (enquiry.followups || []).find(followup => String(followup.id) === String(button.dataset.followupId));
                if (!item || !canWrite) return;
                button.disabled = true;
                try {
                    const nextStatus = item.completed ? "open" : "completed";
                    const { error } = await lordblessSupabase.from("portal_followups")
                        .update({ status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null })
                        .eq("id", item.id)
                        .eq("client_id", clientId);
                    if (error) throw error;
                    await reload();
                } catch (error) {
                    if (statusMessage) statusMessage.textContent = error?.message || "Unable to update the follow-up.";
                    button.disabled = false;
                }
            });
        });
        return;
    }


    addButton.addEventListener(
        "click",
        () => {

            const date =
                dateInput.value;

            const note =
                noteInput.value.trim();


            if (!date || !note) {
                return;
            }


            if (!Array.isArray(
                enquiry.followups
            )) {

                enquiry.followups = [];

            }


            enquiry.followups.push({

                id:
                    "FOLLOW-" +
                    Date.now(),

                date,

                note,

                completed: false

            });


            if (
                typeof openEnquiry ===
                "function"
            ) {

                openEnquiry(
                    enquiry.reference
                );

            }

        }
    );


    document
        .querySelectorAll(
            ".followup-complete"
        )
        .forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const id =
                        button.dataset.followupId;


                    const followup =
                        enquiry.followups.find(
                            item =>
                                item.id === id
                        );


                    if (!followup) {
                        return;
                    }


                    followup.completed =
                        !followup.completed;


                    if (
                        typeof openEnquiry ===
                        "function"
                    ) {

                        openEnquiry(
                            enquiry.reference
                        );

                    }

                }
            );

        });

}


const LORDBLESS_FOLLOWUPS_WORKSPACE_STATE = {
    status: "all",
    taskType: "all",
    assignee: "all",
    records: [],
    assignees: [],
    error: "",
    loading: false
};


function invalidateEnquiryFollowupCache(clientId) {
    const cache = window.LORDBLESS_ENQUIRY_FOLLOWUPS_CACHE;
    if (!(cache instanceof Map)) return;
    for (const key of cache.keys()) {
        if (key.startsWith(`${clientId}:`)) cache.delete(key);
    }
}


async function renderFollowupsWorkspace() {
    const canRead = hasPermission(getCurrentUser(), "followups.read");
    const canWrite = hasPermission(getCurrentUser(), "followups.write");

    if (!canRead) {
        appContent.innerHTML = `<section class="section"><h2>Follow-ups</h2><p role="alert">You do not have permission to view follow-ups.</p></section>`;
        return;
    }

    LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.loading = true;
    LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.error = "";
    appContent.innerHTML = `<section class="section"><h2>Follow-ups</h2><p role="status">Loading follow-ups…</p></section>`;

    try {
        const [followupsResult, staffResult] = await Promise.all([
            lordblessSupabase
                .from("portal_followups")
                .select("*")
                .order("due_date", { ascending: true }),
            lordblessSupabase
                .from("staff_profiles")
                .select("user_id, display_name")
                .eq("active", true)
                .order("display_name", { ascending: true })
        ]);

        if (followupsResult.error) throw followupsResult.error;
        if (staffResult.error && state.adminIdentity?.isOverallAdmin) throw staffResult.error;

        LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.records = followupsResult.data || [];
        LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.assignees = staffResult.error
            ? [{ user_id: state.adminIdentity?.id, display_name: state.adminIdentity?.displayName || "Me" }]
            : staffResult.data || [];
    } catch (error) {
        LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.error = error?.message || String(error);
    } finally {
        LORDBLESS_FOLLOWUPS_WORKSPACE_STATE.loading = false;
    }

    renderFollowupsWorkspaceContent(canWrite);
}


function renderFollowupsWorkspaceContent(canWrite) {
    const workspace = LORDBLESS_FOLLOWUPS_WORKSPACE_STATE;
    const clients = typeof getAdminClients === "function" ? getAdminClients() : [];
    const enquiries = Array.isArray(state.enquiries) ? state.enquiries : [];
    const clientById = new Map(clients.map(client => [client.id, client]));
    const assigneeById = new Map(workspace.assignees.map(person => [person.user_id, person]));
    const today = new Date().toISOString().slice(0, 10);
    const filtered = workspace.records.filter(record =>
        (workspace.status === "all" || record.status === workspace.status) &&
        (workspace.taskType === "all" || record.task_type === workspace.taskType) &&
        (workspace.assignee === "all" || record.assigned_to === workspace.assignee)
    );
    const statusOptions = ["open", "in_progress", "completed", "cancelled"];
    const typeLabels = {
        enquiry_contact: "Enquiry contact",
        payment_reminder: "Payment reminder",
        missing_document: "Missing document",
        consultation: "Consultation",
        client_decision: "Client decision",
        other: "Other"
    };

    appContent.innerHTML = `
        <section class="section">
            <div class="section-header"><div><p class="section-eyebrow">CLIENT TASKS</p><h2>Follow-ups</h2><p class="section-subtitle">Track client and enquiry follow-ups, assignees and due dates.</p></div></div>
            ${workspace.error ? `<p role="alert">Follow-ups could not be loaded: ${escapeHTML(workspace.error)}</p>` : ""}
            <div class="toolbar">
                <select class="filter-select" data-followup-filter="status" aria-label="Filter follow-ups by status">
                    <option value="all">All statuses</option>
                    ${statusOptions.map(status => `<option value="${status}" ${workspace.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}
                </select>
                <select class="filter-select" data-followup-filter="type" aria-label="Filter follow-ups by type">
                    <option value="all">All types</option>
                    ${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}" ${workspace.taskType === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>
                <select class="filter-select" data-followup-filter="assignee" aria-label="Filter follow-ups by assignee">
                    <option value="all">All assignees</option>
                    ${workspace.assignees.map(person => `<option value="${escapeHTML(person.user_id)}" ${workspace.assignee === person.user_id ? "selected" : ""}>${escapeHTML(person.display_name || "Team member")}</option>`).join("")}
                </select>
            </div>
            <div class="table-wrapper"><table class="enquiry-table"><thead><tr><th>Due</th><th>Client</th><th>Type / Notes</th><th>Priority</th><th>Assignee</th><th>Status</th></tr></thead><tbody>
                ${filtered.length ? filtered.map(record => {
                    const client = clientById.get(record.client_id);
                    const overdue = record.due_date < today && !["completed", "cancelled"].includes(record.status);
                    return `<tr><td>${escapeHTML(record.due_date)}${overdue ? `<br><strong>Overdue</strong>` : ""}</td><td>${escapeHTML(client?.fullName || client?.name || getAdminClientDisplayId(client || { id: record.client_id }))}</td><td>${escapeHTML(typeLabels[record.task_type] || record.task_type)}<br>${escapeHTML(record.notes || "")}</td><td>${escapeHTML(record.priority)}</td><td>${escapeHTML(assigneeById.get(record.assigned_to)?.display_name || "Unassigned")}</td><td><select class="filter-select" data-followup-status="${escapeHTML(record.id)}" ${canWrite ? "" : "disabled"}>${statusOptions.map(status => `<option value="${status}" ${record.status === status ? "selected" : ""}>${status.replace("_", " ")}</option>`).join("")}</select></td></tr>`;
                }).join("") : `<tr><td colspan="6">No follow-ups match these filters.</td></tr>`}
            </tbody></table></div>
            ${canWrite ? `
                <section class="detail-card full-width">
                    <h3>Create follow-up</h3>
                    <form data-followup-create class="followup-composer">
                        <label>Client<select name="client_id" required><option value="">Select client</option>${clients.map(client => `<option value="${escapeHTML(client.id)}">${escapeHTML(client.fullName || client.name || getAdminClientDisplayId(client))}</option>`).join("")}</select></label>
                        <label>Related enquiry<select name="enquiry_id"><option value="">Client-level task</option>${enquiries.map(enquiry => `<option value="${escapeHTML(enquiry.id)}" data-client-id="${escapeHTML(enquiry.client?.id || enquiry.client_id || "")}">${escapeHTML(enquiry.reference || "Enquiry")}</option>`).join("")}</select></label>
                        <label>Assignee<select name="assigned_to"><option value="">Unassigned</option>${workspace.assignees.map(person => `<option value="${escapeHTML(person.user_id)}">${escapeHTML(person.display_name || "Team member")}</option>`).join("")}</select></label>
                        <label>Due date<input type="date" name="due_date" required></label>
                        <label>Priority<select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                        <label>Type<select name="task_type" required>${Object.entries(typeLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
                        <label>Notes<textarea name="notes" rows="3" required></textarea></label>
                        <button class="button button-primary" type="submit">Create Follow-up</button>
                        <p data-followup-message role="status" aria-live="polite"></p>
                    </form>
                </section>
            ` : ""}
        </section>
    `;

    appContent.querySelectorAll("[data-followup-filter]").forEach(select => {
        select.addEventListener("change", () => {
            if (select.dataset.followupFilter === "status") workspace.status = select.value;
            if (select.dataset.followupFilter === "type") workspace.taskType = select.value;
            if (select.dataset.followupFilter === "assignee") workspace.assignee = select.value;
            renderFollowupsWorkspaceContent(canWrite);
        });
    });

    appContent.querySelectorAll("[data-followup-status]").forEach(select => {
        select.addEventListener("change", async () => {
            select.disabled = true;
            const status = select.value;
            const update = await lordblessSupabase
                .from("portal_followups")
                .update({ status, completed_at: status === "completed" ? new Date().toISOString() : null })
                .eq("id", select.dataset.followupStatus);
            if (update.error) {
                alert(update.error.message || "Unable to update follow-up status.");
                select.disabled = false;
                return;
            }
            const record = workspace.records.find(item => item.id === select.dataset.followupStatus);
            if (record) invalidateEnquiryFollowupCache(record.client_id);
            void renderFollowupsWorkspace();
        });
    });

    const createForm = appContent.querySelector("[data-followup-create]");
    createForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const formData = new FormData(createForm);
        const message = createForm.querySelector("[data-followup-message]");
        const clientId = String(formData.get("client_id") || "");
        const enquiryId = String(formData.get("enquiry_id") || "");
        const enquiry = enquiries.find(item => item.id === enquiryId);
        if (enquiry && String(enquiry.client?.id || enquiry.client_id || "") !== clientId) {
            if (message) message.textContent = "Choose an enquiry belonging to the selected client.";
            return;
        }

        const payload = {
            client_id: clientId,
            enquiry_id: enquiryId || null,
            assigned_to: String(formData.get("assigned_to") || "") || null,
            created_by: state.adminIdentity?.id,
            due_date: String(formData.get("due_date") || ""),
            priority: String(formData.get("priority") || "normal"),
            task_type: String(formData.get("task_type") || "other"),
            notes: String(formData.get("notes") || "").trim()
        };

        const result = await lordblessSupabase.from("portal_followups").insert(payload);
        if (result.error) {
            if (message) message.textContent = result.error.message || "Unable to create follow-up.";
            return;
        }
        invalidateEnquiryFollowupCache(clientId);
        if (message) message.textContent = "Follow-up created.";
        void renderFollowupsWorkspace();
    });
}
