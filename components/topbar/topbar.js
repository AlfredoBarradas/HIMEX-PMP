(() => {
    async function initTopbar() {
        const container = document.getElementById("topbar-container");
        if (!container) return;
        if (!container.querySelector(".topbar")) {
            const response = await fetch("/components/topbar/topbar.html");
            if (!response.ok) throw new Error("Unable to load topbar");
            container.innerHTML = await response.text();
        }
        updateTopbar();
        const authData = await initializeSupabaseAuth();
        if (authData?.profile) document.getElementById("current-user-name").textContent = authData.profile.full_name || "";
        if (authData?.roleData) document.getElementById("current-user-role").textContent = authData.roleData.name || "";
    }
    function updateTopbar(config = {}) {
        const title = document.getElementById("page-title");
        if (title) title.textContent = config.title || document.body.dataset.pageTitle || document.body.dataset.page || "";
        const description = config.description ?? document.body.dataset.pageDescription ?? "";
        let node = document.getElementById("page-description");
        if (description && title) {
            if (!node) { node = document.createElement("p"); node.id = "page-description"; title.insertAdjacentElement("afterend", node); }
            node.textContent = description;
        } else node?.remove();
    }
    window.PMPTopbar = { init: initTopbar, update: updateTopbar };
})();
