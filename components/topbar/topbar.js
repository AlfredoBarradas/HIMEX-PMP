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

        const pageName = document.body.dataset.page;
        const pageTitle = document.getElementById("page-title");

        if (pageTitle) {
            pageTitle.textContent = document.body.dataset.pageTitle ?? pageName ?? "";
            const pageDescription = document.body.dataset.pageDescription;
            let descriptionElement = document.getElementById("page-description");
            if (pageDescription) {
                if (!descriptionElement) {
                    descriptionElement = document.createElement("p");
                    descriptionElement.id = "page-description";
                    pageTitle.insertAdjacentElement("afterend", descriptionElement);
                }
                descriptionElement.textContent = pageDescription;
            } else if (descriptionElement) {
                descriptionElement.remove();
            }
        }

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

    loadTopbar();
})();