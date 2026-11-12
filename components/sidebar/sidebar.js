(() => {
    async function loadSidebar() {
        const container = document.getElementById("sidebar-container");

        if (!container) {
            return;
        }

        const response = await fetch("/components/sidebar/sidebar.html");

        if (!response.ok) {
            console.error("Error loading sidebar:", response.status);
            return;
        }

        container.innerHTML = await response.text();

        const authData = await initializeSupabaseAuth();

        if (!authData?.user) {
            return;
        }

        applySidebarPermissions();
        setActiveSidebarItem();
        initializeSidebarActions();
    }

    function initializeSidebarActions() {
        const logoutButton = document.getElementById("logout-button");

        if (!logoutButton) {
            return;
        }

        logoutButton.addEventListener("click", async () => {
            logoutButton.disabled = true;

            const success = await signOutUser();

            if (success) {
                window.location.href = "/auth/";
                return;
            }

            logoutButton.disabled = false;
        });
    }

    function hasViewPermission(modules) {
        if (isAdmin()) {
            return true;
        }

        return currentUserPermissions.some(permission => {
            return modules.includes(permission.module) &&
                permission.action.toLowerCase() === "view";
        });
    }

    function applySidebarPermissions() {
        const permissionMap = {
            "Documents": ["SOP", "Layout", "TI", "MDR"],
            "SOP": ["SOP"],
            "Losstime": ["Losstime"],
            "Efficiency": ["Efficiency"],
            "Scrap": ["Scrap"],
            "Production": ["Production"],
            "New Models": ["New Models", "PFMEA"]
        };

        const sidebarLinks = document.querySelectorAll(".sidebar-menu a");

        sidebarLinks.forEach(link => {
            const page = link.dataset.page;

            if (!permissionMap[page]) {
                return;
            }

            const allowed = hasViewPermission(permissionMap[page]);

            if (!allowed) {
                link.remove();
            }
        });
    }

    function setActiveSidebarItem() {
        const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
        const sidebarLinks = document.querySelectorAll(".sidebar-menu a, .sidebar-footer a");

        sidebarLinks.forEach(link => {
            const linkUrl = new URL(link.href, window.location.origin);
            const linkPath = linkUrl.pathname.replace(/\/+$/, "") || "/";

            if (linkPath === currentPath || (linkPath !== "/" && currentPath.startsWith(`${linkPath}/`))) {
                link.classList.add("active");
            }
        });
    }

    loadSidebar();
})();
