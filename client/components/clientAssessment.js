/* =========================================================
   CLIENT EDUCATION ASSESSMENT
   Persisted through the authenticated assessment RPCs.
   ========================================================= */
(function () {
    "use strict";

    const state = {
        context: null,
        enquiryId: null,
        step: 1,
        error: "",
        message: "",
        busy: false,
        summaryLoading: false,
        unsaved: null
    };

    const pathOptions = [
        ["bachelors", "Bachelor's Degree"], ["masters", "Master's Degree"], ["phd", "PhD"],
        ["ausbildung", "General Ausbildung"], ["nursing_ausbildung", "Nursing Ausbildung"],
        ["specialist_healthcare", "Specialist Healthcare Education"],
        ["language_preparation", "Language and Academic Preparation"],
        ["conferences", "International Conferences and Professional Development"],
        ["other", "Other"], ["undecided", "Not yet decided"]
    ];
    const destinationOptions = ["Germany", "Canada", "USA", "China", "Romania", "Serbia", "Poland", "Other destination", "Not yet decided"];
    const languageOptions = ["No German knowledge", "Beginner", "A1", "A2", "B1", "B2", "C1", "C2", "Currently studying"];
    const fields = {
        goals: [
            { key: "highest_qualification", label: "What is your highest academic qualification?", type: "select", options: ["Secondary School Qualification", "WASSCE or equivalent", "Certificate", "Diploma", "Higher National Diploma", "Bachelor's Degree", "Master's Degree", "Doctorate", "Other"] },
            { key: "field_of_study", label: "What was your field of study?", type: "text", optional: true },
            { key: "pathway", label: "What would you like to pursue?", type: "select", options: pathOptions },
            { key: "destination", label: "Which country would you prefer?", type: "text", options: destinationOptions, placeholder: "Enter a country or choose a suggestion" },
            { key: "programme", label: "Do you have a particular course or programme in mind?", type: "text", optional: true, when: ["ausbildung", "nursing_ausbildung", "specialist_healthcare", "language_preparation", "conferences", "other", "undecided"] },
            { key: "open_alternatives", label: "Are you open to alternative programmes or destinations?", type: "select", options: ["Yes", "No", "Undecided"] },
            { key: "pathway_subject", label: "What subject would you like to study?", type: "text", when: ["bachelors"] },
            { key: "postgraduate_area", label: "What postgraduate study area interests you?", type: "text", when: ["masters"] },
            { key: "research_area", label: "What is your preferred research area?", type: "text", when: ["phd"] },
            { key: "occupation", label: "Which occupation interests you?", type: "text", when: ["ausbildung", "nursing_ausbildung"] },
            { key: "german_level", label: "What is your current German language level?", type: "select", options: languageOptions, when: ["ausbildung", "nursing_ausbildung"] },
            { key: "language_certificate", label: "Do you hold a German language certificate?", type: "select", options: ["Yes", "No", "In progress"], when: ["ausbildung", "nursing_ausbildung"] },
            { key: "healthcare_training", label: "What previous healthcare training have you completed, if any?", type: "text", optional: true, when: ["nursing_ausbildung"] },
            { key: "healthcare_profession", label: "What is your current healthcare profession?", type: "text", when: ["specialist_healthcare"] },
            { key: "current_language_level", label: "What is your current language level?", type: "text", when: ["language_preparation"] },
            { key: "target_language_level", label: "What language level would you like to reach?", type: "text", when: ["language_preparation"] },
            { key: "professional_field", label: "What is your professional field?", type: "text", when: ["conferences"] },
            { key: "participation_mode", label: "Would you prefer online or in-person participation?", type: "select", options: ["Online", "In person", "Either"], when: ["conferences"] }
        ],
        financial: [
            { key: "funding_source", label: "Who will finance your international journey?", type: "select", options: ["Self-funded", "Parent", "Guardian", "Spouse", "Other family member", "Employer or organisation", "Scholarship or sponsorship", "Multiple funding sources", "Funding arrangements not yet determined"] },
            { key: "employment_status", label: "What is your current employment status?", type: "select", options: ["Employed", "Self-employed", "Business owner", "Student", "Unemployed", "Other"] },
            { key: "financial_preparation", label: "How far have you prepared financially for your intended journey?", type: "select", options: ["Fully prepared", "Partially prepared", "Currently saving", "My sponsor has committed to providing funds", "Seeking scholarship or sponsorship", "Not yet financially prepared"] },
            { key: "budget_not_determined", label: "My overall journey budget is not yet determined", type: "checkbox" },
            { key: "budget_amount", label: "What is your estimated overall journey budget?", type: "number", optional: true },
            { key: "budget_currency", label: "Budget currency", type: "select", options: ["GHS", "EUR", "USD", "CAD", "Other"], optional: true },
            { key: "destination_finances", label: "Are you prepared to meet the financial requirements associated with your intended destination?", type: "select", options: ["Yes", "Partially prepared", "My sponsor will provide the required funds", "I require guidance on financial preparation", "Not currently prepared"], when: pathOptions.map(([key]) => key).filter(key => key !== "undecided"), exceptOnline: true },
            { key: "blocked_account", label: "If a blocked account (Sperrkonto) is required for your visa application, are you financially prepared to establish one?", type: "select", options: ["Yes", "Currently preparing the funds", "My sponsor will provide the funds", "I require additional time", "I need more information", "No"], when: ["bachelors", "masters", "phd", "ausbildung", "nursing_ausbildung", "specialist_healthcare", "other"], germanyOnly: true },
            { key: "consultancy_readiness", label: "Are you prepared to finance the professional consultancy and application services required for your journey?", type: "select", options: ["Yes, I am ready to proceed", "Yes, subject to the proposed quotation", "My sponsor will cover these services", "I require additional time", "I would like to discuss the available arrangements"] }
        ],
        readiness: [
            { key: "start_timing", label: "When would you like to begin your international journey?", type: "select", options: ["Immediately", "Within 1 to 3 months", "Within 3 to 6 months", "Within 6 to 12 months", "Not yet decided"] },
            { key: "passport_status", label: "Do you have a valid international passport?", type: "select", options: ["Yes", "No", "Passport application in progress"], when: pathOptions.map(([key]) => key).filter(key => key !== "undecided"), exceptOnline: true },
            { key: "certificates_status", label: "Are your academic certificates available?", type: "select", options: ["Yes", "Partially available", "No", "Not applicable"] },
            { key: "transcripts_status", label: "Are your academic results or transcripts available?", type: "select", options: ["Yes", "Partially available", "No", "Not applicable"], when: ["bachelors", "masters", "phd", "ausbildung", "nursing_ausbildung", "specialist_healthcare"] },
            { key: "additional_context", label: "Is there anything else you would like our consultant to know?", type: "textarea", optional: true }
        ]
    };

    const statusLabels = {
        awaiting_payment: "Awaiting Payment", ready_to_begin: "Ready to Begin", in_progress: "In Progress",
        submitted: "Submitted", under_review: "Under Review", clarification_required: "Clarification Required",
        assessment_completed: "Assessment Completed"
    };
    const titleMap = {
        highest_qualification: "Highest academic qualification", field_of_study: "Field of study", pathway: "Intended pathway",
        destination: "Preferred destination", programme: "Programme in mind", open_alternatives: "Open to alternatives",
        pathway_subject: "Intended subject", postgraduate_area: "Postgraduate study area", research_area: "Research area",
        occupation: "Preferred occupation", german_level: "German language level", language_certificate: "Language certificate",
        healthcare_training: "Previous healthcare training", healthcare_profession: "Healthcare profession",
        current_language_level: "Current language level", target_language_level: "Target language level",
        professional_field: "Professional field", participation_mode: "Participation preference",
        funding_source: "Funding source", employment_status: "Employment status", financial_preparation: "Financial preparation",
        budget_not_determined: "Budget", budget_amount: "Estimated journey budget", budget_currency: "Currency",
        destination_finances: "Destination financial preparation", blocked_account: "Blocked account readiness",
        consultancy_readiness: "Consultancy service readiness", start_timing: "Intended start", passport_status: "Passport",
        certificates_status: "Academic certificates", support_needed: "Consultation topics", transcripts_status: "Academic results or transcripts", additional_context: "Additional information"
    };

    function escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
    }
    function rpc(name, args) { return lordblessSupabase.rpc(name, args); }
    function selectedEnquiry() { return (state.context?.enquiries || []).find(item => String(item.id) === String(state.enquiryId)) || null; }
    function isEducation(item) { return item?.is_education ?? Boolean(item?.enquiry?.education); }
    function statusOf(item) {
        if (!isEducation(item)) return "not_applicable";
        return item?.assessment?.status || (item?.payment_authorized ? "ready_to_begin" : "awaiting_payment");
    }
    function decisionLabel(value) {
        return ({ approved: "Approved", on_hold: "On Hold", rejected: "Rejected" })[value] || "Awaiting decision";
    }
    function serviceLabel(item) {
        const values = Array.isArray(item?.services) && item.services.length ? item.services : [item?.service];
        const labels = values.filter(Boolean).map(value => {
            const key = String(value).toLowerCase().replace(/[ _-]+/g, " ");
            if (/education|study|university/.test(key)) return "Global Education";
            if (/career|employment|work|job/.test(key)) return "Global Careers";
            if (/travel|tourism/.test(key)) return "Travel Desk";
            if (/business|trade/.test(key)) return "Business Desk";
            if (/mobility|settlement|migration/.test(key)) return "Global Settlement";
            return String(value).replace(/[ _-]+/g, " ");
        });
        return [...new Set(labels)].join(", ") || (isEducation(item) ? "Global Education" : "Consultancy Service");
    }
    function serviceCodes(item) {
        const values = Array.isArray(item?.services) && item.services.length ? item.services : [item?.service];
        const codes = [...new Set(values.filter(Boolean).map(String))];
        if (codes.length) return codes;
        const inferred = ["education", "careers", "travel", "business", "mobility", "general"]
            .find(key => item?.enquiry?.[key] && typeof item.enquiry[key] === "object");
        return [inferred || (isEducation(item) ? "education" : "general")];
    }
    function professionalDecision(item, serviceCode) {
        const decisions = item?.professional_decisions || (item?.professional_decision
            ? [{ service_code: serviceCodes(item)[0], ...item.professional_decision }]
            : []);
        return decisions.find(entry => entry.service_code === serviceCode) || null;
    }
    function paymentLink() { document.querySelector('[data-view="payments"]')?.click(); }

    function prefill(item) {
        const education = item?.enquiry?.education || {};
        const values = state.context?.client || {};
        const responses = state.unsaved?.id === item?.id ? state.unsaved.responses : (item?.assessment?.responses || {});
        const goals = { ...(responses.goals || {}) };
        if (!goals.highest_qualification && (education.qualification || education.highestQualification)) goals.highest_qualification = education.qualification || education.highestQualification;
        if (!goals.field_of_study) goals.field_of_study = education.studyArea || education.fieldOfStudy || "";
        if (!goals.destination) goals.destination = education.destination || "";
        const existingProgramme = education.firstProgramme || education.programme || "";
        if (!goals.pathway && education.studyLevel) {
            const studyLevel = String(education.studyLevel).toLowerCase();
            const aliases = { bachelor: "bachelors", undergraduate: "bachelors", "bachelor's degree": "bachelors", master: "masters", postgraduate: "masters", "master's degree": "masters", doctorate: "phd", doctoral: "phd", conference: "conferences" };
            goals.pathway = aliases[studyLevel] || pathOptions.find(([, label]) => label.toLowerCase() === studyLevel || label.toLowerCase().includes(studyLevel))?.[0] || "";
        }
        if (goals.pathway === "bachelors" && !goals.pathway_subject) goals.pathway_subject = existingProgramme;
        if (goals.pathway === "masters" && !goals.postgraduate_area) goals.postgraduate_area = existingProgramme;
        if (goals.pathway === "phd" && !goals.research_area) goals.research_area = existingProgramme;
        if (!goals.programme) goals.programme = existingProgramme;
        return { ...responses, goals };
    }

    function renderSummary() {
        const host = document.getElementById("client-assessment-overview-card");
        if (!host) return;
        if (state.summaryLoading) {
            host.innerHTML = '<p class="section-subtitle" role="status">Loading assessment status…</p>';
            return;
        }
        const enquiries = state.context?.enquiries || [];
        if (!enquiries.length) {
            host.innerHTML = `<section class="client-assessment-summary"><div><p class="portal-eyebrow">YOUR ASSESSMENT</p><h3>Assessment profile</h3><p>${escape(state.context?.error || "Your linked service enquiries will appear here.")}</p></div></section>`;
            return;
        }
        const outstanding = enquiries.find(item => isEducation(item) && !["assessment_completed", "submitted", "under_review"].includes(statusOf(item)))
            || enquiries.find(item => isEducation(item)) || enquiries[0];
        const status = statusOf(outstanding);
        const educationCount = enquiries.filter(isEducation).length;
        const countLabel = educationCount ? `${educationCount} Education ${educationCount === 1 ? "assessment" : "assessments"}` : "Service assessment profile";
        const description = isEducation(outstanding)
            ? `${statusLabels[status] || "Ready to Begin"} · ${outstanding.enquiry?.education?.destination || "Education pathway"}`
            : `${decisionLabel(professionalDecision(outstanding, serviceCodes(outstanding)[0])?.decision)} · ${serviceLabel(outstanding)}`;
        const action = isEducation(outstanding)
            ? `<button type="button" class="primary-button" data-view-link="assessment">${status === "awaiting_payment" ? "View payment request" : ["in_progress", "clarification_required"].includes(status) ? "Continue assessment" : ["submitted", "under_review", "assessment_completed"].includes(status) ? "View assessment" : "Start assessment"}</button>`
            : `<button type="button" class="primary-button" data-view-link="assessment">View assessment profile</button>`;
        host.innerHTML = `<section class="client-assessment-summary"><div><p class="portal-eyebrow">YOUR ASSESSMENT</p><h3>${escape(countLabel)}</h3><p>${escape(description)}</p></div>${action}</section>`;
        host.querySelector("[data-view-link='assessment']")?.addEventListener("click", () => document.querySelector('[data-view="assessment"]')?.click());
    }

    async function loadContext() {
        const { data, error } = await rpc("get_my_client_assessments");
        if (error) throw error;
        state.context = data || { enquiries: [] };
        return state.context;
    }

    function renderProfile(client) {
        return `<div class="client-assessment-profile"><span><small>CLIENT</small><strong>${escape(client.full_name || "Client")}</strong></span><span><small>CLIENT ID</small><strong>${escape(client.client_code || "ID pending")}</strong></span><span><small>EMAIL</small><strong>${escape(client.email || "—")}</strong></span><span><small>WHATSAPP</small><strong>${escape(client.whatsapp || "—")}</strong></span><span><small>NATIONALITY</small><strong>${escape(client.nationality || "—")}</strong></span><span><small>COUNTRY OF RESIDENCE</small><strong>${escape(client.current_country || "—")}</strong></span></div>`;
    }

    function renderList() {
        const client = state.context?.client || {};
        const items = state.context?.enquiries || [];
        const cards = items.map(item => {
            const status = statusOf(item);
            if (!isEducation(item)) {
                const decisions = serviceCodes(item).map(code => {
                    const decision = professionalDecision(item, code);
                    return `<p><strong>${escape(serviceLabel({ services: [code] }))} decision:</strong> ${escape(decisionLabel(decision?.decision))}${decision?.reviewed_at ? ` · ${escape(formatDate(decision.reviewed_at))}` : ""}</p>`;
                }).join("");
                return `<article class="client-assessment-engagement"><div><span class="client-assessment-status">Questionnaire: Not Applicable</span><h3>${escape(serviceLabel(item))}</h3><p>${escape(item.destination || item.enquiry?.details?.destination || "Service enquiry")} · ${escape(item.reference || "Enquiry")}</p>${decisions}<small>Your consultant will update this profile as reviews are completed.</small></div></article>`;
            }
            const action = status === "awaiting_payment" ? "View Payment Request" : status === "ready_to_begin" ? "Start Assessment" : status === "in_progress" ? "Continue Assessment" : status === "clarification_required" ? "Update Assessment" : "View Assessment";
            const decisions = serviceCodes(item).map(code => {
                const decision = professionalDecision(item, code);
                return `<p><strong>${escape(serviceLabel({ services: [code] }))} decision:</strong> ${escape(decisionLabel(decision?.decision))}${decision?.reviewed_at ? ` · ${escape(formatDate(decision.reviewed_at))}` : ""}</p>`;
            }).join("");
            return `<article class="client-assessment-engagement"><div><span class="client-assessment-status">${escape(statusLabels[status] || status)}</span><h3>${escape(item.enquiry?.education?.firstProgramme || item.enquiry?.education?.studyLevel || "Education pathway")}</h3><p>${escape(item.enquiry?.education?.destination || item.destination || "Destination not specified")} · ${escape(item.reference || "Enquiry")}</p>${decisions}<small>Updated ${escape(formatDate(item.assessment?.updated_at || item.assessment?.submitted_at || item.created_at))}</small></div><button type="button" class="primary-button" data-assessment-open="${escape(item.id)}">${escape(action)}</button></article>`;
        }).join("");
        return `<section class="client-assessment-panel"><div class="client-assessment-heading"><div><p class="portal-eyebrow">CLIENT PORTAL</p><h2>My Assessment</h2><p>Your assessment profile shows your linked services and applicable review progress. Where a questionnaire is available, your answers help our consultancy team prepare for your consultation.</p></div></div>${renderProfile(client)}<h3>Your Service Assessments</h3>${cards || '<div class="empty-state-card"><h3>No assessment is linked yet</h3><p>If you expected one here, please contact your LORDBLESS consultant.</p></div>'}</section>`;
    }

    function control(field, value, section) {
        const name = field.key;
        const valueText = value === undefined || value === null ? "" : String(value);
        const options = field.options || [];
        const conditional = field.when ? ` data-pathway="${escape(field.when.join(","))}"` : "";
        const germany = field.germanyOnly ? ' data-germany-only="true"' : "";
        const exceptOnline = field.exceptOnline ? ' data-except-online="true"' : "";
        const optionalText = field.optional ? " (optional)" : "";
        if (field.type === "checkbox") return `<label class="client-assessment-field client-assessment-check"${conditional}${germany}><input type="checkbox" data-field="${section}.${escape(name)}" ${value ? "checked" : ""}><span>${escape(field.label)}${optionalText}</span></label>`;
        if (field.type === "select") {
            const known = options.some(option => String(Array.isArray(option) ? option[0] : option) === valueText);
            const preserved = valueText && !known ? `<option value="${escape(valueText)}" selected>${escape(valueText)} (from your enquiry)</option>` : "";
            return `<label class="client-assessment-field"${conditional}${germany}${exceptOnline}><span>${escape(field.label)}${optionalText}</span><select data-field="${section}.${escape(name)}"><option value="">Choose an option</option>${preserved}${options.map(option => { const pair = Array.isArray(option) ? option : [option, option]; return `<option value="${escape(pair[0])}" ${valueText === String(pair[0]) ? "selected" : ""}>${escape(pair[1])}</option>`; }).join("")}</select></label>`;
        }
        const inputType = field.type === "textarea" ? "textarea" : field.type;
        const input = inputType === "textarea" ? `<textarea data-field="${section}.${escape(name)}" rows="3">${escape(valueText)}</textarea>` : `<input data-field="${section}.${escape(name)}" type="${escape(inputType)}" value="${escape(valueText)}" ${field.type === "number" ? 'min="0" step="0.01"' : ""} ${name === "destination" ? 'list="client-assessment-destinations" placeholder="' + escape(field.placeholder || "") + '"' : ""}>${name === "destination" ? `<datalist id="client-assessment-destinations">${options.map(option => `<option value="${escape(option)}"></option>`).join("")}</datalist>` : ""}`;
        return `<label class="client-assessment-field"${conditional}${germany}${exceptOnline}><span>${escape(field.label)}${optionalText}</span>${input}</label>`;
    }

    function renderFields(section, response) {
        return fields[section].map(field => control(field, response[section]?.[field.key], section)).join("");
    }

    function renderAnswers(responses) {
        const groups = [["goals", "Education Goals"], ["financial", "Financial Preparation"], ["readiness", "Preparing for Your Journey"]];
        return groups.map(([key, label]) => {
            const answerRows = Object.entries(responses[key] || {}).map(([field, value]) => {
                if (value === "" || value === null || value === undefined || value === false) return "";
                const title = titleMap[field] || field.replaceAll("_", " ");
                const shown = field === "budget_not_determined" ? "Not yet determined" : field === "budget_amount" ? `${value} ${responses.financial?.budget_currency || ""}`.trim() : value;
                return `<div class="client-assessment-answer"><span>${escape(title)}</span><strong>${escape(shown)}</strong></div>`;
            }).filter(Boolean).join("");
            return `<section class="client-assessment-answer-group"><h3>${escape(label)}</h3>${answerRows || "<p>No responses in this section.</p>"}</section>`;
        }).join("");
    }

    function formatDate(value) {
        if (!value) return "Not yet updated";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Not yet updated" : date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
    }

    function renderWizard(container) {
        const item = selectedEnquiry();
        if (!item) { container.innerHTML = renderList(); bindList(container); return; }
        const status = statusOf(item);
        const responses = prefill(item);
        if (status === "awaiting_payment" || !item.payment_authorized) {
            container.innerHTML = `<section class="client-assessment-panel"><p class="portal-eyebrow">YOUR ASSESSMENT</p><h2>Assessment awaiting payment confirmation</h2><p>Your assessment will become available once your initial consultation and assessment payment has been confirmed.</p><button type="button" class="primary-button" data-assessment-payment>View Payment Request</button><button type="button" class="secondary-button" data-assessment-back-list>Back to assessments</button></section>`;
            container.querySelector("[data-assessment-payment]")?.addEventListener("click", paymentLink);
            container.querySelector("[data-assessment-back-list]")?.addEventListener("click", () => { state.enquiryId = null; render(container); });
            return;
        }
        const readOnly = ["submitted", "under_review", "assessment_completed"].includes(status);
        if (readOnly) {
            container.innerHTML = `<section class="client-assessment-panel"><div class="client-assessment-heading"><div><p class="portal-eyebrow">${escape(statusLabels[status] || "Submitted")}</p><h2>Your Education Assessment</h2><p>Submitted ${escape(formatDate(item.assessment?.submitted_at))}</p></div><button type="button" class="secondary-button" data-assessment-back-list>Back to assessments</button></div>${state.message ? `<p class="client-assessment-feedback" role="status">${escape(state.message)}</p>` : ""}${renderProfile(state.context.client || {})}${renderAnswers(responses)}</section>`;
            container.querySelector("[data-assessment-back-list]")?.addEventListener("click", () => { state.enquiryId = null; render(container); });
            return;
        }
        const stepHeadings = ["", "Your Education Goals", "Your Financial Preparation", "Preparing for Your Journey", "Review and Submit"];
        const current = Math.min(4, Math.max(1, state.step));
        const body = current <= 3 ? `<div class="client-assessment-fields">${renderFields(["", "goals", "financial", "readiness"][current], responses)}</div>` : renderAnswers(responses);
        container.innerHTML = `<section class="client-assessment-panel"><div class="client-assessment-heading"><div><p class="portal-eyebrow">${escape(statusLabels[status] || "Ready to Begin")}</p><h2>Education Assessment</h2><p>About 5–10 minutes · Your answers help our consultant prepare for your conversation.</p></div><button type="button" class="secondary-button" data-assessment-back-list>Back to assessments</button></div>${renderProfile(state.context.client || {})}<div class="client-assessment-progress"><span>Step ${current} of 4</span><div><i style="width:${current * 25}%"></i></div><strong>${escape(stepHeadings[current])}</strong></div>${current === 4 ? `<h3>Review your answers</h3>${body}` : `<form data-assessment-form><fieldset ${state.busy ? "disabled" : ""}><legend>${escape(stepHeadings[current])}</legend>${body}</fieldset></form>`}${state.error ? `<p class="client-assessment-feedback is-error" role="alert">${escape(state.error)}</p>` : ""}${state.message ? `<p class="client-assessment-feedback" role="status">${escape(state.message)}</p>` : ""}<div class="client-assessment-actions">${current > 1 ? '<button type="button" class="secondary-button" data-assessment-prev>Previous</button>' : ""}<button type="button" class="secondary-button" data-assessment-save ${state.busy ? "disabled" : ""}>Save and Continue Later</button>${current < 4 ? `<button type="button" class="primary-button" data-assessment-next ${state.busy ? "disabled" : ""}>${current === 3 ? "Review and Submit" : "Save and Continue"}</button>` : `<button type="button" class="secondary-button" data-assessment-edit>Review and Edit</button><button type="button" class="primary-button" data-assessment-submit ${state.busy ? "disabled" : ""}>Submit Assessment</button>`}</div><p class="client-assessment-note">You can leave at any time and continue later. Your submitted answers are normally read-only.</p></section>`;
        bindWizard(container);
        syncConditionalFields(container);
    }

    function bindList(container) {
        container.querySelectorAll("[data-assessment-open]").forEach(button => button.addEventListener("click", () => {
            const item = (state.context?.enquiries || []).find(entry => String(entry.id) === button.dataset.assessmentOpen);
            if (statusOf(item) === "awaiting_payment") { paymentLink(); return; }
            state.unsaved = null;
            state.enquiryId = button.dataset.assessmentOpen;
            state.step = Math.max(1, Number(item?.assessment?.current_step) || 1);
            render(container);
        }));
    }

    function syncConditionalFields(container) {
        const goals = prefill(selectedEnquiry()).goals || {};
        const pathway = String(container.querySelector('[data-field="goals.pathway"]')?.value ?? goals.pathway ?? "");
        const destination = String(container.querySelector('[data-field="goals.destination"]')?.value ?? goals.destination ?? "");
        const participation = String(container.querySelector('[data-field="goals.participation_mode"]')?.value ?? goals.participation_mode ?? "");
        container.querySelectorAll("[data-pathway]").forEach(element => {
            const visible = element.dataset.pathway.split(",").includes(pathway) &&
                (!element.dataset.germanyOnly || destination.toLowerCase() === "germany") &&
                (!element.dataset.exceptOnline || !(pathway === "conferences" && participation === "Online"));
            element.hidden = !visible;
            element.querySelectorAll("input,select,textarea").forEach(input => { input.disabled = !visible; });
        });
    }

    function collectResponses(container) {
        const item = selectedEnquiry();
        const responses = prefill(item);
        container.querySelectorAll("[data-field]").forEach(input => {
            const [section, key] = input.dataset.field.split(".");
            if (!responses[section]) responses[section] = {};
            responses[section][key] = input.type === "checkbox" ? input.checked : input.value.trim();
        });
        if (responses.financial?.budget_not_determined) {
            responses.financial.budget_amount = "";
            responses.financial.budget_currency = "";
        }
        const pathway = responses.goals?.pathway;
        const destination = String(responses.goals?.destination || "").trim().toLowerCase();
        const online = pathway === "conferences" && responses.goals?.participation_mode === "Online";
        for (const [section, definitions] of Object.entries(fields)) {
            if (!responses[section]) continue;
            for (const field of definitions) {
                if ((field.when && !field.when.includes(pathway)) ||
                    (field.germanyOnly && destination !== "germany") ||
                    (field.exceptOnline && online)) delete responses[section][field.key];
            }
        }
        return responses;
    }

    function bindWizard(container) {
        container.querySelector("[data-assessment-back-list]")?.addEventListener("click", () => { state.unsaved = null; state.enquiryId = null; state.error = ""; render(container); });
        container.querySelector('[data-field="goals.pathway"]')?.addEventListener("change", () => syncConditionalFields(container));
        container.querySelector('[data-field="goals.destination"]')?.addEventListener("input", () => syncConditionalFields(container));
        container.querySelector('[data-field="goals.participation_mode"]')?.addEventListener("change", () => syncConditionalFields(container));
        container.querySelector("[data-assessment-prev]")?.addEventListener("click", () => { state.unsaved = { id: state.enquiryId, responses: collectResponses(container) }; state.step -= 1; state.error = ""; render(container); });
        container.querySelector("[data-assessment-edit]")?.addEventListener("click", () => { state.step = 1; render(container); });
        container.querySelector("[data-assessment-next]")?.addEventListener("click", async () => {
            const responses = collectResponses(container);
            state.unsaved = { id: state.enquiryId, responses };
            if (state.step === 1 && (!responses.goals.pathway || !responses.goals.destination)) {
                state.error = "Choose an intended pathway and preferred destination, or select ‘Not yet decided’.";
                render(container);
                return;
            }
            if (state.step === 2 && (!responses.financial.funding_source || !responses.financial.financial_preparation || !responses.financial.consultancy_readiness)) {
                state.error = "Please complete the required financial readiness questions.";
                render(container);
                return;
            }
            if (state.step === 3 && !responses.readiness.start_timing) {
                state.error = "Please choose when you would like to begin, or select ‘Not yet decided’.";
                render(container);
                return;
            }
            state.busy = true;
            try {
                await saveDraft(responses, state.step + 1);
                state.step += 1;
                state.message = "Your progress has been saved.";
            } catch (error) { state.error = error.message || "Your progress could not be saved."; }
            finally { state.busy = false; render(container); }
        });
        container.querySelector("[data-assessment-save]")?.addEventListener("click", async () => {
            state.busy = true; state.error = ""; state.message = "Saving your draft…";
            try { const responses = collectResponses(container); state.unsaved = { id: state.enquiryId, responses }; await saveDraft(responses, state.step); state.message = "Your draft is saved. You can continue later."; }
            catch (error) { state.error = error.message || "Your draft could not be saved."; state.message = ""; }
            finally { state.busy = false; render(container); }
        });
        container.querySelector("[data-assessment-submit]")?.addEventListener("click", () => void submit(container));
    }

    async function saveDraft(responses, step) {
        const { data, error } = await rpc("save_my_client_assessment_draft", {
            p_enquiry_id: state.enquiryId, p_responses: responses, p_current_step: step
        });
        if (error) throw error;
        if (!data) throw new Error("The database did not confirm the saved draft.");
        state.unsaved = null;
        await loadContext();
    }

    async function submit(container) {
        if (state.busy) return;
        const responses = collectResponses(container);
        state.unsaved = { id: state.enquiryId, responses };
        state.busy = true; state.error = ""; state.message = "Submitting your assessment…"; render(container);
        try {
            const { data, error } = await rpc("submit_my_client_assessment", { p_enquiry_id: state.enquiryId, p_responses: responses });
            if (error) throw error;
            if (!data) throw new Error("The database did not confirm your submission.");
            state.unsaved = null;
            await loadContext();
            state.message = "Thank you for completing your assessment. Our consultancy team will review your information and use it to prepare for your consultation and develop a suitable strategy for your international journey.";
            state.step = 1;
        } catch (error) {
            const message = error.message || "Your assessment could not be submitted.";
            try {
                await loadContext();
                const refreshed = selectedEnquiry();
                if (["submitted", "under_review", "assessment_completed"].includes(statusOf(refreshed))) {
                    state.unsaved = null;
                    state.message = "Your assessment has been submitted and is available to your consultant.";
                    state.error = "";
                    return;
                }
            } catch { /* Keep original submission error. */ }
            state.error = message;
            state.message = "";
        } finally { state.busy = false; render(container); renderSummary(); }
    }

    async function render(container) {
        if (!container) return;
        container.innerHTML = '<section class="client-assessment-panel"><p role="status">Loading your assessment…</p></section>';
        try {
            await loadContext();
            if (state.enquiryId) renderWizard(container);
            else { container.innerHTML = renderList(); bindList(container); }
        } catch (error) {
            state.context = { enquiries: [], error: error.message || "Assessment information is temporarily unavailable." };
            container.innerHTML = `<section class="client-assessment-panel"><p class="portal-eyebrow">YOUR ASSESSMENT</p><h2>Assessment information unavailable</h2><p role="alert">${escape(state.context.error)}</p><button type="button" class="secondary-button" data-assessment-retry>Try again</button></section>`;
            container.querySelector("[data-assessment-retry]")?.addEventListener("click", () => void render(container));
        }
        renderSummary();
    }

    async function refreshSummary() {
        const host = document.getElementById("client-assessment-overview-card");
        if (!host || state.summaryLoading) return;
        state.summaryLoading = true; renderSummary();
        try { await loadContext(); }
        catch (error) { state.context = { enquiries: [], error: error.message || "Assessment status is temporarily unavailable." }; }
        finally { state.summaryLoading = false; renderSummary(); }
    }

    window.LORDBLESS_CLIENT_ASSESSMENT = { render, refreshSummary };
})();
