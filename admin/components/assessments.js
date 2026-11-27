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
        selectedServiceCode: null,
        filters: { search: "", desk: "", service: "", status: "", decision: "", dashboard: "" },
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
        const services = serviceLabels(enquiry);
        const categories = ["education", "careers", "travel", "business", "mobility", "general"]
            .filter(key => enquiry[key] && typeof enquiry[key] === "object");
        const values = categories.flatMap(key => Object.entries(enquiry[key] || {}).map(([field, value]) => {
            const text = displayValue(value);
            return text ? `${fieldLabel(field)}: ${text}` : "";
        })).filter(Boolean);
        if (enquiry.details) {
            const text = displayValue(enquiry.details);
            if (text) values.push(`Additional details: ${text}`);
        }
        return `${services.length ? `<strong>Service:</strong> ${escape(services.join(", "))}<br>` : ""}${values.slice(0, 12).map(escape).join("<br>") || "No additional service details were supplied."}`;
    }

    function fieldLabel(value) {
        const labels = {
            destination: "Destination", study_area: "Study area", study_level: "Study level",
            first_programme: "First programme", second_programme: "Second programme",
            preferred_intake: "Preferred intake", travel_purpose: "Travel purpose",
            travel_period: "Travel period", requested_services: "Requested services",
            business_type: "Business type", current_country: "Current country"
        };
        return labels[value] || String(value).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
    }

    function serviceLabel(enquiry) {
        const serviceSource = Array.isArray(enquiry?.services) && enquiry.services.length ? enquiry.services : enquiry?.service;
        const labels = asArray(serviceSource).map(displayValue).filter(Boolean);
        if (!labels.length) {
            if (enquiry?.is_education || enquiry?.education) return "Global Education";
            if (enquiry?.careers) return "Global Careers";
            if (enquiry?.travel) return "Travel Desk";
            if (enquiry?.business) return "Business Desk";
            if (enquiry?.mobility) return "Global Settlement";
            return "Consultancy Service";
        }
        const mapped = labels.map(label => {
            const key = label.toLowerCase().replace(/[ _-]+/g, " ").trim();
            if (/education|study|university/.test(key)) return "Global Education";
            if (/career|employment|work|job/.test(key)) return "Global Careers";
            if (/travel|tourism/.test(key)) return "Travel Desk";
            if (/business|trade/.test(key)) return "Business Desk";
            if (/mobility|settlement|migration/.test(key)) return "Global Settlement";
            return label.replace(/[ _-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
        });
        return [...new Set(mapped)].join(", ");
    }

    function serviceLabels(enquiry) {
        return serviceLabel(enquiry).split(", ").filter(Boolean);
    }

    function serviceCodes(enquiry) {
        const serviceSource = Array.isArray(enquiry?.services) && enquiry.services.length ? enquiry.services : enquiry?.service;
        const raw = asArray(serviceSource).map(displayValue).filter(Boolean);
        if (raw.length) return [...new Set(raw)];
        const inferred = ["education", "careers", "travel", "business", "mobility", "general"]
            .filter(key => enquiry?.[key] && typeof enquiry[key] === "object");
        return inferred.length ? inferred : [enquiry?.is_education ? "education" : "general"];
    }

    function serviceDecision(enquiry, serviceCode = state.selectedServiceCode) {
        return (enquiry?.service_decisions || []).find(item => item.service_code === serviceCode) || null;
    }

    function renderEnquiryCards(record, selectedEnquiryId) {
        const enquiries = Array.isArray(record?.enquiries) ? record.enquiries : [];
        if (!enquiries.length) return `<article class="detail-card full-width"><h3>Original Enquiry</h3><p class="section-subtitle">No linked enquiry details are available.</p></article>`;
        return enquiries.map(item => `<article class="detail-card full-width">
            <h3>${String(item.id) === String(selectedEnquiryId) ? `Selected ${escape(serviceLabel(item))} Enquiry` : `${escape(serviceLabel(item))} Enquiry`} ${escape(item.reference || "reference unavailable")}</h3>
            <div class="detail-row"><span>Received</span><strong>${escape(formatDate(item.created_at))}</strong></div>
            <div class="assessment-enquiry-details">${enquirySummary(item)}</div>
            ${String(item.id) !== String(selectedEnquiryId) ? `<button type="button" class="button button-secondary" data-assessment-select-enquiry="${escape(item.id)}">Review this service enquiry</button>` : ""}
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
        return state.records.map(record => {
            const enquiries = Array.isArray(record.enquiries) ? record.enquiries : [];
            const preferred = enquiries.find(item => String(item.id) === String(state.selectedEnquiryId))
                || enquiries.find(item => item.is_education)
                || enquiries[0]
                || null;
            return { record, enquiries, enquiry: preferred, assessment: preferred?.is_education ? (preferred.client_assessment || {}) : { status: "not_applicable" } };
        });
    }

    function questionnaireLabel(value) {
        return ({ awaiting_payment: "Awaiting Payment", ready_to_begin: "Ready to Begin", in_progress: "In Progress", submitted: "Submitted", under_review: "Under Review", clarification_required: "Clarification Required", assessment_completed: "Assessment Completed", not_applicable: "Not Applicable" })[value] || "Not Applicable";
    }

    function destination(enquiry) {
        const serviceDestinations = ["education", "careers", "travel", "business", "mobility", "general"]
            .map(key => enquiry?.[key]?.destination)
            .map(displayValue)
            .filter(Boolean);
        return [...new Set(serviceDestinations.length ? serviceDestinations : [displayValue(enquiry?.destination)].filter(Boolean))].join(", ") || "—";
    }

    function clientCode(record, enquiry = null) {
        return String(record?.client_code || "").trim() || `Client ID pending · ${enquiry?.reference || "Enquiry reference unavailable"}`;
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
        const allEnquiries = allRows.flatMap(row => row.enquiries);
        const deskOptions = [...new Set(allEnquiries.flatMap(item => asArray(item.desk_names).map(displayValue)).filter(Boolean))].sort();
        const serviceOptions = [...new Set(allEnquiries.flatMap(item => serviceLabels(item)))].sort();
        const questionnaireStatuses = [...new Set(allEnquiries.filter(item => item.is_education).map(item => item.client_assessment?.status || "awaiting_payment"))].sort();
        if (allEnquiries.some(item => !item.is_education)) questionnaireStatuses.push("not_applicable");
        const filters = state.filters;
        const hasDecision = (record, decision) => (record.enquiries || []).some(item => (item.service_decisions || []).some(entry => entry.decision === decision));
        const isAwaiting = record => (record.enquiries || []).some(item => serviceCodes(item).some(code => !serviceDecision(item, code)));
        const isUnderReview = record => (record.enquiries || []).some(item => item.is_education && item.client_assessment?.status === "under_review");
        const dashboardMatches = record => {
            switch (filters.dashboard) {
                case "awaiting": return isAwaiting(record);
                case "under_review": return isUnderReview(record);
                case "approved": return hasDecision(record, "approved");
                case "on_hold": return hasDecision(record, "on_hold");
                case "rejected": return hasDecision(record, "rejected");
                default: return true;
            }
        };
        const rowsData = allRows.filter(({ record, enquiries }) => {
            const query = filters.search.toLowerCase();
            const searchText = [record.client_name, record.client_code, ...enquiries.map(item => item.reference)].join(" ").toLowerCase();
            const matchesDesk = !filters.desk || enquiries.some(item => asArray(item.desk_names).map(displayValue).includes(filters.desk));
            const matchesService = !filters.service || enquiries.some(item => serviceLabels(item).includes(filters.service));
            const matchesQuestionnaire = !filters.status || (filters.status === "not_applicable"
                ? enquiries.some(item => !item.is_education)
                : enquiries.some(item => item.is_education && (item.client_assessment?.status || "awaiting_payment") === filters.status));
            const matchesDecision = !filters.decision || (filters.decision === "awaiting"
                ? isAwaiting(record)
                : hasDecision(record, filters.decision));
            return (!query || searchText.includes(query)) && matchesDesk && matchesService && matchesQuestionnaire && matchesDecision && dashboardMatches(record);
        });
        const statusSummary = enquiries => {
            const statuses = [...new Set(enquiries.filter(item => item.is_education).map(item => questionnaireLabel(item.client_assessment?.status || "awaiting_payment")))];
            if (enquiries.some(item => !item.is_education)) statuses.push("Not Applicable");
            return statuses.length ? statuses.join(" · ") : "Not Applicable";
        };
        const decisionSummary = enquiries => enquiries.length
            ? enquiries.flatMap(item => serviceCodes(item).map(code => `${serviceLabel({ services: [code] })}: ${decisionLabel(serviceDecision(item, code)?.decision)}`)).join(" · ")
            : "Awaiting assessment";
        const enquiryReferenceSummary = enquiries => enquiries.map(item => item.reference).filter(Boolean).join(", ") || "No enquiry reference";
        const rows = rowsData.map(({ record, enquiries }) => {
            const primary = enquiries.find(item => item.is_education && ["submitted", "under_review"].includes(item.client_assessment?.status))
                || enquiries.find(item => item.is_education) || enquiries[0] || null;
            const services = [...new Set(enquiries.flatMap(item => serviceLabels(item)))].join(", ") || "Consultancy Service";
            const destinations = [...new Set(enquiries.map(destination).filter(value => value !== "—"))].join(", ") || "—";
            const desks = [...new Set(enquiries.flatMap(item => asArray(item.desk_names).map(displayValue)))].join(", ") || "Unassigned";
            const missingId = !String(record.client_code || "").trim();
            const clientIdLabel = missingId ? `Client ID pending · ${enquiryReferenceSummary(enquiries)}` : record.client_code;
            const lastUpdated = enquiries.map(item => item.client_assessment?.submitted_at || item.client_assessment?.updated_at || item.created_at).filter(Boolean).sort().at(-1) || record.updated_at;
            return `<tr>
                <td><strong>${escape(record.client_name || "Client")}</strong><br><small>${escape(clientIdLabel)}</small></td>
                <td>${escape(services)}<br><small>${escape(destinations)}</small></td>
                <td>${escape(desks)}</td>
                <td>${escape(statusSummary(enquiries))}<br><small>${escape(enquiryReferenceSummary(enquiries))}</small></td>
                <td><strong>${escape(decisionSummary(enquiries))}</strong></td>
                <td>${escape(formatDate(lastUpdated))}</td>
                <td><button type="button" class="button button-secondary" data-assessment-open="${escape(record.client_id)}" data-assessment-enquiry="${escape(primary?.id || "")}">Open Profile</button></td>
            </tr>`;
        }).join("");
        const dashboardCards = [
            ["", "Total Assessments", allRows.length],
            ["awaiting", "Awaiting Assessment", allRows.filter(({ record }) => isAwaiting(record)).length],
            ["under_review", "Under Review", allRows.filter(({ record }) => isUnderReview(record)).length],
            ["approved", "Approved", allRows.filter(({ record }) => hasDecision(record, "approved")).length],
            ["on_hold", "On Hold", allRows.filter(({ record }) => hasDecision(record, "on_hold")).length],
            ["rejected", "Rejected", allRows.filter(({ record }) => hasDecision(record, "rejected")).length]
        ].map(([value, label, count]) => `<button type="button" class="assessment-stat-card ${filters.dashboard === value ? "is-active" : ""}" data-dashboard-filter="${escape(value)}" aria-pressed="${filters.dashboard === value}"><span>${escape(label)}</span><strong>${count}</strong></button>`).join("");
        state.container.innerHTML = `<section class="section assessment-workspace">
            <div class="section-header"><div><p class="section-eyebrow">INTERNAL ADMINISTRATION</p><h2 class="section-title">Assessments</h2><p class="section-subtitle">Review client enquiries, applicable questionnaires, consultation findings and professional assessment decisions across all services.</p></div><button type="button" class="button button-secondary" data-assessment-refresh ${state.loading ? "disabled" : ""}>Refresh</button></div>
            ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}${state.loading ? '<p class="section-subtitle" role="status">Loading assessment records…</p>' : ""}${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
            ${allRows.length ? `<div class="assessment-stats-grid">${dashboardCards}</div><div class="assessment-filters">
                <label>Search client or enquiry<input type="search" data-filter="search" placeholder="Name, Client ID or enquiry reference" value="${escape(filters.search)}"></label>
                <label>Desk<select data-filter="desk"><option value="">All desks</option>${deskOptions.map(value => `<option value="${escape(value)}" ${value === filters.desk ? "selected" : ""}>${escape(value)}</option>`).join("")}</select></label>
                <label>Service<select data-filter="service"><option value="">All services</option>${serviceOptions.map(value => `<option value="${escape(value)}" ${value === filters.service ? "selected" : ""}>${escape(value)}</option>`).join("")}</select></label>
                <label>Questionnaire<select data-filter="status"><option value="">All statuses</option>${questionnaireStatuses.map(value => `<option value="${escape(value)}" ${value === filters.status ? "selected" : ""}>${escape(questionnaireLabel(value))}</option>`).join("")}</select></label>
                <label>Service decision<select data-filter="decision"><option value="">All decisions</option><option value="awaiting" ${filters.decision === "awaiting" ? "selected" : ""}>Awaiting Assessment</option><option value="approved" ${filters.decision === "approved" ? "selected" : ""}>Approved</option><option value="on_hold" ${filters.decision === "on_hold" ? "selected" : ""}>On Hold</option><option value="rejected" ${filters.decision === "rejected" ? "selected" : ""}>Rejected</option></select></label>
            </div>` : ""}
            ${!state.loading && !state.error && !allRows.length ? '<div class="empty-state"><div class="empty-state-title">No assessments</div><div class="empty-state-text">Clients and their original enquiries will appear here.</div></div>' : ""}
            ${rowsData.length ? `<div class="table-wrapper"><table class="enquiry-table"><thead><tr><th>Client</th><th>Services / destinations</th><th>Assigned desk</th><th>Questionnaires</th><th>Professional decisions</th><th>Updated</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : allRows.length ? '<p class="section-subtitle">No clients match these filters.</p>' : ""}
        </section>`;
        state.container.querySelector("[data-assessment-refresh]")?.addEventListener("click", () => void loadQueue());
        state.container.querySelectorAll("[data-dashboard-filter]").forEach(button => button.addEventListener("click", () => {
            state.filters.dashboard = button.dataset.dashboardFilter;
            renderQueue();
        }));
        state.container.querySelectorAll("[data-filter]").forEach(control => control.addEventListener("change", () => { state.filters[control.dataset.filter] = control.value; renderQueue(); }));
        state.container.querySelectorAll("[data-assessment-open]").forEach(button => button.addEventListener("click", () => void openReview(button.dataset.assessmentOpen, button.dataset.assessmentEnquiry)));
    }
    function renderReview() {
        const record = getSelectedRecord();
        if (!record) { state.selectedClientId = null; state.selectedEnquiryId = null; renderQueue(); return; }
        const enquiries = Array.isArray(record.enquiries) ? record.enquiries : [];
        const enquiry = getSelectedEnquiry(record);
        const decisionServiceCodes = serviceCodes(enquiry);
        if (enquiry && !decisionServiceCodes.includes(state.selectedServiceCode)) {
            state.selectedServiceCode = decisionServiceCodes[0] || null;
        }
        const selectedServiceCode = state.selectedServiceCode;
        const selectedServiceLabel = serviceLabel({ services: [selectedServiceCode || "general"] });
        const queueAssessment = enquiry?.client_assessment || {};
        const assessment = state.reviewDetails?.assessment || queueAssessment;
        const decision = serviceDecision(enquiry, selectedServiceCode);
        const notes = state.reviewDetails?.consultation_notes || {};
        const historyMarkup = state.history.length ? state.history.map(item => `<article class="detail-card full-width"><h4>${escape(decisionLabel(item.decision))}${item.previous_decision ? ` (revised from ${escape(decisionLabel(item.previous_decision))})` : " (initial decision)"}</h4>${item.previous_reason ? `<p><strong>Previous reason:</strong> ${escape(item.previous_reason)}</p>` : ""}${item.previous_comments ? `<p><strong>Previous comments:</strong> ${escape(item.previous_comments)}</p>` : ""}${item.assessment_reason ? `<p><strong>Decision reason:</strong> ${escape(item.assessment_reason)}</p>` : ""}${item.admin_comments ? `<p><strong>Administrator comments:</strong> ${escape(item.admin_comments)}</p>` : ""}<p class="section-subtitle">${escape(item.reviewer_name)} · ${escape(formatDate(item.changed_at))}</p></article>`).join("") : `<p class="section-subtitle">${escape(state.historyError || "No service-specific decision history recorded yet.")}</p>`;
        const isEducation = Boolean(enquiry?.is_education);
        const noteFields = [
            ["consultation_notes", "Client Background, Eligibility and Consultation Findings", "textarea", "all"],
            ["academic_findings", "Academic and Professional Readiness", "textarea", "education_careers"],
            ["language_readiness", "Language Readiness", "text", "education_careers"],
            ["financial_readiness", "Financial Readiness", "text", "all"],
            ["recommended_destination", "Recommended Destination", "select", "all"],
            ["recommended_pathway", "Recommended Pathway", isEducation ? "select" : "text", "all"],
            ["preparation_requirements", "Preparation Requirements", "textarea", "all"],
            ["recommended_next_action", "Recommended Next Action", "textarea", "all"]
        ];
        const destinations = ["Germany", "Canada", "United States", "United Kingdom", "Ireland", "Australia", "New Zealand", "China", "Romania", "Serbia", "Poland", "Ghana", "Other"];
        const pathways = ["Bachelor's Degree", "Master's Degree", "PhD", "General Ausbildung", "Nursing Ausbildung", "Specialist Healthcare Education", "Language and Academic Preparation", "International Conferences and CPD", "Other"];
        const hasCareerService = serviceLabels(enquiry).includes("Global Careers");
        const notesForm = noteFields.filter(([, , , applicability]) =>
            applicability === "all" || (applicability === "education_careers" && (isEducation || hasCareerService))
        ).map(([key, label, type]) => {
            const value = notes[key] || "";
            if (type === "select") {
                const choices = key === "recommended_destination" ? destinations : pathways;
                const retained = value && !choices.includes(value) ? `<option value="${escape(value)}" selected>${escape(value)} (saved)</option>` : "";
                return `<label>${escape(label)}<select data-note="${key}"><option value="">Not selected</option>${retained}${choices.map(choice => `<option value="${escape(choice)}" ${choice === value ? "selected" : ""}>${escape(choice)}</option>`).join("")}</select></label>`;
            }
            return `<label>${escape(label)}${type === "textarea" ? `<textarea data-note="${key}" rows="3" maxlength="4000">${escape(value)}</textarea>` : `<input data-note="${key}" maxlength="4000" value="${escape(value)}">`}</label>`;
        }).join("");
        const answerHistory = Array.isArray(state.reviewDetails?.submission_history) ? state.reviewDetails.submission_history : [];
        const previousSubmissions = answerHistory.length > 1 ? `<details class="assessment-submission-history"><summary>Previous submitted versions (${answerHistory.length - 1})</summary>${answerHistory.slice(1).map(item => `<div class="assessment-submission-version"><strong>Submission ${Number(item.revision) || ""} · ${escape(formatDate(item.submitted_at))}</strong><div class="assessment-answer-grid">${answerSections(item.responses || {})}</div></div>`).join("")}</details>` : "";
        const questionnaire = state.reviewLoading
            ? '<section class="detail-card full-width"><p class="section-subtitle" role="status">Loading questionnaire and consultation details…</p></section>'
            : isEducation
                ? assessment.id
                    ? `<section class="detail-card full-width"><div class="section-header"><div><h3>Education Questionnaire</h3><p class="section-subtitle">${escape(questionnaireLabel(assessment.status))} · ${assessment.submitted_at ? `Submitted ${escape(formatDate(assessment.submitted_at))}` : "Not submitted"}</p></div>${(state.reviewDetails?.payment_authorized ?? queueAssessment.payment_authorized) ? '<span class="assessment-authorization is-authorized">Consultation payment verified</span>' : '<span class="assessment-authorization">Awaiting verified consultation payment</span>'}</div><div class="assessment-answer-grid">${answerSections(assessment.responses || {})}</div>${previousSubmissions}</section>`
                    : `<section class="detail-card full-width"><h3>Education Questionnaire</h3><p class="section-subtitle">${escape(questionnaireLabel(assessment.status || "awaiting_payment"))}${!(state.reviewDetails?.payment_authorized ?? queueAssessment.payment_authorized) ? " · Available after the existing initial consultation payment is verified." : ""}</p></section>`
                : '<section class="detail-card full-width"><h3>Service Questionnaire</h3><p class="section-subtitle">Not Applicable · A questionnaire has not been implemented for this service.</p></section>';
        const enquiryCards = renderEnquiryCards(record, enquiry?.id);
        const desks = [...new Set(enquiries.flatMap(item => asArray(item.desk_names).map(displayValue)))].join(", ") || "Unassigned";
        const services = [...new Set(enquiries.flatMap(item => serviceLabels(item)))].join(", ") || "Consultancy Service";
        const destinationsSummary = [...new Set(enquiries.map(destination).filter(value => value !== "—"))].join(", ") || "—";
        const permanentId = String(record.client_code || "").trim();
        const idDisplay = permanentId || `Client ID pending · ${enquiry?.reference || "Enquiry reference unavailable"}`;
        const legacyDecision = !decision && record.decision ? `<p class="assessment-legacy-decision" role="note">A previous client-level decision (${escape(decisionLabel(record.decision))}) is retained for history. It is not applied to this service.</p>` : "";
        const decisionMarkup = decision
            ? `<div class="detail-row"><span>Outcome</span><strong>${escape(decisionLabel(decision.decision))}</strong></div>${decision.assessment_reason ? `<div class="detail-row"><span>Reason</span><strong>${escape(decision.assessment_reason)}</strong></div>` : ""}${decision.admin_comments ? `<div class="detail-row"><span>Administrator comments</span><strong>${escape(decision.admin_comments)}</strong></div>` : ""}<div class="detail-row"><span>Reviewer and time</span><strong>${escape(decision.reviewer_name || "—")} · ${escape(formatDate(decision.reviewed_at))}</strong></div>`
            : '<div class="detail-row"><span>Outcome</span><strong>Awaiting assessment</strong></div>';
        state.container.innerHTML = `<section class="section assessment-workspace">
            <div class="section-header"><div><p class="section-eyebrow">ASSESSMENT REVIEW</p><h2 class="section-title">${escape(record.client_name || "Client")}</h2><p class="section-subtitle">${escape(idDisplay)} · ${escape(services)} · ${escape(destinationsSummary)}</p></div><button type="button" class="button button-secondary" data-assessment-back>Back to queue</button></div>
            ${state.error ? `<p class="section-subtitle" role="alert">${escape(state.error)}</p>` : ""}${state.message ? `<p class="section-subtitle" role="status">${escape(state.message)}</p>` : ""}
            <section class="detail-card full-width"><h3>Client Summary</h3><div class="assessment-client-summary-grid"><div><span>Services and destinations</span><strong>${escape(services)} · ${escape(destinationsSummary)}</strong></div><div><span>Assigned desk</span><strong>${escape(desks)}</strong></div><div><span>Questionnaire</span><strong>${escape(questionnaireLabel(assessment.status || (isEducation ? "awaiting_payment" : "not_applicable")))}</strong></div><div><span>Payment authorisation</span><strong>${!isEducation ? "Not Applicable" : (state.reviewDetails?.payment_authorized ?? queueAssessment.payment_authorized) ? "Initial consultation payment verified" : "Payment verification pending"}</strong></div></div></section>
            <section class="assessment-original-enquiries"><h3>Original Enquiries</h3><div class="detail-grid">${enquiryCards}</div></section>${questionnaire}
            <section class="detail-card full-width"><div class="section-header"><div><h3>Internal Consultation and Assessment Notes</h3><p class="section-subtitle">Staff-only notes. Saving does not change a professional decision.</p></div></div>${state.reviewLoading ? '<p class="section-subtitle" role="status">Loading consultation notes…</p>' : canWrite() && enquiry ? `<form data-assessment-notes><div class="assessment-notes-grid">${notesForm}</div><button type="button" class="button button-primary" data-assessment-save-notes ${state.notesSaving ? "disabled" : ""}>Save Consultation Notes</button></form>` : `<p class="section-subtitle">${enquiry ? "You can view these notes but do not have permission to edit them." : "Select an enquiry to view consultation notes."}</p>${Object.entries(notes).filter(([, value]) => value).map(([key, value]) => `<div class="detail-row"><span>${escape(fieldLabel(key))}</span><strong>${escape(value)}</strong></div>`).join("")}`}</section>
            ${isEducation && assessment.id && canWrite() && ["submitted", "under_review", "assessment_completed"].includes(assessment.status) ? `<button type="button" class="button button-secondary" data-assessment-reopen ${state.reopening ? "disabled" : ""}>Request Client Clarification</button>` : ""}
            <section class="detail-card full-width"><h3>Professional Decision</h3>${decisionServiceCodes.length > 1 ? `<label class="assessment-decision-service">Service for this decision<select data-assessment-decision-service>${decisionServiceCodes.map(code => `<option value="${escape(code)}" ${code === selectedServiceCode ? "selected" : ""}>${escape(serviceLabel({ services: [code] }))}</option>`).join("")}</select></label>` : ""}<p class="section-subtitle">Decision applies to ${escape(selectedServiceLabel)} only.</p>${decisionMarkup}${legacyDecision}</section>
            ${canWrite() && enquiry ? `<section class="detail-card full-width"><h3>${decision ? "Revise service decision" : "Record service decision"}</h3><form data-assessment-form><label>Assessment reason<textarea name="assessment_reason" rows="4" maxlength="4000" placeholder="Required for On Hold or Reject">${escape(decision?.assessment_reason || "")}</textarea></label><label>Administrator comments<textarea name="admin_comments" rows="4" maxlength="8000">${escape(decision?.admin_comments || "")}</textarea></label><p class="section-subtitle">On Hold and Reject require a reason.</p><div class="assessment-decision-actions"><button type="button" class="button button-primary" data-assessment-save="approved" ${state.saving ? "disabled" : ""}>Approve</button><button type="button" class="button button-secondary" data-assessment-save="on_hold" ${state.saving ? "disabled" : ""}>On Hold</button><button type="button" class="button button-secondary" data-assessment-save="rejected" ${state.saving ? "disabled" : ""}>Reject</button></div></form></section>` : canWrite() ? '<p class="section-subtitle">A linked enquiry is required to record a service-specific decision.</p>' : '<p class="section-subtitle">You can view this profile but do not have permission to record or revise decisions.</p>'}
            <section class="section"><h3>Decision History</h3>${state.historyLoading ? '<p class="section-subtitle" role="status">Loading decision history…</p>' : `<div class="detail-grid">${historyMarkup}</div>`}</section></section>`;
        state.container.querySelector("[data-assessment-back]")?.addEventListener("click", () => { state.selectedClientId = null; state.selectedEnquiryId = null; state.error = ""; state.message = ""; renderQueue(); });
        state.container.querySelectorAll("[data-assessment-save]").forEach(button => button.addEventListener("click", () => void saveDecision(button.dataset.assessmentSave)));
        state.container.querySelector("[data-assessment-save-notes]")?.addEventListener("click", () => void saveConsultationNotes());
        state.container.querySelector("[data-assessment-reopen]")?.addEventListener("click", () => void reopenForClarification());
        state.container.querySelectorAll("[data-assessment-select-enquiry]").forEach(button => button.addEventListener("click", () => void openReview(state.selectedClientId, button.dataset.assessmentSelectEnquiry)));
        state.container.querySelector("[data-assessment-decision-service]")?.addEventListener("change", event => {
            state.selectedServiceCode = event.currentTarget.value;
            void loadHistory(state.selectedClientId, state.selectedEnquiryId, state.selectedServiceCode);
        });
    }
    async function openReview(clientId, enquiryId) {
        state.selectedClientId = clientId;
        state.selectedEnquiryId = enquiryId || "";
        const selectedRecord = getSelectedRecord();
        const enquiry = getSelectedEnquiry(selectedRecord?.client_id === clientId ? selectedRecord : null);
        state.selectedServiceCode = serviceCodes(enquiry)[0] || null;
        state.reviewDetails = null;
        state.reviewLoading = Boolean(enquiryId);
        state.history = [];
        state.historyError = "";
        state.error = "";
        state.message = "";
        renderReview();
        const selectedEnquiry = getSelectedEnquiry();
        if (canWrite() && selectedEnquiry?.client_assessment?.id && selectedEnquiry.client_assessment.status === "submitted") {
            const { error } = await lordblessSupabase.rpc("mark_client_assessment_under_review", { p_assessment_id: selectedEnquiry.client_assessment.id });
            if (error) state.error = error.message || "Assessment review status could not be updated.";
            else await loadQueue();
        }
        await loadAssessmentReview(enquiryId);
        if (enquiryId) await loadHistory(clientId, enquiryId, state.selectedServiceCode);
    }

    async function loadAssessmentReview(enquiryId) {
        if (!enquiryId) {
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
        if (!enquiry) return;
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
            const records = Array.isArray(data) ? data : [];
            const clientIds = records.map(record => record.client_id).filter(Boolean);
            const decisionResult = clientIds.length
                ? await lordblessSupabase.from("client_assessment_decisions")
                    .select("id,client_id,enquiry_id,service_code,decision,assessment_reason,admin_comments,reviewer_id,reviewer_name,reviewed_at,created_at,updated_at")
                    .in("client_id", clientIds)
                : { data: [], error: null };
            if (decisionResult.error) throw decisionResult.error;
            const decisions = decisionResult.data || [];
            state.records = records.map(record => ({
                ...record,
                decision: record.decision || (decisions.find(item => item.client_id === record.client_id && !item.enquiry_id) || {}).decision || null,
                enquiries: (Array.isArray(record.enquiries) ? record.enquiries : []).map(enquiry => ({
                    ...enquiry,
                    service_decisions: decisions.filter(item => item.client_id === record.client_id && item.enquiry_id === enquiry.id)
                }))
            }));
        } catch (error) {
            state.records = [];
            state.error = error?.message || "Assessment records could not be loaded.";
        } finally {
            state.loading = false;
            if (state.selectedClientId) renderReview();
            else renderQueue();
        }
    }

    async function loadHistory(clientId, enquiryId, serviceCode) {
        state.historyLoading = true;
        state.historyError = "";
        renderReview();
        try {
            const { data, error } = await lordblessSupabase
                .from("client_assessment_decision_history")
                .select("id, client_id, enquiry_id, service_code, previous_decision, decision, previous_reason, assessment_reason, previous_comments, admin_comments, reviewer_id, reviewer_name, changed_at")
                .eq("client_id", clientId)
                .eq("enquiry_id", enquiryId)
                .eq("service_code", serviceCode)
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
        const enquiry = getSelectedEnquiry();
        const serviceCode = state.selectedServiceCode;
        if (!enquiry?.id) {
            state.error = "A linked enquiry is required for a service-specific decision.";
            renderReview();
            return;
        }
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
            const { data: savedDecisionId, error } = await lordblessSupabase.rpc("save_client_assessment_service_decision", {
                p_client_id: clientId,
                p_enquiry_id: enquiry.id,
                p_service_code: serviceCode,
                p_decision: decision,
                p_assessment_reason: assessmentReason || null,
                p_admin_comments: adminComments
            });
            if (error) throw error;
            if (!savedDecisionId) throw new Error("The saved decision was not confirmed by the database.");

            const { data: persistedDecision, error: confirmationError } = await lordblessSupabase
                .from("client_assessment_decisions")
                .select("id, client_id, enquiry_id, service_code, decision, assessment_reason, admin_comments, reviewer_id, reviewer_name, reviewed_at, created_at, updated_at")
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
                enquiries: (previousQueueRecord?.enquiries || []).map(item => item.id === enquiry.id
                    ? { ...item, service_decisions: [...(item.service_decisions || []).filter(row => row.service_code !== serviceCode), persistedDecision] }
                    : item),
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
            await loadHistory(clientId, enquiry.id, serviceCode);
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
