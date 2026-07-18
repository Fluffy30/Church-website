// js/nav.js
// -----------------------------------------------------------------------
// Runs on every page. Handles:
//   1. Mobile hamburger menu toggle
//   2. Showing/hiding nav links based on login state and role, using
//      simple data attributes in the HTML:
//        data-auth="guest"  -> visible only when logged OUT
//        data-auth="user"   -> visible only when logged IN
//        data-auth="staff"  -> visible only for admin/leader roles
// -----------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    const toggleBtn = document.querySelector(".nav-toggle");
    const navLinks = document.querySelector(".nav-links");
    if (toggleBtn && navLinks) {
        toggleBtn.addEventListener("click", () => navLinks.classList.toggle("open"));
    }

    const loggedIn = Auth.isLoggedIn();
    const isStaff = Auth.hasRole("admin", "leader");

    document.querySelectorAll("[data-auth]").forEach((el) => {
        const need = el.getAttribute("data-auth");
        let show = true;
        if (need === "guest") show = !loggedIn;
        if (need === "user") show = loggedIn;
        if (need === "staff") show = loggedIn && isStaff;
        el.style.display = show ? "" : "none";
    });

    const nameEl = document.querySelector("[data-user-name]");
    if (nameEl && loggedIn) nameEl.textContent = Auth.getUser().name;

    const logoutBtn = document.querySelector("[data-logout]");
    if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.preventDefault(); Auth.logout(); });
});
