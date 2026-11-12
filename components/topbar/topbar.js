(() => {
    async function loadTopbar() {
        const container = document.getElementById("topbar-container");
        
        if (!container) {
            return;
        }

        const response = await fetch("/components/topbar/topbar.html");

        if (!response.ok) {
            console.error("Error loading topbar:", response.status);
            return;
        }

        container.innerHTML = await response.text();
        initializeSidebarToggle();
        
        const pageName = document.body.dataset.page;
        const pageTitle = document.getElementById("page-title");
        const descriptionElement = document.getElementById("page-description");
        
        if (pageTitle) {
            pageTitle.textContent =
                document.body.dataset.pageTitle ?? pageName ?? "";
        }
        
        if (descriptionElement) {
            descriptionElement.textContent =
                document.body.dataset.pageDescription ?? "";
        }
        
        updateBreadcrumb();
        

        const authData = await initializeSupabaseAuth();

        if (!authData?.user || !authData.profile || !authData.roleData) {
            return;
        }

        const userNameElement = document.getElementById("current-user-name");
        const roleElement = document.getElementById("current-user-role");

        if (userNameElement) {
            userNameElement.textContent = authData.profile.full_name ?? "";
        }

        if (roleElement) {
            roleElement.textContent = authData.roleData.name ?? "";
        }
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/components/topbar/topbar.css";
    document.head.appendChild(link);

    function initializeSidebarToggle() {
        const toggle = document.getElementById("sidebar-toggle");
    
        if (!toggle) return;
    
        toggle.addEventListener("click", () => {
            const isOpen = document.body.classList.toggle("sidebar-open");
    
            toggle.setAttribute("aria-expanded", String(isOpen));
            toggle.setAttribute(
                "aria-label",
                isOpen ? "Cerrar menú" : "Abrir menú"
            );
        });
    }

    function updateBreadcrumb() {
        const breadcrumb = document.getElementById("breadcrumb");
    
        if (!breadcrumb) return;
    
        const path = window.location.pathname
            .replace(/\/+$/, "")
            .split("/")
            .filter(Boolean);
    
        const routes = {
            "main": "Management Center",
            "production": "Production",
            "efficiency": "Efficiency",
            "losstime": "Loss Time",
            "scrap": "Scrap",
            "engineering": "Engineering",
            "new_models": "NPI",
            "settings": "Settings"
        };
        
        const items = [];
        let currentPath = "";
        
        path.forEach((segment, index) => {
            currentPath += `/${segment}`;
        
            const label = routes[segment] ??
                segment.replace(/_/g, " ");
        
            items.push({
                label,
                href: index === 0 && segment === "main"
                    ? "/"
                    : `${currentPath}/`
            });
        });
    
        breadcrumb.replaceChildren();
    
        items.forEach((item, index) => {
            const separator = document.createElement("span");
            separator.className = "separator";
            separator.textContent = ">";
    
            const link = document.createElement("a");
            link.href = item.href;
            link.textContent = item.label;
    
            if (index > 0) {
                breadcrumb.appendChild(separator);
            }
    
            if (index === items.length - 1) {
                const current = document.createElement("span");
                current.className = "current";
                current.textContent = item.label;
                current.setAttribute("aria-current", "page");
                breadcrumb.appendChild(current);
            } else {
                breadcrumb.appendChild(link);
            }
        });
    }

    loadTopbar();
})();