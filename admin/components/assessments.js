/* =========================================================
   INTERNAL ADMINISTRATIVE ASSESSMENT DECISIONS
   ========================================================= */
(function () {
    "use strict";

    const state = {
        container: null,
        records: [],
        selectedClientId: null,
        history: [],
        loading: false,
        saving: false,
        error: "",
        message: ""
    };

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
        })[character]);
    }

    function canRead() {
        return typeof hasPermission === "function" &&
            hasPermission(getCurrentUser(), "applications.read");
    }

    function canWrite() {
        return typeof hasPermission === "function" &&
            hasPermission(getCurrentUser(), "applications.write");
    }

    function formatDate(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? "—"
            : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    function decisionLabel(value) {
        return ({ approved: "Approved", on_hold: "On Hold", rejected: "Rejected" })[value] || "Awaiting assessment";
    }

    function formatSaveError(error) {
        if (!error || typeof error !== "object") {
            return String(error || "The assessment decision could not be saved.");
        }

        const parts = [error.message, error.code && `Code: ${error.code}`, error.details, error.hint && `Hint: ${error.hint}`]
            .filter(Boolean);
        return parts.join(" · ") || "The assessment decision could not be saved.";
    }

    function asArray(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : value ? [value] : [];
            } catch {
                return value ? [value] : [];
            }
        }
        return value ? [value] : [];
    }

    function displayValue(value, depth = 0) {
        if (value === null || value === undefined || depth > 2) return "";
        if (Array.isArray(value)) return value.map(item => displayValue(item, depth + 1)).filter(Boolean).join(", ");
        if (typeof value === "object") {
            return Object.entries(value)
                .map(([key, item]) => {
                    const text = displayValue(item, depth + 1);
                    return text ? `${key.replaceAll("_", " ")}: ${text}` : "";
                })
                .filter(Boolean)
                .slice(0, 8)
                .join(" · ");
        }
        return String(value).trim();
    }

    function enquirySummary(enquiry) {
        const serviceLabels = asArray(enquiry.services).map(displayValue).filter(Boolean);
        const fields = ["education", "careers", "travel", "business", "mobility", "general", "details"];
        const details = fields
            .map(key => {
                const text = displayValue(enquiry[key]);
                return text ? `${key[0].toUpperCase()}${key.slice(1)}: ${text}` : "";
            })
            .filter(Boolean)
            .slice(0, 5);
        return `${serviceLabels.length ? `<strong>Services:</strong> ${escape(serviceLabels.join(", "))}<br>` : ""}${details.map(escape).join("<br>") || "Service details were not supplied."}`;
    }

    function getSelectedRecord() {
        return state.records.find(record => String(record.client_id) === String(state.selectedClientId)) || null;
    }

    function renderQueue() {
        const rows = state.records.map(record => {
            const enquiries = Array.isArray(record.enquiries) ? record.enquiries : [];
            const refs = enquiries.map(item => item.reference).filter(Boolean);
            const services = [...new Set(enquiries.flatMap(item => asArray(item.services).map(displayValue)).filter(Boolean))];
            return `<tr>
                <td><strong>${escape(record.client_name || "Client")}</strong><br><small>${escape(record.client_code || record.client_id)}</small></td>
                <td>${escape(refs.join(", ") || "—")}</td>
                <td>${escape(services.join(", ") || "—")}</td>
                <td><strong>${escape(decisionLabel(record.decision))}</strong></td>
                <td>${escape(record.reviewer_name || "—")}<br><small>${escape(formatDate(record.reviewed_at))}</small></td>
                <td><button type="button" class="button button-secondary" data-assessment-open="${escape(record.client_id)}">${record.decision ? "Review decision" : "Assess client"}</button></td>
            </tr>`;
        }).join("");

        state.container.innerHTML = `
            <section class="section assessment-workspace">
                <div class="section-header">
                    <div>
                        <p class="section-eyebrow">INTERNAL ADMINISTRATION</p>
                        <h2 class="section-title">Assessments</h2>
                        <p class="section-subtitle">Review client enquiry information and record an internal assessment decision.</p>
                    </div>
                    <button type="button" class="button button-secondary" data-assessment-refresh ${state.loading ? "disabled" : ""}>Refresh</button>
                </div>
                ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}
                ${state.loading ? `<p class="section-subtitle" role="status">Loading assessment records…</p>` : ""}
                ${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
                ${!state.loading && !state.error && !state.records.length ? `<div class="empty-state"><div class="empty-state-title">No assessment records</div><div class="empty-state-text">Clients with submitted enquiries will appear here.</div></div>` : ""}
                ${state.records.length ? `<div class="table-wrapper"><table class="enquiry-table"><thead><tr><th>Client</th><th>Enquiry reference</th><th>Service</th><th>Current decision</th><th>Reviewer / time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
            </section>`;

        state.container.querySelector("[data-assessment-refresh]")?.addEventListener("click", () => void loadQueue());
        state.container.querySelectorAll("[data-assessment-open]").forEach(button => {
            button.addEventListener("click", () => {
                state.selectedClientId = button.dataset.assessmentOpen;
                state.history = [];
                state.message = "";
                renderReview();
                void loadHistory(state.selectedClientId);
            });
        });
    }

    function renderReview() {
        const record = getSelectedRecord();
        if (!record) {
            state.selectedClientId = null;
            renderQueue();
            return;
        }
        const enquiries = Array.isArray(record.enquiries) ? record.enquiries : [];
        const enquiryCards = enquiries.map(enquiry => `
            <article class="detail-card full-width">
                <h3>Enquiry ${escape(enquiry.reference || "reference unavailable")}</h3>
                <div class="detail-row"><span>Received</span><strong>${escape(formatDate(enquiry.created_at))}</strong></div>
                <div class="assessment-enquiry-details">${enquirySummary(enquiry)}</div>
            </article>`).join("");
        const historyMarkup = state.history.length
            ? state.history.map(item => `
                <article class="detail-card full-width">
                    <h4>${escape(decisionLabel(item.decision))}${item.previous_decision ? ` (revised from ${escape(decisionLabel(item.previous_decision))})` : " (initial decision)"}</h4>
                    ${item.previous_reason ? `<p><strong>Previous reason:</strong> ${escape(item.previous_reason)}</p>` : ""}
                    ${item.previous_comments ? `<p><strong>Previous comments:</strong> ${escape(item.previous_comments)}</p>` : ""}
                    ${item.assessment_reason ? `<p><strong>Decision reason:</strong> ${escape(item.assessment_reason)}</p>` : ""}
                    ${item.admin_comments ? `<p><strong>Administrator comments:</strong> ${escape(item.admin_comments)}</p>` : ""}
                    <p class="section-subtitle">${escape(item.reviewer_name)} · ${escape(formatDate(item.changed_at))}</p>
                </article>`).join("")
            : `<p class="section-subtitle">${state.historyError ? escape(state.historyError) : "No decision history recorded yet."}</p>`;

        state.container.innerHTML = `
            <section class="section assessment-workspace">
                <div class="section-header">
                    <div><p class="section-eyebrow">ASSESSMENT REVIEW</p><h2 class="section-title">${escape(record.client_name || "Client")}</h2><p class="section-subtitle">Client ID: ${escape(record.client_code || record.client_id)}</p></div>
                    <button type="button" class="button button-secondary" data-assessment-back>Back to queue</button>
                </div>
                ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}
                ${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
                <section class="detail-card full-width">
                    <h3>Current decision</h3>
                    <div class="detail-row"><span>Outcome</span><strong>${escape(decisionLabel(record.decision))}</strong></div>
                    ${record.assessment_reason ? `<div class="detail-row"><span>Reason</span><strong>${escape(record.assessment_reason)}</strong></div>` : ""}
                    ${record.admin_comments ? `<div class="detail-row"><span>Administrator comments</span><strong>${escape(record.admin_comments)}</strong></div>` : ""}
                    <div class="detail-row"><span>Reviewer</span><strong>${escape(record.reviewer_name || "—")}</strong></div>
                    <div class="detail-row"><span>Decision time</span><strong>${escape(formatDate(record.reviewed_at))}</strong></div>
                </section>
                <div class="detail-grid">${enquiryCards || `<article class="detail-card full-width">No linked enquiry details are available.</article>`}</div>
                ${canWrite() ? `
                    <section class="detail-card full-width">
                        <h3>${record.decision ? "Revise assessment decision" : "Record assessment decision"}</h3>
                        <form data-assessment-form>
                            <label>Assessment reason
                                <textarea name="assessment_reason" rows="4" maxlength="4000" placeholder="Required for On Hold or Reject">${escape(record.assessment_reason || "")}</textarea>
                            </label>
                            <label>Administrator comments
                                <textarea name="admin_comments" rows="4" maxlength="8000">${escape(record.admin_comments || "")}</textarea>
                            </label>
                            <p class="section-subtitle">On Hold and Reject require a reason.</p>
                            <div class="assessment-decision-actions">
                                <button type="button" class="button button-primary" data-assessment-save="approved" ${state.saving ? "disabled" : ""}>Approve</button>
                                <button type="button" class="button button-secondary" data-assessment-save="on_hold" ${state.saving ? "disabled" : ""}>On Hold</button>
                                <button type="button" class="button button-secondary" data-assessment-save="rejected" ${state.saving ? "disabled" : ""}>Reject</button>
                            </div>
                        </form>
                    </section>` : `<p class="section-subtitle">You can view this assessment but do not have permission to record or revise decisions.</p>`}
                <section class="section">
                    <h3>Decision history</h3>
                    ${state.historyLoading ? `<p class="section-subtitle" role="status">Loading decision history…</p>` : `<div class="detail-grid">${historyMarkup}</div>`}
                </section>
            </section>`;

        state.container.querySelector("[data-assessment-back]")?.addEventListener("click", () => {
            state.selectedClientId = null;
            state.error = "";
            state.message = "";
            renderQueue();
        });
        state.container.querySelectorAll("[data-assessment-save]").forEach(button => {
            button.addEventListener("click", () => void saveDecision(button.dataset.assessmentSave));
        });
    }

    async function loadQueue() {
        if (!canRead()) {
            state.error = "Assessment read permission is required.";
            renderQueue();
            return;
        }
        state.loading = true;
        state.error = "";
        renderQueue();
        try {
            const { data, error } = await lordblessSupabase.rpc("list_client_assessment_queue");
            if (error) throw error;
            state.records = Array.isArray(data) ? data : [];
        } catch (error) {
            state.records = [];
            state.error = error?.message || "Assessment records could not be loaded.";
        } finally {
            state.loading = false;
            if (state.selectedClientId) renderReview();
            else renderQueue();
        }
    }

    async function loadHistory(clientId) {
        state.historyLoading = true;
        state.historyError = "";
        renderReview();
        try {
            const { data, error } = await lordblessSupabase
                .from("client_assessment_decision_history")
                .select("id, client_id, previous_decision, decision, previous_reason, assessment_reason, previous_comments, admin_comments, reviewer_id, reviewer_name, changed_at")
                .eq("client_id", clientId)
                .order("changed_at", { ascending: false });
            if (error) throw error;
            state.history = data || [];
        } catch (error) {
            state.history = [];
            state.historyError = error?.message || "Decision history could not be loaded.";
        } finally {
            state.historyLoading = false;
            renderReview();
        }
    }

    async function saveDecision(decision) {
        if (!canWrite() || state.saving) return;
        const clientId = state.selectedClientId;
        const previousQueueRecord = getSelectedRecord();
        const form = state.container.querySelector("[data-assessment-form]");
        if (!form) return;
        const assessmentReason = form.elements.assessment_reason.value.trim();
        const adminComments = form.elements.admin_comments.value.trim();
        if (["on_hold", "rejected"].includes(decision) && !assessmentReason) {
            state.error = "Enter an assessment reason before placing the case on hold or rejecting it.";
            state.message = "";
            renderReview();
            return;
        }

        state.saving = true;
        state.error = "";
        state.message = "Saving assessment decision…";
        renderReview();
        try {
            const { data: savedDecisionId, error } = await lordblessSupabase.rpc("save_client_assessment_decision", {
                p_client_id: clientId,
                p_decision: decision,
                p_assessment_reason: assessmentReason || null,
                p_admin_comments: adminComments
            });
            if (error) throw error;
            if (!savedDecisionId) throw new Error("The saved decision was not confirmed by the database.");

            const { data: persistedDecision, error: confirmationError } = await lordblessSupabase
                .from("client_assessment_decisions")
                .select("id, client_id, decision, assessment_reason, admin_comments, reviewer_id, reviewer_name, reviewed_at, created_at, updated_at")
                .eq("id", savedDecisionId)
                .maybeSingle();
            if (confirmationError) {
                throw new Error(`The decision was submitted but could not be verified: ${confirmationError.message}`);
            }
            if (!persistedDecision) {
                throw new Error("The database did not return the saved assessment decision.");
            }

            const confirmedQueueRecord = {
                ...previousQueueRecord,
                ...persistedDecision,
                decision_id: persistedDecision.id,
                client_id: clientId
            };
            state.message = "Assessment decision saved. Previous decisions remain in history.";
            await loadQueue();
            if (!state.records.some(record => String(record.client_id) === String(clientId))) {
                state.records = [confirmedQueueRecord, ...state.records];
                state.error = state.error || "The database confirmed this decision; the refreshed queue did not return the client row. The confirmed decision is shown here.";
            }
            state.selectedClientId = clientId;
            await loadHistory(clientId);
        } catch (error) {
            state.error = formatSaveError(error);
            state.message = "";
        } finally {
            state.saving = false;
            renderReview();
        }
    }

    async function render(container) {
        state.container = container;
        state.selectedClientId = null;
        state.history = [];
        state.error = "";
        state.message = "";
        if (!canRead()) {
            container.innerHTML = `<section class="section"><div class="empty-state"><div class="empty-state-title">Access restricted</div><div class="empty-state-text">Applications read permission is required to view assessments.</div></div></section>`;
            return;
        }
        await loadQueue();
    }

    window.LORDBLESS_ASSESSMENTS = { render };
})();
