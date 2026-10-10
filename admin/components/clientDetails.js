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
        const canCreate = Boolean(model.canCreateAssessment && !payment && clientId);
        const canSetInstructions = Boolean(
            model.canCreateAssessment && payment?.status === "requested"
        );
        const canSchedule = Boolean(model.canScheduleConsultation && payment?.status === "paid" && payment?.verification_status === "verified");
        const inputs = meetingTimeParts(meeting);
        const email = model.consultationEmail || null;
        const outstanding = payment?.status === "paid" && payment?.verification_status === "verified"
            ? 0
            : Math.max(0, Number(payment?.amount || 1000) - Number(payment?.amount_received || 0));
        const paymentStatus = !payment
            ? "Not requested"
            : payment.status === "paid" && payment.verification_status === "verified"
                ? "Paid and verified"
                : String(payment.status || "requested").replaceAll("_", " ");
        const meetingStatus = meeting
            ? String(meeting.status || "scheduled").replaceAll("_", " ")
            : "Not scheduled";

        return `
            <section class="detail-card full-width" aria-labelledby="client-assessment-title">
                <h3 id="client-assessment-title">Initial Assessment &amp; Consultation</h3>
                <div class="detail-row"><span>Assessment service</span><strong>Initial Assessment &amp; 30-Minute Consultation</strong></div>
                <div class="detail-row"><span>Fee</span><strong>GHS 1,000.00</strong></div>
                <div class="detail-row"><span>Payment status</span><strong>${escapeClientDetails(paymentStatus)}</strong></div>
                <div class="detail-row"><span>Outstanding amount</span><strong>GHS ${outstanding.toFixed(2)}</strong></div>
                <div class="detail-row"><span>Verification status</span><strong>${escapeClientDetails(payment?.verification_status || "Not verified")}</strong></div>
                ${payment ? `<div class="detail-row"><span>Request reference</span><strong>${escapeClientDetails(payment.reference || "—")}</strong></div>` : ""}
                ${payment?.payment_instructions
                    ? `<p>${escapeClientDetails(payment.payment_instructions)}</p>`
                    : payment && payment.status !== "paid"
                        ? `<p>Payment instructions are pending Finance confirmation. No payment method has been configured here.</p>`
                        : ""}
                ${canSetInstructions ? `
                    <form data-assessment-instructions-form data-payment-id="${escapeClientDetails(payment.id)}">
                        <label>FINANCE-APPROVED PAYMENT INSTRUCTIONS
                            <textarea name="payment_instructions" maxlength="2000" required>${escapeClientDetails(payment.payment_instructions || "")}</textarea>
                        </label>
                        <button type="submit" class="button button-secondary">SAVE APPROVED PAYMENT INSTRUCTIONS</button>
                    </form>
                ` : ""}
                ${model.assessmentError ? `<p role="alert">${escapeClientDetails(model.assessmentError)}</p>` : ""}
                ${canCreate ? `<button type="button" class="button button-primary" data-assessment-create data-client-id="${escapeClientDetails(clientId)}">CREATE GHS 1,000 ASSESSMENT REQUEST</button>` : ""}
                <div class="detail-row"><span>Meeting status</span><strong>${escapeClientDetails(meetingStatus)}</strong></div>
                ${meeting ? `
                    <div class="detail-row"><span>Scheduled meeting</span><strong>${escapeClientDetails(meetingTimeLabel(meeting))}</strong></div>
                    <div class="detail-row"><span>Duration</span><strong>${escapeClientDetails(meeting.duration_minutes || 30)} minutes</strong></div>
                    <div class="detail-row"><span>Mode</span><strong>${escapeClientDetails(meeting.mode || "—")}</strong></div>
                    ${meeting.location ? `<div class="detail-row"><span>Location</span><strong>${escapeClientDetails(meeting.location)}</strong></div>` : ""}
                    ${meeting.meeting_link ? `<div class="detail-row"><span>Meeting link</span><strong>${escapeClientDetails(meeting.meeting_link)}</strong></div>` : ""}
                    ${meeting.instructions ? `<div class="detail-row"><span>Instructions</span><strong>${escapeClientDetails(meeting.instructions)}</strong></div>` : ""}
                    ${email ? `<div class="detail-row"><span>Confirmation email</span><strong>${escapeClientDetails(email.status || "pending")}</strong></div>` : ""}
                    ${email && ["pending", "failed"].includes(email.status) ? `<button type="button" class="button button-secondary" data-consultation-email-retry data-notification-id="${escapeClientDetails(email.notification_id)}">RETRY EMAIL</button>` : ""}
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
            </section>
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

                <div class="detail-grid">
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

                    ${renderAssessment(model, model.clientId)}

                    <section class="detail-card full-width">
                        <h3>Additional Information</h3>
                        <p>${escapeClientDetails(textValue(additionalInformation) || "Not provided")}</p>
                    </section>

                    ${renderPortalAccess(portalState, model.clientId)}
                </div>
            </div>
        `;

        container.querySelector("[data-close-client-details]")?.addEventListener("click", () => {
            document.getElementById("enquiry-modal")?.classList.add("hidden");
        });
    }

    window.LORDBLESS_CLIENT_DETAILS = window.LORDBLESS_CLIENT_DETAILS || {};
    window.LORDBLESS_CLIENT_DETAILS.renderEnquiry = renderEnquiry;
})();
