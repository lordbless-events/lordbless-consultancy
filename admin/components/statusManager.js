/* =========================================
   LORDBLESS ADMIN
   STATUS MANAGER
========================================= */

const LORDBLESS_STATUS_LABELS = {

    new: "New",

    reviewing: "Reviewing",

    contacted: "Contacted",

    detailed_form: "Detailed Form",

    documents: "Documents",

    payment_pending: "Payment Pending",

    assessment: "Assessment",

    processing: "Processing",

    completed: "Completed",

    closed: "Closed",

    spam: "Spam"

};


/* =========================================
   STATUS BADGE
========================================= */

function renderStatusBadge(status) {

    const label =
        LORDBLESS_STATUS_LABELS[status] ||
        status;


    return `

        <span class="
            status
            status-${escapeHTML(status)}
        ">

            ${escapeHTML(label)}

        </span>

    `;

}


/* =========================================
   STATUS SELECT
========================================= */

function renderStatusSelector(
    enquiry
) {

    const statuses =
        LORDBLESS_MOCK_DATA.statuses;


    return `

        <div class="status-control">

            <label>
                Enquiry Status
            </label>

            <select
                class="filter-select"
                id="status-select"
                data-reference="${escapeHTML(
                    enquiry.reference
                )}"
                ${
                    typeof hasPermission === "function" &&
                    !hasPermission(getCurrentUser(), "enquiries.write")
                        ? "disabled"
                        : ""
                }
            >

                ${statuses
                    .map(status => `

                        <option
                            value="${escapeHTML(status)}"
                            ${
                                enquiry.status === status
                                    ? "selected"
                                    : ""
                            }
                        >

                            ${escapeHTML(
                                LORDBLESS_STATUS_LABELS[
                                    status
                                ] || status
                            )}

                        </option>

                    `)
                    .join("")}

            </select>

            <span data-enquiry-status-message role="status" aria-live="polite"></span>

        </div>

    `;

}


/* =========================================
   STATUS EVENT
========================================= */

function initialiseStatusManager(
    enquiry
) {

    const select =
        document.getElementById(
            "status-select"
        );


    if (!select) {
        return;
    }


    select.addEventListener("change", async event => {
        const nextStatus = event.target.value;
        const previousStatus = enquiry.status;
        const message = select.parentElement?.querySelector("[data-enquiry-status-message]");

        if (typeof window.LORDBLESS_ADMIN_UPDATE_ENQUIRY_STATUS !== "function") {
            select.value = previousStatus;
            return;
        }

        select.disabled = true;
        if (message) message.textContent = "Saving…";

        const result = await window.LORDBLESS_ADMIN_UPDATE_ENQUIRY_STATUS(enquiry, nextStatus);
        if (!result.ok) {
            select.value = previousStatus;
            select.disabled = false;
            if (message) message.textContent = result.error;
            return;
        }

        if (typeof renderDashboard === "function") renderDashboard();
        if (typeof openEnquiry === "function") openEnquiry(enquiry.reference);
    });

}
