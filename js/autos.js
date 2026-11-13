document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("autos-vehicle-grid")) initializeAutosCatalogue();
    else initializeAutosShowcases();

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
                    body: {
                        enquiryData: window.LORDBLESS_ENQUIRY_EMAIL_PAYLOAD?.forNotification(enquiryData) || enquiryData,
                        reference: data.reference
                    }
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
let autosCurrentPage = 1;
const AUTOS_PAGE_SIZE = 12;
let autosShowcaseVehicles = [];
let autosShowcaseTimer = null;

async function initializeAutosCatalogue() {
    const grid = document.getElementById("autos-vehicle-grid");
    const status = document.getElementById("autos-catalogue-status");
    if (!grid || !status) return;

    if (typeof lordblessSupabase === "undefined") {
        status.textContent = "The vehicle catalogue is temporarily unavailable. You can still contact LORDBLESS AUTOS using WhatsApp or the enquiry form below.";
        status.classList.add("is-error");
        document.querySelectorAll("[data-autos-showcase]").forEach(root => { root.innerHTML = `<p>Contact us to explore vehicle sourcing and availability.</p>`; });
        return;
    }

    try {
        const { data, error } = await fetchPublishedAutosCatalogue();
        if (error) throw error;
        autosPublishedVehicles = Array.isArray(data) ? data : [];
        populateAutosFilters(autosPublishedVehicles);
        await renderAutosShowcases(autosPublishedVehicles);
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
        document.querySelectorAll("[data-autos-showcase]").forEach(root => { root.innerHTML = `<p>Contact us to explore vehicle sourcing and availability.</p>`; });
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
    const availability = document.getElementById("autos-filter-availability");
    if (availability) {
        const options = [["", "All vehicles"], ["available_ghana", "Available in Ghana"], ["available_sourcing", "Available for Sourcing"], ["reserved", "Reserved"]];
        availability.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    }
}

function initializeAutosCatalogueEvents() {
    const search = document.getElementById("autos-catalogue-search");
    const filterForm = document.getElementById("autos-catalogue-filters");
    const grid = document.getElementById("autos-vehicle-grid");
    const detail = document.getElementById("autos-vehicle-detail");
    filterForm?.addEventListener("submit", event => event.preventDefault());
    [search, ...Array.from(filterForm?.querySelectorAll("select") || [])].forEach(control => {
        const update = () => { autosCurrentPage = 1; renderAutosCatalogue(); };
        control?.addEventListener("input", update);
        control?.addEventListener("change", update);
    });
    filterForm?.addEventListener("reset", () => window.setTimeout(() => { autosCurrentPage = 1; renderAutosCatalogue(); }, 0));
    grid?.addEventListener("click", async event => {
        const button = event.target.closest("[data-autos-action]");
        if (!button) return;
        const vehicle = autosPublishedVehicles.find(item => item.id === button.dataset.vehicleId);
        if (!vehicle) return;
        if (button.dataset.autosAction === "details") await showAutosVehicleDetail(vehicle);
        if (button.dataset.autosAction === "quote") selectAutosVehicleForEnquiry(vehicle);
    });
    detail?.addEventListener("click", event => {
        const thumb = event.target.closest("[data-gallery-index]");
        if (thumb) setAutosGalleryIndex(Number(thumb.dataset.galleryIndex));
        if (event.target.closest("[data-gallery-open]")) openAutosLightbox();
        if (event.target.closest("[data-gallery-prev]")) setAutosGalleryIndex(autosGalleryIndex - 1);
        if (event.target.closest("[data-gallery-next]")) setAutosGalleryIndex(autosGalleryIndex + 1);
        if (event.target.closest("[data-lightbox-close]")) closeAutosLightbox();
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
    detail?.addEventListener("pointerdown", event => { autosTouchStartX = event.clientX; });
    detail?.addEventListener("pointerup", event => { const delta = event.clientX - autosTouchStartX; if (Math.abs(delta) > 45) setAutosGalleryIndex(autosGalleryIndex + (delta < 0 ? 1 : -1)); });
    document.addEventListener("click", event => {
        const page = event.target.closest("[data-autos-page]");
        if (!page) return;
        autosCurrentPage = Number(page.dataset.autosPage) || 1;
        renderAutosCatalogue();
        document.getElementById("autos-vehicle-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

function getFilteredAutosVehicles() {
    const term = String(document.getElementById("autos-catalogue-search")?.value || "").trim().toLowerCase();
    const filters = {
        make: document.getElementById("autos-filter-make")?.value || "",
        year: document.getElementById("autos-filter-year")?.value || "",
        body_type: document.getElementById("autos-filter-body")?.value || "",
        fuel_type: document.getElementById("autos-filter-fuel")?.value || "",
        availability_status: document.getElementById("autos-filter-availability")?.value || ""
    };
    const sort = document.getElementById("autos-filter-sort")?.value || "newest";
    const vehicles = autosPublishedVehicles.filter(vehicle => {
        const searchable = `${vehicle.reference} ${vehicle.make} ${vehicle.model} ${vehicle.year || ""} ${vehicle.body_type || ""} ${vehicle.fuel_type || ""}`.toLowerCase();
        return (!term || searchable.includes(term)) && Object.entries(filters).every(([key, value]) => !value || String(vehicle[key] || "") === value);
    });
    return vehicles.sort((a, b) => sort === "name"
        ? `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`)
        : sort === "oldest"
            ? new Date(a.published_at || 0) - new Date(b.published_at || 0)
            : new Date(b.published_at || 0) - new Date(a.published_at || 0));
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
    const pages = Math.max(1, Math.ceil(vehicles.length / AUTOS_PAGE_SIZE));
    autosCurrentPage = Math.min(autosCurrentPage, pages);
    const visibleVehicles = vehicles.slice((autosCurrentPage - 1) * AUTOS_PAGE_SIZE, autosCurrentPage * AUTOS_PAGE_SIZE);
    status.textContent = `${vehicles.length} ${vehicles.length === 1 ? "vehicle" : "vehicles"} found · Page ${autosCurrentPage} of ${pages}. No public prices are displayed.`;
    grid.innerHTML = visibleVehicles.length ? visibleVehicles.map(vehicle => {
        const cover = (vehicle.photos || []).find(photo => photo.is_cover) || (vehicle.photos || [])[0];
        return `<article class="autos-vehicle-card">
            <div class="autos-vehicle-card-image" data-cover-container="${escapeAutosHTML(vehicle.id)}">${cover?.signed_url ? `<img src="${escapeAutosHTML(cover.signed_url)}" alt="${escapeAutosHTML(`${vehicle.year || ""} ${vehicle.make} ${vehicle.model}`)}" loading="lazy">` : `<span>${cover ? "Loading vehicle photo..." : "Photo will be added"}</span>`}</div>
            <div class="autos-vehicle-card-content">
                <p class="autos-vehicle-reference">${escapeAutosHTML(vehicle.reference)}</p><span class="autos-availability-badge ${escapeAutosHTML(vehicle.availability_status || "unclassified")}">${escapeAutosHTML(getAutosAvailabilityLabel(vehicle.availability_status))}</span>
                <h3>${escapeAutosHTML([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "))}</h3>
                <p class="autos-vehicle-facts">${[vehicle.body_type, vehicle.fuel_type, vehicle.mileage_km ? `${Number(vehicle.mileage_km).toLocaleString()} km` : ""].filter(Boolean).map(escapeAutosHTML).join(" · ")}</p>
                <div class="autos-vehicle-actions"><button type="button" class="autos-detail-button" data-autos-action="details" data-vehicle-id="${escapeAutosHTML(vehicle.id)}">View details</button><button type="button" class="autos-quote-button" data-autos-action="quote" data-vehicle-id="${escapeAutosHTML(vehicle.id)}">${vehicle.availability_status === "reserved" ? "Ask about availability" : vehicle.availability_status === "sold" ? "Request a similar vehicle" : "Enquire now"}</button></div>
            </div>
        </article>`;
    }).join("") : `<p class="autos-catalogue-empty">No published vehicles match these filters.</p>`;
    loadAutosPageCovers(visibleVehicles);
    const pager = document.getElementById("autos-pagination");
    if (pager) pager.innerHTML = vehicles.length > AUTOS_PAGE_SIZE ? `<button type="button" data-autos-page="${Math.max(1, autosCurrentPage - 1)}" ${autosCurrentPage === 1 ? "disabled" : ""}>Previous</button>${Array.from({length: pages}, (_, i) => `<button type="button" data-autos-page="${i + 1}" aria-current="${autosCurrentPage === i + 1 ? "page" : "false"}">${i + 1}</button>`).join("")}<button type="button" data-autos-page="${Math.min(pages, autosCurrentPage + 1)}" ${autosCurrentPage === pages ? "disabled" : ""}>Next</button>` : "";
}

async function loadAutosPageCovers(vehicles) {
    await Promise.all(vehicles.map(async vehicle => {
        const photo = (vehicle.photos || []).find(item => item.is_cover) || (vehicle.photos || [])[0];
        if (!photo || photo.signed_url) return;
        const signed = await signAutosPhoto(photo);
        photo.signed_url = signed.signed_url;
        const container = document.querySelector(`[data-cover-container="${CSS.escape(String(vehicle.id))}"]`);
        if (container && signed.signed_url) container.innerHTML = `<img src="${escapeAutosHTML(signed.signed_url)}" alt="${escapeAutosHTML(`${vehicle.year || ""} ${vehicle.make} ${vehicle.model}`)}" loading="lazy">`;
        else if (container) container.textContent = "Vehicle photo unavailable";
    }));
}

async function showAutosVehicleDetail(vehicle) {
    const detail = document.getElementById("autos-vehicle-detail");
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = `<div class="autos-detail-loading">Loading vehicle details…</div>`;
    const photos = await Promise.all((vehicle.photos || []).map(async photo => photo.signed_url ? photo : signAutosPhoto(photo)));
    vehicle.photos = photos.filter(photo => photo?.signed_url);
    autosGalleryVehicle = vehicle;
    autosGalleryIndex = 0;
    const facts = [
        ["Year", vehicle.year], ["Mileage", vehicle.mileage_km ? `${Number(vehicle.mileage_km).toLocaleString()} km` : ""],
        ["Condition", vehicle.condition], ["Body type", vehicle.body_type], ["Fuel type", vehicle.fuel_type],
        ["Transmission", vehicle.transmission], ["Drivetrain", vehicle.drivetrain], ["Engine", vehicle.engine]
    ].filter(([, value]) => value !== null && value !== undefined && String(value).trim());
    detail.innerHTML = `<div class="autos-detail-header"><div><p class="autos-vehicle-reference">${escapeAutosHTML(vehicle.reference)}</p><h2>${escapeAutosHTML([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "))}</h2></div><button type="button" class="autos-detail-close" data-autos-close-detail aria-label="Close vehicle details">×</button></div>
        ${renderAutosGallery()}
        <dl class="autos-detail-facts">${facts.map(([label, value]) => `<div><dt>${escapeAutosHTML(label)}</dt><dd>${escapeAutosHTML(value)}</dd></div>`).join("")}</dl>
        ${vehicle.description ? `<p class="autos-detail-description">${escapeAutosHTML(vehicle.description)}</p>` : ""}
        <p class="autos-detail-caution">${escapeAutosHTML(getAutosAvailabilityLabel(vehicle.availability_status))}. Specifications and transaction costs are confirmed for each enquiry.</p>
        <button type="button" class="button button-primary" data-autos-detail-quote data-vehicle-id="${escapeAutosHTML(vehicle.id)}">${vehicle.availability_status === "sold" ? "Request a similar vehicle" : vehicle.availability_status === "reserved" ? "Ask about availability" : "Get a Personalised Quotation"}</button>`;
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

let autosGalleryVehicle = null;
let autosGalleryIndex = 0;
function renderAutosGallery() {
    const photos = autosGalleryVehicle?.photos || [];
    if (!photos.length) return `<div class="autos-detail-gallery-empty">Vehicle photos are not available at this time.</div>`;
    return `<div class="autos-detail-gallery"><button type="button" class="autos-gallery-primary" data-gallery-open aria-label="Enlarge vehicle photo"><img data-gallery-main-image src="${escapeAutosHTML(photos[autosGalleryIndex].signed_url)}" alt="${escapeAutosHTML(`${autosGalleryVehicle.make} ${autosGalleryVehicle.model}, photo ${autosGalleryIndex + 1}`)}"></button><div class="autos-gallery-thumbnails">${photos.map((photo, i) => `<button type="button" data-gallery-index="${i}" aria-label="Show photo ${i + 1}" aria-pressed="${i === autosGalleryIndex}"><img src="${escapeAutosHTML(photo.signed_url)}" alt="" loading="lazy"></button>`).join("")}</div></div><dialog class="autos-lightbox" id="autos-lightbox"><button type="button" data-lightbox-close aria-label="Close photo viewer">×</button><button type="button" data-gallery-prev aria-label="Previous photo">‹</button><img data-lightbox-image alt=""><button type="button" data-gallery-next aria-label="Next photo">›</button><p data-lightbox-count></p></dialog>`;
}
function setAutosGalleryIndex(index) {
    const photos = autosGalleryVehicle?.photos || [];
    if (!photos.length) return;
    autosGalleryIndex = (index + photos.length) % photos.length;
    const detail = document.getElementById("autos-vehicle-detail");
    const main = detail?.querySelector("[data-gallery-main-image]");
    if (main) { main.src = photos[autosGalleryIndex].signed_url; main.alt = `${autosGalleryVehicle.make} ${autosGalleryVehicle.model}, photo ${autosGalleryIndex + 1}`; }
    detail?.querySelectorAll("[data-gallery-index]").forEach((button, i) => button.setAttribute("aria-pressed", String(i === autosGalleryIndex)));
    const dialog = document.getElementById("autos-lightbox");
    if (dialog?.open) updateAutosLightbox();
}
function openAutosLightbox() { const dialog = document.getElementById("autos-lightbox"); if (!dialog) return; updateAutosLightbox(); dialog.showModal(); }
function closeAutosLightbox() { document.getElementById("autos-lightbox")?.close(); }
function updateAutosLightbox() { const photos = autosGalleryVehicle?.photos || []; const image = document.querySelector("[data-lightbox-image]"); if (image && photos[autosGalleryIndex]) { image.src = photos[autosGalleryIndex].signed_url; image.alt = `${autosGalleryVehicle.make} ${autosGalleryVehicle.model}, photo ${autosGalleryIndex + 1}`; } const count = document.querySelector("[data-lightbox-count]"); if (count) count.textContent = `${autosGalleryIndex + 1} of ${photos.length}`; }
let autosTouchStartX = 0;
document.addEventListener("keydown", event => { if (document.getElementById("autos-lightbox")?.open) { if (event.key === "ArrowRight") setAutosGalleryIndex(autosGalleryIndex + 1); if (event.key === "ArrowLeft") setAutosGalleryIndex(autosGalleryIndex - 1); } });
function getAutosAvailabilityLabel(status) { return ({available_ghana: "Available in Ghana", available_sourcing: "Available for sourcing", reserved: "Reserved", sold: "Sold"})[status] || "Availability confirmed on enquiry"; }

async function initializeAutosShowcases() {
    if (typeof lordblessSupabase === "undefined") {
        document.querySelectorAll("[data-autos-showcase]").forEach(root => { root.innerHTML = `<p>Contact us to explore vehicle sourcing and availability.</p>`; });
        return;
    }
    try { const { data, error } = await fetchPublishedAutosCatalogue(); if (error) throw error; await renderAutosShowcases(data || []); }
    catch (error) { console.error("AUTOS showcase unavailable.", error); }
}
async function fetchPublishedAutosCatalogue() {
    let result = await lordblessSupabase.from("autos_public_catalogue").select("*").order("promotional_order", { ascending: true }).order("published_at", { ascending: false });
    if (result.error && /promotional_order|availability_status|is_featured/i.test(result.error.message || "")) {
        // Keep the existing catalogue readable until the additive metadata
        // migration is applied. No unclassified vehicle is promoted.
        result = await lordblessSupabase.from("autos_public_catalogue").select("*").order("published_at", { ascending: false });
    }
    return result;
}
async function renderAutosShowcases(source) {
    const roots = [...document.querySelectorAll("[data-autos-showcase]")];
    if (!roots.length) return;
    const eligible = source.filter(v => ["available_ghana", "available_sourcing"].includes(v.availability_status));
    const featured = eligible.filter(v => v.is_featured);
    const selected = [...new Set([
        eligible.find(v => v.availability_status === "available_ghana"),
        eligible.find(v => v.availability_status === "available_sourcing"),
        ...(featured.length ? featured : eligible)
    ].filter(Boolean))].slice(0, 6);
    autosShowcaseVehicles = await Promise.all(selected.map(async v => ({...v, _cover: await signAutosPhoto((v.photos || []).find(p => p.is_cover) || (v.photos || [])[0] || {})})));
    roots.forEach(root => {
        if (!autosShowcaseVehicles.length) { root.innerHTML = `<p>Contact us to explore current vehicle options.</p>`; return; }
        root.classList.add("is-autos-showcase");
        root.dataset.slideIndex = "0";
        renderAutosShowcaseSlide(root, 0);
        root.addEventListener("click", e => { if (e.target.closest("[data-showcase-prev]")) renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) - 1); if (e.target.closest("[data-showcase-next]")) renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) + 1); const enq = e.target.closest("[data-showcase-enquire]"); if (enq) { const vehicle = autosShowcaseVehicles[Number(enq.dataset.showcaseEnquire)]; if (vehicle) { if (document.getElementById("autos-vehicle")) selectAutosVehicleForEnquiry(vehicle); else window.location.href = `autos.html?vehicle=${encodeURIComponent(vehicle.reference)}#autos-enquiry`; } } });
        root.addEventListener("mouseenter", () => clearInterval(autosShowcaseTimer));
        root.addEventListener("mouseleave", startAutosShowcaseRotation);
        root.addEventListener("focusin", () => clearInterval(autosShowcaseTimer));
        root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) startAutosShowcaseRotation(); });
        root.addEventListener("keydown", e => { if (e.key === "ArrowRight") renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) + 1); if (e.key === "ArrowLeft") renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) - 1); });
        root.addEventListener("pointerdown", e => { root.dataset.touchX = String(e.clientX); });
        root.addEventListener("pointerup", e => { const delta = e.clientX - Number(root.dataset.touchX || e.clientX); if (Math.abs(delta) > 45) renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) + (delta < 0 ? 1 : -1)); });
    });
    startAutosShowcaseRotation();
}
function renderAutosShowcaseSlide(root, index) {
    const total = autosShowcaseVehicles.length; if (!total) return;
    const current = (index + total) % total; root.dataset.slideIndex = String(current);
    const v = autosShowcaseVehicles[current]; const label = getAutosAvailabilityLabel(v.availability_status);
    root.innerHTML = `<div class="autos-showcase-slide"><div class="autos-showcase-photo">${v._cover?.signed_url ? `<img src="${escapeAutosHTML(v._cover.signed_url)}" alt="${escapeAutosHTML(`${v.year || ""} ${v.make} ${v.model}`)}" loading="lazy">` : `<span>Vehicle image available on enquiry</span>`}</div><div class="autos-showcase-copy"><span class="autos-showcase-label">${escapeAutosHTML(v.availability_status === "available_ghana" ? "Available in Ghana" : v.is_featured ? "Featured from China" : label)}</span><h3>${escapeAutosHTML([v.year,v.make,v.model].filter(Boolean).join(" "))}</h3><p>${escapeAutosHTML(label)}${v.description ? ` · ${escapeAutosHTML(v.description)}` : ""}</p><button type="button" data-showcase-enquire="${current}">Enquire now</button></div></div><div class="autos-showcase-controls"><button type="button" data-showcase-prev aria-label="Previous vehicle">‹</button><span>${autosShowcaseVehicles.map((_, i) => `<button type="button" data-showcase-dot="${i}" aria-label="Show vehicle ${i+1}" aria-current="${i === current}"></button>`).join("")}</span><button type="button" data-showcase-next aria-label="Next vehicle">›</button></div>`;
    root.querySelectorAll("[data-showcase-dot]").forEach(dot => dot.addEventListener("click", () => renderAutosShowcaseSlide(root, Number(dot.dataset.showcaseDot))));
}
function startAutosShowcaseRotation() {
    clearInterval(autosShowcaseTimer);
    if (document.hidden || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || autosShowcaseVehicles.length < 2) return;
    autosShowcaseTimer = window.setInterval(() => document.querySelectorAll("[data-autos-showcase]").forEach(root => renderAutosShowcaseSlide(root, Number(root.dataset.slideIndex) + 1)), 5000);
}
document.addEventListener("visibilitychange", startAutosShowcaseRotation);

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
