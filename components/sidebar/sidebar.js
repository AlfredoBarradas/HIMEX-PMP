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
        initializeSidebarDismissal();

        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/components/sidebar/sidebar.css";
        document.head.appendChild(link);

        const authData = await initializeSupabaseAuth();

        if (!authData?.user) {
            return;
        }

        applySidebarPermissions();
        setActiveSidebarItem();
        initializeSidebarActions();
    }
    
    function initializeSidebarDismissal() {
        const overlay = document.getElementById("sidebar-overlay");
    
        // Cerrar al hacer clic fuera del menú
        overlay?.addEventListener("click", closeSidebar);
    
        // Cerrar con Escape
        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeSidebar();
            }
        });
    
        // Cerrar al navegar a otra página
        document.querySelectorAll(
            ".sidebar-menu a, .sidebar-footer a"
        ).forEach(link => {
            if (link.getAttribute("href") !== "#") {
                link.addEventListener("click", closeSidebar);
            }
        });
    }
    
    function closeSidebar() {
        document.body.classList.remove("sidebar-open");
    
        const toggle = document.getElementById("sidebar-toggle");
    
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", "Abrir menú");
        }
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
