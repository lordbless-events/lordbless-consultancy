/* LORDBLESS AUTOS catalogue administration. Access is also enforced by database RLS. */
window.LORDBLESS_AUTOS_ADMIN = (() => {
    const BUCKET = "lordbless-autos-catalogue";
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const PILOT_REFERENCE_BY_SUPPLIER = new Map([
        ["2529", "LBC-CAR-0001"], ["2822", "LBC-CAR-0002"], ["YEK-2026-556", "LBC-CAR-0003"],
        ["YEK-2026-005", "LBC-CAR-0004"], ["YEK-2026-607", "LBC-CAR-0005"]
    ]);
    const REVERIFY_FIELDS = [
        "make", "model", "year", "mileage_km", "condition", "fuel_type",
        "transmission", "drivetrain", "engine", "description",
        "supplier_name", "supplier_vehicle_id", "supplier_listing_url"
    ];
    let root;
    let vehicles = [];
    let activeVehicle = null;
    let photos = [];
    let notice = "";
    let error = "";
    let busy = false;
    let bulkPackage = { vehiclesFile: null, mappingFile: null, imageFiles: [], records: null, mapping: null, photoFiles: null, preflight: null };
    let bulkStatus = "Select the three V3 inputs, then validate the package and production access.";
    let bulkErrors = [];

    async function render(container) {
        root = container;
        root.innerHTML = '<section class="section"><p>Loading AUTOS catalogue…</p></section>';
        if (typeof lordblessSupabase === "undefined") {
            root.innerHTML = '<section class="section"><p role="alert">The Supabase client is unavailable. No local/mock catalogue is shown.</p></section>';
            return;
        }
        await loadData();
        renderWorkspace();
    }

    async function loadData() {
        error = "";
        const { data, error: queryError } = await lordblessSupabase
            .from("autos_vehicles")
            .select("*")
            .order("reference", { ascending: true });
        if (queryError) {
            vehicles = [];
            error = `Catalogue records could not be loaded: ${queryError.message}`;
            return;
        }
        vehicles = data || [];
        if (activeVehicle) {
            activeVehicle = vehicles.find(vehicle => vehicle.id === activeVehicle.id) || null;
            await loadPhotos();
        }
    }

    async function loadPhotos() {
        photos = [];
        if (!activeVehicle) return;
        const { data, error: photoError } = await lordblessSupabase
            .from("autos_vehicle_photos")
            .select("*")
            .eq("vehicle_id", activeVehicle.id)
            .order("sort_order", { ascending: true });
        if (photoError) {
            error = `Vehicle photos could not be loaded: ${photoError.message}`;
            return;
        }
        photos = await Promise.all((data || []).map(async photo => {
            const { data: signed, error: signError } = await lordblessSupabase.storage.from(BUCKET).createSignedUrl(photo.storage_path, 3600);
            return { ...photo, signedUrl: signError ? "" : signed?.signedUrl || "" };
        }));
    }

    function renderWorkspace() {
        const selected = activeVehicle || {};
        const escape = escapeHTML;
        const supplierUrl = safeSupplierUrl(activeVehicle?.supplier_listing_url);
        const opt = (value, label, current) => `<option value="${escape(value)}" ${current === value ? "selected" : ""}>${escape(label)}</option>`;
        const canManage = typeof hasPermission === "function" && hasPermission(typeof getCurrentUser === "function" ? getCurrentUser() : null, "autos.manage");
        root.innerHTML = `<section class="section autos-admin">
            <div class="section-header"><div><h2>LORDBLESS AUTOS Catalogue</h2><p class="section-subtitle">Draft, verify and publish catalogue records. Public visitors see only verified, published vehicles.</p></div><div class="autos-admin-toolbar"><button type="button" class="secondary-button" data-autos-import-toggle ${canManage ? "" : "hidden"}>Import V3 Vehicle Catalogue</button><button type="button" class="primary-button" data-autos-new>New draft</button></div></div>
            ${error ? `<p class="autos-admin-alert is-error" role="alert">${escape(error)}</p>` : ""}
            ${notice ? `<p class="autos-admin-alert" role="status">${escape(notice)}</p>` : ""}
            ${canManage ? renderBulkImporter(escape) : ""}
            <div class="autos-admin-layout">
                <aside class="autos-admin-records"><h3>Vehicle records (${vehicles.length})</h3>${vehicles.length ? vehicles.map(vehicle => `<article class="autos-admin-record ${vehicle.id === activeVehicle?.id ? "is-selected" : ""}"><button type="button" data-autos-edit="${escape(vehicle.id)}"><strong>${escape(vehicle.reference)}</strong><span>${escape([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Details pending")}</span><small>${escape(vehicle.status)} · ${escape(vehicle.verification_status)}</small></button></article>`).join("") : `<p>No catalogue records are stored yet. Create assigned LBC-CAR references as drafts; do not reuse or invent an assigned reference.</p>`}</aside>
                <div class="autos-admin-editor">
                    <form id="autos-admin-vehicle-form">
                        <div class="autos-admin-form-heading"><h3>${activeVehicle ? `Edit ${escape(activeVehicle.reference)}` : "Create a vehicle draft"}</h3><p>Confirm supplier details before setting verification to verified or publishing.</p>${activeVehicle?.verified_at ? `<p class="autos-admin-verification-meta">Last verified: ${escape(new Date(activeVehicle.verified_at).toLocaleString())}</p>` : ""}</div>
                        <div class="autos-admin-fields">
                            <label>LORDBLESS reference<input name="reference" required pattern="LBC-CAR-[0-9]{4}" maxlength="12" placeholder="LBC-CAR-0001" value="${escape(selected.reference || "")}" ${activeVehicle ? "readonly" : ""}></label>
                            <label>Make<input name="make" maxlength="80" value="${escape(selected.make || "")}"></label>
                            <label>Model / variant<input name="model" maxlength="160" value="${escape(selected.model || "")}"></label>
                            <label>Year<input name="year" type="number" min="2016" max="2100" value="${escape(selected.year || "")}"></label>
                            <label>Mileage (km)<input name="mileage_km" type="number" min="0" value="${escape(selected.mileage_km ?? "")}"></label>
                            <label>Body type<input name="body_type" maxlength="60" value="${escape(selected.body_type || "")}"></label>
                            <label>Condition<input name="condition" maxlength="60" value="${escape(selected.condition || "")}"></label>
                            <label>Fuel / powertrain<input name="fuel_type" maxlength="60" value="${escape(selected.fuel_type || "")}"></label>
                            <label>Transmission<input name="transmission" maxlength="60" value="${escape(selected.transmission || "")}"></label>
                            <label>Drivetrain<input name="drivetrain" maxlength="60" value="${escape(selected.drivetrain || "")}"></label>
                            <label>Engine<input name="engine" maxlength="60" value="${escape(selected.engine || "")}"></label>
                            <label>Supplier name<input name="supplier_name" maxlength="160" value="${escape(selected.supplier_name || "CBBase")}"></label>
                            <label>Supplier / source ID<input name="supplier_vehicle_id" maxlength="120" value="${escape(selected.supplier_vehicle_id || "")}"></label>
                            <label>Supplier listing URL<input name="supplier_listing_url" type="url" maxlength="1000" value="${escape(selected.supplier_listing_url || "")}"></label>
                            <label>Verification status<select name="verification_status">${opt("pending", "Pending confirmation", selected.verification_status || "pending")}${opt("verified", "Verified", selected.verification_status)}${opt("conflict", "Conflict — keep draft", selected.verification_status)}</select></label>
                            <label>Catalogue status<select name="status">${opt("draft", "Draft", selected.status || "draft")}${opt("published", "Published", selected.status)}${opt("unavailable", "Unavailable", selected.status)}</select></label>
                            <label class="autos-admin-wide">Verification notes<textarea name="verification_notes" rows="3" maxlength="4000">${escape(selected.verification_notes || "")}</textarea></label>
                            <label class="autos-admin-wide">Public description<textarea name="description" rows="3" maxlength="2000">${escape(selected.description || "")}</textarea></label>
                        </div>
                        <div class="autos-admin-actions"><button type="submit" class="primary-button" ${busy ? "disabled" : ""}>Save vehicle</button>${activeVehicle ? `${supplierUrl ? `<a href="${escape(supplierUrl)}" target="_blank" rel="noopener noreferrer">Open supplier listing</a>` : ""}<button type="button" class="secondary-button" data-autos-preview>Preview public listing</button>` : ""}</div>
                    </form>
                    ${activeVehicle ? renderPhotoManager(escape) : `<p class="autos-admin-photo-note">Save the draft before adding photographs. Add only photographs matched to this exact vehicle. The multi-file upload is the dependable fallback; CBBase images are not hotlinked.</p>`}
                </div>
            </div>
        </section>`;
        bindWorkspaceEvents();
    }

    function renderBulkImporter(escape) {
        const count = bulkPackage.imageFiles.length;
        return `<section class="autos-admin-bulk" data-autos-import-panel hidden aria-labelledby="autos-import-title">
            <h3 id="autos-import-title">Temporary authenticated V3 import</h3>
            <p>Imports approved vehicle rows as drafts, then uploads and associates only the 630 mapped images. Uses this signed-in Admin session, <code>autos.manage</code>, and the existing private bucket.</p>
            <div class="autos-admin-bulk-inputs">
                <label>Catalogue preparation JSON<input type="file" accept="application/json,.json" data-autos-import-json></label>
                <label>Photograph mapping CSV<input type="file" accept="text/csv,.csv" data-autos-import-csv></label>
                <label>V3 images folder (choose <code>autos-research/images</code>)<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" webkitdirectory directory multiple data-autos-import-images></label>
            </div>
            <p class="autos-admin-bulk-selected" data-autos-import-selected>${count ? `${count} image files selected.` : "No images folder selected."}</p>
            <div class="autos-admin-actions"><button type="button" class="secondary-button" data-autos-import-validate ${busy ? "disabled" : ""}>Validate package and production</button><button type="button" class="primary-button" data-autos-import-run disabled>Import 50 vehicles and 630 photographs</button></div>
            <progress data-autos-import-progress max="100" value="0" aria-label="V3 import progress"></progress>
            <p class="autos-admin-bulk-status" role="status" aria-live="polite" data-autos-import-status>${escape(bulkStatus)}</p>
            <ul class="autos-admin-bulk-errors" data-autos-import-errors>${bulkErrors.map(item => `<li>${escape(item)}</li>`).join("")}</ul>
        </section>`;
    }

    function renderPhotoManager(escape) {
        const supplierUrl = safeSupplierUrl(activeVehicle.supplier_listing_url);
        const source = supplierUrl ? `<a href="${escape(supplierUrl)}" target="_blank" rel="noopener noreferrer">Open the recorded supplier listing to verify the vehicle and select its photographs.</a>` : "Record an HTTPS supplier listing URL before matching supplier photographs.";
        return `<section class="autos-admin-photos"><h3>Vehicle photo gallery</h3><p>${source} Upload the selected image files below to the dedicated private LORDBLESS AUTOS bucket.</p>
            <label class="autos-admin-upload">Add multiple photographs<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple data-autos-upload ${busy ? "disabled" : ""}></label>
            <div class="autos-admin-photo-grid">${photos.map((photo, index) => `<article class="autos-admin-photo">${photo.signedUrl ? `<img src="${escape(photo.signedUrl)}" alt="${escape(activeVehicle.reference)} photograph ${index + 1}">` : `<div class="autos-photo-unavailable">Preview unavailable</div>`}<p>${photo.is_cover ? "Cover photo" : `Gallery photo ${index + 1}`}</p><div><button type="button" data-photo-cover="${escape(photo.id)}" ${photo.is_cover ? "disabled" : ""}>Set cover</button><button type="button" data-photo-up="${escape(photo.id)}" ${index === 0 ? "disabled" : ""} aria-label="Move photo earlier">↑</button><button type="button" data-photo-down="${escape(photo.id)}" ${index === photos.length - 1 ? "disabled" : ""} aria-label="Move photo later">↓</button><button type="button" data-photo-delete="${escape(photo.id)}">Remove</button></div></article>`).join("")}</div>
            <div class="autos-admin-preview" data-autos-preview-panel hidden><h4>Public preview</h4><p>${escape([activeVehicle.year, activeVehicle.make, activeVehicle.model].filter(Boolean).join(" "))}</p><p>${escape(activeVehicle.reference)} · ${escape(activeVehicle.body_type || "")} · ${escape(activeVehicle.fuel_type || "")}</p><p>No public price shown. Draft/conflict records remain off the public catalogue.</p>${photos.filter(photo => photo.is_cover && photo.signedUrl).map(photo => `<img src="${escape(photo.signedUrl)}" alt="Cover preview">`).join("")}</div>
        </section>`;
    }

    function bindWorkspaceEvents() {
        root.querySelector("[data-autos-import-toggle]")?.addEventListener("click", () => {
            const panel = root.querySelector("[data-autos-import-panel]");
            if (panel) panel.hidden = !panel.hidden;
        });
        root.querySelector("[data-autos-import-json]")?.addEventListener("change", event => { bulkPackage.vehiclesFile = event.currentTarget.files?.[0] || null; resetBulkValidation(); });
        root.querySelector("[data-autos-import-csv]")?.addEventListener("change", event => { bulkPackage.mappingFile = event.currentTarget.files?.[0] || null; resetBulkValidation(); });
        root.querySelector("[data-autos-import-images]")?.addEventListener("change", event => {
            bulkPackage.imageFiles = Array.from(event.currentTarget.files || []);
            const label = root.querySelector("[data-autos-import-selected]");
            if (label) label.textContent = `${bulkPackage.imageFiles.length} image files selected.`;
            resetBulkValidation();
        });
        root.querySelector("[data-autos-import-validate]")?.addEventListener("click", validateBulkImport);
        root.querySelector("[data-autos-import-run]")?.addEventListener("click", executeBulkImport);
        root.querySelector("[data-autos-new]")?.addEventListener("click", () => { if (busy) return; activeVehicle = null; photos = []; notice = ""; error = ""; renderWorkspace(); });
        root.querySelectorAll("[data-autos-edit]").forEach(button => button.addEventListener("click", async () => {
            if (busy) return;
            activeVehicle = vehicles.find(vehicle => vehicle.id === button.dataset.autosEdit) || null;
            notice = "";
            await loadPhotos();
            renderWorkspace();
        }));
        root.querySelector("#autos-admin-vehicle-form")?.addEventListener("submit", saveVehicle);
        root.querySelector("[data-autos-upload]")?.addEventListener("change", uploadPhotos);
        root.querySelector("[data-autos-preview]")?.addEventListener("click", () => {
            if (busy) return;
            const panel = root.querySelector("[data-autos-preview-panel]");
            if (panel) panel.hidden = !panel.hidden;
        });
        root.querySelectorAll("[data-photo-cover]").forEach(button => button.addEventListener("click", () => setCover(button.dataset.photoCover)));
        root.querySelectorAll("[data-photo-up]").forEach(button => button.addEventListener("click", () => movePhoto(button.dataset.photoUp, -1)));
        root.querySelectorAll("[data-photo-down]").forEach(button => button.addEventListener("click", () => movePhoto(button.dataset.photoDown, 1)));
        root.querySelectorAll("[data-photo-delete]").forEach(button => button.addEventListener("click", () => removePhoto(button.dataset.photoDelete)));
    }

    function resetBulkValidation() {
        bulkPackage.records = null;
        bulkPackage.mapping = null;
        bulkPackage.photoFiles = null;
        bulkPackage.preflight = null;
        bulkErrors = [];
        bulkStatus = "Inputs changed. Validate the package again before any production write.";
        const run = root?.querySelector("[data-autos-import-run]");
        if (run) run.disabled = true;
        setBulkStatus(bulkStatus);
    }

    async function validateBulkImport() {
        if (busy) return;
        bulkErrors = [];
        bulkPackage.preflight = null;
        const status = root.querySelector("[data-autos-import-status]");
        if (status) status.textContent = "Validating package files...";
        try {
            if (!bulkPackage.vehiclesFile || !bulkPackage.mappingFile || !bulkPackage.imageFiles.length) {
                throw new Error("Select the preparation JSON, photograph mapping CSV, and the V3 images folder.");
            }
            const rows = JSON.parse(await bulkPackage.vehiclesFile.text());
            const csvText = await bulkPackage.mappingFile.text();
            const mapping = parseCsv(csvText);
            const validated = validateImportFiles(rows, mapping, bulkPackage.imageFiles);
            bulkPackage.records = validated.records;
            bulkPackage.mapping = validated.mapping;
            bulkPackage.photoFiles = validated.photoFiles;
            bulkStatus = "Package valid. Checking authenticated user, project, permissions, tables, references, and private Storage bucket...";
            setBulkStatus(bulkStatus);
            const preflight = await runProductionPreflight(validated.records, validated.mapping);
            bulkPackage.preflight = preflight;
            bulkStatus = `Ready. Production has ${preflight.existingVehicles} expected vehicle records and ${preflight.existingPhotos} expected photo associations. Import can resume safely.`;
            setBulkStatus(bulkStatus);
            const run = root.querySelector("[data-autos-import-run]");
            if (run) run.disabled = false;
        } catch (cause) {
            const message = cause?.message || String(cause);
            bulkErrors = [message];
            bulkStatus = "Validation failed. No production records or files were written.";
            setBulkStatus(bulkStatus);
            const list = root.querySelector("[data-autos-import-errors]");
            if (list) list.innerHTML = `<li>${escapeHTML(message)}</li>`;
            const run = root.querySelector("[data-autos-import-run]");
            if (run) run.disabled = true;
        }
    }

    function validateImportFiles(rows, mapping, files) {
        const problems = [];
        if (!Array.isArray(rows) || rows.length !== 50) problems.push(`Expected 50 vehicle rows; found ${Array.isArray(rows) ? rows.length : "invalid JSON structure"}.`);
        if (!Array.isArray(mapping) || mapping.length !== 630) problems.push(`Expected 630 photo mappings; found ${Array.isArray(mapping) ? mapping.length : 0}.`);
        if (problems.length) throw new Error(problems.join(" "));

        const refs = new Set();
        const suppliers = new Set();
        const listings = new Set();
        let nextReference = 6;
        const records = rows.map(row => ({ ...row }));
        for (const row of records) {
            if (!row.supplier_name || !row.supplier_vehicle_id || !row.supplier_listing_url || !row.make || !row.model) problems.push(`A vehicle is missing a required identity field: ${row.supplier_vehicle_id || row.model || "unknown row"}.`);
            const supplierKey = `${row.supplier_name}|${row.supplier_vehicle_id}`;
            if (suppliers.has(supplierKey)) problems.push(`Duplicate supplier identifier: ${row.supplier_vehicle_id}.`);
            suppliers.add(supplierKey);
            if (listings.has(row.supplier_listing_url)) problems.push(`Duplicate supplier listing URL: ${row.supplier_listing_url}.`);
            listings.add(row.supplier_listing_url);
            if (row.reference == null || row.reference === "") row.reference = `LBC-CAR-${String(nextReference++).padStart(4, "0")}`;
            if (!/^LBC-CAR-\d{4}$/.test(row.reference) || refs.has(row.reference)) problems.push(`Invalid or duplicate catalogue reference: ${row.reference}.`);
            refs.add(row.reference);
            if (row.year != null && (Number(row.year) < 2016 || Number(row.year) > 2100)) problems.push(`${row.reference} has a year outside the database constraint.`);
            if (row.mileage_km != null && Number(row.mileage_km) < 0) problems.push(`${row.reference} has negative mileage.`);
            if (row.year != null && row.year !== "" && !Number.isInteger(Number(row.year))) problems.push(`${row.reference} has an invalid year value.`);
            if (row.mileage_km != null && row.mileage_km !== "" && (!Number.isInteger(Number(row.mileage_km)) || Number(row.mileage_km) < 0)) problems.push(`${row.reference} has an invalid mileage value.`);
            try { if (new URL(row.supplier_listing_url).hostname !== "cbbase.com" || new URL(row.supplier_listing_url).protocol !== "https:") problems.push(`${row.reference} must use its exact HTTPS CBBase listing URL.`); }
            catch { problems.push(`${row.reference} has an invalid supplier listing URL.`); }
            row.year = row.year == null || row.year === "" ? null : Number(row.year);
            row.mileage_km = row.mileage_km == null || row.mileage_km === "" ? null : Number(row.mileage_km);
            row.status = "draft";
            row.verification_status = "pending";
        }
        const expectedRefs = Array.from({ length: 50 }, (_, i) => `LBC-CAR-${String(i + 1).padStart(4, "0")}`);
        if (expectedRefs.some(ref => !refs.has(ref)) || refs.size !== 50) problems.push("References must be exactly LBC-CAR-0001 through LBC-CAR-0050.");
        for (const [supplierId, reference] of PILOT_REFERENCE_BY_SUPPLIER) {
            if (records.find(row => String(row.supplier_vehicle_id) === supplierId)?.reference !== reference) problems.push(`Pilot vehicle ${supplierId} must retain ${reference}.`);
        }
        const pilotRefs = records.filter(row => Number(row.reference.slice(-4)) <= 5).map(row => Number(row.reference.slice(-4))).sort((a, b) => a - b);
        if (pilotRefs.join(",") !== "1,2,3,4,5") problems.push("The five pilot references are not all present exactly once.");
        if (problems.length) throw new Error(problems.join(" "));

        const byListing = new Map(records.map(row => [String(row.supplier_listing_url), row]));
        const mapKeys = new Set();
        const coverCounts = new Map();
        const orderSets = new Map();
        const photoFiles = new Map();
        const normalizedFiles = new Map();
        for (const file of files) {
            if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) continue;
            const path = normalizeSelectedImagePath(file.webkitRelativePath || file.name);
            if (!normalizedFiles.has(path)) normalizedFiles.set(path, []);
            normalizedFiles.get(path).push(file);
        }
        const normalizedMapping = mapping.map(item => {
            const row = byListing.get(String(item.ListingURL || ""));
            const supplierId = String(row?.supplier_vehicle_id || "");
            if (!row || (item.SupplierVehicleID && supplierId !== String(item.SupplierVehicleID))) problems.push(`Photo mapping does not match a selected vehicle/listing: ${item.ListingURL || "unknown"}.`);
            if (item.DownloadStatus !== "Downloaded") problems.push(`Photo is not marked downloaded: ${item.DownloadedFile || "unknown file"}.`);
            const order = Number(item.ImageOrder);
            if (!Number.isInteger(order) || order < 1) problems.push(`Invalid image order for ${item.DownloadedFile || "photo"}.`);
            const expectedPath = String(item.DownloadedFile || "").replace(/\\/g, "/").replace(/^.*?autos-research\//, "");
            if (!/^images\/(?:LBC-CAR-\d{4}|LBC-RS-\d{3})\/(?:cover\.jpg|gallery-\d{2}\.jpg)$/.test(expectedPath)) problems.push(`Photo mapping contains an unexpected image path: ${expectedPath}.`);
            const key = `${supplierId}|${order}`;
            if (mapKeys.has(key)) problems.push(`Duplicate mapped photo order: ${key}.`);
            mapKeys.add(key);
            if (!orderSets.has(supplierId)) orderSets.set(supplierId, new Set());
            orderSets.get(supplierId).add(order);
            const isCover = String(item.IsCover).toLowerCase() === "true";
            if (isCover) coverCounts.set(supplierId, (coverCounts.get(supplierId) || 0) + 1);
            const fileCandidates = normalizedFiles.get(expectedPath) || [];
            if (fileCandidates.length !== 1) problems.push(`${expectedPath} matched ${fileCandidates.length} selected files; select the original V3 images folder.`);
            else if (!/^image\/(jpeg|png|webp|avif)$/.test(fileCandidates[0].type)) problems.push(`${expectedPath} has an unsupported image type.`);
            else photoFiles.set(key, fileCandidates[0]);
            return { row, supplierId, order, filename: expectedPath.split("/").pop(), isCover, key, expectedPath };
        });
        if (photoFiles.size !== 630) problems.push(`Resolved ${photoFiles.size} image files; 630 are required.`);
        for (const row of records) {
            const supplierId = String(row.supplier_vehicle_id);
            const orders = Array.from(orderSets.get(supplierId) || []).sort((a, b) => a - b);
            if (coverCounts.get(supplierId) !== 1) problems.push(`${row.reference} must have exactly one mapped cover photo.`);
            if (!orders.length || orders.some((order, index) => order !== index + 1)) problems.push(`${row.reference} photo order must be sequential from 1.`);
        }
        if (problems.length) throw new Error(problems.slice(0, 12).join(" ") + (problems.length > 12 ? ` Plus ${problems.length - 12} more validation errors.` : ""));
        return { records, mapping: normalizedMapping.sort((a, b) => a.row.reference.localeCompare(b.row.reference) || a.order - b.order), photoFiles };
    }

    function normalizeSelectedImagePath(value) {
        return String(value || "").replace(/\\/g, "/").replace(/^.*?(?=images\/)/, "").replace(/^\/+/, "");
    }

    function parseCsv(text) {
        const rows = [];
        let row = [], field = "", quoted = false;
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (quoted) {
                if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
                else if (char === '"') quoted = false;
                else field += char;
            } else if (char === '"') quoted = true;
            else if (char === ",") { row.push(field); field = ""; }
            else if (char === "\n" || char === "\r") {
                if (char === "\r" && text[i + 1] === "\n") i++;
                row.push(field); field = "";
                if (row.some(value => value !== "")) rows.push(row);
                row = [];
            } else field += char;
        }
        if (quoted) throw new Error("The photograph mapping CSV has an unclosed quoted field.");
        if (field || row.length) { row.push(field); rows.push(row); }
        if (rows.length < 2) throw new Error("The photograph mapping CSV is empty.");
        const headers = rows.shift().map(value => value.replace(/^\uFEFF/, "").trim());
        return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
    }

    async function runProductionPreflight(records, mapping) {
        if (!/^https:\/\/rqlcjaaibmdfdfsemcrc\.supabase\.co\/?$/i.test(String(LORDBLESS_SUPABASE_URL || ""))) throw new Error("The configured Supabase project does not match the approved production project.");
        const { data: authData, error: authError } = await lordblessSupabase.auth.getUser();
        if (authError || !authData?.user) throw new Error(`A signed-in administrator is required: ${authError?.message || "no authenticated user"}.`);
        const adminIdentity = typeof getCurrentUser === "function" ? getCurrentUser() : null;
        if (!adminIdentity || adminIdentity.id !== authData.user.id) throw new Error("The Admin identity and authenticated Supabase session do not match. Reload the Admin Portal and sign in again.");
        if (typeof hasPermission !== "function" || !hasPermission(adminIdentity, "autos.manage")) throw new Error("The current Admin identity does not have autos.manage.");

        const [vehicleResult, photoResult, bucketResult] = await Promise.all([
            lordblessSupabase.from("autos_vehicles").select("id,reference,make,model,year,mileage_km,condition,body_type,fuel_type,transmission,drivetrain,engine,description,supplier_name,supplier_vehicle_id,supplier_listing_url,verification_status,verification_notes,status"),
            lordblessSupabase.from("autos_vehicle_photos").select("id,vehicle_id,storage_path,sort_order,is_cover"),
            lordblessSupabase.storage.from(BUCKET).list("", { limit: 1 })
        ]);
        if (vehicleResult.error) throw new Error(`Cannot verify AUTOS vehicles or autos.manage: ${vehicleResult.error.message}`);
        if (photoResult.error) throw new Error(`Cannot verify AUTOS photo associations: ${photoResult.error.message}`);
        if (bucketResult.error) throw new Error(`The existing private Storage bucket could not be verified: ${bucketResult.error.message}`);

        const bySupplier = new Map(records.map(row => [`${row.supplier_name}|${row.supplier_vehicle_id}`, row]));
        const byReference = new Map(records.map(row => [row.reference, row]));
        const idsBySupplier = new Map();
        const seenIds = new Set();
        const rows = vehicleResult.data || [];
        for (const existing of rows) {
            const key = `${existing.supplier_name}|${existing.supplier_vehicle_id}`;
            const expected = bySupplier.get(key);
            if (!expected || expected.supplier_listing_url !== existing.supplier_listing_url || expected.reference !== existing.reference) throw new Error(`Production contains an unexpected or conflicting vehicle record (${existing.reference || existing.supplier_vehicle_id}). Import stopped before writes.`);
            for (const field of ["make", "model", "year", "mileage_km", "condition", "body_type", "fuel_type", "transmission", "drivetrain", "engine", "description", "verification_notes"]) {
                const left = existing[field] == null || existing[field] === "" ? null : (field === "year" || field === "mileage_km" ? Number(existing[field]) : String(existing[field]).trim());
                const right = expected[field] == null || expected[field] === "" ? null : (field === "year" || field === "mileage_km" ? Number(expected[field]) : String(expected[field]).trim());
                if (left !== right) throw new Error(`Existing ${existing.reference} has a different ${field} value. It was preserved; import stopped before writes.`);
            }
            if (seenIds.has(expected.supplier_vehicle_id)) throw new Error(`Production contains a duplicate supplier identifier: ${expected.supplier_vehicle_id}.`);
            seenIds.add(expected.supplier_vehicle_id);
            idsBySupplier.set(String(expected.supplier_vehicle_id), existing.id);
        }
        for (const existing of rows) {
            const expected = byReference.get(existing.reference);
            if (!expected || expected.supplier_vehicle_id !== existing.supplier_vehicle_id) throw new Error(`Reference conflict in production: ${existing.reference}.`);
        }
        const vehicleIds = new Set(rows.map(row => row.id));
        for (const photo of photoResult.data || []) if (!vehicleIds.has(photo.vehicle_id)) throw new Error(`Production has an AUTOS photo association outside the expected catalogue (${photo.id}). Import stopped before writes.`);
        const expectedPhotoPaths = new Set();
        for (const item of mapping) {
            const vehicleId = idsBySupplier.get(item.supplierId);
            if (vehicleId) expectedPhotoPaths.add(`${vehicleId}/${item.filename}`);
        }
        for (const photo of photoResult.data || []) if (!expectedPhotoPaths.has(photo.storage_path)) throw new Error(`Unexpected production photo association ${photo.storage_path}. Import stopped before writes.`);
        return { existingVehicles: rows.length, existingPhotos: (photoResult.data || []).length, idsBySupplier };
    }

    async function executeBulkImport() {
        if (busy || !bulkPackage.preflight || !bulkPackage.records || !bulkPackage.mapping) return;
        if (!window.confirm("Import the validated V3 catalogue into the approved production project? Vehicle drafts and photo associations will be written using this authenticated Admin account.")) return;
        setBusy(true);
        root.querySelector(".autos-admin")?.setAttribute("aria-busy", "true");
        bulkErrors = [];
        const runButton = root.querySelector("[data-autos-import-run]");
        if (runButton) runButton.disabled = true;
        setImportProgress(0);
        try {
            bulkStatus = "Rechecking production access and existing records before writes...";
            setBulkStatus(bulkStatus);
            const preflight = await runProductionPreflight(bulkPackage.records, bulkPackage.mapping);
            const idsBySupplier = new Map(preflight.idsBySupplier);
            const newRecords = bulkPackage.records.filter(row => !idsBySupplier.has(String(row.supplier_vehicle_id)));
            let vehiclesDone = idsBySupplier.size;
            const vehicleProgress = newRecords.length ? 20 / newRecords.length : 20;
            for (let offset = 0; offset < newRecords.length; offset += 5) {
                const batch = newRecords.slice(offset, offset + 5).map(row => vehiclePayload(row));
                bulkStatus = `Inserting vehicle drafts ${offset + 1}-${offset + batch.length} of ${newRecords.length}...`;
                setBulkStatus(bulkStatus);
                const { data, error: insertError } = await lordblessSupabase.from("autos_vehicles").insert(batch).select("id,reference,supplier_vehicle_id");
                if (insertError) throw new Error(`Vehicle batch failed: ${insertError.message}. Completed inserts are retained; revalidate and rerun to resume.`);
                for (const saved of data || []) idsBySupplier.set(String(saved.supplier_vehicle_id), saved.id);
                vehiclesDone += batch.length;
                setImportProgress(Math.min(20, 20 * vehiclesDone / 50));
                await yieldToBrowser();
            }
            if (idsBySupplier.size !== 50) throw new Error(`Only ${idsBySupplier.size} vehicle UUIDs were confirmed; photograph upload was stopped.`);

            const { data: currentPhotos, error: photoReadError } = await lordblessSupabase.from("autos_vehicle_photos").select("vehicle_id,storage_path,sort_order,is_cover");
            if (photoReadError) throw new Error(`Vehicle drafts were retained, but existing photo associations could not be read: ${photoReadError.message}`);
            const existingPhotoMap = new Map((currentPhotos || []).map(photo => [`${photo.vehicle_id}/${photo.storage_path.split("/").pop()}`, photo]));
            let photosDone = existingPhotoMap.size;
            let uploaded = 0, associated = 0;
            setImportProgress(20 + 80 * photosDone / 630);
            bulkStatus = "Checking each target Storage folder for existing files before upload...";
            setBulkStatus(bulkStatus);
            const storedPaths = await inventoryStoragePaths(idsBySupplier, bulkPackage.mapping);
            for (const item of bulkPackage.mapping) {
                const vehicleId = idsBySupplier.get(item.supplierId);
                const path = `${vehicleId}/${item.filename}`;
                const existing = existingPhotoMap.get(path);
                if (existing) {
                    if (existing.sort_order !== item.order - 1 || existing.is_cover !== item.isCover) throw new Error(`Existing photo association conflicts with the V3 mapping: ${path}.`);
                    if (!storedPaths.has(path)) {
                        const missingFile = bulkPackage.photoFiles.get(item.key);
                        const { error: repairError } = await lordblessSupabase.storage.from(BUCKET).upload(path, missingFile, { contentType: missingFile.type, upsert: false });
                        if (repairError) throw new Error(`Existing photo association has no Storage object and could not be restored (${path}): ${repairError.message}.`);
                        uploaded++;
                    }
                    storedPaths.add(path);
                    continue;
                }
                const file = bulkPackage.photoFiles.get(item.key);
                if (!file) throw new Error(`Selected image disappeared from the import session: ${item.expectedPath}.`);
                if (storedPaths.has(path)) {
                    const { data: storedFile, error: downloadError } = await lordblessSupabase.storage.from(BUCKET).download(path);
                    if (downloadError || !storedFile || !(await filesHaveSameHash(file, storedFile))) throw new Error(`An existing unassociated Storage object conflicts with ${path}; it was preserved and not overwritten.`);
                } else {
                    const { error: uploadError } = await lordblessSupabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
                    if (uploadError) throw new Error(`Photo upload failed for ${item.expectedPath}: ${uploadError.message}. Completed uploads and associations are retained; validate and rerun to resume.`);
                    uploaded++;
                }
                const { error: associationError } = await lordblessSupabase.from("autos_vehicle_photos").insert({ vehicle_id: vehicleId, storage_path: path, sort_order: item.order - 1, is_cover: item.isCover });
                if (associationError) throw new Error(`Photo uploaded but association failed for ${item.expectedPath}: ${associationError.message}. Rerun to resume this mapped photo.`);
                associated++;
                storedPaths.add(path);
                existingPhotoMap.set(path, { vehicle_id: vehicleId, storage_path: path, sort_order: item.order - 1, is_cover: item.isCover });
                photosDone++;
                if (photosDone % 5 === 0 || photosDone === 630) {
                    bulkStatus = `Photographs: ${photosDone}/630 associated (${uploaded} uploaded, ${associated} newly associated).`;
                    setBulkStatus(bulkStatus);
                    setImportProgress(20 + 80 * photosDone / 630);
                    await yieldToBrowser();
                }
            }
            const finalResult = await verifyCompletedImport(idsBySupplier, bulkPackage.mapping, storedPaths);
            bulkStatus = `Import complete: ${finalResult.vehicles} vehicle drafts, ${finalResult.covers} covers, ${finalResult.gallery} gallery photographs (${finalResult.photos} total). All remain draft / pending verification; review and publish through the existing vehicle editor.`;
            setBulkStatus(bulkStatus);
            setImportProgress(100);
            notice = "V3 vehicle drafts and mapped photographs imported successfully.";
            setBusy(false);
            await loadData();
            renderWorkspace();
        } catch (cause) {
            const message = cause?.message || String(cause);
            bulkErrors = [message];
            bulkStatus = "Import stopped safely. Successful batches and associations are retained; rerun validation to resume.";
            setBulkStatus(bulkStatus);
            const list = root.querySelector("[data-autos-import-errors]");
            if (list) list.innerHTML = `<li>${escapeHTML(message)}</li>`;
            if (runButton) runButton.disabled = false;
        } finally {
            setBusy(false);
            root.querySelector(".autos-admin")?.removeAttribute("aria-busy");
        }
    }

    function vehiclePayload(row) {
        return {
            reference: row.reference, make: row.make, model: row.model, year: row.year,
            mileage_km: row.mileage_km, condition: row.condition || null, body_type: row.body_type || null,
            fuel_type: row.fuel_type || null, transmission: row.transmission || null,
            drivetrain: row.drivetrain || null, engine: row.engine || null, description: row.description || null,
            supplier_name: row.supplier_name, supplier_vehicle_id: row.supplier_vehicle_id,
            supplier_listing_url: row.supplier_listing_url, verification_status: "pending",
            verification_notes: row.verification_notes || null, status: "draft"
        };
    }

    async function verifyCompletedImport(idsBySupplier, mapping, storedPaths) {
        const [vehicleResult, photoResult] = await Promise.all([
            lordblessSupabase.from("autos_vehicles").select("id,reference,supplier_vehicle_id,status,verification_status"),
            lordblessSupabase.from("autos_vehicle_photos").select("vehicle_id,storage_path,sort_order,is_cover")
        ]);
        if (vehicleResult.error) throw new Error(`Final vehicle validation failed: ${vehicleResult.error.message}`);
        if (photoResult.error) throw new Error(`Final photo validation failed: ${photoResult.error.message}`);
        const vehicleIds = new Set((vehicleResult.data || []).map(row => row.id));
        if (vehicleIds.size !== 50 || vehicleIds.size !== idsBySupplier.size) throw new Error(`Final check found ${vehicleIds.size} vehicles instead of 50.`);
        if ((vehicleResult.data || []).some(row => row.status !== "draft" || row.verification_status !== "pending")) throw new Error("Final check found a vehicle that is not draft/pending; no publication was performed.");
        const photos = photoResult.data || [];
        if (photos.length !== 630) throw new Error(`Final check found ${photos.length} photo associations instead of 630.`);
        const covers = photos.filter(photo => photo.is_cover).length;
        if (covers !== 50 || photos.length - covers !== 580) throw new Error(`Final photo totals are ${covers} covers and ${photos.length - covers} gallery photographs.`);
        const photosByPath = new Map(photos.map(photo => [photo.storage_path, photo]));
        for (const item of mapping) {
            const path = `${idsBySupplier.get(item.supplierId)}/${item.filename}`;
            const photo = photosByPath.get(path);
            if (!photo || photo.vehicle_id !== idsBySupplier.get(item.supplierId) || photo.sort_order !== item.order - 1 || photo.is_cover !== item.isCover || !storedPaths.has(path)) throw new Error(`Final mapping verification failed for ${item.expectedPath}.`);
        }
        return { vehicles: vehicleIds.size, photos: photos.length, covers, gallery: photos.length - covers };
    }

    async function inventoryStoragePaths(idsBySupplier, mapping) {
        const expected = new Set(mapping.map(item => `${idsBySupplier.get(item.supplierId)}/${item.filename}`));
        const folders = Array.from(new Set(mapping.map(item => idsBySupplier.get(item.supplierId))));
        const found = new Set();
        for (let offset = 0; offset < folders.length; offset += 5) {
            const batch = await Promise.all(folders.slice(offset, offset + 5).map(async folder => {
                const { data, error: listError } = await lordblessSupabase.storage.from(BUCKET).list(folder, { limit: 1000 });
                if (listError) throw new Error(`Could not inspect Storage folder ${folder}: ${listError.message}`);
                return (data || []).map(item => `${folder}/${item.name}`);
            }));
            for (const paths of batch) for (const path of paths) {
                if (!expected.has(path)) throw new Error(`An existing Storage object is outside the V3 photo map (${path}); it was preserved and the import stopped.`);
                found.add(path);
            }
            bulkStatus = `Storage folders checked: ${Math.min(offset + 5, folders.length)}/${folders.length}.`;
            setBulkStatus(bulkStatus);
        }
        return found;
    }

    async function filesHaveSameHash(localFile, storedFile) {
        if (!window.crypto?.subtle) throw new Error("Secure SHA-256 validation is unavailable in this browser; existing Storage objects were not overwritten.");
        const [localBytes, storedBytes] = await Promise.all([localFile.arrayBuffer(), storedFile.arrayBuffer()]);
        const [localHash, storedHash] = await Promise.all([
            window.crypto.subtle.digest("SHA-256", localBytes),
            window.crypto.subtle.digest("SHA-256", storedBytes)
        ]);
        const left = new Uint8Array(localHash), right = new Uint8Array(storedHash);
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    function setBulkStatus(message) {
        const element = root?.querySelector("[data-autos-import-status]");
        if (element) element.textContent = message;
    }

    function setImportProgress(value) {
        const progress = root?.querySelector("[data-autos-import-progress]");
        if (progress) progress.value = Math.max(0, Math.min(100, value));
    }

    function yieldToBrowser() { return new Promise(resolve => requestAnimationFrame(() => resolve())); }

    async function saveVehicle(event) {
        event.preventDefault();
        if (busy || !event.currentTarget.reportValidity()) return;
        const form = new FormData(event.currentTarget);
        const yearText = String(form.get("year") || "").trim();
        const mileageText = String(form.get("mileage_km") || "").trim();
        const payload = {
            reference: String(form.get("reference") || "").trim().toUpperCase(),
            make: String(form.get("make") || "").trim(),
            model: String(form.get("model") || "").trim(),
            year: yearText ? Number(yearText) : null,
            mileage_km: mileageText ? Number(mileageText) : null,
            body_type: blankToNull(form.get("body_type")), condition: blankToNull(form.get("condition")),
            fuel_type: blankToNull(form.get("fuel_type")), transmission: blankToNull(form.get("transmission")),
            drivetrain: blankToNull(form.get("drivetrain")), engine: blankToNull(form.get("engine")),
            supplier_name: String(form.get("supplier_name") || "CBBase").trim() || "CBBase",
            supplier_vehicle_id: blankToNull(form.get("supplier_vehicle_id")),
            supplier_listing_url: blankToNull(form.get("supplier_listing_url")),
            verification_status: String(form.get("verification_status") || "pending"),
            verification_notes: blankToNull(form.get("verification_notes")),
            description: blankToNull(form.get("description")),
            status: String(form.get("status") || "draft")
        };
        const needsReverification = Boolean(activeVehicle) && REVERIFY_FIELDS.some(field =>
            normalizeReviewValue(field, activeVehicle[field]) !== normalizeReviewValue(field, payload[field])
        );
        if (needsReverification) {
            payload.status = "draft";
            payload.verification_status = "pending";
        }
        setBusy(true);
        const query = activeVehicle
            ? lordblessSupabase.from("autos_vehicles").update(payload).eq("id", activeVehicle.id).select("*").single()
            : lordblessSupabase.from("autos_vehicles").insert(payload).select("*").single();
        const { data, error: saveError } = await query;
        setBusy(false);
        if (saveError) {
            error = `Vehicle was not saved: ${saveError.message}`;
            renderWorkspace();
            return;
        }
        activeVehicle = data;
        notice = needsReverification
            ? `${data.reference} saved as draft and marked pending verification because its details or supplier information changed.`
            : `${data.reference} saved as ${data.status}.`;
        await loadData();
        renderWorkspace();
    }

    async function uploadPhotos(event) {
        const files = Array.from(event.currentTarget.files || []);
        event.currentTarget.value = "";
        const uploadVehicle = activeVehicle;
        let nextOrder = photos.length;
        if (!uploadVehicle || !files.length || busy) return;
        if (files.some(file => !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
            error = "Choose JPEG, PNG, WebP or AVIF image files no larger than 15 MB each.";
            renderWorkspace();
            return;
        }
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(uploadVehicle.id)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        error = "";
        for (const file of files) {
            const path = `${uploadVehicle.id}/${crypto.randomUUID()}.${file.name.split(".").pop().toLowerCase()}`;
            const { error: uploadError } = await lordblessSupabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
            if (uploadError) { error = `Photo upload failed: ${uploadError.message}`; break; }
            const { error: rowError } = await lordblessSupabase.from("autos_vehicle_photos").insert({ vehicle_id: uploadVehicle.id, storage_path: path, sort_order: nextOrder, is_cover: nextOrder === 0 });
            if (rowError) {
                await lordblessSupabase.storage.from(BUCKET).remove([path]);
                error = `Photo metadata could not be saved: ${rowError.message}`;
                break;
            }
            nextOrder += 1;
        }
        setBusy(false);
        if (!error) notice = "Photos uploaded. The vehicle is a draft pending re-verification.";
        await loadPhotos();
        renderWorkspace();
    }

    async function setCover(photoId) {
        if (busy || !activeVehicle) return;
        const vehicleId = activeVehicle.id;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(vehicleId)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        let result = await lordblessSupabase.from("autos_vehicle_photos").update({ is_cover: false }).eq("vehicle_id", vehicleId);
        if (!result.error) result = await lordblessSupabase.from("autos_vehicle_photos").update({ is_cover: true }).eq("id", photoId).eq("vehicle_id", vehicleId);
        setBusy(false);
        error = result.error ? `Cover photo could not be changed: ${result.error.message}` : "";
        notice = error ? "" : "Cover photo updated. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function movePhoto(photoId, direction) {
        const index = photos.findIndex(photo => photo.id === photoId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= photos.length || busy) return;
        const vehicleId = activeVehicle?.id;
        const order = [...photos];
        if (!vehicleId) return;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(vehicleId)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        [order[index], order[target]] = [order[target], order[index]];
        for (let position = 0; position < order.length; position += 1) {
            const { error: orderError } = await lordblessSupabase.from("autos_vehicle_photos").update({ sort_order: position }).eq("id", order[position].id);
            if (orderError) { error = `Photo order could not be saved: ${orderError.message}`; break; }
        }
        setBusy(false);
        if (!error) notice = "Photo order changed. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function removePhoto(photoId) {
        const photo = photos.find(item => item.id === photoId);
        if (!photo || busy || !window.confirm("Remove this vehicle photo from the catalogue?")) return;
        setBusy(true);
        if (!await markDraftPendingBeforeCatalogueChange(photo.vehicle_id)) {
            setBusy(false);
            renderWorkspace();
            return;
        }
        const { error: rowError } = await lordblessSupabase.from("autos_vehicle_photos").delete().eq("id", photoId);
        if (!rowError) {
            const { error: storageError } = await lordblessSupabase.storage.from(BUCKET).remove([photo.storage_path]);
            error = storageError ? `Photo metadata was removed, but its stored file could not be removed: ${storageError.message}` : "";
        } else error = `Photo record could not be removed: ${rowError.message}`;
        setBusy(false);
        if (!error) notice = "Photo removed. The vehicle is a draft pending re-verification.";
        await loadPhotos(); renderWorkspace();
    }

    async function markDraftPendingBeforeCatalogueChange(vehicleId) {
        const { data, error: updateError } = await lordblessSupabase
            .from("autos_vehicles")
            .update({ status: "draft", verification_status: "pending" })
            .eq("id", vehicleId)
            .select("id")
            .single();
        if (updateError || !data) {
            error = `The vehicle could not be moved to draft pending verification: ${updateError?.message || "record not found"}`;
            return false;
        }

        vehicles = vehicles.map(vehicle => vehicle.id === vehicleId
            ? { ...vehicle, status: "draft", verification_status: "pending" }
            : vehicle
        );
        if (activeVehicle?.id === vehicleId) {
            activeVehicle = { ...activeVehicle, status: "draft", verification_status: "pending" };
        }
        error = "";
        notice = `${vehicles.find(vehicle => vehicle.id === vehicleId)?.reference || "Vehicle"} moved to draft pending re-verification.`;
        return true;
    }

    function normalizeReviewValue(field, value) {
        if (field === "year" || field === "mileage_km") {
            return value === null || value === undefined || value === "" ? null : Number(value);
        }
        return String(value ?? "").trim();
    }

    function safeSupplierUrl(value) {
        try {
            const parsed = new URL(String(value || ""));
            return parsed.protocol === "https:" ? parsed.href : "";
        } catch {
            return "";
        }
    }
    function setBusy(value) { busy = value; }
    function blankToNull(value) { const text = String(value || "").trim(); return text || null; }
    function escapeHTML(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }

    return { render };
})();
