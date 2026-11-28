/* LORDBLESS Spotlight: native, dependency-free story carousel. */
document.addEventListener("DOMContentLoaded", () => {
    const section = document.querySelector(".spotlight-section");
    const viewport = section?.querySelector(".spotlight-viewport");
    const track = section?.querySelector(".spotlight-track");
    if (!section || !viewport || !track) return;

    const cards = [...track.querySelectorAll(".journey-story")];
    if (!cards.length) return;

    const wordLimit = 23;
    const items = cards.map((card, index) => {
        const title = card.querySelector("h3")?.textContent.trim() || "Client story";
        const coverImage = safeSpotlightDestination(card.dataset.coverImage);
        if (coverImage) {
            const image = document.createElement("img");
            image.className = "spotlight-cover-image";
            image.src = coverImage;
            image.alt = `${title} promotional image`;
            image.loading = "lazy";
            image.decoding = "async";
            card.prepend(image);
            card.classList.add("has-cover-image");
        }
        const previewParts = [...card.querySelectorAll(".journey-story-content > p:not(.journey-story-route)")]
            .map(node => node.textContent.trim()).filter(Boolean);
        const words = previewParts.join(" ").split(/\s+/).filter(Boolean);
        const description = words.slice(0, wordLimit).join(" ") + (words.length > wordLimit ? "..." : "");
        const detail = card.querySelector(".journey-story-full");

        card.querySelectorAll(".journey-story-content > p:not(.journey-story-route)").forEach(node => node.remove());
        const preview = document.createElement("p");
        preview.className = "spotlight-description";
        preview.textContent = description;
        card.querySelector(".journey-story-content h3")?.after(preview);
        card.dataset.contentType = "story";
        card.dataset.spotlightCategory = card.querySelector(".journey-story-status")?.textContent.trim() || "LORDBLESS Story";
        card.dataset.publicationStatus = "published";
        card.dataset.displayOrder = String(index);
        card.setAttribute("role", "group");
        card.setAttribute("aria-roledescription", "slide");
        card.setAttribute("aria-label", `${index + 1} of ${cards.length}: ${title}`);
        return {
            id: card.id || `story-${index + 1}`,
            content_type: "story",
            service_category: card.querySelector(".journey-story-status")?.textContent.trim() || "story",
            title,
            cover_image: coverImage,
            short_description: description,
            full_content: detail?.innerHTML || "",
            action_label: "Read the Journey",
            action_destination: safeSpotlightDestination("#"),
            publication_status: "published",
            publication_date: null,
            expiry_date: null,
            featured: false,
            display_order: index
        };
    });
    window.LORDBLESS_SPOTLIGHT_ITEMS = items;
    window.LORDBLESS_SPOTLIGHT_UTILS = {
        safeDestination: safeSpotlightDestination
    };

    const previous = section.querySelector("[data-spotlight-prev]");
    const next = section.querySelector("[data-spotlight-next]");
    const toggle = section.querySelector("[data-spotlight-toggle]");
    const dots = section.querySelector("[data-spotlight-dots]");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let index = 0;
    let paused = reducedMotion.matches;
    let hovered = false;
    let focused = false;
    let visible = false;
    let timer = null;

    let dotButtons = [];

    function visibleCount() {
        if (window.matchMedia("(min-width: 1100px)").matches) return 3;
        if (window.matchMedia("(min-width: 680px)").matches) return 2;
        return 1;
    }
    function syncDots() {
        if (!dots) return;
        const dotCount = Math.max(1, cards.length - visibleCount() + 1);
        dots.replaceChildren();
        for (let dotIndex = 0; dotIndex < dotCount; dotIndex += 1) {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.dataset.spotlightIndex = String(dotIndex);
            dot.setAttribute("aria-label", `Show spotlight position ${dotIndex + 1}`);
            dots.append(dot);
        }
        dotButtons = [...dots.querySelectorAll("button")];
        dotButtons.forEach(dot => dot.addEventListener("click", () => {
            index = Number(dot.dataset.spotlightIndex) || 0;
            pauseForInteraction();
            render();
        }));
    }
    function pauseForInteraction() {
        paused = true;
        toggle?.setAttribute("aria-pressed", "true");
        if (toggle) toggle.textContent = "Resume stories";
        stopTimer();
    }
    function render() {
        const maxIndex = Math.max(0, cards.length - visibleCount());
        index = Math.min(index, maxIndex);
        const step = cards[0].getBoundingClientRect().width + (parseFloat(getComputedStyle(track).columnGap) || 16);
        track.style.transform = `translate3d(${-index * step}px, 0, 0)`;
        cards.forEach((card, cardIndex) => card.setAttribute("aria-hidden", String(cardIndex < index || cardIndex >= index + visibleCount())));
        dotButtons.forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === index)));
        if (previous) previous.disabled = index === 0;
        if (next) next.disabled = index >= maxIndex;
    }
    function stopTimer() {
        if (timer) window.clearInterval(timer);
        timer = null;
    }
    function startTimer() {
        stopTimer();
        if (paused || hovered || focused || !visible || reducedMotion.matches || cards.length <= visibleCount()) return;
        timer = window.setInterval(() => {
            index = index >= cards.length - visibleCount() ? 0 : index + 1;
            render();
        }, 6000);
    }
    previous?.addEventListener("click", () => { index = Math.max(0, index - 1); pauseForInteraction(); render(); });
    next?.addEventListener("click", () => { index = Math.min(cards.length - visibleCount(), index + 1); pauseForInteraction(); render(); });
    toggle?.addEventListener("click", () => {
        paused = !paused;
        toggle.setAttribute("aria-pressed", String(paused));
        toggle.textContent = paused ? "Resume stories" : "Pause stories";
        startTimer();
    });
    section.addEventListener("pointerenter", () => { hovered = true; stopTimer(); });
    section.addEventListener("pointerleave", () => { hovered = false; startTimer(); });
    section.addEventListener("focusin", () => { focused = true; stopTimer(); });
    section.addEventListener("focusout", event => {
        if (!section.contains(event.relatedTarget)) { focused = false; startTimer(); }
    });
    let touchStartX = null;
    viewport.addEventListener("touchstart", event => { touchStartX = event.changedTouches[0]?.clientX ?? null; stopTimer(); }, { passive: true });
    viewport.addEventListener("touchend", event => {
        const delta = touchStartX === null ? 0 : touchStartX - (event.changedTouches[0]?.clientX ?? touchStartX);
        if (Math.abs(delta) > 40) {
            index = Math.max(0, Math.min(cards.length - visibleCount(), index + (delta > 0 ? 1 : -1)));
            pauseForInteraction();
        }
        touchStartX = null; render(); startTimer();
    }, { passive: true });
    let lastVisibleCount = visibleCount();
    window.addEventListener("resize", () => {
        const nextVisibleCount = visibleCount();
        if (nextVisibleCount !== lastVisibleCount) {
            lastVisibleCount = nextVisibleCount;
            syncDots();
        }
        render(); startTimer();
    }, { passive: true });
    reducedMotion.addEventListener?.("change", event => { if (event.matches) paused = true; startTimer(); });
    document.addEventListener("visibilitychange", () => document.hidden ? stopTimer() : startTimer());
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(entries => {
            visible = Boolean(entries[0]?.isIntersecting);
            startTimer();
        }, { threshold: 0.2 }).observe(section);
    } else visible = true;
    syncDots();
    render();
    startTimer();
});

function safeSpotlightDestination(destination) {
    if (typeof destination !== "string" || !destination.trim()) return null;
    try {
        const url = new URL(destination, window.location.origin);
        if (url.origin === window.location.origin) return `${url.pathname}${url.search}${url.hash}`;
        return url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}
