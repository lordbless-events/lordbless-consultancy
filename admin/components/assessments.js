/* =========================================================
   INTERNAL ADMINISTRATIVE ASSESSMENT DECISIONS
   ========================================================= */
(function () {
    "use strict";

    const state = {
        container: null,
        records: [],
        selectedClientId: null,
        selectedEnquiryId: null,
        filters: { search: "", desk: "", service: "", status: "", decision: "" },
        notesSaving: false,
        reopening: false,
        history: [],
        historyError: "",
        reviewDetails: null,
        reviewLoading: false,
        loading: false,
        saving: false,
        error: "",
        message: "",
        historyLoading: false
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
        const serviceText = serviceLabels.join(" ").toLowerCase();
        const category = serviceText.includes("career") ? "careers"
            : serviceText.includes("travel") || serviceText.includes("tourism") ? "travel"
                : serviceText.includes("business") ? "business"
                    : serviceText.includes("mobility") ? "mobility"
                        : serviceText.includes("education") || enquiry.is_education ? "education" : "general";
        const fields = [category, "details"];
        const details = fields
            .map(key => {
                const text = displayValue(enquiry[key]);
                return text ? `${key[0].toUpperCase()}${key.slice(1)}: ${text}` : "";
            })
            .filter(Boolean)
            .slice(0, 5);
        return `${serviceLabels.length ? `<strong>Services:</strong> ${escape(serviceLabels.join(", "))}<br>` : ""}${details.map(escape).join("<br>") || "Service details were not supplied."}`;
    }

    function renderEnquiryCards(record, selectedEnquiryId) {
        const enquiries = Array.isArray(record?.enquiries) ? record.enquiries : [];
        if (!enquiries.length) return `<article class="detail-card full-width"><h3>Original Enquiry</h3><p class="section-subtitle">No linked enquiry details are available.</p></article>`;
        return enquiries.map(item => `<article class="detail-card full-width">
            <h3>${item.is_education && String(item.id) === String(selectedEnquiryId) ? "Selected Education Enquiry" : "Original Enquiry"} ${escape(item.reference || "reference unavailable")}</h3>
            <div class="detail-row"><span>Received</span><strong>${escape(formatDate(item.created_at))}</strong></div>
            <div class="assessment-enquiry-details">${enquirySummary(item)}</div>
            ${item.is_education && String(item.id) !== String(selectedEnquiryId) ? `<button type="button" class="button button-secondary" data-assessment-select-enquiry="${escape(item.id)}">Open this Education assessment</button>` : ""}
        </article>`).join("");
    }

    function getSelectedRecord() {
        return state.records.find(record => String(record.client_id) === String(state.selectedClientId)) || null;
    }

    function getSelectedEnquiry(record = getSelectedRecord()) {
        return (Array.isArray(record?.enquiries) ? record.enquiries : [])
            .find(item => String(item.id) === String(state.selectedEnquiryId)) || null;
    }

    function assessmentRows() {
        return state.records.flatMap(record => {
            const enquiries = (Array.isArray(record.enquiries) ? record.enquiries : []).filter(item => item.is_education);
            if (enquiries.length) return enquiries.map(enquiry => ({ record, enquiry, assessment: enquiry.client_assessment || {} }));
            const enquiry = (Array.isArray(record.enquiries) ? record.enquiries : [])[0] || null;
            return [{ record, enquiry, assessment: { status: "not_started" } }];
        });
    }

    function questionnaireLabel(value) {
        return ({ awaiting_payment: "Awaiting Payment", ready_to_begin: "Ready to Begin", in_progress: "In Progress", submitted: "Submitted", under_review: "Under Review", clarification_required: "Clarification Required", assessment_completed: "Assessment Completed" })[value] || "Not started";
    }

    function serviceLabel(enquiry) {
        const labels = asArray(enquiry?.services).map(displayValue).filter(Boolean);
        if (labels.length) return labels.join(", ");
        return enquiry?.education ? "Education" : enquiry?.careers ? "Careers" : enquiry?.travel ? "Travel" : enquiry?.business ? "Business" : "Consultancy service";
    }

    function destination(enquiry) {
        const services = asArray(enquiry?.services).map(displayValue).join(" ").toLowerCase();
        const category = services.includes("career") ? "careers" : services.includes("travel") ? "travel" : services.includes("business") ? "business" : services.includes("mobility") ? "mobility" : "education";
        return displayValue(enquiry?.[category]?.destination || enquiry?.education?.destination || enquiry?.destination) || "—";
    }

    function clientCode(record) {
        return String(record?.client_code || "").trim() || "Client ID unavailable";
    }

    function answerSections(responses) {
        const labels = {
            goals: ["Education Goals", { highest_qualification: "Highest academic qualification", field_of_study: "Field of study", pathway: "Intended pathway", destination: "Preferred destination", programme: "Course or programme", open_alternatives: "Open to alternatives", pathway_subject: "Intended subject", postgraduate_area: "Postgraduate study area", research_area: "Research area", occupation: "Preferred occupation", german_level: "German language level", language_certificate: "Language certificate", healthcare_training: "Previous healthcare training", healthcare_profession: "Healthcare profession", current_language_level: "Current language level", target_language_level: "Target language level", professional_field: "Professional field", participation_mode: "Participation preference" }],
            financial: ["Financial Preparation", { funding_source: "Funding source", employment_status: "Employment status", financial_preparation: "Financial preparation", budget_not_determined: "Budget", budget_amount: "Estimated overall budget", budget_currency: "Budget currency", destination_finances: "Destination financial preparation", blocked_account: "Blocked account readiness", consultancy_readiness: "Consultancy services readiness" }],
            readiness: ["Preparing for Your Journey", { start_timing: "Intended start", passport_status: "International passport", certificates_status: "Academic certificates", support_needed: "Consultation topics", additional_context: "Additional information" }]
        };
        return Object.entries(labels).map(([group, [heading, keys]]) => {
            const values = Object.entries(responses?.[group] || {}).map(([key, value]) => {
                if (value === "" || value === null || value === undefined || value === false) return "";
                const display = key === "budget_not_determined" ? "Not yet determined" : key === "budget_amount" ? `${value} ${responses?.financial?.budget_currency || ""}`.trim() : displayValue(value);
                return `<div class="assessment-answer-row"><span>${escape(keys[key] || key.replaceAll("_", " "))}</span><strong>${escape(display)}</strong></div>`;
            }).filter(Boolean).join("");
            return `<article class="detail-card assessment-answer-group"><h4>${escape(heading)}</h4>${values || `<p class="section-subtitle">No answers in this section.</p>`}</article>`;
        }).join("");
    }

    function renderQueue() {
        const allRows = assessmentRows();
        const deskOptions = [...new Set(allRows.flatMap(({ enquiry }) => asArray(enquiry?.desk_names).map(displayValue)).filter(Boolean))].sort();
        const serviceOptions = [...new Set(allRows.map(({ enquiry }) => serviceLabel(enquiry)))].sort();
        const statusOptions = [...new Set(allRows.map(({ assessment }) => assessment.status || "awaiting_payment"))].sort();
        const filters = state.filters;
        const rowsData = allRows.filter(({ record, enquiry, assessment }) => {
            const query = filters.search.toLowerCase();
            return (!query || `${record.client_name || ""} ${record.client_code || ""}`.toLowerCase().includes(query)) &&
                (!filters.desk || asArray(enquiry?.desk_names).map(displayValue).includes(filters.desk)) &&
                (!filters.service || serviceLabel(enquiry) === filters.service) &&
                (!filters.status || (assessment.status || "awaiting_payment") === filters.status) &&
                (!filters.decision || (record.decision || "awaiting") === filters.decision);
        });
        const rows = rowsData.map(({ record, enquiry, assessment }) => `<tr>
            <td><strong>${escape(record.client_name || "Client")}</strong><br><small>${escape(clientCode(record))}</small></td>
            <td>${escape(serviceLabel(enquiry))}<br><small>${escape(destination(enquiry))}</small></td>
            <td>${escape(asArray(enquiry?.desk_names).map(displayValue).join(", ") || "Unassigned")}</td>
            <td>${escape(questionnaireLabel(assessment.status || "awaiting_payment"))}<br><small>${escape(enquiry?.reference || "Enquiry")}</small></td>
            <td><strong>${escape(decisionLabel(record.decision))}</strong></td>
            <td>${escape(formatDate(assessment.submitted_at || assessment.updated_at || enquiry?.created_at || record.updated_at))}</td>
            <td><button type="button" class="button button-secondary" data-assessment-open="${escape(record.client_id)}" data-assessment-enquiry="${escape(enquiry?.id || "")}">${["submitted", "under_review"].includes(assessment.status) ? "Review Assessment" : record.decision ? "Review decision" : "Assess client"}</button></td>
        </tr>`).join("");
        const clients = new Map(allRows.map(item => [String(item.record.client_id), item.record]));
        const applicableRows = allRows.filter(({ enquiry }) => enquiry?.is_education);
        const educationClientIds = new Set(applicableRows.map(({ record }) => String(record.client_id)));
        const outcomeCount = outcome => [...clients.values()].filter(record => educationClientIds.has(String(record.client_id)) && record.decision === outcome).length;
        const stats = [
            ["Applicable Education assessments", applicableRows.length],
            ["Awaiting client submission", applicableRows.filter(({ assessment }) => !["submitted", "under_review", "assessment_completed"].includes(assessment.status)).length],
            ["Submitted / under review", applicableRows.filter(({ assessment }) => ["submitted", "under_review", "clarification_required"].includes(assessment.status)).length],
            ["Approved", outcomeCount("approved")], ["On Hold", outcomeCount("on_hold")], ["Rejected", outcomeCount("rejected")]
        ].map(([label, count]) => `<article class="assessment-stat-card"><span>${escape(label)}</span><strong>${count}</strong></article>`).join("");
        state.container.innerHTML = `<section class="section assessment-workspace">
            <div class="section-header"><div><p class="section-eyebrow">INTERNAL ADMINISTRATION</p><h2 class="section-title">Assessments</h2><p class="section-subtitle">Review client-submitted Education assessments, consultation findings and the existing professional decision.</p></div><button type="button" class="button button-secondary" data-assessment-refresh ${state.loading ? "disabled" : ""}>Refresh</button></div>
            ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}${state.loading ? '<p class="section-subtitle" role="status">Loading assessment records…</p>' : ""}${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
            ${allRows.length ? `<div class="assessment-stats-grid">${stats}</div><div class="assessment-filters">
                <label>Search client<input type="search" data-filter="search" placeholder="Name or permanent Client ID" value="${escape(filters.search)}"></label>
                <label>Desk<select data-filter="desk"><option value="">All desks</option>${deskOptions.map(value => `<option value="${escape(value)}" ${value === filters.desk ? "selected" : ""}>${escape(value)}</option>`).join("")}</select></label>
                <label>Service<select data-filter="service"><option value="">All services</option>${serviceOptions.map(value => `<option value="${escape(value)}" ${value === filters.service ? "selected" : ""}>${escape(value)}</option>`).join("")}</select></label>
                <label>Questionnaire<select data-filter="status"><option value="">All statuses</option>${statusOptions.map(value => `<option value="${escape(value)}" ${value === filters.status ? "selected" : ""}>${escape(questionnaireLabel(value))}</option>`).join("")}</select></label>
                <label>Decision<select data-filter="decision"><option value="">All decisions</option><option value="awaiting" ${filters.decision === "awaiting" ? "selected" : ""}>Awaiting assessment</option><option value="approved" ${filters.decision === "approved" ? "selected" : ""}>Approved</option><option value="on_hold" ${filters.decision === "on_hold" ? "selected" : ""}>On Hold</option><option value="rejected" ${filters.decision === "rejected" ? "selected" : ""}>Rejected</option></select></label>
            </div>` : ""}
            ${!state.loading && !state.error && !allRows.length ? '<div class="empty-state"><div class="empty-state-title">No applicable assessments</div><div class="empty-state-text">Education enquiries and existing assessment decisions will appear here.</div></div>' : ""}
            ${rowsData.length ? `<div class="table-wrapper"><table class="enquiry-table"><thead><tr><th>Client</th><th>Service / destination</th><th>Assigned desk</th><th>Client questionnaire</th><th>Professional decision</th><th>Submitted / updated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : allRows.length ? '<p class="section-subtitle">No assessments match these filters.</p>' : ""}
        </section>`;
        state.container.querySelector("[data-assessment-refresh]")?.addEventListener("click", () => void loadQueue());
        state.container.querySelectorAll("[data-filter]").forEach(control => control.addEventListener(control.type === "search" ? "input" : "change", () => { state.filters[control.dataset.filter] = control.value; renderQueue(); }));
        state.container.querySelectorAll("[data-assessment-open]").forEach(button => button.addEventListener("click", () => void openReview(button.dataset.assessmentOpen, button.dataset.assessmentEnquiry)));
    }

    function renderReview() {
        const record = getSelectedRecord();
        if (!record) { state.selectedClientId = null; state.selectedEnquiryId = null; renderQueue(); return; }
        const enquiry = getSelectedEnquiry(record);
        const queueAssessment = enquiry?.client_assessment || {};
        const assessment = state.reviewDetails?.assessment || queueAssessment;
        const historyMarkup = state.history.length ? state.history.map(item => `<article class="detail-card full-width"><h4>${escape(decisionLabel(item.decision))}${item.previous_decision ? ` (revised from ${escape(decisionLabel(item.previous_decision))})` : " (initial decision)"}</h4>${item.previous_reason ? `<p><strong>Previous reason:</strong> ${escape(item.previous_reason)}</p>` : ""}${item.previous_comments ? `<p><strong>Previous comments:</strong> ${escape(item.previous_comments)}</p>` : ""}${item.assessment_reason ? `<p><strong>Decision reason:</strong> ${escape(item.assessment_reason)}</p>` : ""}${item.admin_comments ? `<p><strong>Administrator comments:</strong> ${escape(item.admin_comments)}</p>` : ""}<p class="section-subtitle">${escape(item.reviewer_name)} · ${escape(formatDate(item.changed_at))}</p></article>`).join("") : `<p class="section-subtitle">${escape(state.historyError || "No decision history recorded yet.")}</p>`;
        const notes = state.reviewDetails?.consultation_notes || {};
        const noteFields = [
            ["academic_findings", "Academic assessment findings", "textarea"], ["language_readiness", "Language readiness", "text"],
            ["financial_readiness", "Financial readiness", "text"], ["consultation_notes", "Consultation notes", "textarea"],
            ["recommended_destination", "Recommended destination", "select"], ["recommended_pathway", "Recommended pathway", "select"],
            ["preparation_requirements", "Preparation requirements", "textarea"], ["recommended_next_action", "Recommended next action", "textarea"]
        ];
        const destinations = ["Germany", "Canada", "United States", "United Kingdom", "Ireland", "Australia", "New Zealand", "Other"];
        const pathways = ["Bachelor's Degree", "Master's Degree", "PhD", "General Ausbildung", "Nursing Ausbildung", "Specialist Healthcare Education", "Language and Academic Preparation", "International Conferences and Professional Development", "Other"];
        const notesForm = noteFields.map(([key, label, type]) => {
            const value = notes[key] || "";
            if (type === "select") {
                const choices = key === "recommended_destination" ? destinations : pathways;
                return `<label>${escape(label)}<select data-note="${key}"><option value="">Not selected</option>${choices.map(choice => `<option value="${escape(choice)}" ${choice === value ? "selected" : ""}>${escape(choice)}</option>`).join("")}</select></label>`;
            }
            return `<label>${escape(label)}${type === "textarea" ? `<textarea data-note="${key}" rows="3" maxlength="4000">${escape(value)}</textarea>` : `<input data-note="${key}" maxlength="250" value="${escape(value)}">`}</label>`;
        }).join("");
        const answerHistory = Array.isArray(state.reviewDetails?.submission_history) ? state.reviewDetails.submission_history : [];
        const previousSubmissions = answerHistory.length > 1 ? `<details class="assessment-submission-history"><summary>Previous submitted versions (${answerHistory.length - 1})</summary>${answerHistory.slice(1).map(item => `<div class="assessment-submission-version"><strong>Submission ${Number(item.revision) || ""} · ${escape(formatDate(item.submitted_at))}</strong><div class="assessment-answer-grid">${answerSections(item.responses || {})}</div></div>`).join("")}</details>` : "";
        const canEditNotes = canWrite();
        const clientAssessment = state.reviewLoading
            ? '<section class="detail-card full-width"><p class="section-subtitle" role="status">Loading client assessment details…</p></section>'
            : assessment.id
                ? `<section class="detail-card full-width"><div class="section-header"><div><h3>Client-submitted Assessment</h3><p class="section-subtitle">${escape(questionnaireLabel(assessment.status))} · ${assessment.submitted_at ? `Submitted ${escape(formatDate(assessment.submitted_at))}` : "Not submitted"}</p></div>${(state.reviewDetails?.payment_authorized ?? queueAssessment.payment_authorized) ? '<span class="assessment-authorization is-authorized">Consultation payment verified</span>' : '<span class="assessment-authorization">Awaiting verified consultation payment</span>'}</div><div class="assessment-answer-grid">${answerSections(assessment.responses || {})}</div>${previousSubmissions}</section>`
                : `<section class="detail-card full-width"><h3>Client-submitted Assessment</h3><p class="section-subtitle">${escape(questionnaireLabel(assessment.status || (enquiry?.is_education ? "awaiting_payment" : "not_started")))}${enquiry?.is_education && !(state.reviewDetails?.payment_authorized ?? queueAssessment.payment_authorized) ? " · Available after the existing initial consultation payment is verified." : ""}</p></section>`;
        const enquiryCards = renderEnquiryCards(record, enquiry?.id);
        const deskNames = asArray(enquiry?.desk_names).map(displayValue).join(", ") || "Unassigned";
        state.container.innerHTML = `<section class="section assessment-workspace">
            <div class="section-header"><div><p class="section-eyebrow">ASSESSMENT REVIEW</p><h2 class="section-title">${escape(record.client_name || "Client")}</h2><p class="section-subtitle">Client ID: ${escape(clientCode(record))} · ${escape(serviceLabel(enquiry))} · ${escape(destination(enquiry))}</p></div><button type="button" class="button button-secondary" data-assessment-back>Back to queue</button></div>
            ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
            <section class="detail-card full-width"><h3>Client Summary</h3><div class="detail-row"><span>Assigned desk</span><strong>${escape(deskNames)}</strong></div><div class="detail-row"><span>Assigned officer</span><strong>Not individually assigned in the current desk structure</strong></div><div class="detail-row"><span>Assessment status</span><strong>${escape(questionnaireLabel(assessment.status || (enquiry?.is_education ? "awaiting_payment" : "not_started")))}</strong></div><div class="detail-row"><span>Assessment authorisation</span><strong>${!enquiry?.is_education ? "Not applicable to this service" : assessment.payment_authorized ? "Initial consultation payment verified" : "Payment verification pending"}</strong></div></section>
            <section class="assessment-original-enquiries"><h3>Original Enquiries</h3><div class="detail-grid">${enquiryCards}</div></section>${clientAssessment}
            <section class="detail-card full-width"><div class="section-header"><div><h3>Internal Consultation and Assessment Notes</h3><p class="section-subtitle">Staff-only working notes. Saving these notes does not record or change a decision.</p></div></div>${state.reviewLoading ? '<p class="section-subtitle" role="status">Loading consultation notes…</p>' : canEditNotes && enquiry?.is_education ? `<form data-assessment-notes><div class="assessment-notes-grid">${notesForm}</div><button type="button" class="button button-primary" data-assessment-save-notes ${state.notesSaving ? "disabled" : ""}>Save Consultation Notes</button></form>` : `<p class="section-subtitle">${enquiry?.is_education ? (state.reviewDetails ? "You can view notes but do not have permission to edit them." : "Consultation notes could not be loaded.") : "Consultation notes are available for Education enquiries."}</p>${Object.entries(notes).filter(([, value]) => value).map(([key, value]) => `<div class="detail-row"><span>${escape(key.replaceAll("_", " "))}</span><strong>${escape(value)}</strong></div>`).join("")}`}</section>
            ${assessment.id && canWrite() && ["submitted", "under_review", "assessment_completed"].includes(assessment.status) ? `<button type="button" class="button button-secondary" data-assessment-reopen ${state.reopening ? "disabled" : ""}>Request Client Clarification</button>` : ""}
            <section class="detail-card full-width"><h3>Current Professional Decision</h3><p class="section-subtitle">This existing decision is recorded at the client level and remains separate from the questionnaire status.</p><div class="detail-row"><span>Outcome</span><strong>${escape(decisionLabel(record.decision))}</strong></div>${record.assessment_reason ? `<div class="detail-row"><span>Reason</span><strong>${escape(record.assessment_reason)}</strong></div>` : ""}${record.admin_comments ? `<div class="detail-row"><span>Administrator comments</span><strong>${escape(record.admin_comments)}</strong></div>` : ""}<div class="detail-row"><span>Reviewer</span><strong>${escape(record.reviewer_name || "—")}</strong></div><div class="detail-row"><span>Decision time</span><strong>${escape(formatDate(record.reviewed_at))}</strong></div></section>
            ${canWrite() ? `<section class="detail-card full-width"><h3>${record.decision ? "Revise assessment decision" : "Record assessment decision"}</h3><form data-assessment-form><label>Assessment reason<textarea name="assessment_reason" rows="4" maxlength="4000" placeholder="Required for On Hold or Reject">${escape(record.assessment_reason || "")}</textarea></label><label>Administrator comments<textarea name="admin_comments" rows="4" maxlength="8000">${escape(record.admin_comments || "")}</textarea></label><p class="section-subtitle">On Hold and Reject require a reason.</p><div class="assessment-decision-actions"><button type="button" class="button button-primary" data-assessment-save="approved" ${state.saving ? "disabled" : ""}>Approve</button><button type="button" class="button button-secondary" data-assessment-save="on_hold" ${state.saving ? "disabled" : ""}>On Hold</button><button type="button" class="button button-secondary" data-assessment-save="rejected" ${state.saving ? "disabled" : ""}>Reject</button></div></form></section>` : '<p class="section-subtitle">You can view this assessment but do not have permission to record or revise decisions.</p>'}
            <section class="section"><h3>Decision History</h3>${state.historyLoading ? '<p class="section-subtitle" role="status">Loading decision history…</p>' : `<div class="detail-grid">${historyMarkup}</div>`}</section></section>`;
        state.container.querySelector("[data-assessment-back]")?.addEventListener("click", () => { state.selectedClientId = null; state.selectedEnquiryId = null; state.error = ""; state.message = ""; renderQueue(); });
        state.container.querySelectorAll("[data-assessment-save]").forEach(button => button.addEventListener("click", () => void saveDecision(button.dataset.assessmentSave)));
        state.container.querySelector("[data-assessment-save-notes]")?.addEventListener("click", () => void saveConsultationNotes());
        state.container.querySelector("[data-assessment-reopen]")?.addEventListener("click", () => void reopenForClarification());
        state.container.querySelectorAll("[data-assessment-select-enquiry]").forEach(button => button.addEventListener("click", () => void openReview(state.selectedClientId, button.dataset.assessmentSelectEnquiry)));
    }

    async function openReview(clientId, enquiryId) {
        state.selectedClientId = clientId;
        state.selectedEnquiryId = enquiryId || "";
        state.reviewDetails = null;
        state.reviewLoading = Boolean(enquiryId);
        state.history = [];
        state.historyError = "";
        state.error = "";
        state.message = "";
        renderReview();
        const enquiry = getSelectedEnquiry();
        if (canWrite() && enquiry?.client_assessment?.id && enquiry.client_assessment.status === "submitted") {
            const { error } = await lordblessSupabase.rpc("mark_client_assessment_under_review", { p_assessment_id: enquiry.client_assessment.id });
            if (error) state.error = error.message || "Assessment review status could not be updated.";
            else await loadQueue();
        }
        await loadAssessmentReview(enquiryId);
        await loadHistory(clientId);
    }

    async function loadAssessmentReview(enquiryId) {
        if (!enquiryId || !getSelectedEnquiry()?.is_education) {
            state.reviewDetails = null;
            state.reviewLoading = false;
            return;
        }
        state.reviewLoading = true;
        renderReview();
        try {
            const { data, error } = await lordblessSupabase.rpc("get_client_assessment_review", { p_enquiry_id: enquiryId });
            if (error) throw error;
            state.reviewDetails = data || null;
            if (!state.reviewDetails) throw new Error("The assessment review details were not returned.");
        } catch (error) {
            state.reviewDetails = null;
            state.error = error?.message || "Client assessment details could not be loaded.";
        } finally {
            state.reviewLoading = false;
            renderReview();
        }
    }

    async function saveConsultationNotes() {
        if (!canWrite() || state.notesSaving) return;
        const enquiry = getSelectedEnquiry();
        if (!enquiry?.is_education) return;
        const form = state.container.querySelector("[data-assessment-notes]");
        const notes = Object.fromEntries([...form.querySelectorAll("[data-note]")].map(input => [input.dataset.note, input.value.trim()]));
        state.notesSaving = true;
        try {
            const { error } = await lordblessSupabase.rpc("save_client_assessment_consultation_notes", { p_enquiry_id: enquiry.id, p_notes: notes });
            if (error) throw error;
            state.message = "Consultation notes saved.";
            await loadQueue();
            await loadAssessmentReview(state.selectedEnquiryId);
        } catch (error) { state.error = formatSaveError(error); }
        finally { state.notesSaving = false; renderReview(); }
    }

    async function reopenForClarification() {
        if (!canWrite() || state.reopening) return;
        const assessment = getSelectedEnquiry()?.client_assessment;
        if (!assessment?.id) return;
        state.reopening = true;
        try {
            const { error } = await lordblessSupabase.rpc("reopen_client_assessment_for_clarification", { p_assessment_id: assessment.id });
            if (error) throw error;
            state.message = "The client can now update and resubmit this assessment. Previous submissions are preserved.";
            await loadQueue();
            await loadAssessmentReview(state.selectedEnquiryId);
        } catch (error) { state.error = formatSaveError(error); }
        finally { state.reopening = false; renderReview(); }
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
            await loadAssessmentReview(state.selectedEnquiryId);
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
        state.selectedEnquiryId = null;
        state.reviewDetails = null;
        state.reviewLoading = false;
        state.history = [];
        state.historyError = "";
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
