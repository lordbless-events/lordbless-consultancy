/* Education page mobile navigation. Public enquiries use the main website form. */
document.addEventListener("DOMContentLoaded", () => {
    const menuButton = document.querySelector(".mobile-menu-button");
    const navigation = document.querySelector(".main-navigation");
    if (!menuButton || !navigation) return;

    menuButton.addEventListener("click", () => {
        const open = menuButton.getAttribute("aria-expanded") === "true";
        menuButton.setAttribute("aria-expanded", String(!open));
        navigation.classList.toggle("is-open", !open);
    });

    navigation.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            menuButton.setAttribute("aria-expanded", "false");
            navigation.classList.remove("is-open");
        });
    });
});
