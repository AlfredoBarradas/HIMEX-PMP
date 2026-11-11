const PAGE_MODULES = {
    engPage: ["Layout", "MDR", "SOP", "TI"],
    partinfo: ["SOP"],
    partsPage: ["SOP"],
    drawsPage: ["SOP"],
    sopPage: ["SOP"],
    layoutPage: ["Layout"],
    mdrPage: ["MDR"],
    techPage: ["TI"],
    flowPage: ["SOP"],
    procPage: ["SOP"]
};

function getRequiredModules(config = {}) {
    if (Array.isArray(config.modules)) return config.modules;
    const key = config.page || document.body.dataset.page;
    const configured = document.body.dataset.requiredModules;
    return configured ? configured.split(",").map(item => item.trim()).filter(Boolean) : (PAGE_MODULES[key] || []);
}

function redirectTo(path) { window.location.replace(path); return null; }

async function authorizePage(config = {}) {
    try {
        const authData = await initializeSupabaseAuth();
        const path = config.path || window.location.pathname;
        const isChangePasswordPage = path.startsWith("/auth/change-password");
        if (!authData?.user) return { allowed: false, redirect: "/auth/" };
        if (!authData.profile || !authData.roleData) {
            await signOutUser();
            return { allowed: false, redirect: "/auth/" };
        }
        if (!authData.profile.active || !authData.roleData.active) {
            await signOutUser();
            return { allowed: false, redirect: "/auth/" };
        }
        if (authData.profile.must_change_password && !isChangePasswordPage) {
            return { allowed: false, redirect: "/auth/change-password/" };
        }
        if (!authData.profile.must_change_password && isChangePasswordPage) {
            return { allowed: false, redirect: "/" };
        }
        const admin = isAdmin();
        const adminOnly = Boolean(config.adminOnly) || path.startsWith("/settings/users") || path.startsWith("/settings/roles");
        if (adminOnly && !admin) return { allowed: false, redirect: "/" };
        const pageName = config.page || document.body.dataset.page;
        const requiredModules = getRequiredModules(config);
        if (!admin && !adminOnly && !isChangePasswordPage && pageName && pageName !== "Home" && !requiredModules.length) {
            return { allowed: false, redirect: "/", reason: "Missing access policy" };
        }
        if (!admin && !adminOnly && requiredModules.length) {
            const canView = currentUserPermissions.some(permission =>
                requiredModules.includes(permission.module) &&
                String(permission.action).toLowerCase() === "view"
            );
            if (!canView) return { allowed: false, redirect: "/", reason: "Permission denied" };
        }
        return { allowed: true, authData };
    } catch (error) {
        console.error("Access validation failed:", error);
        return { allowed: false, redirect: "/auth/" };
    }
}

async function requireAuth() {
    const result = await authorizePage();
    if (!result.allowed) return redirectTo(result.redirect);
    return result.authData;
}

document.addEventListener("DOMContentLoaded", async () => {
    if (document.body.dataset.authDefer === "true") return;
    const result = await authorizePage();
    if (!result.allowed) { redirectTo(result.redirect); return; }
    document.body.classList.remove("auth-pending");
});
