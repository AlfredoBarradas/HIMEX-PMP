(() => {
    let initialized = false;
    async function initSidebar() {
        const container = document.getElementById("sidebar-container");
        if (!container) return;
        if (!initialized || !container.querySelector(".sidebar")) {
            const response = await fetch("/components/sidebar/sidebar.html");
            if (!response.ok) throw new Error("Unable to load sidebar");
            container.innerHTML = await response.text();
            initialized = true;
            initializeSidebarActions();
        }
        applySidebarPermissions();
        setActiveSidebarItem();
    }
    function initializeSidebarActions() {
        document.getElementById("logout-button")?.addEventListener("click", async event => {
            const button = event.currentTarget; button.disabled = true;
            if (await signOutUser()) window.location.href = "/auth/";
            else button.disabled = false;
        });
    }
    function hasViewPermission(modules) {
        return isAdmin() || currentUserPermissions.some(p => modules.includes(p.module) && String(p.action).toLowerCase() === "view");
    }
    function applySidebarPermissions() {
        const map = { "Documents":["SOP","Layout","TI","MDR"], "SOP":["SOP"], "Losstime":["Losstime"], "Efficiency":["Efficiency"], "Scrap":["Scrap"], "Production":["Production"], "New Models":["New Models","PFMEA"] };
        document.querySelectorAll(".sidebar-menu a").forEach(link => {
            const modules = map[link.dataset.page];
            if (modules) link.hidden = !hasViewPermission(modules);
        });
    }
    function setActiveSidebarItem(path = window.location.pathname) {
        document.querySelectorAll(".sidebar-menu a, .sidebar-footer a").forEach(link => {
            const linkPath = new URL(link.href, location.origin).pathname.replace(/\/+$/, "") || "/";
            const current = path.replace(/\/+$/, "") || "/";
            link.classList.toggle("active", linkPath === current || (linkPath !== "/" && current.startsWith(linkPath + "/")));
        });
    }
    window.PMPSidebar = { init: initSidebar, update: setActiveSidebarItem };
    document.addEventListener("DOMContentLoaded", () => initSidebar().catch(console.error));
})();
