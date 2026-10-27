document.addEventListener("DOMContentLoaded", () => {
    initializeAutosCatalogue();

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

const AUTOS_PHOTO_BUCKET = "lordbless-autos-catalogue";
let autosPublishedVehicles = [];

async function initializeAutosCatalogue() {
    const grid = document.getElementById("autos-vehicle-grid");
    const status = document.getElementById("autos-catalogue-status");
    if (!grid || !status) return;

    if (typeof lordblessSupabase === "undefined") {
        status.textContent = "The vehicle catalogue is temporarily unavailable. You can still contact LORDBLESS AUTOS using WhatsApp or the enquiry form below.";
        status.classList.add("is-error");
        return;
    }

    try {
        const { data, error } = await lordblessSupabase
            .from("autos_public_catalogue")
            .select("*")
            .order("published_at", { ascending: false });
        if (error) throw error;
        autosPublishedVehicles = await Promise.all((Array.isArray(data) ? data : []).map(async vehicle => ({
            ...vehicle,
            photos: await Promise.all((vehicle.photos || []).map(photo => photo.is_cover ? signAutosPhoto(photo) : photo))
        })));
        populateAutosFilters(autosPublishedVehicles);
        renderAutosCatalogue();
        initializeAutosCatalogueEvents();

        const requestedRef = new URLSearchParams(window.location.search).get("vehicle");
        if (requestedRef) {
            const selected = autosPublishedVehicles.find(vehicle => vehicle.reference === requestedRef);
            if (selected) await showAutosVehicleDetail(selected);
        }
    } catch (error) {
        console.error("LORDBLESS AUTOS catalogue could not be loaded.", error);
        status.textContent = "The vehicle catalogue is temporarily unavailable. You can still contact LORDBLESS AUTOS using WhatsApp or the enquiry form below.";
        status.classList.add("is-error");
    }
}

function populateAutosFilters(vehicles) {
    const choices = [
        ["autos-filter-make", "make", "All makes"],
        ["autos-filter-year", "year", "All years"],
        ["autos-filter-body", "body_type", "All body types"],
        ["autos-filter-fuel", "fuel_type", "All fuel types"]
    ];
    choices.forEach(([id, key, placeholder]) => {
        const select = document.getElementById(id);
        if (!select) return;
        const values = [...new Set(vehicles.map(vehicle => vehicle[key]).filter(value => value !== null && value !== undefined && String(value).trim()))]
            .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
        select.innerHTML = `<option value="">${escapeAutosHTML(placeholder)}</option>${values.map(value => `<option value="${escapeAutosHTML(value)}">${escapeAutosHTML(value)}</option>`).join("")}`;
    });
}

function initializeAutosCatalogueEvents() {
    const search = document.getElementById("autos-catalogue-search");
    const filterForm = document.getElementById("autos-catalogue-filters");
    const grid = document.getElementById("autos-vehicle-grid");
    const detail = document.getElementById("autos-vehicle-detail");
    filterForm?.addEventListener("submit", event => event.preventDefault());
    [search, ...Array.from(filterForm?.querySelectorAll("select") || [])].forEach(control => {
        control?.addEventListener("input", renderAutosCatalogue);
        control?.addEventListener("change", renderAutosCatalogue);
    });
    filterForm?.addEventListener("reset", () => window.setTimeout(renderAutosCatalogue, 0));
    grid?.addEventListener("click", async event => {
        const button = event.target.closest("[data-autos-action]");
        if (!button) return;
        const vehicle = autosPublishedVehicles.find(item => item.id === button.dataset.vehicleId);
        if (!vehicle) return;
        if (button.dataset.autosAction === "details") await showAutosVehicleDetail(vehicle);
        if (button.dataset.autosAction === "quote") selectAutosVehicleForEnquiry(vehicle);
    });
    detail?.addEventListener("click", event => {
        const close = event.target.closest("[data-autos-close-detail]");
        if (close) {
            detail.hidden = true;
            detail.innerHTML = "";
        }
        const quote = event.target.closest("[data-autos-detail-quote]");
        if (quote) {
            const vehicle = autosPublishedVehicles.find(item => item.id === quote.dataset.vehicleId);
            if (vehicle) selectAutosVehicleForEnquiry(vehicle);
        }
    });
}

function getFilteredAutosVehicles() {
    const term = String(document.getElementById("autos-catalogue-search")?.value || "").trim().toLowerCase();
    const filters = {
        make: document.getElementById("autos-filter-make")?.value || "",
        year: document.getElementById("autos-filter-year")?.value || "",
        body_type: document.getElementById("autos-filter-body")?.value || "",
        fuel_type: document.getElementById("autos-filter-fuel")?.value || ""
    };
    return autosPublishedVehicles.filter(vehicle => {
        const searchable = `${vehicle.reference} ${vehicle.make} ${vehicle.model} ${vehicle.year || ""}`.toLowerCase();
        return (!term || searchable.includes(term)) && Object.entries(filters).every(([key, value]) => !value || String(vehicle[key]) === value);
    });
}

function renderAutosCatalogue() {
    const grid = document.getElementById("autos-vehicle-grid");
    const status = document.getElementById("autos-catalogue-status");
    if (!grid || !status) return;
    const vehicles = getFilteredAutosVehicles();
    if (!autosPublishedVehicles.length) {
        status.textContent = "No verified vehicles have been published yet. Contact us to discuss a vehicle request.";
        grid.innerHTML = "";
        return;
    }
    status.textContent = `${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"} shown. No public prices are displayed.`;
    grid.innerHTML = vehicles.length ? vehicles.map(vehicle => {
        const cover = (vehicle.photos || []).find(photo => photo.is_cover) || (vehicle.photos || [])[0];
        const photoUrl = cover?.signed_url || "";
        return `<article class="autos-vehicle-card">
            <div class="autos-vehicle-card-image">${photoUrl ? `<img src="${escapeAutosHTML(photoUrl)}" alt="${escapeAutosHTML(`${vehicle.year || ""} ${vehicle.make} ${vehicle.model}`)}" loading="lazy">` : `<span>Photo will be added</span>`}</div>
            <div class="autos-vehicle-card-content">
                <p class="autos-vehicle-reference">${escapeAutosHTML(vehicle.reference)}</p>
                <h3>${escapeAutosHTML([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "))}</h3>
                <p class="autos-vehicle-facts">${[vehicle.body_type, vehicle.fuel_type, vehicle.mileage_km ? `${Number(vehicle.mileage_km).toLocaleString()} km` : ""].filter(Boolean).map(escapeAutosHTML).join(" · ")}</p>
                <div class="autos-vehicle-actions"><button type="button" class="autos-detail-button" data-autos-action="details" data-vehicle-id="${escapeAutosHTML(vehicle.id)}">View details</button><button type="button" class="autos-quote-button" data-autos-action="quote" data-vehicle-id="${escapeAutosHTML(vehicle.id)}">Ask for Price</button></div>
            </div>
        </article>`;
    }).join("") : `<p class="autos-catalogue-empty">No published vehicles match these filters.</p>`;
}

async function showAutosVehicleDetail(vehicle) {
    const detail = document.getElementById("autos-vehicle-detail");
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = `<div class="autos-detail-loading">Loading vehicle details…</div>`;
    const photos = await Promise.all((vehicle.photos || []).map(async photo => photo.signed_url ? photo : signAutosPhoto(photo)));
    vehicle.photos = photos.filter(photo => photo?.signed_url);
    const facts = [
        ["Year", vehicle.year], ["Mileage", vehicle.mileage_km ? `${Number(vehicle.mileage_km).toLocaleString()} km` : ""],
        ["Condition", vehicle.condition], ["Body type", vehicle.body_type], ["Fuel type", vehicle.fuel_type],
        ["Transmission", vehicle.transmission], ["Drivetrain", vehicle.drivetrain], ["Engine", vehicle.engine]
    ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());
    detail.innerHTML = `<div class="autos-detail-header"><div><p class="autos-vehicle-reference">${escapeAutosHTML(vehicle.reference)}</p><h2>${escapeAutosHTML([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "))}</h2></div><button type="button" class="autos-detail-close" data-autos-close-detail aria-label="Close vehicle details">×</button></div>
        <div class="autos-detail-gallery">${vehicle.photos.length ? vehicle.photos.map(photo => `<img src="${escapeAutosHTML(photo.signed_url)}" alt="${escapeAutosHTML(`${vehicle.make} ${vehicle.model}`)}" loading="lazy">`).join("") : `<p>Vehicle photos are not available at this time.</p>`}</div>
        <dl class="autos-detail-facts">${facts.map(([label, value]) => `<div><dt>${escapeAutosHTML(label)}</dt><dd>${escapeAutosHTML(value)}</dd></div>`).join("")}</dl>
        ${vehicle.description ? `<p class="autos-detail-description">${escapeAutosHTML(vehicle.description)}</p>` : ""}
        <p class="autos-detail-caution">Specifications and availability are confirmed for each enquiry. No public price is listed.</p>
        <button type="button" class="button button-primary" data-autos-detail-quote data-vehicle-id="${escapeAutosHTML(vehicle.id)}">Ask for Price / Request a Quotation</button>`;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function selectAutosVehicleForEnquiry(vehicle) {
    const input = document.getElementById("autos-vehicle");
    const label = [vehicle.reference, [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" — ");
    if (input) input.value = label;
    const section = document.getElementById("autos-enquiry");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    input?.focus({ preventScroll: true });
}

function escapeAutosHTML(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function signAutosPhoto(photo) {
    try {
        const { data, error } = await lordblessSupabase.storage.from(AUTOS_PHOTO_BUCKET).createSignedUrl(photo.storage_path, 3600);
        return { ...photo, signed_url: error ? "" : data?.signedUrl || "" };
    } catch {
        return { ...photo, signed_url: "" };
    }
}
