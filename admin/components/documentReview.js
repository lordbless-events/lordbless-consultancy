/* =========================================================
   LORDBLESS ADMIN
   DOCUMENT REVIEW
   ========================================================= */


/* =========================================================
   DOCUMENT REVIEW STATE
   ========================================================= */

const LORDBLESS_DOCUMENT_REVIEW_STATE = {

    document: null,

    client: null,

    transaction: null,

    reviewHistory: []

};


/* =========================================================
   INITIALISE DOCUMENT REVIEW
   ========================================================= */

function initialiseDocumentReview(
    document,
    client,
    transaction = null
) {

    if (!document) {
        return;
    }

    LORDBLESS_DOCUMENT_REVIEW_STATE.document =
        document;

    LORDBLESS_DOCUMENT_REVIEW_STATE.client =
        client || null;

    LORDBLESS_DOCUMENT_REVIEW_STATE.transaction =
        transaction || null;

    LORDBLESS_DOCUMENT_REVIEW_STATE.reviewHistory =
        Array.isArray(document.reviewHistory)
            ? [...document.reviewHistory]
            : [];

}


/* =========================================================
   RENDER DOCUMENT REVIEW
   ========================================================= */

function renderDocumentReview(
    container,
    document,
    client,
    transaction = null
) {

    if (!container || !document) {
        return;
    }

    initialiseDocumentReview(
        document,
        client,
        transaction
    );


    const status =
        getDocumentReviewStatus(document);


    const statusLabel =
        getDocumentReviewStatusLabel(status);


    const transactionLabel =
        transaction
            ? `${transaction.title || "Transaction"} · ${transaction.id}`
            : "Client Document Library";


    container.innerHTML = `

        <div class="document-review-panel">


            <!-- HEADER -->

            <div class="document-review-header">

                <div>

                    <span class="section-eyebrow">
                        DOCUMENT REVIEW
                    </span>

                    <h2>
                        ${escapeDocumentReviewHtml(
                            document.name || "Document"
                        )}
                    </h2>

                    <p>
                        ${escapeDocumentReviewHtml(
                            transactionLabel
                        )}
                    </p>

                </div>


                <span
                    class="document-review-status status-${status}"
                >
                    ${statusLabel}
                </span>

            </div>


            <!-- DOCUMENT INFORMATION -->

            <div class="document-review-grid">


                <div class="document-review-card">

                    <span>
                        Document Type
                    </span>

                    <strong>
                        ${escapeDocumentReviewHtml(
                            document.type || "—"
                        )}
                    </strong>

                </div>


                <div class="document-review-card">

                    <span>
                        File Name
                    </span>

                    <strong>
                        ${escapeDocumentReviewHtml(
                            document.fileName || "—"
                        )}
                    </strong>

                </div>


                <div class="document-review-card">

                    <span>
                        Uploaded
                    </span>

                    <strong>
                        ${formatDocumentReviewDate(
                            document.uploadedAt
                        )}
                    </strong>

                </div>


                <div class="document-review-card">

                    <span>
                        Version
                    </span>

                    <strong>
                        ${document.version || 1}
                    </strong>

                </div>

            </div>


            <!-- CLIENT -->

            ${
                client
                    ? `

                        <div class="document-review-section">

                            <div class="document-review-section-header">

                                <div>

                                    <span class="section-eyebrow">
                                        CLIENT
                                    </span>

                                    <h3>
                                        ${escapeDocumentReviewHtml(
                                            client.fullName ||
                                            "Client"
                                        )}
                                    </h3>

                                </div>

                            </div>


                            <div class="document-review-client-grid">

                                <div>

                                    <span>
                                        Client ID
                                    </span>

                                    <strong>
                                        ${escapeDocumentReviewHtml(
                                            client.clientCode || client.client_code || "ID pending"
                                        )}
                                    </strong>

                                </div>


                                <div>

                                    <span>
                                        Email
                                    </span>

                                    <strong>
                                        ${escapeDocumentReviewHtml(
                                            client.email || "—"
                                        )}
                                    </strong>

                                </div>


                                <div>

                                    <span>
                                        WhatsApp
                                    </span>

                                    <strong>
                                        ${escapeDocumentReviewHtml(
                                            client.whatsapp || "—"
                                        )}
                                    </strong>

                                </div>

                            </div>

                        </div>

                    `
                    : ""
            }


            <!-- PASSPORT VALIDITY -->

            ${
                document.type === "passport"
                    ? renderPassportReviewInformation(
                        document
                    )
                    : ""
            }


            <!-- FILE PREVIEW -->

            <div class="document-review-section">

                <div class="document-review-section-header">

                    <div>

                        <span class="section-eyebrow">
                            FILE
                        </span>

                        <h3>
                            Document Preview
                        </h3>

                    </div>

                </div>


                <div class="document-preview">

                    ${
                        document.previewUrl
                            ? `
                                <iframe
                                    src="${escapeDocumentReviewAttribute(
                                        document.previewUrl
                                    )}"
                                    title="Document preview"
                                    class="document-preview-frame"
                                ></iframe>
                            `
                            : `
                                <div class="document-preview-placeholder">

                                    <div class="document-preview-icon">
                                        DOC
                                    </div>

                                    <strong>
                                        ${escapeDocumentReviewHtml(
                                            document.fileName ||
                                            document.name ||
                                            "Uploaded document"
                                        )}
                                    </strong>

                                    <span>
                                        Secure document preview
                                        will be connected to
                                        Supabase Storage.
                                    </span>

                                </div>
                            `
                    }

                </div>

            </div>


            <!-- REVIEW FORM -->

            ${
                status !== "approved"
                    ? `

                        <div class="document-review-section">

                            <div class="document-review-section-header">

                                <div>

                                    <span class="section-eyebrow">
                                        ADMIN DECISION
                                    </span>

                                    <h3>
                                        Review Document
                                    </h3>

                                </div>

                            </div>


                            <label
                                class="document-review-field"
                                for="document-review-note"
                            >

                                <span>
                                    Review note
                                </span>

                                <textarea
                                    id="document-review-note"
                                    rows="4"
                                    placeholder="Add a note for the client or internal team..."
                                ></textarea>

                            </label>


                            <div class="document-review-actions">

                                <button
                                    type="button"
                                    class="btn btn-primary"
                                    id="approve-document-btn"
                                >
                                    Approve Document
                                </button>


                                <button
                                    type="button"
                                    class="btn btn-danger"
                                    id="reject-document-btn"
                                >
                                    Reject Document
                                </button>

                            </div>

                        </div>

                    `
                    : `

                        <div class="document-approved-banner">

                            <div class="document-approved-icon">
                                ✓
                            </div>

                            <div>

                                <strong>
                                    Document Approved
                                </strong>

                                <span>
                                    This document is now available
                                    in the client's permanent
                                    document library and can be
                                    reused for applicable future
                                    transactions.
                                </span>

                            </div>

                        </div>

                    `
            }


            <!-- REVIEW HISTORY -->

            ${renderDocumentReviewHistory(document)}

        </div>
    `;


    initialiseDocumentReviewActions(
        container
    );

}


/* =========================================================
   PASSPORT INFORMATION
   ========================================================= */

function renderPassportReviewInformation(
    document
) {

    const alert =
        LORDBLESS_DOCUMENT_CENTRE
            .getPassportExpiryAlert(
                document
            );


    if (!alert) {
        return "";
    }


    let alertClass =
        "document-passport-alert";


    if (alert.level === "urgent") {
        alertClass +=
            " document-passport-alert-urgent";
    }

    if (alert.level === "critical") {
        alertClass +=
            " document-passport-alert-critical";
    }

    if (alert.level === "attention") {
        alertClass +=
            " document-passport-alert-attention";
    }


    return `

        <div class="${alertClass}">

            <div>

                <strong>
                    Passport Validity
                </strong>

                <span>
                    ${escapeDocumentReviewHtml(
                        alert.message
                    )}
                </span>

            </div>


            <strong>
                ${
                    alert.daysRemaining < 0
                        ? "EXPIRED"
                        : `${alert.daysRemaining} days`
                }
            </strong>

        </div>

    `;
}


/* =========================================================
   APPROVE DOCUMENT
   ========================================================= */

function approveDocument() {

    const document =
        LORDBLESS_DOCUMENT_REVIEW_STATE.document;


    if (!document) {
        return;
    }

    const note =
        getReviewNote();


    /*
     * Mark the uploaded document as approved.
     */

    document.status =
        "approved";


    document.approvedAt =
        new Date().toISOString();


    document.rejectedAt =
        null;


    document.rejectionReason =
        null;


    document.reviewHistory =
        Array.isArray(document.reviewHistory)
            ? document.reviewHistory
            : [];


    document.reviewHistory.push({

        action: "approved",

        note,

        timestamp:
            new Date().toISOString(),

        transactionId:
            LORDBLESS_DOCUMENT_REVIEW_STATE
                .transaction
                ?.id || null

    });


    /*
     * IMPORTANT:
     *
     * The document remains attached to the CLIENT,
     * not merely to this transaction.
     *
     * Therefore future transactions can discover
     * this approved document automatically.
     */

    markDocumentAsReusable(
        document
    );


    showDocumentReviewMessage(
        document.isReusable
            ? "Document approved and added to the client's reusable document library."
            : "Document approved. It is not reusable while superseded or outside its validity dates."
    );


    console.log(
        "LORDBLESS DOCUMENT APPROVED:",
        document
    );


    refreshDocumentReview();
}


/* =========================================================
   REJECT DOCUMENT
   ========================================================= */

function rejectDocument() {

    const document =
        LORDBLESS_DOCUMENT_REVIEW_STATE.document;


    if (!document) {
        return;
    }


    const note =
        getReviewNote();


    if (!note.trim()) {

        showDocumentReviewMessage(
            "Please provide a reason before rejecting the document."
        );

        return;
    }


    document.status =
        "rejected";


    document.rejectedAt =
        new Date().toISOString();


    document.approvedAt =
        null;


    document.rejectionReason =
        note;


    document.isCurrent =
        false;


    document.reviewHistory =
        Array.isArray(document.reviewHistory)
            ? document.reviewHistory
            : [];


    document.reviewHistory.push({

        action: "rejected",

        note,

        timestamp:
            new Date().toISOString(),

        transactionId:
            LORDBLESS_DOCUMENT_REVIEW_STATE
                .transaction
                ?.id || null

    });


    showDocumentReviewMessage(
        "Document rejected. A replacement can now be requested from the client."
    );


    console.log(
        "LORDBLESS DOCUMENT REJECTED:",
        document
    );


    refreshDocumentReview();
}


/* =========================================================
   MARK DOCUMENT REUSABLE
   ========================================================= */

function markDocumentAsReusable(
    document
) {

    /*
     * Approved documents are permanent client assets.
     */

    const today = new Date().toISOString().slice(0, 10);
    const validFrom = document.validFrom || document.valid_from || document.issueDate;
    const validUntil = document.validUntil || document.valid_until || document.expiryDate;
    const startsInFuture = validFrom && String(validFrom).slice(0, 10) > today;
    const alreadyExpired = validUntil && String(validUntil).slice(0, 10) < today;

    document.isReusable =
        document.isCurrent !== false &&
        !startsInFuture &&
        !alreadyExpired;

}


/* =========================================================
   REVIEW NOTE
   ========================================================= */

function getReviewNote() {

    const element =
        window.document.getElementById(
            "document-review-note"
        );

    return element
        ? element.value.trim()
        : "";
}


/* =========================================================
   ACTION INITIALISATION
   ========================================================= */

function initialiseDocumentReviewActions(
    container
) {

    const approveButton =
        container.querySelector(
            "#approve-document-btn"
        );


    if (approveButton) {

        approveButton.addEventListener(
            "click",
            approveDocument
        );

    }


    const rejectButton =
        container.querySelector(
            "#reject-document-btn"
        );


    if (rejectButton) {

        rejectButton.addEventListener(
            "click",
            rejectDocument
        );

    }

}


/* =========================================================
   REFRESH
   ========================================================= */

function refreshDocumentReview() {

    const container =
        window.document.getElementById(
            "document-review-container"
        );


    if (!container) {
        return;
    }


    const state =
        LORDBLESS_DOCUMENT_REVIEW_STATE;


    renderDocumentReview(
        container,
        state.document,
        state.client,
        state.transaction
    );

}


/* =========================================================
   REVIEW HISTORY
   ========================================================= */

function renderDocumentReviewHistory(
    document
) {

    const history =
        Array.isArray(document.reviewHistory)
            ? document.reviewHistory
            : [];


    if (!history.length) {

        return `

            <div class="document-review-section">

                <div class="document-review-section-header">

                    <div>

                        <span class="section-eyebrow">
                            HISTORY
                        </span>

                        <h3>
                            Review History
                        </h3>

                    </div>

                </div>

                <div class="empty-state">
                    No review activity yet.
                </div>

            </div>

        `;

    }


    return `

        <div class="document-review-section">

            <div class="document-review-section-header">

                <div>

                    <span class="section-eyebrow">
                        HISTORY
                    </span>

                    <h3>
                        Review History
                    </h3>

                </div>

            </div>


            <div class="document-review-history">

                ${history
                    .slice()
                    .reverse()
                    .map(
                        renderReviewHistoryItem
                    )
                    .join("")}

            </div>

        </div>

    `;

}


/* =========================================================
   HISTORY ITEM
   ========================================================= */

function renderReviewHistoryItem(
    item
) {

    const actionLabel = {

        approved: "Approved",

        rejected: "Rejected",

        requested: "Requested",

        replacement_requested:
            "Replacement Requested"

    }[item.action] || item.action;


    return `

        <div class="document-history-item">

            <div class="document-history-marker">
                ${item.action === "approved" ? "✓" : "•"}
            </div>


            <div class="document-history-content">

                <strong>
                    ${escapeDocumentReviewHtml(
                        actionLabel
                    )}
                </strong>

                ${
                    item.note
                        ? `
                            <span>
                                ${escapeDocumentReviewHtml(
                                    item.note
                                )}
                            </span>
                        `
                        : ""
                }


                <small>
                    ${formatDocumentReviewDate(
                        item.timestamp
                    )}
                </small>

            </div>

        </div>

    `;

}


/* =========================================================
   STATUS
   ========================================================= */

function getDocumentReviewStatus(
    document
) {

    if (!document) {
        return "missing";
    }


    if (document.status === "approved") {
        return "approved";
    }


    if (document.status === "rejected") {
        return "rejected";
    }


    if (document.status === "reviewing") {
        return "reviewing";
    }


    if (
        document.validUntil &&
        new Date(document.validUntil) < new Date()
    ) {
        return "expired";
    }


    return "uploaded";

}


function getDocumentReviewStatusLabel(
    status
) {

    const labels = {

        approved: "APPROVED",

        rejected: "REJECTED",

        reviewing: "UNDER REVIEW",

        expired: "EXPIRED",

        uploaded: "UPLOADED",

        missing: "MISSING"

    };


    return labels[status] || "UPLOADED";

}


/* =========================================================
   DATE FORMAT
   ========================================================= */

function formatDocumentReviewDate(
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
   MESSAGE
   ========================================================= */

function showDocumentReviewMessage(
    message
) {

    console.log(
        "LORDBLESS DOCUMENT REVIEW:",
        message
    );

    alert(message);

}


/* =========================================================
   HTML ESCAPING
   ========================================================= */

function escapeDocumentReviewHtml(
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


function escapeDocumentReviewAttribute(
    value
) {

    return escapeDocumentReviewHtml(
        value
    );

}


/* =========================================================
   GLOBAL ADMIN BRIDGE
   ========================================================= */

window.LORDBLESS_DOCUMENT_REVIEW = {

    state:
        LORDBLESS_DOCUMENT_REVIEW_STATE,

    initialise:
        initialiseDocumentReview,

    render:
        renderDocumentReview,

    approve:
        approveDocument,

    reject:
        rejectDocument,

    refresh:
        refreshDocumentReview

};
