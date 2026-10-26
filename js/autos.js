document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("autos-enquiry-form");
    const status = document.getElementById("autos-enquiry-status");

    if (!form || !status) return;

    const submitButton = form.querySelector('button[type="submit"]');
    const defaultButtonText = submitButton?.textContent || "Send Vehicle Enquiry";

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submitButton?.disabled) return;
        status.textContent = "";
        status.className = "autos-enquiry-status";

        if (!form.reportValidity()) return;

        if (typeof lordblessSupabase === "undefined") {
            status.textContent = "Enquiry submission is temporarily unavailable. Please contact us on WhatsApp.";
            status.classList.add("is-error");
            return;
        }

        const formData = new FormData(form);
        const vehicleRequest = String(formData.get("vehicle_request") || "").trim();
        const preferredYear = String(formData.get("preferred_year") || "").trim();
        const budget = String(formData.get("budget") || "").trim();
        const requirements = String(formData.get("requirements") || "").trim();
        const destination = String(formData.get("destination") || "").trim();
        const details = [
            `Requested vehicle: ${vehicleRequest}`,
            preferredYear ? `Preferred year: ${preferredYear}` : "",
            `Destination in Ghana: ${destination}`,
            budget ? `Budget: ${budget}` : "",
            requirements ? `Requirements: ${requirements}` : ""
        ].filter(Boolean).join("\n");

        // Keep the same payload keys and service values as the existing
        // Business & Sourcing website form. AUTOS details use its existing
        // business and journey fields; no new backend field is assumed.
        const enquiryData = {
            submittedAt: new Date().toISOString(),
            client: {
                fullName: String(formData.get("full_name") || "").trim(),
                whatsapp: String(formData.get("whatsapp") || "").trim(),
                email: String(formData.get("email") || "").trim(),
                currentCountry: "",
                nationality: ""
            },
            services: ["business"],
            journey: {
                destination,
                timeframe: preferredYear,
                additionalInformation: details,
                preferredContact: String(formData.get("preferred_contact") || "")
            },
            education: {
                destination: "",
                studyArea: "",
                studyLevel: "",
                firstProgramme: "",
                secondProgramme: "",
                preferredIntake: ""
            },
            careers: {
                profession: "",
                qualification: "",
                experience: "",
                destination: "",
                interest: ""
            },
            travel: {
                purpose: "",
                destination: "",
                travelPeriod: "",
                travellers: "",
                services: []
            },
            business: {
                businessType: "LORDBLESS AUTOS",
                services: ["product-sourcing"],
                productCategory: vehicleRequest,
                estimatedQuantity: "",
                source: "China → Ghana"
            },
            mobility: {
                destination: "",
                purpose: "",
                arrivalDate: "",
                services: []
            },
            general: {
                unsureRequest: "",
                additionalInformation: details,
                preferredContact: String(formData.get("preferred_contact") || "")
            }
        };

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Sending…";
        }

        try {
            const { data, error } = await lordblessSupabase.rpc(
                "submit_initial_enquiry",
                { p_data: enquiryData }
            );

            if (error) throw error;
            if (!data || data.success !== true) {
                throw new Error("The enquiry was not confirmed by the submission service.");
            }

            // Match the existing site's secondary notification attempt. The
            // enquiry itself is confirmed by the RPC above, not by email.
            try {
                const { data: notificationData, error: notificationError } = await lordblessSupabase.functions.invoke("send-enquiry-email", {
                    body: { enquiryData, reference: data.reference }
                });
                if (notificationError || notificationData?.success !== true) {
                    console.error("AUTOS enquiry notification was not confirmed.", notificationError || notificationData?.error);
                }
            } catch (notificationError) {
                console.error("AUTOS enquiry notification could not be sent.", notificationError);
            }

            form.hidden = true;
            status.className = "autos-enquiry-status is-success";
            status.textContent = data.reference
                ? `Your LORDBLESS AUTOS enquiry has been received. Reference: ${data.reference}. Our team will follow up using your preferred contact method.`
                : "Your LORDBLESS AUTOS enquiry has been received. Our team will follow up using your preferred contact method.";
        } catch (error) {
            console.error("LORDBLESS AUTOS enquiry submission failed.", error);
            status.textContent = "We could not submit your enquiry. Please try again or contact us on WhatsApp using the link on this page.";
            status.className = "autos-enquiry-status is-error";
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = defaultButtonText;
            }
        }
    });
});
