/* =========================================
   LORDBLESS ADMIN
   ENQUIRY DETAIL COMPONENT
========================================= */


/* =========================================
   OPEN ENQUIRY
========================================= */

function renderEnquiryDetail(
    container,
    enquiry,
    client = null
) {

    if (!container) {
        return;
    }

    if (!enquiry) {

        container.innerHTML = `

            <div class="empty-state">

                <div class="empty-state-title">
                    Enquiry not found
                </div>

            </div>

        `;

        return;

    }


    const journey =
        enquiry.journey && typeof enquiry.journey === "object"
            ? enquiry.journey
            : {};

    const serviceValues =
        Array.isArray(enquiry.services) && enquiry.services.length
            ? enquiry.services
            : Array.isArray(enquiry.service)
                ? enquiry.service
                : enquiry.service
                    ? [enquiry.service]
                    : Array.isArray(enquiry.services)
                        ? enquiry.services
                        : [];

    enquiry = {
        ...enquiry,
        client: {
            ...(client || {}),
            ...(enquiry.client || {})
        },
        services: serviceValues,
        journey: {
            ...journey,
            destination:
                journey.destination || enquiry.destination || "",
            timeframe:
                journey.timeframe || enquiry.timeframe ||
                enquiry.travel_dates || enquiry.travelDates || "",
            preferredContact:
                journey.preferredContact || enquiry.preferredContact ||
                enquiry.preferred_contact || "",
            additionalInformation:
                journey.additionalInformation ||
                enquiry.additionalInformation ||
                enquiry.additional_information || ""
        }
    };


    const serviceDetails =
        renderServiceSections(
            enquiry
        );

    const clientId =
        enquiry.client?.id || "";

    const isLinkedClientRecord =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(clientId));

    const currentAdmin =
        typeof getCurrentUser === "function"
            ? getCurrentUser()
            : null;

    const canRequestPortalAccess =
        Boolean(
            currentAdmin &&
            typeof hasPermission === "function" &&
            hasPermission(currentAdmin, "clients.portal_access")
        );

    const canRequestFinancePayment =
        Boolean(
            currentAdmin &&
            typeof hasPermission === "function" &&
            hasPermission(currentAdmin, "finance.requests")
        );

    container.innerHTML = `

        <div class="enquiry-detail-page">

            <div class="detail-page-header">

                <div>

                    <div class="topbar-label">
                        ENQUIRY REFERENCE
                    </div>

                    <h2>
                        ${escapeHTML(
                            enquiry.reference
                        )}
                    </h2>

                </div>


                <div>

                    ${renderStatusBadge(
                        enquiry.status
                    )}

                </div>

            </div>


            <div class="detail-card enquiry-onboarding-actions">

                <h3>Client Onboarding</h3>

                ${isLinkedClientRecord
                    ? `
                        <div class="enquiry-onboarding-action-buttons">
                            ${canRequestPortalAccess ? `
                                <button
                                    type="button"
                                    class="button button-primary"
                                    data-enquiry-action="create-client-access"
                                    data-client-id="${escapeHTML(clientId)}"
                                >
                                    Create Portal Access
                                </button>
                            ` : ""}

                            ${canRequestFinancePayment ? `
                                <button
                                    type="button"
                                    class="button button-secondary"
                                    data-enquiry-action="request-initial-assessment-payment"
                                    data-client-id="${escapeHTML(clientId)}"
                                >
                                    Request Initial Assessment Payment
                                </button>
                            ` : ""}
                        </div>

                        <p
                            class="enquiry-onboarding-action-message"
                            data-enquiry-action-message
                            role="status"
                            aria-live="polite"
                        ></p>
                    `
                    : `
                        <p>
                            Portal access and onboarding payments are available for enquiries linked to a production client record.
                        </p>
                    `
                }

            </div>


            <div class="detail-grid">


                <!-- CLIENT -->

                ${detailCard(
                    "Client Information",
                    [
                        [
                            "Name",
                            enquiry.client.fullName
                        ],
                        [
                            "Email",
                            enquiry.client.email
                        ],
                        [
                            "WhatsApp",
                            enquiry.client.whatsapp
                        ],
                        [
                            "Current Country",
                            enquiry.client.currentCountry
                        ],
                        [
                            "Nationality",
                            enquiry.client.nationality
                        ]
                    ]
                )}


                <!-- JOURNEY -->

                ${detailCard(
                    "Journey",
                    [
                        [
                            "Destination",
                            enquiry.journey.destination
                        ],
                        [
                            "Timeframe",
                            enquiry.journey.timeframe
                        ],
                        [
                            "Preferred Contact",
                            enquiry.journey.preferredContact
                        ],
                        [
                            "Additional Information",
                            enquiry.journey.additionalInformation
                        ]
                    ]
                )}


                <!-- STATUS -->

                <div class="detail-card">

                    <h3>
                        Workflow
                    </h3>

                    ${renderStatusSelector(
                        enquiry
                    )}

                </div>


                <!-- DATE -->

                ${detailCard(
                    "Enquiry Record",
                    [
                        [
                            "Reference",
                            enquiry.reference
                        ],
                        [
                            "Created",
                            formatDate(
                                enquiry.createdAt
                            )
                        ],
                        [
                            "Services",
                            formatServices(
                                enquiry.services
                            )
                        ]
                    ]
                )}


                ${serviceDetails}


                <!-- NOTES -->

                ${renderNotes(
                    enquiry
                )}


                <!-- FOLLOWUPS -->

                ${renderFollowups(
                    enquiry
                )}

            </div>

        </div>

    `;

}


/* =========================================
   SERVICE SECTIONS
========================================= */

function renderServiceSections(
    enquiry
) {

    const sections = [];


    if (
        enquiry.services.includes(
            "education"
        )
    ) {

        sections.push(
            detailCard(
                "Education",
                objectToRows(
                    enquiry.education
                )
            )
        );

    }


    if (
        enquiry.services.includes(
            "careers"
        )
    ) {

        sections.push(
            detailCard(
                "Careers",
                objectToRows(
                    enquiry.careers
                )
            )
        );

    }


    if (
        enquiry.services.includes(
            "travel"
        )
    ) {

        sections.push(
            detailCard(
                "Travel",
                objectToRows(
                    enquiry.travel
                )
            )
        );

    }


    if (
        enquiry.services.includes(
            "business"
        )
    ) {

        sections.push(
            detailCard(
                "Business",
                objectToRows(
                    enquiry.business
                )
            )
        );

    }


    if (
        enquiry.services.includes(
            "mobility"
        )
    ) {

        sections.push(
            detailCard(
                "LORDBLESS GOLD SERVICES",
                objectToRows(
                    enquiry.mobility
                )
            )
        );

    }


    if (
        enquiry.services.includes(
            "unsure"
        )
    ) {

        sections.push(
            detailCard(
                "General / Not Sure Yet",
                objectToRows(
                    enquiry.general
                )
            )
        );

    }


    return sections.join("");

}
