/* Keep persisted enquiry data intact while sending only completed service
   sections to the shared internal/customer notification function. */
(function () {
    const serviceKeys = ["education", "careers", "travel", "business", "mobility", "general"];

    function hasContent(value) {
        if (Array.isArray(value)) return value.some(hasContent);
        if (value && typeof value === "object") return Object.values(value).some(hasContent);
        return value !== null && value !== undefined && String(value).trim() !== "";
    }

    function clean(value) {
        if (Array.isArray(value)) return value.map(clean).filter(hasContent);
        if (value && typeof value === "object") {
            return Object.fromEntries(Object.entries(value)
                .filter(([, entry]) => hasContent(entry))
                .map(([key, entry]) => [key, clean(entry)]));
        }
        return value;
    }

    function forNotification(enquiryData) {
        const source = enquiryData && typeof enquiryData === "object" ? enquiryData : {};
        const services = Array.isArray(source.services) ? source.services : [source.services].filter(Boolean);
        const selected = services.map(value => String(value).trim().toLowerCase());
        const result = {
            ...source,
            client: clean(source.client || {}),
            services: [...services],
            journey: clean(source.journey || {})
        };

        for (const key of serviceKeys) {
            const aliases = {
                education: ["education", "study", "university"],
                careers: ["career", "work", "job"],
                travel: ["travel", "tourism"],
                business: ["business", "trade"],
                mobility: ["mobility", "settlement", "migration"],
                general: ["general", "other", "unsure"]
            }[key];
            const isSelected = selected.some(service => aliases.some(alias => service.includes(alias)));
            const section = clean(source[key] || {});
            if (isSelected && hasContent(section)) result[key] = section;
            else delete result[key];
        }

        return result;
    }

    window.LORDBLESS_ENQUIRY_EMAIL_PAYLOAD = Object.freeze({ forNotification });
})();
