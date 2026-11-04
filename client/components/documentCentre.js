/* ============================================================
   LORDBLESS CONSULTANCY
   CLIENT DOCUMENT CENTRE
   ============================================================

   DOCUMENT ARCHITECTURE

   1. Permanent Client Document Library
      - Client can upload any document.
      - Client selects what type of document it is.
      - "Other" is always available.

   2. Admin Document Requests
      - Admin can request specific documents.
      - Requests belong to a journey.
      - Client sees a checklist of requested documents.
      - Client uploads the requested document.
      - Uploaded document is matched to the request.

   3. Document Status
      - Missing
      - Uploaded
      - Under Review
      - Approved
      - Rejected
      - Expired
      - Waived

   4. No Supabase connection yet.
   5. No pathway-specific hard-coded requirement system.
   ============================================================ */


/* ============================================================
   DOCUMENT STATUS
   ============================================================ */

const LORDBLESS_DOCUMENT_STATUS = {

    MISSING:
        "missing",

    UPLOADED:
        "uploaded",

    REVIEWING:
        "reviewing",

    APPROVED:
        "approved",

    REJECTED:
        "rejected",

    EXPIRED:
        "expired",

    SUPERSEDED:
        "superseded",

    WAIVED:
        "waived",

};


/* ============================================================
   ADMIN REQUEST STATUS
   ============================================================ */

const LORDBLESS_DOCUMENT_REQUEST_STATUS = {

    REQUESTED:
        "requested",

    UPLOADED:
        "uploaded",

    VIEWED:
        "viewed",

    UNDER_REVIEW:
        "under_review",

    APPROVED:
        "approved",

    REJECTED:
        "rejected",

    EXPIRED:
        "expired",

    WAIVED:
        "waived",

    CANCELLED:
        "cancelled"

};


/* ============================================================
   DOCUMENT TYPE OPTIONS
   ============================================================

   These are UNIVERSAL document categories.

   They are NOT tied to individual journey pathways.

   The same document can therefore be used for:
   - Education
   - Careers
   - Business
   - Travel
   - Gold Services
   - Mobility
   - Future pathways
   ============================================================ */

const LORDBLESS_DOCUMENT_TYPES = [

    {
        id:
            "passport",

        name:
            "International Passport",

        category:
            "Identity",

        reusable:
            true

    },


    {
        id:
            "national_id",

        name:
            "National ID / Identity Document",

        category:
            "Identity",

        reusable:
            true

    },


    {
        id:
            "cv",

        name:
            "CV / Resume",

        category:
            "Career",

        reusable:
            true

    },


    {
        id:
            "academic_certificate",

        name:
            "Academic Certificate",

        category:
            "Education",

        reusable:
            true

    },


    {
        id:
            "academic_transcript",

        name:
            "Academic Transcript",

        category:
            "Education",

        reusable:
            true

    },


    {
        id:
            "professional_certificate",

        name:
            "Professional Certificate",

        category:
            "Professional",

        reusable:
            true

    },


    {
        id:
            "professional_registration",

        name:
            "Professional Registration / Licence",

        category:
            "Professional",

        reusable:
            true

    },


    {
        id:
            "employment_document",

        name:
            "Employment Document",

        category:
            "Employment",

        reusable:
            true

    },


    {
        id:
            "language_certificate",

        name:
            "Language Certificate",

        category:
            "Education",

        reusable:
            true

    },


    {
        id:
            "motivation_letter",

        name:
            "Motivation Letter",

        category:
            "Application",

        reusable:
            false

    },


    {
        id:
            "invitation_letter",

        name:
            "Invitation Letter",

        category:
            "Travel / Business",

        reusable:
            false

    },


    {
        id:
            "travel_document",

        name:
            "Travel Document / Itinerary",

        category:
            "Travel",

        reusable:
            false

    },


    {
        id:
            "business_registration",

        name:
            "Business Registration Document",

        category:
            "Business",

        reusable:
            true

    },


    {
        id:
            "business_profile",

        name:
            "Business Profile",

        category:
            "Business",

        reusable:
            true

    },


    {
        id:
            "financial_document",

        name:
            "Bank / Financial Document",

        category:
            "Financial",

        reusable:
            false

    },


    {
        id:
            "proof_of_address",

        name:
            "Proof of Address",

        category:
            "Identity",

        reusable:
            true

    },


    {
        id:
            "other",

        name:
            "Other",

        category:
            "Other",

        reusable:
            true

    }

].sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));


/* ============================================================
   FIND DOCUMENT TYPE
   ============================================================ */

function getDocumentTypeDefinition(
    type
) {

    return (
        LORDBLESS_DOCUMENT_TYPES.find(
            documentType =>
                documentType.id ===
                type
        ) || {

            id:
                "other",

            name:
                "Other",

            category:
                "Other",

            reusable:
                true

        }
    );

}


/* ============================================================
   DOCUMENT TYPE LABEL
   ============================================================ */

function getDocumentTypeLabel(
    type
) {

    return getDocumentTypeDefinition(
        type
    ).name;

}


/* ============================================================
   FIND CURRENT CLIENT DOCUMENT
   ============================================================ */

function findCurrentClientDocument(
    clientDocuments,
    documentType
) {

    if (
        !Array.isArray(
            clientDocuments
        )
    ) {

        return null;

    }


    const documents =
        clientDocuments.filter(
            document =>
                document.type ===
                documentType &&
                document.isCurrent !== false
        );


    if (
        !documents.length
    ) {

        return null;

    }


    return documents[
        documents.length - 1
    ];

}


/* ============================================================
   FIND REUSABLE APPROVED DOCUMENT
   ============================================================ */

function findReusableClientDocument(
    clientDocuments,
    documentType
) {

    if (
        !Array.isArray(
            clientDocuments
        )
    ) {

        return null;

    }


    const documents =
        clientDocuments.filter(
            document => {
                const validFrom = document.validFrom || document.valid_from || document.issueDate;
                const validUntil = document.validUntil || document.valid_until || document.expiryDate;
                const today = new Date().toISOString().slice(0, 10);

                return (

                    document.type ===
                    documentType &&

                    document.isCurrent !== false &&

                    document.isReusable !== false &&

                    !(validFrom && String(validFrom).slice(0, 10) > today) &&

                    !(validUntil && String(validUntil).slice(0, 10) < today) &&

                    document.status ===
                    LORDBLESS_DOCUMENT_STATUS.APPROVED

                );

            }
        );


    if (
        !documents.length
    ) {

        return null;

    }


    return documents[
        documents.length - 1
    ];

}


/* ============================================================
   DOCUMENT VALIDITY
   ============================================================ */

function getDocumentValidityStatus(
    document
) {

    if (!document) {

        return (
            LORDBLESS_DOCUMENT_STATUS.MISSING
        );

    }


    if (
        document.status ===
        LORDBLESS_DOCUMENT_STATUS.REJECTED
    ) {

        return (
            LORDBLESS_DOCUMENT_STATUS.REJECTED
        );

    }


    if (
        document.status ===
        LORDBLESS_DOCUMENT_STATUS.REVIEWING
    ) {

        return (
            LORDBLESS_DOCUMENT_STATUS.REVIEWING
        );

    }


    if (
        document.status ===
        LORDBLESS_DOCUMENT_STATUS.EXPIRED
    ) {

        return (
            LORDBLESS_DOCUMENT_STATUS.EXPIRED
        );

    }


    const expiryDate =
        document.expiryDate ||
        document.validUntil;


    if (
        expiryDate
    ) {

        const expiry =
            new Date(
                expiryDate
            );


        if (
            !Number.isNaN(
                expiry.getTime()
            ) &&
            expiry <
            new Date()
        ) {

            return (
                LORDBLESS_DOCUMENT_STATUS.EXPIRED
            );

        }

    }


    if (
        document.status ===
        LORDBLESS_DOCUMENT_STATUS.APPROVED
    ) {

        return (
            LORDBLESS_DOCUMENT_STATUS.APPROVED
        );

    }


    if (
        document.status ===
        LORDBLESS_DOCUMENT_STATUS.UPLOADED
    ) {

        return (
            LORDBLESS_DOCUMENT_STATUS.UPLOADED
        );

    }


    return (
        LORDBLESS_DOCUMENT_STATUS.UPLOADED
    );

}


/* ============================================================
   PASSPORT EXPIRY ALERT
   ============================================================ */

function getPassportExpiryAlert(
    document
) {

    if (
        !document ||
        document.type !==
        "passport"
    ) {

        return null;

    }


    const expiryDate =
        document.expiryDate ||
        document.validUntil;


    if (!expiryDate) {

        return null;

    }


    const expiry =
        new Date(
            expiryDate
        );


    if (
        Number.isNaN(
            expiry.getTime()
        )
    ) {

        return null;

    }


    const difference =
        expiry.getTime() -
        new Date().getTime();


    const days =
        Math.ceil(
            difference /
            (
                1000 *
                60 *
                60 *
                24
            )
        );


    if (
        days < 0
    ) {

        return {

            level:
                "critical",

            daysRemaining:
                days,

            message:
                "Passport has expired."

        };

    }


    if (
        days <= 90
    ) {

        return {

            level:
                "urgent",

            daysRemaining:
                days,

            message:
                "Passport expires within 3 months."

        };

    }


    if (
        days <= 180
    ) {

        return {

            level:
                "attention",

            daysRemaining:
                days,

            message:
                "Passport expires within 6 months."

        };

    }


    return {

        level:
            "normal",

        daysRemaining:
            days,

        message:
            "Passport validity is currently sufficient."

    };

}


/* ============================================================
   ADMIN REQUEST DATA
   ============================================================

   IMPORTANT:

   This is deliberately empty by default.

   The Admin Portal will eventually create these requests.

   Example future structure:

   {
       id: "REQ-0001",
       transactionId: "LBC-2026-00021",
       documentType: "academic_transcript",
       title: "Academic Transcript",
       message: "Please upload your official transcript.",
       status: "requested",
       requestedAt: "2026-09-22",
       dueDate: "2026-09-30"
   }

   No pathway automatically creates requests.
   Admin does.
   ============================================================ */

const LORDBLESS_DOCUMENT_REQUESTS = {};

/* ============================================================
   GET REQUESTS FOR JOURNEY
   ============================================================ */

function getJourneyDocumentRequests(
    transaction,
    persistedRequests = null
) {

    if (Array.isArray(persistedRequests)) {
        const enquiryId = transaction?.enquiryId || transaction?.enquiry_id || null;
        return persistedRequests.filter(request =>
            request && (!enquiryId || request.enquiryId === enquiryId)
        );
    }

    if (!transaction && !requests.length) {

        return [];

    }


    /*
     * Preferred future source:
     *
     * transaction.documentRequests
     */

    if (
        Array.isArray(
            transaction.documentRequests
        )
    ) {

        return transaction.documentRequests;

    }


    /*
     * Shared Admin ↔ Client bridge.
     *
     * Admin-created document requests are stored
     * in the shared local bridge and retrieved here.
     */

    if (
        window.LORDBLESS_PORTAL_BRIDGE &&
        typeof
            window.LORDBLESS_PORTAL_BRIDGE
                .getDocumentRequests === "function"
    ) {

        return window.LORDBLESS_PORTAL_BRIDGE
            .getDocumentRequests(
                transaction.clientId || null,
                transaction.id
            );

    }


    /*
     * Temporary fallback local request store.
     */

    return (
        LORDBLESS_DOCUMENT_REQUESTS[
            transaction.id
        ] || []
    );

}


/* ============================================================
   GET REQUEST STATUS
   ============================================================ */

function getDocumentRequestStatus(
    request,
    clientDocuments
) {

    if (!request) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED
        );

    }


    /*
     * If Admin has already marked the request
     * as waived, preserve it.
     */

    if (
        request.status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.WAIVED
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.WAIVED
        );

    }

    if (request.status === LORDBLESS_DOCUMENT_REQUEST_STATUS.CANCELLED) {
        return LORDBLESS_DOCUMENT_REQUEST_STATUS.CANCELLED;
    }

    if (request.status === "completed") {
        return LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED;
    }


    /*
     * Find the document linked directly to the request.
     */

    let document = (request.enquiryId || request.enquiry_id)
        ? clientDocuments.find(item => item.documentRequestId === request.id || item.document_request_id === request.id) || null
        : null;

    if ((request.enquiryId || request.enquiry_id) && !document) {
        const persistedStatus = {
            uploaded: LORDBLESS_DOCUMENT_REQUEST_STATUS.UPLOADED,
            viewed: LORDBLESS_DOCUMENT_REQUEST_STATUS.VIEWED,
            completed: LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED,
            cancelled: LORDBLESS_DOCUMENT_REQUEST_STATUS.CANCELLED
        }[request.status];
        return persistedStatus || LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED;
    }


    if (
        request.documentId
    ) {

        document =
            clientDocuments.find(
                item =>
                    item.id ===
                    request.documentId
            );

    }


    /*
     * If no direct document link exists,
     * try matching by document type.
     */

    if (!document && !(request.enquiryId || request.enquiry_id) && request.documentType) {

        document =
            findCurrentClientDocument(
                clientDocuments,
                request.documentType
            );

    }


    if (!document) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED
        );

    }


    const status =
        getDocumentValidityStatus(
            document
        );


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.APPROVED
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED
        );

    }


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.REVIEWING
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.UNDER_REVIEW
        );

    }


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.UPLOADED
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.UPLOADED
        );

    }


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.REJECTED
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED
        );

    }


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.EXPIRED
    ) {

        return (
            LORDBLESS_DOCUMENT_REQUEST_STATUS.EXPIRED
        );

    }


    return (
        LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED
    );

}


/* ============================================================
   RESOLVE REQUEST DOCUMENT
   ============================================================ */

function getRequestDocument(
    request,
    clientDocuments
) {

    if (
        !request ||
        !Array.isArray(
            clientDocuments
        )
    ) {

        return null;

    }


    if (request.enquiryId || request.enquiry_id) {
        return clientDocuments.find(document =>
            document.documentRequestId === request.id || document.document_request_id === request.id
        ) || null;
    }

    if (
        request.documentId
    ) {

        const linked =
            clientDocuments.find(
                document =>
                    document.id ===
                    request.documentId
            );


        if (linked) {

            return linked;

        }

    }


    if (
        request.documentType
    ) {

        return findCurrentClientDocument(
            clientDocuments,
            request.documentType
        );

    }


    return null;

}


/* ============================================================
   REQUEST SUMMARY
   ============================================================ */

function getDocumentRequestSummary(
    requests,
    clientDocuments
) {

    const total =
        requests.length;


    let approved =
        0;


    let underReview =
        0;


    let uploaded =
        0;


    let pending =
        0;


    let rejected =
        0;


    let waived =
        0;


    requests.forEach(
        request => {

            const status =
                getDocumentRequestStatus(
                    request,
                    clientDocuments
                );


            if (
                status ===
                LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED
            ) {

                approved++;

            }


            else if (
                status ===
                LORDBLESS_DOCUMENT_REQUEST_STATUS.UNDER_REVIEW
            ) {

                underReview++;

            }


            else if (
                status ===
                LORDBLESS_DOCUMENT_REQUEST_STATUS.UPLOADED
            ) {

                uploaded++;

            }


            else if (
                status ===
                LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED
            ) {

                rejected++;

            }


            else if (
                status ===
                LORDBLESS_DOCUMENT_REQUEST_STATUS.WAIVED
            ) {

                waived++;

            }


            else {

                pending++;

            }

        }
    );


    const completed =
        approved +
        waived;


    const percentage =
        total > 0
            ? Math.round(
                (
                    completed /
                    total
                ) *
                100
            )
            : 0;


    return {

        total,

        approved,

        underReview,

        uploaded,

        pending,

        rejected,

        waived,

        completed,

        percentage

    };

}


/* ============================================================
   RENDER DOCUMENT CENTRE
   ============================================================ */

function renderDocumentCentre(
    container,
    transaction,
    clientDocuments = [],
    client = null,
    persistedRequests = null
) {

    if (
        !container
    ) {

        return;

    }


    const documents =
        Array.isArray(
            clientDocuments
        )
            ? clientDocuments
            : [];


    const requests =
        getJourneyDocumentRequests(
            transaction,
            persistedRequests
        );


    const requestSummary =
        getDocumentRequestSummary(
            requests,
            documents
        );


    container.innerHTML = `

        <div
            class="document-centre"
        >

            <div class="document-section-heading">
                <div>
                    <p class="portal-eyebrow">CLIENT ID</p>
                    <strong>${escapeDocumentHTML(client?.clientCode || client?.client_code || "ID pending")}</strong>
                </div>
            </div>

            ${renderJourneyRequestsSection(
                transaction,
                requests,
                documents,
                requestSummary
            )}


            ${renderPermanentLibrarySection(
                documents
            )}


            ${renderUniversalUploadSection()}

        </div>

    `;


    initialiseDocumentCentreActions(
        container,
        transaction,
        client,
        requests,
        documents
    );

}


/* ============================================================
   JOURNEY REQUEST SECTION
   ============================================================ */

function renderJourneyRequestsSection(
    transaction,
    requests,
    documents,
    summary
) {

    if (!transaction && !requests.length) {

        return `

            <section
                class="
                    document-request-section
                    document-empty-section
                "
            >

                <p
                    class="portal-eyebrow"
                >
                    DOCUMENT REQUESTS
                </p>

                <h3>
                    No active journey
                </h3>

                <p>
                    Documents requested by LORDBLESS
                    for your journeys will appear here.
                </p>

            </section>

        `;

    }


    const journeyTitle =
        transaction?.title ||
        transaction?.service ||
        (requests.length ? "Documents for your account" : "Current Journey");


    if (
        !requests.length
    ) {

        return `

            <section
                class="
                    document-request-section
                    document-empty-section
                "
            >

                <div
                    class="document-section-heading"
                >

                    <div>

                        <p
                            class="portal-eyebrow"
                        >
                            CURRENT JOURNEY
                        </p>

                        <h3>
                            ${escapeDocumentHTML(
                                journeyTitle
                            )}
                        </h3>

                    </div>

                </div>


                <div
                    class="document-request-empty"
                >

                    <div
                        class="document-request-empty-icon"
                    >
                        ✓
                    </div>

                    <div>

                        <strong>
                            No document requests at this time
                        </strong>

                        <p>
                            LORDBLESS has not requested
                            any additional documents for
                            this journey yet.
                        </p>

                    </div>

                </div>

            </section>

        `;

    }


    return `

        <section
            class="
                document-request-section
            "
        >

            <div
                class="document-section-heading"
            >

                <div>

                    <p
                        class="portal-eyebrow"
                    >
                        CURRENT JOURNEY
                    </p>

                    <h3>
                        ${escapeDocumentHTML(
                            journeyTitle
                        )}
                    </h3>

                    <p>
                        Documents specifically requested
                        by LORDBLESS for this journey.
                    </p>

                </div>


                <div
                    class="document-request-progress"
                >

                    <strong>
                        ${summary.completed}/${summary.total}
                    </strong>

                    <span>
                        complete
                    </span>

                </div>

            </div>


            <div
                class="document-request-progress-bar"
            >

                <div
                    class="document-request-progress-fill"
                    style="
                        width:${summary.percentage}%;
                    "
                ></div>

            </div>


            <div
                class="document-request-meta"
            >

                <span>
                    ${summary.approved}
                    approved
                </span>


                ${
                    summary.underReview
                        ? `
                            <span>
                                ${summary.underReview}
                                under review
                            </span>
                        `
                        : ""
                }


                ${
                    summary.uploaded
                        ? `
                            <span>
                                ${summary.uploaded}
                                submitted
                            </span>
                        `
                        : ""
                }


                ${
                    summary.pending
                        ? `
                            <span>
                                ${summary.pending}
                                pending
                            </span>
                        `
                        : ""
                }


                ${
                    summary.rejected
                        ? `
                            <span>
                                ${summary.rejected}
                                action required
                            </span>
                        `
                        : ""
                }

            </div>


            <div
                class="document-request-list"
            >

                ${requests
                    .map(
                        request =>
                            renderDocumentRequestItem(
                                request,
                                documents
                            )
                    )
                    .join("")}

            </div>

        </section>

    `;

}


/* ============================================================
   DOCUMENT REQUEST ITEM
   ============================================================ */
function renderDocumentRequestItem(
    request,
    documents
) {

    const status =
        getDocumentRequestStatus(
            request,
            documents
        );


    const document =
        getRequestDocument(
            request,
            documents
        );


    const documentName =
        request.title ||
        request.name ||
        getDocumentTypeLabel(
            request.documentType
        );


    let icon =
        "!";


    let statusLabel =
        "REQUESTED";


    let statusClass =
        "requested";


    let action = "";


    if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED
    ) {

        icon = "✓";
        statusLabel = "APPROVED";
        statusClass = "approved";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.UNDER_REVIEW
    ) {

        icon = "◌";
        statusLabel = "UNDER REVIEW";
        statusClass = "reviewing";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.UPLOADED
    ) {

        icon = "↑";
        statusLabel = "SUBMITTED";
        statusClass = "uploaded";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.VIEWED
    ) {

        icon = "!";
        statusLabel = "VIEWED";
        statusClass = "requested";
        action = `
            <button type="button" class="primary-button document-request-upload"
                data-request-id="${escapeDocumentHTML(request.id)}"
                data-document-type="${escapeDocumentHTML(request.documentType || "other")}">
                Upload Document
            </button>`;

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.CANCELLED
    ) {

        icon = "—";
        statusLabel = "CANCELLED";
        statusClass = "waived";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED
    ) {

        icon = "!";
        statusLabel = "ACTION REQUIRED";
        statusClass = "rejected";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.EXPIRED
    ) {

        icon = "!";
        statusLabel = "EXPIRED";
        statusClass = "expired";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_REQUEST_STATUS.WAIVED
    ) {

        icon = "—";
        statusLabel = "WAIVED";
        statusClass = "waived";

    }


    else {

        action = `

            <button
                type="button"
                class="
                    primary-button
                    document-request-upload
                "
                data-request-id="${escapeDocumentHTML(
                    request.id
                )}"
                data-document-type="${escapeDocumentHTML(
                    request.documentType ||
                    "other"
                )}"
            >
                Upload Document
            </button>

        `;

    }


    if (
        status ===
            LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED ||
        status ===
            LORDBLESS_DOCUMENT_REQUEST_STATUS.EXPIRED
    ) {

        action = `

            <button
                type="button"
                class="
                    primary-button
                    document-request-upload
                "
                data-request-id="${escapeDocumentHTML(
                    request.id
                )}"
                data-document-type="${escapeDocumentHTML(
                    request.documentType ||
                    "other"
                )}"
            >
                Replace Document
            </button>

        `;

    }


    const description =
        (status === LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED && document?.rejectionReason) ||
        request.message ||
        request.description ||
        (
            status ===
            LORDBLESS_DOCUMENT_REQUEST_STATUS.REQUESTED

                ? "This document has been requested by LORDBLESS."

                : status ===
                    LORDBLESS_DOCUMENT_REQUEST_STATUS.REJECTED

                    ? "Please upload a replacement document."

                    : status ===
                        LORDBLESS_DOCUMENT_REQUEST_STATUS.UNDER_REVIEW

                        ? "Your document is currently being reviewed."

                        : status ===
                            LORDBLESS_DOCUMENT_REQUEST_STATUS.APPROVED

                            ? "This request has been completed."

                            : "Document request status updated."
        );


    return `

        <article
            class="
                document-request-item
                document-request-${statusClass}
            "
        >

            <div
                class="
                    document-request-icon
                    document-request-icon-${statusClass}
                "
                aria-hidden="true"
            >
                <span>
                    ${icon}
                </span>
            </div>


            <div
                class="document-request-content"
            >

                <div
                    class="document-request-title-row"
                >

                    <div
                        class="document-request-title-block"
                    >

                        <span
                            class="document-request-label"
                        >
                            DOCUMENT REQUIRED
                        </span>

                        <strong>
                            ${escapeDocumentHTML(
                                documentName
                            )}
                        </strong>

                    </div>


                    <span
                        class="
                            document-request-status
                            ${statusClass}
                        "
                    >
                        ${statusLabel}
                    </span>

                </div>


                <p
                    class="document-request-description"
                >
                    ${escapeDocumentHTML(
                        description
                    )}
                </p>


                ${
                    document &&
                    document.filename
                        ? `
                            <div
                                class="document-request-file"
                            >
                                <span>
                                    Current submission
                                </span>

                                <strong>
                                    ${escapeDocumentHTML(
                                        document.filename
                                    )}
                                </strong>
                            </div>
                        `
                        : ""
                }


                ${
                    request.dueDate
                        ? `
                            <div
                                class="document-request-due"
                            >
                                Due:
                                <strong>
                                    ${formatDocumentDate(
                                        request.dueDate
                                    )}
                                </strong>
                            </div>
                        `
                        : ""
                }

            </div>


            ${
                action
                    ? `
                        <div
                            class="document-request-action"
                        >
                            ${action}
                        </div>
                    `
                    : ""
            }

        </article>

    `;

}

/* ============================================================
   PERMANENT LIBRARY SECTION
   ============================================================ */

function renderPermanentLibrarySection(
    documents
) {

    return `

        <section
            class="
                document-library-section
            "
        >

            <div
                class="document-section-heading"
            >

                <div>

                    <p
                        class="portal-eyebrow"
                    >
                        PERMANENT DOCUMENT LIBRARY
                    </p>

                    <h3>
                        Your Documents
                    </h3>

                    <p>
                        Documents stored here can support
                        applicable current and future
                        LORDBLESS journeys.
                    </p>

                </div>

            </div>


            ${
                documents.length
                    ? `

                        <div
                            class="document-library-grid"
                        >

                            ${documents
                                .map(
                                    createPermanentDocumentCard
                                )
                                .join("")}

                        </div>

                    `
                    : createEmptyDocumentLibrary()
            }

        </section>

    `;

}


/* ============================================================
   PERMANENT DOCUMENT CARD
   ============================================================ */

function createPermanentDocumentCard(
    document
) {

    const status =
        getDocumentValidityStatus(
            document
        );


    const definition =
        getDocumentTypeDefinition(
            document.type
        );


    const statusLabel =
        getDocumentStatusLabel(
            status
        );


    const expiryAlert =
        getPassportExpiryAlert(
            document
        );


    let attentionMessage =
        "";


    if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.REJECTED
    ) {

        attentionMessage =
            "This document was rejected. Please upload a replacement.";

    }


    else if (
        status ===
        LORDBLESS_DOCUMENT_STATUS.EXPIRED
    ) {

        attentionMessage =
            "This document has expired. Please upload a current version.";

    }


    else if (
        expiryAlert &&
        expiryAlert.level ===
        "urgent"
    ) {

        attentionMessage =
            expiryAlert.message;

    }


    return `

        <article
            class="
                document-card
                document-status-${escapeDocumentHTML(
                    status
                )}
            "
        >

            <div
                class="document-card-header"
            >

                <div>

                    ${document.version ? `<span class="transaction-reference">Version ${escapeDocumentHTML(document.version)}</span>` : ""}

                    <h3>
                        ${escapeDocumentHTML(
                            document.name ||
                            definition.name
                        )}
                    </h3>

                </div>


                <span
                    class="
                        document-status
                        ${escapeDocumentHTML(
                            status
                        )}
                    "
                >
                    ${escapeDocumentHTML(
                        statusLabel
                    )}
                </span>

            </div>


            <div
                class="document-card-meta"
            >

                <span>
                    ${escapeDocumentHTML(
                        document.filename ||
                        "No file uploaded"
                    )}
                </span>


                <span>
                    ${escapeDocumentHTML(
                        definition.category
                    )}
                </span>


                ${
                    document.expiryDate
                        ? `
                            <span>
                                Expires:
                                ${formatDocumentDate(
                                    document.expiryDate
                                )}
                            </span>
                        `
                        : ""
                }

            </div>


            ${
                attentionMessage
                    ? `
                        <div
                            class="
                                document-attention-message
                            "
                        >
                            ${escapeDocumentHTML(
                                attentionMessage
                            )}
                        </div>
                    `
                    : ""
            }


            <div
                class="document-card-actions"
            >

                <button
                    type="button"
                    class="secondary-button"
                    data-document-view="${escapeDocumentHTML(
                        document.id
                    )}"
                >
                    View Details
                </button>


                <button
                    type="button"
                    class="secondary-button"
                    data-document-replace="${escapeDocumentHTML(
                        document.id
                    )}"
                >
                    Replace / Update
                </button>

            </div>

        </article>

    `;

}


/* ============================================================
   EMPTY LIBRARY
   ============================================================ */

function createEmptyDocumentLibrary() {

    return `

        <div
            class="empty-state-card"
        >

            <div
                class="empty-state-icon"
            >
                ▣
            </div>


            <h3>
                Your document library is empty
            </h3>


            <p>
                Upload a document to begin building
                your permanent LORDBLESS document library.
            </p>

        </div>

    `;

}


/* ============================================================
   UNIVERSAL UPLOAD SECTION
   ============================================================ */

function renderUniversalUploadSection() {

    return `
        <section class="document-request-section">
            <div class="document-section-heading">
                <div>
                    <p class="portal-eyebrow">DOCUMENT LIBRARY</p>
                    <h3>Add a document</h3>
                    <p>Upload a document for your permanent client library.</p>
                </div>
                <button type="button" class="primary-button" data-universal-upload>Upload Document</button>
            </div>
        </section>
    `;

}


/* ============================================================
   DOCUMENT UPLOAD DIALOG
   ============================================================ */
function openUniversalUploadDialog(
    request = null,
    client = null,
    existingDocuments = []
) {

    const existing =
        document.getElementById(
            "document-upload-dialog"
        );


    if (
        existing
    ) {

        existing.remove();

    }


    const requestedType =
        request &&
        request.documentType
            ? request.documentType
            : "";


    const requestedName = request?.documentName || request?.title || request?.name || "";


    const knownDocumentTypes = LORDBLESS_DOCUMENT_TYPES.some(item => item.id === requestedType)
        ? LORDBLESS_DOCUMENT_TYPES
        : request && requestedType
            ? [...LORDBLESS_DOCUMENT_TYPES, { id: requestedType, name: requestedName || requestedType }]
            : LORDBLESS_DOCUMENT_TYPES;
    const options =
        knownDocumentTypes
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }))
            .map(
                documentType => {

                    return `

                        <option
                            value="${escapeDocumentHTML(
                                documentType.id
                            )}"
                            ${
                                requestedType ===
                                documentType.id
                                    ? "selected"
                                    : ""
                            }
                        >
                            ${escapeDocumentHTML(
                                documentType.name
                            )}
                        </option>

                    `;

                }
            )
            .join("");


    const dialog =
        document.createElement(
            "div"
        );


    dialog.id =
        "document-upload-dialog";


    dialog.className =
        "portal-modal open";


    dialog.setAttribute(
        "aria-hidden",
        "false"
    );


   dialog.innerHTML = `

    <div
        class="portal-modal-overlay"
    ></div>


    <div
        class="
            portal-modal-content
            document-upload-dialog-content
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-upload-dialog-title"
    >

        <button
            type="button"
            class="portal-modal-close"
            data-close-document-dialog
            aria-label="Close"
        >
            ×
        </button>


        <div
            class="document-upload-modal-header"
        >

            <div
                class="document-upload-modal-icon"
                aria-hidden="true"
            >
                ↑
            </div>


            <div>

                <p
                    class="portal-eyebrow"
                >
                    ${
                        request
                            ? "DOCUMENT REQUEST"
                            : "DOCUMENT LIBRARY"
                    }
                </p>


                <h2
                    id="document-upload-dialog-title"
                >
                    ${
                        request
                            ? "Upload Document"
                            : "Upload a Document"
                    }
                </h2>

            </div>

        </div>


        ${
            request
                ? `

                    <div
                        class="document-upload-request-summary"
                    >

                        <span
                            class="document-upload-request-label"
                        >
                            DOCUMENT REQUIRED
                        </span>


                        <strong>
                            ${escapeDocumentHTML(
                                requestedName ||
                                getDocumentTypeLabel(
                                    requestedType
                                )
                            )}
                        </strong>


                        <p>
                            LORDBLESS has requested this
                            document for your current journey.
                        </p>

                    </div>

                `
                : `

                    <div
                        class="document-upload-library-note"
                    >

                        <p>
                            Select the document that best
                            describes the file you are uploading
                            to your LORDBLESS document library.
                        </p>

                    </div>

                `
        }


        <form
            id="universal-document-upload-form"
        >

            <div
                class="document-upload-field"
            >

                <label
                    for="document-file-input"
                >
                    Select your file
                </label>


                <div
                    class="document-file-input-wrap"
                >

                    <input
                        type="file"
                        id="document-file-input"
                        name="file"
                        required
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                    >

                </div>


                <small
                    class="document-upload-field-hint"
                >
                    PDF, JPG, PNG, WEBP, DOC, DOCX, XLS or XLSX · Maximum 15 MB
                </small>

            </div>

            <p id="document-upload-message" role="status" aria-live="polite"></p>


            <div
                class="document-upload-field"
            >

                <label
                    for="document-type-select"
                >
                    Document type
                </label>


                <select
                    id="document-type-select"
                    name="documentType"
                    required
                    ${request ? "disabled" : ""}
                >

                    <option
                        value=""
                    >
                        Select document type
                    </option>

                    ${options}

                </select>

            </div>


            <div
                class="document-upload-field"
                id="document-other-field"
                hidden
            >

                <label
                    for="document-other-name"
                >
                    Please specify
                </label>


                <input
                    type="text"
                    id="document-other-name"
                    name="otherName"
                    placeholder="e.g. Marriage Certificate"
                >

            </div>


            <input
                type="hidden"
                id="document-request-id"
                value="${
                    request
                        ? escapeDocumentHTML(
                            request.id
                        )
                        : ""
                }"
            >


            <div
                class="
                    document-upload-form-actions
                "
            >

                <button
                    type="button"
                    class="secondary-button"
                    data-close-document-dialog
                >
                    Cancel
                </button>


                <button
                    type="submit"
                    class="primary-button"
                >
                    Upload Document
                </button>

            </div>

        </form>

    </div>

`;
    document.body.appendChild(
        dialog
    );

    initialiseUploadDialog(dialog, request, client, existingDocuments);

}


/* ============================================================
   INITIALISE UPLOAD DIALOG
   ============================================================ */

function initialiseUploadDialog(
    dialog,
    request,
    client,
    existingDocuments
) {

    const typeSelect =
        dialog.querySelector(
            "#document-type-select"
        );


    const otherField =
        dialog.querySelector(
            "#document-other-field"
        );


    const otherInput =
        dialog.querySelector(
            "#document-other-name"
        );


    const closeButtons =
        dialog.querySelectorAll(
            "[data-close-document-dialog]"
        );


    closeButtons.forEach(
        button => {

            button.addEventListener(
                "click",
                () => {

                    dialog.remove();

                }
            );

        }
    );


    const overlay =
        dialog.querySelector(
            ".portal-modal-overlay"
        );


    if (
        overlay
    ) {

        overlay.addEventListener(
            "click",
            () => {

                dialog.remove();

            }
        );

    }


    if (
        typeSelect
    ) {

        typeSelect.addEventListener(
            "change",
            () => {

                const isOther =
                    typeSelect.value ===
                    "other";


                if (
                    otherField
                ) {

                    otherField.hidden =
                        !isOther;

                }


                if (
                    otherInput
                ) {

                    otherInput.required =
                        isOther;

                }

            }
        );

    }


    const form =
        dialog.querySelector(
            "#universal-document-upload-form"
        );


    if (
        form
    ) {

        form.addEventListener(
            "submit",
            event => {

                event.preventDefault();


                handleUniversalUpload(
                    form,
                    request,
                    client,
                    existingDocuments
                );

            }
        );

    }

}


/* ============================================================
   UNIVERSAL UPLOAD HANDLER
   ============================================================ */

async function handleUniversalUpload(
    form,
    request,
    client,
    existingDocuments = []
) {

    const fileInput =
        form.querySelector(
            "#document-file-input"
        );


    const typeSelect =
        form.querySelector(
            "#document-type-select"
        );


    const otherInput =
        form.querySelector(
            "#document-other-name"
        );


    const file =
        fileInput &&
        fileInput.files
            ? fileInput.files[0]
            : null;


    if (
        !file
    ) {

        showDocumentMessage(
            "Please select a document to upload."
        );

        return;

    }


    const documentType =
        typeSelect
            ? typeSelect.value
            : "other";


    if (
        !documentType
    ) {

        showDocumentMessage(
            "Please select the document type."
        );

        return;

    }


    if (
        documentType ===
        "other" &&
        (
            !otherInput ||
            !otherInput.value.trim()
        )
    ) {

        showDocumentMessage(
            "Please specify what type of document you are uploading."
        );

        return;

    }


    const selectedDefinition =
        getDocumentTypeDefinition(
            documentType
        );


    const documentName =
        request?.documentName || (documentType === "other"
            ? otherInput.value.trim()
            : selectedDefinition?.name || "");

    const clientId = String(client?.id || "");
    const isDatabaseClient = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId);
    if (isDatabaseClient) {
        const message = form.querySelector("#document-upload-message");
        const submit = form.querySelector('[type="submit"]');
        const setMessage = value => { if (message) message.textContent = value; };
        const acceptedTypes = new Map([
            [".pdf", "application/pdf"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
            [".png", "image/png"], [".webp", "image/webp"], [".doc", "application/msword"],
            [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            [".xls", "application/vnd.ms-excel"], [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
        ]);
        const extension = `.${String(file.name).split(".").pop()}`.toLowerCase();
        const expectedMime = acceptedTypes.get(extension);
        const fileMime = file.type || expectedMime;
        if (!expectedMime || fileMime !== expectedMime) {
            setMessage("This file type is not supported. Use PDF, JPG, PNG, WEBP, DOC, DOCX, XLS or XLSX.");
            return;
        }
        if (file.size <= 0 || file.size > 15 * 1024 * 1024) {
            setMessage("Choose a file smaller than 15 MB.");
            return;
        }
        if (request && String(request.documentType) !== documentType) {
            setMessage("The selected document type does not match this request.");
            return;
        }
        if (typeof lordblessSupabase === "undefined" || !window.crypto?.randomUUID) {
            setMessage("Secure upload is unavailable in this browser session. No file was uploaded.");
            return;
        }

        const documentId = window.crypto.randomUUID();
        const fileToken = window.crypto.randomUUID();
        const storagePath = `${clientId}/${documentId}/${fileToken}`;
        const safeFileName = String(file.name).replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
        if (!safeFileName || safeFileName.length > 255) {
            setMessage("The filename is invalid or too long.");
            return;
        }

        if (submit) {
            submit.disabled = true;
            submit.textContent = "Uploading…";
        }
        setMessage("Uploading securely…");
        let uploadedPath = "";
        try {
            const { data: uploaded, error: uploadError } = await lordblessSupabase.storage
                .from("lordbless-client-documents")
                .upload(storagePath, file, { contentType: fileMime, upsert: false });
            if (uploadError) throw uploadError;
            uploadedPath = uploaded?.path || storagePath;

            setMessage("Saving document record…");
            const { data, error } = await lordblessSupabase.rpc("finalize_client_document_upload", {
                p_client_id: clientId,
                p_document_id: documentId,
                p_document_request_id: request?.id || null,
                p_document_type: documentType,
                p_document_name: documentName,
                p_file_name: safeFileName,
                p_storage_path: uploadedPath
            });
            if (error) throw error;
            if (data !== documentId) throw new Error("Supabase did not confirm the document record.");

            setMessage("Upload complete. Refreshing your document list…");
            window.dispatchEvent(new CustomEvent("lordbless:client-document-updated", { detail: { clientId } }));
            document.getElementById("document-upload-dialog")?.remove();
            showDocumentMessage(`${documentName} was uploaded and submitted for review.`);
        } catch (error) {
            if (uploadedPath) {
                const { error: cleanupError } = await lordblessSupabase.storage
                    .from("lordbless-client-documents")
                    .remove([uploadedPath]);
                if (cleanupError) {
                    setMessage(`Upload metadata failed. The file remains unregistered for safe recovery (${uploadedPath}). ${error?.message || ""}`);
                    if (submit) {
                        submit.disabled = false;
                        submit.textContent = "Retry Upload";
                    }
                    return;
                }
            }
            setMessage(error?.message || "The document could not be uploaded. No submitted status was saved.");
            if (submit) {
                submit.disabled = false;
                submit.textContent = "Retry Upload";
            }
        }
        return;
    }

    const localDevelopment = window.location.protocol === "file:" ||
        ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!localDevelopment) {
        showDocumentMessage(
            "Secure document upload is not available yet. This file has not been sent or saved. Contact LORDBLESS CONSULTANCY for an approved submission method."
        );
        return;
    }


    /*
     * MOCK ONLY
     *
     * The actual File object is NOT sent anywhere yet.
     *
     * This prepares the data structure that will later
     * be connected to Supabase Storage.
     */

    const uploadPayload = {

        fileName:
            file.name,

        documentType:
            documentType,

        documentName:
            documentName,

        requestId:
            request
                ? request.id
                : null,

        uploadedAt:
            new Date().toISOString(),

        status:
            LORDBLESS_DOCUMENT_STATUS.REVIEWING

    };


    console.log(
        "LORDBLESS DOCUMENT UPLOAD",
        uploadPayload
    );


    const dialog =
        document.getElementById(
            "document-upload-dialog"
        );


    if (
        dialog
    ) {

        dialog.remove();

    }


    showDocumentMessage(

        request

            ? `${documentName} has been submitted for your document request and is now under review.`

            : `${documentName} has been added to your document library and is now under review.`

    );

}


/* ============================================================
   INITIALISE DOCUMENT CENTRE ACTIONS
   ============================================================ */

function initialiseDocumentCentreActions(
    container,
    transaction,
    client,
    requests,
    documents
) {

    /*
     * Universal upload.
     */

    container
        .querySelectorAll(
            "[data-universal-upload]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        openUniversalUploadDialog(null, client, documents);

                    }
                );

            }
        );


    /*
     * Admin-requested document upload.
     */

    container
        .querySelectorAll(
            ".document-request-upload"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const requestId =
                            button.dataset.requestId;


                        const request =
                            (requests || []).find(
                                item =>
                                    item.id ===
                                    requestId
                            );


                        if (
                            request
                        ) {

                            openUniversalUploadDialog(
                                request,
                                client,
                                documents
                            );

                        }

                    }
                );

            }
        );


    /*
     * View permanent document.
     */

    container
        .querySelectorAll(
            "[data-document-view]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const documents =
                            window
                                .LORDBLESS_CLIENT_ACCOUNT
                                ?.documents ||
                            [];


                        const document =
                            documents.find(
                                item =>
                                    item.id ===
                                    button.dataset.documentView
                            );


                        if (
                            document
                        ) {

                            showDocumentDetails(
                                document
                            );

                        }

                    }
                );

            }
        );


    /*
     * Replace permanent document.
     */

    container
        .querySelectorAll(
            "[data-document-replace]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const documents =
                            window
                                .LORDBLESS_CLIENT_ACCOUNT
                                ?.documents ||
                            [];


                        const document =
                            documents.find(
                                item =>
                                    item.id ===
                                    button.dataset.documentReplace
                            );


                        openUniversalUploadDialog({

                            id: null,
                            isReplacement: true,
                            documentName: document?.name || "Document Replacement",

                            documentType:
                                document?.type ||
                                "other",

                            title:
                                document?.name ||
                                "Document Replacement"

                        }, window.LORDBLESS_CLIENT_ACCOUNT, window.LORDBLESS_CLIENT_ACCOUNT?.documents || []);

                    }
                );

            }
        );

}


/* ============================================================
   DOCUMENT DETAILS
   ============================================================ */

function showDocumentDetails(
    document
) {

    const definition =
        getDocumentTypeDefinition(
            document.type
        );


    const status =
        getDocumentValidityStatus(
            document
        );


    const statusLabel =
        getDocumentStatusLabel(
            status
        );


    const details = [

        `Document: ${
            document.name ||
            definition.name
        }`,

        `Type: ${
            definition.name
        }`,

        `Status: ${
            statusLabel
        }`,

        `File: ${
            document.filename ||
            "No file uploaded"
        }`

    ];


    if (
        document.issueDate
    ) {

        details.push(
            `Issue date: ${formatDocumentDate(
                document.issueDate
            )}`
        );

    }


    if (
        document.expiryDate
    ) {

        details.push(
            `Expiry date: ${formatDocumentDate(
                document.expiryDate
            )}`
        );

    }


    if (!document.storagePath || typeof lordblessSupabase === "undefined") {
        showDocumentMessage(details.join("\n"));
        return;
    }

    const preview = window.open("about:blank", "_blank");
    if (!preview) {
        showDocumentMessage("Allow pop-ups to open this private document.");
        return;
    }
    preview.opener = null;
    preview.document.write("<title>Opening secure document</title><p>Opening secure document…</p>");
    lordblessSupabase.storage.from("lordbless-client-documents")
        .createSignedUrl(document.storagePath, 300)
        .then(({ data, error }) => {
            if (error || !data?.signedUrl) throw error || new Error("A secure preview link was not created.");
            preview.location.replace(data.signedUrl);
        })
        .catch(error => {
            preview.close();
            showDocumentMessage(error?.message || "The private document could not be opened.");
        });

}


/* ============================================================
   DOCUMENT STATUS LABEL
   ============================================================ */

function getDocumentStatusLabel(
    status
) {

    const labels = {

        missing:
            "Missing",

        uploaded:
            "Uploaded",

        reviewing:
            "Under Review",

        approved:
            "Approved",

        rejected:
            "Rejected",

        expired:
            "Expired",

        superseded:
            "Superseded",

        waived:
            "Waived"

    };


    return (
        labels[status] ||
        "Pending"
    );

}


/* ============================================================
   DATE FORMAT
   ============================================================ */

function formatDocumentDate(
    date
) {

    if (
        !date
    ) {

        return "";

    }


    const parsed =
        new Date(
            date
        );


    if (
        Number.isNaN(
            parsed.getTime()
        )
    ) {

        return String(
            date
        );

    }


    return new Intl.DateTimeFormat(
        "en-GB",
        {

            day:
                "2-digit",

            month:
                "short",

            year:
                "numeric"

        }
    ).format(
        parsed
    );

}


/* ============================================================
   HTML ESCAPE
   ============================================================ */

function escapeDocumentHTML(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }


    return String(
        value
    )

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


/* ============================================================
   DOCUMENT MESSAGE
   ============================================================ */

function showDocumentMessage(
    message
) {

    /*
     * Use the existing client portal modal when
     * available.
     */

    if (
        typeof window.showModal ===
        "function"
    ) {

        window.showModal(
            "Document",
            message
        );

        return;

    }


    if (
        typeof window.showClientModal ===
        "function"
    ) {

        window.showClientModal(
            "Document",
            message
        );

        return;

    }


    alert(
        message
    );

}


/* ============================================================
   GLOBAL DOCUMENT CENTRE API
   ============================================================ */

window.LORDBLESS_DOCUMENT_CENTRE = {

    documentStatuses:
        LORDBLESS_DOCUMENT_STATUS,


    requestStatuses:
        LORDBLESS_DOCUMENT_REQUEST_STATUS,


    documentTypes:
        LORDBLESS_DOCUMENT_TYPES,


    requests:
        LORDBLESS_DOCUMENT_REQUESTS,


    getDocumentTypeDefinition:
        getDocumentTypeDefinition,


    getDocumentTypeLabel:
        getDocumentTypeLabel,


    getDocumentValidityStatus:
        getDocumentValidityStatus,


    getPassportExpiryAlert:
        getPassportExpiryAlert,


    findCurrentClientDocument:
        findCurrentClientDocument,


    findReusableClientDocument:
        findReusableClientDocument,


    getJourneyDocumentRequests:
        getJourneyDocumentRequests,


    getDocumentRequestStatus:
        getDocumentRequestStatus,


    getDocumentRequestSummary:
        getDocumentRequestSummary,


    renderDocumentCentre:
        renderDocumentCentre,


    openUniversalUploadDialog:
        openUniversalUploadDialog

};
