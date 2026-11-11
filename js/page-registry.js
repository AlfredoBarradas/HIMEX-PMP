(() => {
    const routes = {
        "/": {
            page: "Home",
            title: "PMP Management Center",
            modules: [],
            mount: [],
            styles: [],
            scripts: []
        },
        "/engineering/": {
            page: "engPage",
            title: "PMP Engineering",
            modules: ["Layout", "MDR", "SOP", "TI"],
            mount: [],
            styles: [],
            scripts: []
        },
        "/engineering/sop/": {
            page: "sopPage",
            title: "PMP SOP Management",
            modules: ["SOP"],
            mount: ["SOP", "SOPWorkflow"],
            styles: ["/engineering/sop/sop.css"],
            scripts: ["/engineering/sop/workflow.js", "/engineering/sop/sop.js"]
        },
        "/settings/": {
            page: "Settings",
            title: "PMP Settings",
            adminOnly: true,
            modules: [],
            mount: [],
            styles: ["/settings/settings.css"],
            scripts: []
        },
        "/settings/users/": {
            page: "Users",
            title: "PMP Users",
            adminOnly: true,
            modules: [],
            mount: ["Users"],
            styles: ["/settings/users/users.css"],
            scripts: ["/settings/users/users.js"]
        },
        "/settings/roles/": {
            page: "Roles",
            title: "PMP Roles",
            adminOnly: true,
            modules: [],
            mount: ["Roles"],
            styles: ["/settings/roles/roles.css"],
            scripts: ["/settings/roles/roles.js"]
        }
    };

    window.PMP_PAGE_REGISTRY = Object.freeze(routes);
})();