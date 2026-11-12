/* ============================================================
   LORDBLESS CONSULTANCY
   MAIN JAVASCRIPT
   Universal Intelligent Enquiry System
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

    /* =========================================================
       MOBILE NAVIGATION
       ========================================================= */

    const mobileMenuButton = document.querySelector(
        ".mobile-menu-button"
    );

    const mainNavigation = document.querySelector(
        ".main-navigation"
    );

    if (mobileMenuButton && mainNavigation) {

        mobileMenuButton.addEventListener("click", () => {

            const isOpen =
                mobileMenuButton.getAttribute("aria-expanded") === "true";

            mobileMenuButton.setAttribute(
                "aria-expanded",
                String(!isOpen)
            );

            mainNavigation.classList.toggle(
                "is-open",
                !isOpen
            );

        });


        /* Close mobile menu after selecting a navigation link */

        mainNavigation
            .querySelectorAll("a")
            .forEach(link => {

                link.addEventListener("click", () => {

                    mobileMenuButton.setAttribute(
                        "aria-expanded",
                        "false"
                    );

                    mainNavigation.classList.remove(
                        "is-open"
                    );

                });

            });

    }



    /* =========================================================
       INTELLIGENT ENQUIRY SYSTEM
       ========================================================= */

    const enquiryForm = document.querySelector(
        "#lordbless-enquiry-form"
    );

    if (!enquiryForm) {
        return;
    }


    const serviceCheckboxes = enquiryForm.querySelectorAll(
        'input[name="services"]'
    );


    const servicePanels = enquiryForm.querySelectorAll(
        "[data-service-panel]"
    );


    /* =========================================================
       SERVICE PANEL CONTROL
       ========================================================= */

    function updateServicePanels() {

        const selectedServices = Array.from(
            serviceCheckboxes
        )
        .filter(checkbox => checkbox.checked)
        .map(checkbox => checkbox.value);


        /*
         * If "Not Sure Yet" is selected,
         * hide all other service-specific panels.
         */

        if (selectedServices.includes("unsure")) {

            servicePanels.forEach(panel => {

                panel.hidden =
                    panel.dataset.servicePanel !== "unsure";

            });

            return;
        }


        /*
         * Otherwise display the panels corresponding
         * to the selected services.
         */

        servicePanels.forEach(panel => {

            const service =
                panel.dataset.servicePanel;

            panel.hidden =
                !selectedServices.includes(service);

        });

    }



    /* =========================================================
       SERVICE SELECTION EVENTS
       ========================================================= */

    serviceCheckboxes.forEach(checkbox => {

        checkbox.addEventListener(
            "change",
            () => {

                /*
                 * "Not Sure Yet" is mutually exclusive
                 * with the specific service options.
                 */

                if (
                    checkbox.value === "unsure" &&
                    checkbox.checked
                ) {

                    serviceCheckboxes.forEach(otherCheckbox => {

                        if (
                            otherCheckbox !== checkbox
                        ) {

                            otherCheckbox.checked = false;

                        }

                    });

                }


                /*
                 * If a specific service is selected,
                 * automatically remove "Not Sure Yet".
                 */

                if (
                    checkbox.value !== "unsure" &&
                    checkbox.checked
                ) {

                    const unsureCheckbox =
                        enquiryForm.querySelector(
                            'input[name="services"][value="unsure"]'
                        );

                    if (unsureCheckbox) {

                        unsureCheckbox.checked = false;

                    }

                }


                updateServicePanels();

            }
        );

    });



    /* =========================================================
       ENHANCED SERVICE EXPERIENCE
       PHASE 2C
       ========================================================= */

    const enhancedServiceLinks =
        document.querySelectorAll(
            "[data-enhanced-service]"
        );

    const enhancedServicePanels =
        document.querySelectorAll(
            "[data-service-experience]"
        );


    /*
     * Display one enhanced service panel
     * and hide all other service panels.
     */

    function showEnhancedService(service) {

        if (!service) {
            return;
        }


        let targetPanel = null;


        enhancedServicePanels.forEach(panel => {

            const panelService =
                panel.dataset.serviceExperience;


            const isTarget =
                panelService === service;


            if (isTarget) {

                targetPanel = panel;

                panel.hidden = false;

                requestAnimationFrame(() => {

                    panel.classList.add(
                        "is-active"
                    );

                });

            } else {

                panel.classList.remove(
                    "is-active"
                );

                panel.hidden = true;

            }

        });


        /*
         * Stop if no matching service panel exists.
         */

        if (!targetPanel) {
            return;
        }


        /*
         * Update the URL hash without
         * causing a browser page reload.
         */

        if (
            window.history &&
            window.history.replaceState
        ) {

            window.history.replaceState(
                null,
                "",
                "#service-experience"
            );

        }


        /*
         * Give the browser a moment to render
         * the panel before scrolling to it.
         */

        requestAnimationFrame(() => {

            targetPanel.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

        });

    }



    /*
     * Homepage service-card interactions.
     */

    enhancedServiceLinks.forEach(link => {

        link.addEventListener(
            "click",
            event => {

                event.preventDefault();


                const service =
                    link.dataset.enhancedService;


                showEnhancedService(
                    service
                );

            }
        );

    });



    /* =========================================================
       SERVICE CARD → ENQUIRY FORM
       ========================================================= */

    const serviceLinks = document.querySelectorAll(
        "[data-service-select]"
    );


    serviceLinks.forEach(link => {

        link.addEventListener("click", () => {

            const service =
                link.dataset.serviceSelect;


            const checkbox =
                enquiryForm.querySelector(
                    `input[name="services"][value="${service}"]`
                );


            if (!checkbox) {
                return;
            }


            /*
             * Clear "Not Sure Yet".
             */

            const unsureCheckbox =
                enquiryForm.querySelector(
                    'input[name="services"][value="unsure"]'
                );


            if (unsureCheckbox) {
                unsureCheckbox.checked = false;
            }


            /*
             * Select requested service.
             */

            checkbox.checked = true;


            updateServicePanels();

        });

    });



    /* =========================================================
       INITIAL FORM STATE
       ========================================================= */

    updateServicePanels();



    /* =========================================================
       FORM VALIDATION HELPERS
       ========================================================= */

    function showFieldError(
        field,
        message
    ) {

        clearFieldError(field);


        field.classList.add(
            "field-error"
        );


        const errorMessage =
            document.createElement("small");


        errorMessage.className =
            "form-error-message";


        errorMessage.textContent =
            message;


        field.parentElement.appendChild(
            errorMessage
        );

    }



    function clearFieldError(field) {

        field.classList.remove(
            "field-error"
        );


        const existingError =
            field.parentElement.querySelector(
                ".form-error-message"
            );


        if (existingError) {
            existingError.remove();
        }

    }



    /* =========================================================
       CLEAR ERRORS WHEN USER CORRECTS A FIELD
       ========================================================= */

    enquiryForm
        .querySelectorAll(
            "input, select, textarea"
        )
        .forEach(field => {

            field.addEventListener(
                "input",
                () => clearFieldError(field)
            );


            field.addEventListener(
                "change",
                () => clearFieldError(field)
            );

        });



    /* =========================================================
       EMAIL VALIDATION
       ========================================================= */

    function isValidEmail(email) {

        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
            email
        );

    }



    /* =========================================================
       SERVICE SELECTION VALIDATION
       ========================================================= */

    function validateServices() {

        const selectedServices =
            Array.from(
                serviceCheckboxes
            )
            .filter(
                checkbox => checkbox.checked
            );


        if (selectedServices.length === 0) {

            const serviceSelection =
                enquiryForm.querySelector(
                    ".service-selection"
                );


            if (serviceSelection) {

                serviceSelection.classList.add(
                    "selection-error"
                );

            }


            return false;

        }


        const serviceSelection =
            enquiryForm.querySelector(
                ".service-selection"
            );


        if (serviceSelection) {

            serviceSelection.classList.remove(
                "selection-error"
            );

        }


        return true;

    }



    /* =========================================================
       CONSENT VALIDATION
       ========================================================= */

    function validateConsent() {

        const consent =
            document.querySelector(
                "#enquiry-consent"
            );


        if (!consent) {
            return true;
        }


        if (!consent.checked) {

            consent.classList.add(
                "field-error"
            );


            return false;

        }


        consent.classList.remove(
            "field-error"
        );


        return true;

    }



    /* =========================================================
       BASIC FORM VALIDATION
       ========================================================= */

    function validateBasicFields() {

        let isValid = true;


        const requiredFields =
            enquiryForm.querySelectorAll(
                "[required]"
            );


        requiredFields.forEach(field => {

            /*
             * Ignore required fields inside hidden
             * service panels.
             */

            const parentPanel =
                field.closest(
                    "[data-service-panel]"
                );


            if (
                parentPanel &&
                parentPanel.hidden
            ) {

                return;

            }


            clearFieldError(field);


            if (
                field.type === "checkbox" &&
                !field.checked
            ) {

                isValid = false;

                return;

            }


            if (
                field.value.trim() === ""
            ) {

                showFieldError(
                    field,
                    "Please complete this field."
                );


                isValid = false;

                return;

            }


            if (
                field.type === "email" &&
                !isValidEmail(field.value.trim())
            ) {

                showFieldError(
                    field,
                    "Please enter a valid email address."
                );


                isValid = false;

            }

        });


        return isValid;

    }


    /* =========================================================
   SUPABASE SUBMISSION
   ========================================================= */

async function submitEnquiryToSupabase(
    enquiryData
) {

    if (
        typeof lordblessSupabase ===
        "undefined"
    ) {

        throw new Error(
            "Supabase is not configured."
        );

    }


    const {
        data,
        error
    } =
        await lordblessSupabase.rpc(
            "submit_initial_enquiry",
            {
                p_data: enquiryData
            }
        );


    if (error) {

        console.error(
            "LORDBLESS SUPABASE ERROR:",
            error
        );

        throw new Error(
            error.message ||
            "Unable to submit enquiry."
        );

    }


    if (
        !data ||
        data.success !== true
    ) {

        throw new Error(
            "The enquiry could not be completed."
        );

    }


    console.log(
        "LORDBLESS ENQUIRY SUBMITTED:",
        data
    );


    return data;

}



/* =========================================================
   FORM SUBMISSION
   ========================================================= */

enquiryForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();


        const basicFieldsValid =
            validateBasicFields();


        const servicesValid =
            validateServices();


        const consentValid =
            validateConsent();


        if (
            !basicFieldsValid ||
            !servicesValid ||
            !consentValid
        ) {

            const firstError =
                enquiryForm.querySelector(
                    ".field-error, .selection-error"
                );


            if (firstError) {

                firstError.scrollIntoView({
                    behavior: "smooth",
                    block: "center"
                });

            }


            return;

        }


        /* =================================================
           BUILD STRUCTURED ENQUIRY
           ================================================= */

        const formData =
            new FormData(
                enquiryForm
            );


        const enquiryData =
            buildEnquiryData(
                formData
            );


        /* =================================================
           SUBMIT BUTTON STATE
           ================================================= */

        const submitButton =
            enquiryForm.querySelector(
                'button[type="submit"]'
            );


        const originalButtonText =
            submitButton
                ? submitButton.textContent
                : "";


        if (submitButton) {

            submitButton.disabled =
                true;

            submitButton.textContent =
                "Sending...";

        }


        /* =================================================
           REMOVE OLD SUBMISSION ERROR
           ================================================= */

        const oldError =
            enquiryForm.querySelector(
                ".submission-error"
            );


        if (oldError) {

            oldError.remove();

        }


        try {

            /* =============================================
               SEND TO SUPABASE
               ============================================= */

            
            const result =
                await submitEnquiryToSupabase(
                    enquiryData
    );


/* =============================================
   SEND EMAIL NOTIFICATIONS
   ============================================= */

try {

    await sendEnquiryEmail(
        enquiryData,
        result.reference
    );

} catch (emailError) {

    console.error(
        "LORDBLESS EMAIL NOTIFICATION FAILED:",
        emailError
    );

}


/* =============================================
   SUCCESS
   ============================================= */

showSubmissionMessage(
    enquiryData,
    result
);

        } catch (error) {

            console.error(
                "LORDBLESS ENQUIRY SUBMISSION FAILED:",
                error
            );


            const errorMessage =
                document.createElement(
                    "p"
                );


            errorMessage.className =
                "submission-error";


            errorMessage.setAttribute(
                "role",
                "alert"
            );


            errorMessage.textContent =
                "We could not submit your enquiry right now. Please try again or contact us on WhatsApp.";


            enquiryForm.prepend(
                errorMessage
            );


            errorMessage.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });


        } finally {

            if (submitButton) {

                submitButton.disabled =
                    false;

                submitButton.textContent =
                    originalButtonText;

            }

        }

        }
);
/* =========================================================
   SEND ENQUIRY EMAIL
   ========================================================= */

async function sendEnquiryEmail(
    enquiryData,
    reference
) {

    if (
        typeof lordblessSupabase ===
        "undefined"
    ) {

        throw new Error(
            "Supabase is not configured."
        );

    }


    const {
        data,
        error
    } =
        await lordblessSupabase.functions.invoke(
            "send-enquiry-email",
            {
                body: {
                    enquiryData: window.LORDBLESS_ENQUIRY_EMAIL_PAYLOAD?.forNotification(enquiryData) || enquiryData,
                    reference
                }
            }
        );


    if (error) {

        console.error(
            "LORDBLESS EMAIL FUNCTION ERROR:",
            error
        );

        throw new Error(
            error.message ||
            "Unable to send enquiry emails."
        );

    }


    if (
        !data ||
        data.success !== true
    ) {

        throw new Error(
            data?.error ||
            "The enquiry emails could not be sent."
        );

    }


    console.log(
        "LORDBLESS ENQUIRY EMAILS SENT:",
        data
    );


    return data;

}
    /* =========================================================
       BUILD STRUCTURED ENQUIRY DATA
       ========================================================= */

    function buildEnquiryData(formData) {

        const selectedServices =
            formData.getAll(
                "services"
            );


        return {

            submittedAt:
                new Date().toISOString(),


            client: {

                fullName:
                    formData.get("full_name") || "",

                whatsapp:
                    formData.get("whatsapp") || "",

                email:
                    formData.get("email") || "",

                currentCountry:
                    formData.get("current_country") || "",

                nationality:
                    formData.get("nationality") || ""

            },


            services:
                selectedServices,


            journey: {

                destination:
                    formData.get("destination") || "",

                timeframe:
                    formData.get("timeframe") || "",

                additionalInformation:
                    formData.get("additional_information") || "",

                preferredContact:
                    formData.get("preferred_contact") || ""

            },


            education: {

                destination:
                    formData.get("destination") || "",

                studyArea:
                    formData.get("study_area") || "",

                studyLevel:
                    formData.get("study_level") || "",

                firstProgramme:
                    formData.get("first_programme") || "",

                secondProgramme:
                    formData.get("second_programme") || "",

                preferredIntake:
                    formData.get("preferred_intake") || ""

            },


            careers: {

                profession:
                    formData.get("profession") || "",

                qualification:
                    formData.get(
                        "professional_qualification"
                    ) || "",

                experience:
                    formData.get(
                        "work_experience"
                    ) || "",

                destination:
                    formData.get(
                        "career_destination"
                    ) || "",

                interest:
                    formData.get(
                        "career_interest"
                    ) || ""

            },


            travel: {

                purpose:
                    formData.get(
                        "travel_purpose"
                    ) || "",

                destination:
                    formData.get(
                        "travel_destination"
                    ) || "",

                travelPeriod:
                    formData.get(
                        "travel_period"
                    ) || "",

                travellers:
                    formData.get(
                        "travellers"
                    ) || "",

                services:
                    formData.getAll(
                        "travel_services"
                    )

            },


            business: {

                businessType:
                    formData.get(
                        "business_type"
                    ) || "",

                services:
                    formData.getAll(
                        "business_services"
                    ),

                productCategory:
                    formData.get(
                        "product_category"
                    ) || "",

                estimatedQuantity:
                    formData.get(
                        "estimated_quantity"
                    ) || "",

                source:
                    formData.get(
                        "business_source"
                    ) || ""

            },


            mobility: {

                destination:
                    formData.get(
                        "mobility_destination"
                    ) || "",

                purpose:
                    formData.get(
                        "mobility_purpose"
                    ) || "",

                arrivalDate:
                    formData.get(
                        "arrival_date"
                    ) || "",

                services:
                    formData.getAll(
                        "mobility_services"
                    )

            },


            general: {

                unsureRequest:
                    formData.get(
                        "unsure_request"
                    ) || "",

                additionalInformation:
                    formData.get(
                        "additional_information"
                    ) || "",

                preferredContact:
                    formData.get(
                        "preferred_contact"
                    ) || ""

            }

        };

    }



    /* =========================================================
       SUBMISSION CONFIRMATION
       ========================================================= */
    function showSubmissionMessage(
    enquiryData,
    result
) {
        const formContainer =
            enquiryForm.parentElement;


        /*
         * Get the client's first name.
         */

        const fullName =
            enquiryData.client.fullName
                .trim();


        const firstName =
            fullName
                ? fullName.split(/\s+/)[0]
                : "there";


        /*
         * Determine the selected services.
         */

        const serviceLabels = {

            education:
                "GLOBAL EDUCATION",

            careers:
                "GLOBAL CAREERS",

            travel:
                "TRAVEL",

            business:
                "BUSINESS & SOURCING",

            mobility:
                "LORDBLESS GOLD SERVICES",

            unsure:
                "NOT SURE YET"

        };


        const selectedLabels =
            enquiryData.services
                .map(
                    service =>
                        serviceLabels[service] ||
                        service
                );


        const confirmation =
            document.createElement(
                "div"
            );


        confirmation.className =
            "enquiry-success";


        confirmation.setAttribute(
            "role",
            "status"
        );


        confirmation.innerHTML = `

            <p class="eyebrow">
                JOURNEY STARTED
            </p>


            <h2>
                Thank You, ${escapeHtml(firstName)}.
            </h2>

            <p>
    Your enquiry has been received by
    the LORDBLESS CONSULTANCY team.
</p>


<div class="enquiry-success-reference">

    <strong>
        Enquiry Reference
    </strong>

    <p>
        ${escapeHtml(
            result &&
            result.reference
                ? result.reference
                : "LBC-PENDING"
        )}
    </p>

</div>

            <div class="enquiry-success-services">

                <strong>
                    Your selected pathway
                </strong>


                <p>
                    ${escapeHtml(
                        selectedLabels.join(", ")
                    )}
                </p>

            </div>


            <div class="enquiry-next-steps">

                <h3>
                    What happens next?
                </h3>


                <ol>

                    <li>
                        We review your enquiry.
                    </li>

                    <li>
                        We identify the appropriate
                        service pathway.
                    </li>

                    <li>
                        A LORDBLESS consultant contacts
                        you regarding the next step.
                    </li>

                </ol>

            </div>


            <div class="enquiry-success-actions">

                <a
                    href="https://wa.me/4915754780010"
                    class="button button-primary"
                    target="_blank"
                    rel="noopener"
                >
                    Chat With Us on WhatsApp
                </a>


                <button
                    type="button"
                    class="button button-secondary"
                    data-reset-enquiry
                >
                    Start Another Enquiry
                </button>

            </div>

        `;


        enquiryForm.hidden = true;


        formContainer.appendChild(
            confirmation
        );


        confirmation
            .querySelector(
                "[data-reset-enquiry]"
            )
            .addEventListener(
                "click",
                () => {

                    confirmation.remove();

                    enquiryForm.reset();

                    enquiryForm.hidden = false;

                    updateServicePanels();

                    enquiryForm
                        .scrollIntoView({
                            behavior: "smooth",
                            block: "start"
                        });

                }
            );


        confirmation.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    }



    /* =========================================================
       HTML ESCAPE
       ========================================================= */

    function escapeHtml(value) {

        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    }



    /* =========================================================
       AUTO-SCROLL TO SERVICE QUESTIONS
       ========================================================= */

    serviceCheckboxes.forEach(checkbox => {

        checkbox.addEventListener(
            "change",
            () => {

                /*
                 * Give the browser a moment to update
                 * the hidden panels before scrolling.
                 */

                window.setTimeout(
                    () => {

                        const selected =
                            Array.from(
                                serviceCheckboxes
                            )
                            .filter(
                                item =>
                                    item.checked
                            );


                        if (
                            selected.length !== 1
                        ) {

                            return;

                        }


                        const selectedService =
                            selected[0].value;


                        const panel =
                            enquiryForm.querySelector(
                                `[data-service-panel="${selectedService}"]`
                            );


                        if (
                            panel &&
                            !panel.hidden
                        ) {

                            panel.scrollIntoView({
                                behavior: "smooth",
                                block: "nearest"
                            });

                        }

                    },
                    100
                );

            }
        );

    });



    /* =========================================================
       ACCESSIBILITY
       ========================================================= */

    /*
     * Keep hidden service panels inaccessible to keyboard
     * navigation and assistive technology.
     */

    function updatePanelAccessibility() {

        servicePanels.forEach(panel => {

            const isHidden =
                panel.hidden;


            panel.setAttribute(
                "aria-hidden",
                String(isHidden)
            );


            panel.querySelectorAll(
                "input, select, textarea"
            ).forEach(field => {

                /*
                 * Do not disable fields automatically.
                 * The hidden state itself controls visibility.
                 */

                field.setAttribute(
                    "tabindex",
                    isHidden
                        ? "-1"
                        : "0"
                );

            });

        });

    }



    /*
     * Extend panel update to accessibility.
     */

    const originalUpdateServicePanels =
        updateServicePanels;


    function refreshServiceInterface() {

        originalUpdateServicePanels();

        updatePanelAccessibility();

    }


    serviceCheckboxes.forEach(checkbox => {

        checkbox.addEventListener(
            "change",
            refreshServiceInterface
        );

    });


    refreshServiceInterface();

});
