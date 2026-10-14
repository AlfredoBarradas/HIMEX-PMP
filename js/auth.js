const PAGE_MODULES = {
    "Production": ["Production"],
    "Efficiency": ["Efficiency"],
    "Losstime": ["Losstime"],
    "Scrap": ["Scrap"],
    

    "Engineering": ["SOP", "Layout", "TI", "MDR"],
    
    "New Models": ["New Models", "PFMEA"],
};
let authGuardPromise = null;
function getRequiredModules() {
    const configuredModules = document.body.dataset.requiredModules;
    if (configuredModules) {
        return configuredModules.split(",").map(module => module.trim()).filter(Boolean);
    }
    return PAGE_MODULES[document.body.dataset.page] ?? [];
}
function redirectTo(path) {
    window.location.replace(path);
    return null;
}

async function requireAuth() {
    if (authGuardPromise) return authGuardPromise;

    authGuardPromise = (async () => {
        try {
            // 1. Initialize authentication
            const authData = await initializeSupabaseAuth();

            const path = window.location.pathname;
            const isChangePasswordPage = path.startsWith(
                "/auth/change-password"
            );

            // 2. Require an authenticated user
            if (!authData?.user) {
                return redirectTo("/auth/");
            }

            // 3. Validate profile and role
            if (!authData.profile || !authData.roleData) {
                console.error(
                    "Authenticated user has no valid profile or role."
                );

                await signOutUser();
                return redirectTo("/auth/");
            }

            // 4. Validate account and role status
            if (
                !authData.profile.active ||
                !authData.roleData.active
            ) {
                console.error(
                    "User account or role is inactive."
                );

                await signOutUser();
                return redirectTo("/auth/");
            }

            // 5. Enforce password change
            if (
                authData.profile.must_change_password &&
                !isChangePasswordPage
            ) {
                return redirectTo("/auth/change-password/");
            }

            if (
                !authData.profile.must_change_password &&
                isChangePasswordPage
            ) {
                return redirectTo("/");
            }

            // 6. Identify administrator
            const admin = isAdmin();

            // 7. Identify administrator-only pages
            const adminOnly =
                document.body.dataset.adminOnly === "true" ||
                path.startsWith("/settings/users") ||
                path.startsWith("/settings/roles");

            if (adminOnly && !admin) {
                return redirectTo("/");
            }

            // 8. Resolve the page access policy
            const requiredModules = getRequiredModules();
            const pageName = document.body.dataset.page;

            // 9. Require a configured policy for regular users.
            // Administrators can access pages without a module policy.
            if (
                !admin &&
                !adminOnly &&
                !isChangePasswordPage &&
                pageName !== "Home" &&
                !requiredModules.length
            ) {
                console.error(
                    "No access policy configured for page:",
                    pageName
                );

                return redirectTo("/");
            }

            // 10. Validate module view permissions for regular users.
            // Administrators bypass this permission check.
            if (
                !admin &&
                !adminOnly &&
                !isChangePasswordPage &&
                pageName !== "Home" &&
                requiredModules.length
            ) {
                const canViewPage =
                    currentUserPermissions.some(permission =>
                        requiredModules.includes(permission.module) &&
                        String(permission.action).toLowerCase() === "view"
                    );

                if (!canViewPage) {
                    return redirectTo("/");
                }
            }

            // 11. Authentication and access validation successful
            return authData;

        } catch (error) {
            console.error(
                "Access validation failed:",
                error
            );

            return redirectTo("/auth/");
        }
    })();

    return authGuardPromise;
}

document.addEventListener("DOMContentLoaded", async () => {
    const authData = await requireAuth();
    if (authData && document.body.classList.contains("auth-pending") &&
        document.body.dataset.authDefer !== "true") {
        document.body.classList.remove("auth-pending");
    }
});