/* =========================================
   LORDBLESS ADMIN CLIENT DETAILS
========================================= */

(function () {
    function escapeClientDetails(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function textValue(value) {
        if (Array.isArray(value)) {
            return value.map(textValue).filter(Boolean).join(", ");
        }
        if (value === null || value === undefined || typeof value === "object") {
            return "";
        }
        return String(value).trim();
    }

    function labelFor(key) {
        return String(key)
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .replace(/\b\w/g, character => character.toUpperCase());
    }

    function clientDisplayId(client) {
        const permanentId = client?.clientCode || client?.client_code;
        if (permanentId) return permanentId;

        const internalId = String(client?.id || "").trim();
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(internalId);

        return isUuid ? "ID pending" : internalId || "ID pending";
    }

    function detailRows(values) {
        return Object.entries(values || {})
            .map(([key, value]) => ({ key, value: textValue(value) }))
            .filter(item => item.value)
            .map(item => `
                <div class="detail-row">
                    <span>${escapeClientDetails(labelFor(item.key))}</span>
                    <strong>${escapeClientDetails(item.value)}</strong>
                </div>
            `)
            .join("");
    }

    function serviceSections(enquiry) {
        const serviceValues = Array.isArray(enquiry.services)
            ? enquiry.services
            : enquiry.services ? [enquiry.services]
                : enquiry.service ? [enquiry.service] : [];
        const requested = serviceValues.map(value => textValue(value).toLowerCase());
        const sections = [
            { key: "education", title: "Education", matches: ["education", "study", "university"] },
            { key: "careers", title: "Careers and Work", matches: ["career", "work", "job"] },
            { key: "travel", title: "Travel", matches: ["travel", "tourism", "business travel"] },
            { key: "business", title: "Business", matches: ["business", "trade"] },
            { key: "mobility", title: "Global Mobility", matches: ["mobility", "settlement", "migration"] },
            { key: "general", title: "General Request", matches: ["general", "other"] }
        ];
        const relevant = sections.filter(section =>
            requested.some(service => section.matches.some(match => service.includes(match)))
        );
        const selectedSections = relevant.length
            ? relevant
            : sections.filter(section => detailRows(enquiry[section.key] || ""));

        return selectedSections.map(section => {
            const rows = detailRows(enquiry[section.key]);
            return rows ? `
                <section class="detail-card full-width">
                    <h3>${escapeClientDetails(section.title)} Details</h3>
                    ${rows}
                </section>
            ` : "";
        }).join("");
    }

    function accessStatus(portalState) {
        if (portalState.loading) return "Checking portal account…";
        if (portalState.error) return "Unable to verify";
        if (!portalState.account) return "Not Created";

        const status = String(portalState.account.access_status || "").trim();
        if (!status) return "Status unavailable";
        return status.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
    }

    function renderPortalAccess(portalState, clientId) {
        const status = accessStatus(portalState);
        const canCreate = Boolean(
            !portalState.loading &&
            !portalState.error &&
            !portalState.account &&
            portalState.canCreate &&
            clientId
        );
        const canResendInvitation = Boolean(
            !portalState.loading &&
            !portalState.error &&
            portalState.account?.access_status === "invited" &&
            portalState.canResend &&
            clientId
        );

        return `
            <section class="detail-card full-width" aria-labelledby="client-portal-access-title">
                <h3 id="client-portal-access-title">Portal Access</h3>
                <div class="detail-row">
                    <span>Portal Account</span>
                    <strong>${escapeClientDetails(status)}</strong>
                </div>
                ${portalState.error
                    ? `<p class="client-portal-access-message" role="alert">${escapeClientDetails(portalState.error)}</p>`
                    : ""}
                ${portalState.message
                    ? `<p class="client-portal-access-message" role="status">${escapeClientDetails(portalState.message)}</p>`
                    : ""}
                ${canCreate ? `
                    <button
                        type="button"
                        class="button button-primary"
                        data-client-portal-action="create"
                        data-client-id="${escapeClientDetails(clientId)}"
                    >
                        CREATE PORTAL ACCESS
                    </button>
                    <p data-client-portal-message class="client-portal-access-message" role="status" aria-live="polite"></p>
                ` : ""}
                ${canResendInvitation ? `
                    <button
                        type="button"
                        class="button button-primary"
                        data-client-portal-action="resend-invitation"
                        data-client-id="${escapeClientDetails(clientId)}"
                    >
                        RESEND INVITATION
                    </button>
                    <p data-client-portal-message class="client-portal-access-message" role="status" aria-live="polite"></p>
                ` : ""}
                ${!portalState.loading && !portalState.error && !portalState.account && !portalState.canCreate
                    ? `<p>Portal access can only be created by an administrator with the required permission.</p>`
                    : ""}
            </section>
        `;
    }

    function meetingTimeParts(meeting) {
        if (!meeting?.starts_at || !meeting?.timezone) return { date: "", time: "" };
        const date = new Date(meeting.starts_at);
        if (Number.isNaN(date.getTime())) return { date: "", time: "" };
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: meeting.timezone,
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(date).reduce((result, part) => {
            if (part.type !== "literal") result[part.type] = part.value;
            return result;
        }, {});
        return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
    }

    function meetingTimeLabel(meeting) {
        if (!meeting?.starts_at) return "—";
        const date = new Date(meeting.starts_at);
        if (Number.isNaN(date.getTime())) return "—";
        try {
            return `${new Intl.DateTimeFormat("en-GB", {
                dateStyle: "full", timeStyle: "short", timeZone: meeting.timezone || "UTC"
            }).format(date)} (${meeting.timezone || "UTC"})`;
        } catch {
            return `${date.toLocaleString()} (${meeting.timezone || "UTC"})`;
        }
    }

    function renderAssessment(model, clientId) {
        const payment = model.assessmentPayment || null;
        const meeting = model.consultationMeeting || null;
        if (!model.canReadAssessment) {
            return `<section class="detail-card full-width"><h3>Initial Assessment &amp; Consultation</h3><p>Finance permission is required to view this assessment payment.</p></section>`;
        }
        const canManagePaymentRequest = Boolean(
            model.canCreateAssessment &&
            clientId &&
            (!payment || (
                payment.status === "requested" &&
                !payment.client_payment_submitted_at &&
                !["pending", "verified"].includes(payment.verification_status)
            ))
        );
        const canSetInstructions = Boolean(
            model.canCreateAssessment && payment?.status === "requested"
        );
        const canSchedule = Boolean(model.canScheduleConsultation && payment?.status === "paid" && payment?.verification_status === "verified");
        const inputs = meetingTimeParts(meeting);
        const outstanding = payment?.status === "paid" && payment?.verification_status === "verified"
            ? 0
            : Math.max(0, Number(payment?.amount || 1000) - Number(payment?.amount_received || 0));
        const standardAmount = Number(payment?.standard_amount ?? 1000);
        const discountAmount = Number(payment?.discount_amount ?? 0);
        const payableAmount = Number(payment?.amount ?? standardAmount);
        const paymentStatus = !payment
            ? "Not requested"
            : payment.status === "paid" && payment.verification_status === "verified"
                ? "Paid and verified"
                : String(payment.status || "requested").replaceAll("_", " ");
        const meetingStatus = meeting
            ? String(meeting.status || "scheduled").replaceAll("_", " ")
            : "Not scheduled";
        const verifiedPayment = payment?.status === "paid" && payment?.verification_status === "verified";
        const verifiedWithReceipt = verifiedPayment && payment?.receipt_number && payment?.receipt_issued_at;
        const financeSummary = verifiedWithReceipt
            ? "Consultation paid in full"
            : verifiedPayment
                ? "Payment verified · receipt pending"
            : payment ? `${paymentStatus} · GHS ${payableAmount.toFixed(2)} payable` : "Not requested";

        return `
            <details class="client-detail-accordion full-width">
                <summary><span>Finance · Initial Assessment &amp; Consultation</span><strong>${escapeClientDetails(financeSummary)}</strong></summary>
                <div class="client-detail-accordion-content">
                ${verifiedWithReceipt ? `
                    <p class="client-payment-complete-status"><strong>Consultation paid in full</strong></p>
                    <div class="detail-row"><span>Official receipt</span><strong>${escapeClientDetails(payment.receipt_number)}</strong></div>
                    <p>The official receipt remains available in Finance → Receipts.</p>
                ` : `
                    <h3 id="client-assessment-title">Initial Assessment &amp; Consultation</h3>
                    <div class="detail-row"><span>Assessment service</span><strong>Initial Assessment &amp; 30-Minute Consultation</strong></div>
                    <div class="detail-row"><span>Standard fee</span><strong>GHS ${standardAmount.toFixed(2)}</strong></div>
                    <div class="detail-row"><span>Authorized discount</span><strong>GHS ${discountAmount.toFixed(2)}</strong></div>
                    <div class="detail-row"><span>Amount payable</span><strong>GHS ${payableAmount.toFixed(2)}</strong></div>
                    <div class="detail-row"><span>Payment status</span><strong>${escapeClientDetails(paymentStatus)}</strong></div>
                    <div class="detail-row"><span>Outstanding amount</span><strong>GHS ${outstanding.toFixed(2)}</strong></div>
                    <div class="detail-row"><span>Verification status</span><strong>${escapeClientDetails(payment?.verification_status || "Not verified")}</strong></div>
                    ${payment ? `<div class="detail-row"><span>Request reference</span><strong>${escapeClientDetails(payment.reference || "—")}</strong></div>` : ""}
                    ${payment?.payment_instructions && payment?.verification_status !== "verified"
                        ? `<p>${escapeClientDetails(payment.payment_instructions)}</p>`
                        : payment && payment?.verification_status !== "verified" && payment.status !== "paid"
                            ? `<p>Payment instructions are pending Finance confirmation.</p>`
                            : ""}
                `}
                ${canSetInstructions ? `
                    <form data-assessment-instructions-form data-payment-id="${escapeClientDetails(payment.id)}">
                        <label>FINANCE-APPROVED PAYMENT INSTRUCTIONS
                            <textarea name="payment_instructions" maxlength="2000" required>${escapeClientDetails(payment.payment_instructions || "")}</textarea>
                        </label>
                        <button type="submit" class="button button-secondary">SAVE APPROVED PAYMENT INSTRUCTIONS</button>
                    </form>
                ` : ""}
                ${model.assessmentError ? `<p role="alert">${escapeClientDetails(model.assessmentError)}</p>` : ""}
                ${canManagePaymentRequest ? `
                    <form data-assessment-request-form data-client-id="${escapeClientDetails(clientId)}" data-payment-id="${escapeClientDetails(payment?.id || "")}" data-action="${payment ? "update" : "create"}">
                        <label>OPTIONAL DISCOUNT (GHS)
                            <input name="discount_amount" type="number" min="0" max="999.99" step="0.01" value="${discountAmount.toFixed(2)}" required>
                        </label>
                        <div class="detail-row"><span>Final amount payable</span><strong>GHS <span data-assessment-payable-amount>${payableAmount.toFixed(2)}</span></strong></div>
                        <button type="submit" class="button button-primary">${payment ? "UPDATE EXISTING PAYMENT REQUEST" : "CREATE ASSESSMENT PAYMENT REQUEST"}</button>
                    </form>
                ` : ""}
                <div class="detail-row"><span>Meeting status</span><strong>${escapeClientDetails(meetingStatus)}</strong></div>
                ${meeting ? `
                    <div class="detail-row"><span>Scheduled meeting</span><strong>${escapeClientDetails(meetingTimeLabel(meeting))}</strong></div>
                    <div class="detail-row"><span>Duration</span><strong>${escapeClientDetails(meeting.duration_minutes || 30)} minutes</strong></div>
                    <div class="detail-row"><span>Mode</span><strong>${escapeClientDetails(meeting.mode || "—")}</strong></div>
                    ${meeting.location ? `<div class="detail-row"><span>Location</span><strong>${escapeClientDetails(meeting.location)}</strong></div>` : ""}
                    ${meeting.meeting_link ? `<div class="detail-row"><span>Meeting link</span><strong>${escapeClientDetails(meeting.meeting_link)}</strong></div>` : ""}
                    ${meeting.instructions ? `<div class="detail-row"><span>Instructions</span><strong>${escapeClientDetails(meeting.instructions)}</strong></div>` : ""}
                    ${canSchedule && meeting.status === "scheduled" ? `<button type="button" class="button button-secondary" data-consultation-cancel data-client-id="${escapeClientDetails(clientId)}">CANCEL CONSULTATION</button>` : ""}
                ` : ""}
                ${canSchedule ? `
                    <form data-consultation-form data-client-id="${escapeClientDetails(clientId)}">
                        <label>MEETING DATE<input name="meeting_date" type="date" required value="${escapeClientDetails(inputs.date)}"></label>
                        <label>START TIME<input name="meeting_time" type="time" required value="${escapeClientDetails(inputs.time)}"></label>
                        <label>TIMEZONE<select name="timezone" required>
                            ${["Europe/Berlin", "Africa/Accra", "UTC", "America/Toronto", "Asia/Shanghai"].map(zone => `<option value="${zone}" ${(meeting?.timezone || "Europe/Berlin") === zone ? "selected" : ""}>${zone}</option>`).join("")}
                        </select></label>
                        <label>DURATION (MINUTES)<input name="duration_minutes" type="number" min="15" max="120" step="15" value="${escapeClientDetails(meeting?.duration_minutes || 30)}" required></label>
                        <label>MODE<select name="mode"><option value="online" ${meeting?.mode === "online" ? "selected" : ""}>Online</option><option value="phone" ${meeting?.mode === "phone" ? "selected" : ""}>Phone</option><option value="in_person" ${meeting?.mode === "in_person" ? "selected" : ""}>In person</option></select></label>
                        <label>LOCATION<input name="location" type="text" value="${escapeClientDetails(meeting?.location || "")}"></label>
                        <label>MEETING LINK<input name="meeting_link" type="url" value="${escapeClientDetails(meeting?.meeting_link || "")}"></label>
                        <label>CLIENT INSTRUCTIONS<textarea name="instructions">${escapeClientDetails(meeting?.instructions || "")}</textarea></label>
                        <button type="submit" class="button button-primary">${meeting ? "RESCHEDULE CONSULTATION" : "SCHEDULE 30-MINUTE CONSULTATION"}</button>
                    </form>
                ` : ""}
                <p data-assessment-message role="status" aria-live="polite"></p>
                </div>
            </details>
        `;
    }

    function renderAppointments(model, clientId) {
        if (!model.canManageAppointments) return "";
        const appointments = Array.isArray(model.appointments) ? model.appointments : [];
        const rows = appointments.length ? appointments.map(appointment => `
            <article class="detail-card">
                <h4>${escapeClientDetails(appointment.title || "Appointment")}</h4>
                <div class="detail-row"><span>When</span><strong>${escapeClientDetails(meetingTimeLabel(appointment))}</strong></div>
                <div class="detail-row"><span>Duration</span><strong>${escapeClientDetails(appointment.duration_minutes || 30)} minutes</strong></div>
                <div class="detail-row"><span>Channel</span><strong>${escapeClientDetails(appointment.channel || "—")}</strong></div>
                <div class="detail-row"><span>Status</span><strong>${escapeClientDetails(appointment.status || "scheduled")}</strong></div>
                ${appointment.location ? `<div class="detail-row"><span>Location</span><strong>${escapeClientDetails(appointment.location)}</strong></div>` : ""}
                ${appointment.meeting_link ? `<div class="detail-row"><span>Meeting link</span><strong>${escapeClientDetails(appointment.meeting_link)}</strong></div>` : ""}
                ${appointment.instructions ? `<p>${escapeClientDetails(appointment.instructions)}</p>` : ""}
                ${appointment.status === "scheduled" ? `
                    <button type="button" class="button button-secondary" data-appointment-edit="${escapeClientDetails(appointment.id)}">RESCHEDULE</button>
                    <button type="button" class="button button-secondary" data-appointment-status="completed" data-appointment-id="${escapeClientDetails(appointment.id)}">MARK COMPLETED</button>
                    <button type="button" class="button button-secondary" data-appointment-status="cancelled" data-appointment-id="${escapeClientDetails(appointment.id)}">CANCEL APPOINTMENT</button>
                ` : ""}
            </article>
        `).join("") : `<p>No appointments have been scheduled.</p>`;

        return `
            <details class="client-detail-accordion full-width">
                <summary><span>Appointments</span><strong>${appointments.length ? `${appointments.length} recorded · ${escapeClientDetails(appointments[0].status || "scheduled")}` : "No appointments scheduled"}</strong></summary>
                <div class="client-detail-accordion-content">
                <h3 id="client-appointments-title">Appointments</h3>
                <p>Use this for ongoing client appointments. Initial Assessment &amp; Consultation remains in its payment-gated workflow.</p>
                ${model.appointmentError ? `<p role="alert">${escapeClientDetails(model.appointmentError)}</p>` : ""}
                <div class="detail-grid">${rows}</div>
                <form data-client-appointment-form data-client-id="${escapeClientDetails(clientId)}">
                    <label>APPOINTMENT TITLE<input name="title" type="text" maxlength="160" required></label>
                    <label>DATE<input name="meeting_date" type="date" required></label>
                    <label>START TIME<input name="meeting_time" type="time" required></label>
                    <label>TIMEZONE<select name="timezone" required>
                        ${["Europe/Berlin", "Africa/Accra", "UTC", "America/Toronto", "Asia/Shanghai"].map(zone => `<option value="${zone}" ${zone === "Europe/Berlin" ? "selected" : ""}>${zone}</option>`).join("")}
                    </select></label>
                    <label>DURATION (MINUTES)<input name="duration_minutes" type="number" min="15" max="480" step="15" value="30" required></label>
                    <label>CHANNEL<select name="channel"><option value="online">Online</option><option value="whatsapp">WhatsApp</option><option value="phone">Phone</option><option value="in_person">In person</option></select></label>
                    <label>LOCATION<input name="location" type="text" maxlength="500"></label>
                    <label>MEETING LINK<input name="meeting_link" type="url" maxlength="2000"></label>
                    <label>CLIENT INSTRUCTIONS<textarea name="instructions" maxlength="2000"></textarea></label>
                    <button type="submit" class="button button-primary" data-appointment-submit>SCHEDULE APPOINTMENT</button>
                </form>
                <p data-appointment-message role="status" aria-live="polite"></p>
                </div>
            </details>
        `;
    }

    function renderClientDocuments(model) {
        if (!model.canReadDocuments) return "";
        const documents = Array.isArray(model.clientDocuments) ? model.clientDocuments : [];
        const requests = Array.isArray(model.documentRequests) ? model.documentRequests : [];
        const openRequests = requests.filter(item => !["approved", "waived", "cancelled"].includes(String(item.status || "requested").toLowerCase()));
        const documentRows = documents.length ? documents.map(document => `
            <article class="client-workspace-row">
                <strong>${escapeClientDetails(document.document_name || document.name || document.title || document.document_type || "Client document")}</strong>
                <span>${escapeClientDetails(document.document_type || document.type || "Document")} · ${escapeClientDetails(document.status || document.review_status || "uploaded")}</span>
                <span>${escapeClientDetails(document.file_name || document.original_filename || document.filename || "File record")}</span>
            </article>
        `).join("") : "<p>No uploaded document records.</p>";
        const requestRows = requests.length ? requests.map(request => `
            <article class="client-workspace-row">
                <strong>${escapeClientDetails(request.document_name || request.document_type || request.title || "Requested document")}</strong>
                <span>${escapeClientDetails(request.status || "requested")}${request.deadline || request.due_date ? ` · due ${escapeClientDetails(request.deadline || request.due_date)}` : ""}</span>
                ${request.instructions || request.message ? `<p>${escapeClientDetails(request.instructions || request.message)}</p>` : ""}
            </article>
        `).join("") : "<p>No document requests have been recorded.</p>";

        return `
            <details class="client-detail-accordion full-width">
                <summary><span>Documents</span><strong>${documents.length} uploaded · ${openRequests.length} open requests</strong></summary>
                <div class="client-detail-accordion-content">
                    ${model.documentError ? `<p role="alert">${escapeClientDetails(model.documentError)}</p>` : ""}
                    <h4>Uploaded documents (${documents.length})</h4>${documentRows}
                    <h4>Requested documents (${requests.length})</h4>${requestRows}
                    <p>Private preview and download controls appear in the Documents workspace only when secure Storage access is configured.</p>
                </div>
            </details>
        `;
    }

    function renderClientFollowups(model, clientId) {
        if (!model.canReadFollowups) return "";
        const followups = Array.isArray(model.clientFollowups) ? model.clientFollowups : [];
        const rows = followups.length ? followups.map(item => `
            <article class="client-workspace-row">
                <strong>${escapeClientDetails(item.task_type.replaceAll("_", " "))} · ${escapeClientDetails(item.status.replaceAll("_", " "))}</strong>
                <span>Due ${escapeClientDetails(item.due_date)} · ${escapeClientDetails(item.priority)}</span>
                ${item.notes ? `<p>${escapeClientDetails(item.notes)}</p>` : ""}
            </article>
        `).join("") : "<p>No follow-up actions are recorded.</p>";
        return `
            <details class="client-detail-accordion full-width">
                <summary><span>Follow-ups</span><strong>${followups.filter(item => !["completed", "cancelled"].includes(item.status)).length} open · ${followups.length} total</strong></summary>
                <div class="client-detail-accordion-content">
                    ${model.followupError ? `<p role="alert">${escapeClientDetails(model.followupError)}</p>` : ""}
                    ${rows}
                    ${model.canWriteFollowups ? `
                        <form data-client-followup-form data-client-id="${escapeClientDetails(clientId)}">
                            <label>Due date<input name="due_date" type="date" required></label>
                            <label>Task type<select name="task_type" required><option value="client_decision">Client decision</option><option value="enquiry_contact">Client contact</option><option value="missing_document">Missing document</option><option value="payment_reminder">Payment reminder</option><option value="consultation">Consultation</option><option value="other">Other</option></select></label>
                            <label>Priority<select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                            <label>Notes<textarea name="notes" rows="2" maxlength="3000"></textarea></label>
                            <button class="button button-secondary" type="submit">ADD FOLLOW-UP</button>
                            <p data-client-followup-message role="status" aria-live="polite"></p>
                        </form>
                    ` : ""}
                </div>
            </details>
        `;
    }

    function renderEnquiry(container, model) {
        const enquiry = model.enquiry || {};
        const client = { ...(enquiry.client || {}), ...(model.client || {}) };
        const journey = enquiry.journey && typeof enquiry.journey === "object"
            ? enquiry.journey
            : {};
        const travel = enquiry.travel && typeof enquiry.travel === "object"
            ? enquiry.travel
            : {};
        const clientName = client.fullName || client.full_name || enquiry.client_name || enquiry.full_name;
        const destination = journey.destination || enquiry.destination || travel.destination;
        const timeframe = journey.timeframe || journey.travelDates || journey.travel_dates ||
            enquiry.timeframe || enquiry.travel_dates || enquiry.travelDates || travel.travelPeriod;
        const preferredContact = journey.preferredContact || journey.preferred_contact ||
            enquiry.preferredContact || enquiry.preferred_contact;
        const additionalInformation = journey.additionalInformation || journey.additional_information ||
            enquiry.additionalInformation || enquiry.additional_information ||
            enquiry.general?.additionalInformation;
        const services = Array.isArray(enquiry.services)
            ? enquiry.services
            : enquiry.services ? [enquiry.services]
                : enquiry.service ? [enquiry.service] : [];
        const submitted = enquiry.createdAt || enquiry.created_at || enquiry.submitted_at ||
            enquiry.submittedAt || "";
        const portalState = model.portalState || model;

        container.innerHTML = `
            <div class="enquiry-detail-page client-enquiry-view">
                <div class="detail-page-header">
                    <div>
                        <div class="topbar-label">CLIENT DETAILS</div>
                        <h2>${escapeClientDetails(clientName || "Client")}</h2>
                        <p>${escapeClientDetails(enquiry.reference || enquiry.enquiry_reference || enquiry.id || "Enquiry")}</p>
                    </div>
                    <button type="button" class="button button-secondary" data-close-client-details>
                        BACK TO ENQUIRIES
                    </button>
                </div>

                <details class="client-detail-accordion full-width">
                    <summary><span>Personal information, enquiry and submitted pathway</span><strong>${escapeClientDetails(services.join(", ") || "Enquiry details")}</strong></summary>
                    <div class="client-detail-accordion-content detail-grid">
                    <section class="detail-card">
                        <h3>Client Information</h3>
                        ${detailRows({
                            "Client ID": clientDisplayId(client),
                            "Full name": clientName,
                            Email: client.email || enquiry.client_email || enquiry.email,
                            WhatsApp: client.whatsapp || client.phone || enquiry.client_whatsapp || enquiry.whatsapp,
                            "Current country": client.currentCountry || client.current_country || enquiry.current_country,
                            Nationality: client.nationality || enquiry.nationality
                        }) || `<p>Client information has not been provided.</p>`}
                    </section>

                    <section class="detail-card">
                        <h3>Enquiry Information</h3>
                        ${detailRows({
                            "Enquiry reference": enquiry.reference || enquiry.enquiry_reference || enquiry.id,
                            "Submission date": submitted,
                            Status: enquiry.status,
                            "Services requested": services,
                            Destination: destination,
                            "Timeframe / travel dates": timeframe,
                            "Preferred contact": preferredContact,
                            Purpose: enquiry.purpose || travel.purpose || enquiry.business?.purpose
                        }) || `<p>Enquiry details have not been provided.</p>`}
                    </section>

                    ${serviceSections(enquiry)}

                    <section class="detail-card full-width">
                        <h3>Additional Information</h3>
                        <p>${escapeClientDetails(textValue(additionalInformation) || "Not provided")}</p>
                    </section>
                    </div>
                </details>
                ${renderAssessment(model, model.clientId)}
                ${renderAppointments(model, model.clientId)}
                ${renderClientDocuments(model)}
                ${renderClientFollowups(model, model.clientId)}
                ${renderPortalAccess(portalState, model.clientId)}
            </div>
        `;

        container.querySelector("[data-close-client-details]")?.addEventListener("click", () => {
            document.getElementById("enquiry-modal")?.classList.add("hidden");
        });
    }

    window.LORDBLESS_CLIENT_DETAILS = window.LORDBLESS_CLIENT_DETAILS || {};
    window.LORDBLESS_CLIENT_DETAILS.renderEnquiry = renderEnquiry;
})();
