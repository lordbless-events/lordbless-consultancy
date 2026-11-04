/* =========================================================
   LORDBLESS ADMIN
   DOCUMENT REQUEST
   ========================================================= */


/* =========================================================
   DOCUMENT REQUEST STATE
   ========================================================= */

const LORDBLESS_DOCUMENT_REQUEST_STATE = {

    transaction: null,

    client: null,

    requirement: null,

    request: null,

    isSubmitting: false

};


/* =========================================================
   LOCAL / MOCK REQUEST STORE

   Temporary frontend store for the current development stage.
   Production persistence will move to Supabase later.
========================================================= */

if (!Array.isArray(window.LORDBLESS_DOCUMENT_REQUESTS)) {

    window.LORDBLESS_DOCUMENT_REQUESTS = [];

}


/* =========================================================
   REQUEST TYPES
   ========================================================= */

const LORDBLESS_DOCUMENT_REQUEST_TYPES = {

    MISSING:
        "missing",

    REPLACEMENT:
        "replacement",

    EXPIRED:
        "expired",

    ADDITIONAL:
        "additional"

};


/* =========================================================
   REQUEST STATUS
   ========================================================= */

const LORDBLESS_DOCUMENT_REQUEST_STATUS = {

    DRAFT:
        "draft",

    REQUESTED:
        "requested",

    VIEWED:
        "viewed",

    UPLOADED:
        "uploaded",

    COMPLETED:
        "completed",

    CANCELLED:
        "cancelled"

};


/* =========================================================
   INITIALISE
   ========================================================= */

function initialiseDocumentRequest(
    client,
    transaction,
    requirement,
    requestType = "missing"
) {

    LORDBLESS_DOCUMENT_REQUEST_STATE.client =
        client || null;

    LORDBLESS_DOCUMENT_REQUEST_STATE.transaction =
        transaction || null;

    LORDBLESS_DOCUMENT_REQUEST_STATE.requirement =
        requirement || null;


    LORDBLESS_DOCUMENT_REQUEST_STATE.request = {

        id:
            generateDocumentRequestId(),

        clientId:
            client?.id || null,

        transactionId:
            transaction?.id || null,

        enquiryId:
            transaction?.enquiryId || transaction?.enquiry_id || null,

        requirementId:
            requirement?.requirementId || null,

        documentType:
            requirement?.documentType || null,

        documentName:
            requirement?.name || null,

        type:
            requestType,

        status:
            LORDBLESS_DOCUMENT_REQUEST_STATUS.DRAFT,

        message:
            buildDefaultDocumentRequestMessage(
                requirement,
                requestType
            ),

        createdAt:
            null,

        updatedAt:
            null,

        sentAt:
            null,

        viewedAt:
            null,

        completedAt:
            null

    };

}


/* =========================================================
   REQUEST ID
   ========================================================= */

function generateDocumentRequestId() {

    const timestamp =
        Date.now()
            .toString(36)
            .toUpperCase();

    const random =
        Math.random()
            .toString(36)
            .substring(2, 7)
            .toUpperCase();

    return `DOCREQ-${timestamp}-${random}`;

}


/* =========================================================
   DEFAULT MESSAGE
   ========================================================= */

function buildDefaultDocumentRequestMessage(
    requirement,
    requestType
) {

    const documentName =
        requirement?.name ||
        "document";


    switch (requestType) {

        case LORDBLESS_DOCUMENT_REQUEST_TYPES.REPLACEMENT:

            return `
Dear Client,

We require a new copy of your ${documentName} for your current LORDBLESS journey.

The document previously provided cannot be used for the current stage of your journey.

Please upload a new/current version through your LORDBLESS Client Portal.

Thank you.

LORDBLESS CONSULTANCY
CONNECTING PEOPLE. MOVING POSSIBILITIES.
`.trim();


        case LORDBLESS_DOCUMENT_REQUEST_TYPES.EXPIRED:

            return `
Dear Client,

Your ${documentName} currently available on your LORDBLESS account is no longer valid for this journey.

Please upload a valid/current version through your LORDBLESS Client Portal.

Thank you.

LORDBLESS CONSULTANCY
CONNECTING PEOPLE. MOVING POSSIBILITIES.
`.trim();


        case LORDBLESS_DOCUMENT_REQUEST_TYPES.ADDITIONAL:

            return `
Dear Client,

An additional ${documentName} is required to continue processing your current LORDBLESS journey.

Please upload the requested document through your LORDBLESS Client Portal.

Thank you.

LORDBLESS CONSULTANCY
CONNECTING PEOPLE. MOVING POSSIBILITIES.
`.trim();


        case LORDBLESS_DOCUMENT_REQUEST_TYPES.MISSING:

        default:

            return `
Dear Client,

Your current LORDBLESS journey requires a copy of your ${documentName}.

Please upload the requested document through your LORDBLESS Client Portal.

Thank you.

LORDBLESS CONSULTANCY
CONNECTING PEOPLE. MOVING POSSIBILITIES.
`.trim();

    }

}


/* =========================================================
   RENDER REQUEST PANEL
   ========================================================= */

function renderDocumentRequest(
    container,
    client,
    transaction,
    requirement,
    requestType = "missing"
) {

    if (
        !container ||
        !requirement
    ) {
        return;
    }


    initialiseDocumentRequest(
        client,
        transaction,
        requirement,
        requestType
    );


    const request =
        LORDBLESS_DOCUMENT_REQUEST_STATE.request;


    container.innerHTML = `

        <div class="document-request-panel">


            <div class="document-request-header">

                <div>

                    <span class="section-eyebrow">
                        CLIENT REQUEST
                    </span>

                    <h2>
                        Request Document
                    </h2>

                    <p>
                        Send a document request to the client
                        through the LORDBLESS workflow.
                    </p>

                </div>

            </div>


            <!-- CLIENT -->

            <div class="document-request-section">

                <div class="document-request-section-header">

                    <span class="section-eyebrow">
                        CLIENT
                    </span>

                    <strong>
                        ${escapeDocumentRequestHtml(
                            client?.fullName ||
                            "Client"
                        )}
                    </strong>

                </div>


                <div class="document-request-meta">

                    <div>

                        <span>
                            Client ID
                        </span>

                        <strong>
                            ${escapeDocumentRequestHtml(
                                client?.clientCode || client?.client_code || "ID pending"
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            Email
                        </span>

                        <strong>
                            ${escapeDocumentRequestHtml(
                                client?.email || "—"
                            )}
                        </strong>

                    </div>


                    <div>

                        <span>
                            WhatsApp
                        </span>

                        <strong>
                            ${escapeDocumentRequestHtml(
                                client?.whatsapp || "—"
                            )}
                        </strong>

                    </div>

                </div>

            </div>


            <!-- TRANSACTION -->

            <div class="document-request-section">

                <div class="document-request-section-header">

                    <span class="section-eyebrow">
                        JOURNEY
                    </span>

                    <strong>
                        ${escapeDocumentRequestHtml(
                            transaction?.title ||
                            "Current Transaction"
                        )}
                    </strong>

                </div>


                <p class="document-request-reference">

                    ${escapeDocumentRequestHtml(
                        transaction?.id || "—"
                    )}

                </p>

            </div>


            <!-- DOCUMENT -->

            <div class="document-request-document">

                <div class="document-request-document-icon">
                    DOC
                </div>


                <div>

                    <strong>
                        ${escapeDocumentRequestHtml(
                            requirement.name
                        )}
                    </strong>

                    <span>
                        ${escapeDocumentRequestType(
                            requestType
                        )}
                    </span>

                </div>

            </div>


            <!-- MESSAGE -->

            <div class="document-request-section">

                <label
                    class="document-request-field"
                    for="document-request-message"
                >

                    <span>
                        Message to client
                    </span>

                    <textarea
                        id="document-request-message"
                        rows="9"
                    >${escapeDocumentRequestHtml(
                        request.message
                    )}</textarea>

                </label>

            </div>


            <!-- DELIVERY -->

            <div class="document-request-section">

                <span class="section-eyebrow">
                    DELIVERY
                </span>


                <div class="document-request-delivery">

                    <label>

                        <input
                            type="checkbox"
                            id="request-email"
                            checked
                        >

                        <span>
                            Email
                        </span>

                    </label>


                    <label>

                        <input
                            type="checkbox"
                            id="request-portal"
                            checked
                        >

                        <span>
                            Client Portal
                        </span>

                    </label>


                    <label>

                        <input
                            type="checkbox"
                            id="request-whatsapp"
                        >

                        <span>
                            WhatsApp
                        </span>

                    </label>

                </div>

            </div>


            <!-- ACTIONS -->

            <div class="document-request-actions">

                <button
                    type="button"
                    class="btn btn-secondary"
                    id="cancel-document-request"
                >
                    Cancel
                </button>


                <button
                    type="button"
                    class="btn btn-primary"
                    id="send-document-request"
                >
                    Send Request
                </button>

            </div>


        </div>

    `;


    initialiseDocumentRequestActions(
        container
    );

}


/* =========================================================
   REQUEST TYPE LABEL
   ========================================================= */

function escapeDocumentRequestType(
    requestType
) {

    const labels = {

        missing:
            "Document required",

        replacement:
            "Replacement required",

        expired:
            "Current document expired",

        additional:
            "Additional document required"

    };


    return escapeDocumentRequestHtml(
        labels[requestType] ||
        "Document required"
    );

}


/* =========================================================
   ACTIONS
   ========================================================= */

function initialiseDocumentRequestActions(
    container
) {

    const sendButton =
        container.querySelector(
            "#send-document-request"
        );


    if (sendButton) {

        sendButton.addEventListener(
            "click",
            sendDocumentRequest
        );

    }


    const cancelButton =
        container.querySelector(
            "#cancel-document-request"
        );


    if (cancelButton) {

        cancelButton.addEventListener(
            "click",
            closeDocumentRequest
        );

    }

}


/* =========================================================
   SEND REQUEST
   ========================================================= */

async function sendDocumentRequest() {

    const state =
        LORDBLESS_DOCUMENT_REQUEST_STATE;


    const request =
        state.request;


    if (!request) {
        return;
    }

    if (state.isSubmitting) return;


    const messageElement =
        window.document.getElementById(
            "document-request-message"
        );


    const message =
        messageElement
            ? messageElement.value.trim()
            : "";


    if (!message) {

        showDocumentRequestMessage(
            "Please enter a message before sending the request."
        );

        return;
    }


    const email =
        isRequestChannelSelected(
            "request-email"
        );


    const portal =
        isRequestChannelSelected(
            "request-portal"
        );


    const whatsapp =
        isRequestChannelSelected(
            "request-whatsapp"
        );


    if (
        !email &&
        !portal &&
        !whatsapp
    ) {

        showDocumentRequestMessage(
            "Please select at least one delivery method."
        );

        return;
    }


    const clientId = String(request.clientId || "");
    const databaseClient = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
    if (databaseClient) {
        if (!request.enquiryId || typeof lordblessSupabase === "undefined") {
            showDocumentRequestMessage("A valid client enquiry and authenticated Supabase session are required. No request was created.");
            return;
        }
        state.isSubmitting = true;
        const sendButton = window.document.getElementById("send-document-request");
        if (sendButton) {
            sendButton.disabled = true;
            sendButton.textContent = "Saving request…";
        }
        try {
            const { data, error } = await lordblessSupabase.rpc("create_document_request", {
                p_client_id: clientId,
                p_enquiry_id: request.enquiryId,
                p_requirement_id: request.requirementId || null,
                p_document_type: request.documentType,
                p_document_name: request.documentName,
                p_request_type: request.type,
                p_message: message,
                p_email: email,
                p_portal: portal,
                p_whatsapp: whatsapp
            });
            if (error) throw error;
            if (!data) throw new Error("Supabase did not confirm the document request.");
            const persistedRequest = {
                ...request,
                id: data,
                clientId,
                message,
                status: "requested",
                email,
                portal,
                whatsapp,
                createdAt: new Date().toISOString(),
                sentAt: new Date().toISOString(),
                databaseRequest: true
            };
            dispatchDocumentRequestEvent(persistedRequest);
            showDocumentRequestMessage("Document request saved and sent to the Client Portal.");
            closeDocumentRequest();
        } catch (error) {
            showDocumentRequestMessage(error?.message || "Unable to save the document request.");
            if (sendButton) {
                sendButton.disabled = false;
                sendButton.textContent = "Send Request";
            }
        } finally {
            state.isSubmitting = false;
        }
        return;
    }

    request.message =
        message;


    request.channels = {

        email,

        portal,

        whatsapp

    };


    request.status =
        LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED;


    const now =
        new Date().toISOString();


    request.createdAt =
        request.createdAt ||
        now;


    request.updatedAt =
        now;


    request.sentAt =
        now;


    /*
     * Store the request in the temporary local/mock store.
     * Upsert by request ID to prevent duplicates.
     */

    const requestStore =
        Array.isArray(
            window.LORDBLESS_DOCUMENT_REQUESTS
        )
            ? window.LORDBLESS_DOCUMENT_REQUESTS
            : [];


    const existingIndex =
        requestStore.findIndex(
            item =>
                item &&
                item.id === request.id
        );


    if (existingIndex >= 0) {

        requestStore[existingIndex] = {
            ...request
        };

    } else {

        requestStore.unshift({
            ...request
        });

    }


    window.LORDBLESS_DOCUMENT_REQUESTS =
        requestStore;


    /*
     * Update the transaction requirement.
     */

    if (
        state.requirement
    ) {

        state.requirement.requestedAt =
            request.sentAt;

        state.requirement.status =
            getRequestedRequirementStatus(
                state.requirement
            );

    }


    /*
     * Temporary local/mock implementation.
     *
     * The production implementation will send the request
     * through Supabase Edge Functions and create a persistent
     * request record.
     */

    console.log(
        "LORDBLESS DOCUMENT REQUEST SENT:",
        request
    );

    /* =====================================================
   PORTAL BRIDGE
   Make the request available to the Client Portal.
===================================================== */

if (
    window.LORDBLESS_PORTAL_BRIDGE &&
    typeof
        window.LORDBLESS_PORTAL_BRIDGE
            .saveDocumentRequest ===
        "function"
) {

    window.LORDBLESS_PORTAL_BRIDGE
        .saveDocumentRequest(
            request
        );

}

    showDocumentRequestMessage(
        "Document request prepared successfully."
    );


    /*
     * Notify the rest of the Admin application.
     */

    dispatchDocumentRequestEvent(
        request
    );


    closeDocumentRequest();

}

/* =========================================================
   REQUIREMENT STATUS AFTER REQUEST
   ========================================================= */

function getRequestedRequirementStatus(
    requirement
) {

    if (!requirement) {
        return "required";
    }


    if (
        requirement.status === "expired"
    ) {

        return "expired";

    }


    if (
        requirement.status === "rejected"
    ) {

        return "replacement_required";

    }


    return "required";

}


/* =========================================================
   DELIVERY CHANNEL
   ========================================================= */

function isRequestChannelSelected(
    id
) {

    const element =
        window.document.getElementById(id);


    return Boolean(
        element &&
        element.checked
    );

}


/* =========================================================
   EVENT
   ========================================================= */

function dispatchDocumentRequestEvent(
    request
) {

    try {

        window.dispatchEvent(
            new CustomEvent(
                "lordbless:document-request-created",
                {
                    detail: request
                }
            )
        );

    } catch (error) {

        console.warn(
            "Unable to dispatch document request event.",
            error
        );

    }

}


/* =========================================================
   CLOSE
   ========================================================= */

function closeDocumentRequest() {

    const container =
        window.document.getElementById(
            "document-request-container"
        );


    if (container) {

        container.innerHTML = "";

    }


    /*
     * Also support modal-based implementations.
     */

    const modal =
        window.document.getElementById(
            "document-request-modal"
        );


    if (modal) {

        modal.classList.remove(
            "is-open"
        );

    }


    /*
     * Clear the working composer state so data from a closed
     * request can never leak into the next request.
     */

    LORDBLESS_DOCUMENT_REQUEST_STATE.transaction =
        null;

    LORDBLESS_DOCUMENT_REQUEST_STATE.client =
        null;

    LORDBLESS_DOCUMENT_REQUEST_STATE.requirement =
        null;

    LORDBLESS_DOCUMENT_REQUEST_STATE.request =
        null;

}


/* =========================================================
   MESSAGE
   ========================================================= */

function showDocumentRequestMessage(
    message
) {

    console.log(
        "LORDBLESS DOCUMENT REQUEST:",
        message
    );


    alert(message);

}


/* =========================================================
   DATE
   ========================================================= */

function formatDocumentRequestDate(
    date
) {

    if (!date) {
        return "—";
    }


    const parsed =
        new Date(date);


    if (
        Number.isNaN(
            parsed.getTime()
        )
    ) {

        return "—";

    }


    return parsed.toLocaleDateString(
        "en-GB",
        {
            day: "2-digit",
            month: "short",
            year: "numeric"
        }
    );

}


/* =========================================================
   HTML ESCAPING
   ========================================================= */

function escapeDocumentRequestHtml(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }


    return String(value)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   GLOBAL ADMIN BRIDGE
   ========================================================= */

window.LORDBLESS_DOCUMENT_REQUEST = {

    state:
        LORDBLESS_DOCUMENT_REQUEST_STATE,

    types:
        LORDBLESS_DOCUMENT_REQUEST_TYPES,

    statuses:
        LORDBLESS_DOCUMENT_REQUEST_STATUS,

    initialise:
        initialiseDocumentRequest,

    render:
        renderDocumentRequest,

    send:
        sendDocumentRequest,

    close:
        closeDocumentRequest,

    getRequests:
        () =>
            Array.isArray(
                window.LORDBLESS_DOCUMENT_REQUESTS
            )
                ? window.LORDBLESS_DOCUMENT_REQUESTS
                : []

};
