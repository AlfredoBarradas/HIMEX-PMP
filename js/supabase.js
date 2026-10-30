const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

let currentUser = null;
let currentUserProfile = null;
let currentUserRole = null;
let currentUserPermissions = [];
let currentPermissionCodes = new Set();
let authContextPromise = null;

async function loadCurrentUserContext(user) {
    if (!user) {
        clearAuthContext();
        return null;
    }

    const { data: profile, error: profileError } = await supabaseClient
        .from("user_profiles")
        .select(`
            id,
            employee_number,
            full_name,
            role_id,
            active,
            must_change_password,
            roles (
                id,
                code,
                name,
                description,
                active
            )
        `)
        .eq("id", user.id)
        .single();

    if (profileError) {
        console.error("Error loading user profile:", profileError);
        clearAuthContext();
        return null;
    }

    const role = Array.isArray(profile.roles)
        ? profile.roles[0] ?? null
        : profile.roles;

    if (!role) {
        console.error("User has no assigned role.");
        clearAuthContext();
        return null;
    }

    let permissions = [];

    if (role.code === "admin") {
        const { data, error } = await supabaseClient
            .from("permissions")
            .select(`
                id,
                code,
                name,
                module,
                action,
                description
            `)
            .order("module")
            .order("action");

        if (error) {
            console.error("Error loading admin permissions:", error);
            clearAuthContext();
            return null;
        }

        permissions = data ?? [];
    } else if (profile.role_id) {
        const { data, error } = await supabaseClient
            .from("role_permissions")
            .select(`
                permission_id,
                permissions (
                    id,
                    code,
                    name,
                    module,
                    action,
                    description
                )
            `)
            .eq("role_id", profile.role_id);

        if (error) {
            console.error("Error loading role permissions:", error);
            clearAuthContext();
            return null;
        }

        permissions = (data ?? [])
            .map(row => row.permissions)
            .filter(Boolean);
    }

    currentUser = user;
    currentUserProfile = profile;
    currentUserRole = role;
    currentUserPermissions = permissions;
    currentPermissionCodes = new Set(
        permissions.map(permission => permission.code)
    );

    return {
        user: currentUser,
        profile: currentUserProfile,
        role: currentUserRole.name,
        roleCode: currentUserRole.code,
        roleData: currentUserRole,
        permissions: currentUserPermissions
    };
}

async function initializeSupabaseAuth() {
    if (authContextPromise) {
        return authContextPromise;
    }

    authContextPromise = (async () => {
        const { data, error } = await supabaseClient.auth.getSession();

        if (error) {
            console.error("Error getting session:", error);
            clearAuthContext();
            return null;
        }

        const user = data.session?.user ?? null;

        if (!user) {
            clearAuthContext();
            return null;
        }

        return await loadCurrentUserContext(user);
    })();

    const result = await authContextPromise;

    authContextPromise = null;

    return result;
}

function hasPermission(permissionCode) {
    if (!permissionCode) {
        return false;
    }

    if (currentUserRole?.code === "admin") {
        return true;
    }

    return currentPermissionCodes.has(permissionCode);
}

function isAdmin() {
    return currentUserRole?.code === "admin";
}

function clearAuthContext() {
    currentUser = null;
    currentUserProfile = null;
    currentUserRole = null;
    currentUserPermissions = [];
    currentPermissionCodes = new Set();
    authContextPromise = null;
}

async function signOutUser() {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        console.error("Logout error:", error);
        return false;
    }

    clearAuthContext();

    return true;
}

supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session?.user ?? null;

    if (!currentUser) {
        clearAuthContext();
    }
});