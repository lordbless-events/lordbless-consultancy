/* Education page mobile navigation. Public enquiries use the main website form. */
document.addEventListener("DOMContentLoaded", () => {
    const menuButton = document.querySelector(".mobile-menu-button");
    const navigation = document.querySelector(".main-navigation");
    if (!menuButton || !navigation) return;

    menuButton.addEventListener("click", () => {
        const open = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!open));
        menuButton.setAttribute("aria-label", open ? "Open navigation menu" : "Close navigation menu");
        navigation.classList.toggle("is-open", !open);
    });

    navigation.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            menuButton.setAttribute("aria-expanded", "false");
            menuButton.setAttribute("aria-label", "Open navigation menu");
            navigation.classList.remove("is-open");
        });
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || menuButton.getAttribute("aria-expanded") !== "true") return;
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation menu");
        navigation.classList.remove("is-open");
        menuButton.focus();
    });
});
