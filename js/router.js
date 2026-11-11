(() => {
    const routes = window.PMP_PAGE_REGISTRY || {};
    const loadedScripts = new Map();
    let activeModules = [];
    let navigationPending = false;

    function normalizePath(pathname) {
        if (!pathname || pathname === "/") return "/";
        return pathname.replace(/\/+$/, "") + "/";
    }

    function getRoute(pathname) {
        return routes[normalizePath(pathname)] || null;
    }

    function setBodyMetadata(sourceBody, route) {
        const keys = ["page", "pageTitle", "pageDescription", "adminOnly", "requiredModules"];
        keys.forEach(key => {
            if (sourceBody?.dataset?.[key] !== undefined) {
                document.body.dataset[key] = sourceBody.dataset[key];
            } else {
                delete document.body.dataset[key];
            }
        });

        if (route.page) document.body.dataset.page = route.page;
        if (route.title) document.body.dataset.pageTitle = route.title;
        if (route.description) document.body.dataset.pageDescription = route.description;
        if (route.adminOnly) document.body.dataset.adminOnly = "true";
    }

    async function authorize(route, pathname) {
        const result = await authorizePage({
            path: pathname,
            page: route.page,
            modules: route.modules || [],
            adminOnly: Boolean(route.adminOnly)
        });

        if (!result.allowed) {
            window.location.replace(result.redirect || "/auth/");
            return false;
        }
        return true;
    }

    async function initializeShell() {
        await Promise.all([
            window.PMPSidebar?.init?.(),
            window.PMPTopbar?.init?.()
        ]);
    }

    function updateShell(route) {
        window.PMPTopbar?.update?.({
            title: route.title || document.body.dataset.pageTitle || document.body.dataset.page,
            description: route.description || document.body.dataset.pageDescription || ""
        });
        window.PMPSidebar?.update?.(window.location.pathname);
        document.title = route.title || document.title;
    }

    function setRouteStyles(styles = []) {
        const active = new Set(styles);
        document.querySelectorAll('link[data-pmp-route-style]').forEach(link => {
            link.disabled = !active.has(link.getAttribute("href"));
        });

        styles.forEach(href => {
            let link = document.querySelector('link[data-pmp-route-style][href="' + href + '"]');
            if (!link) {
                link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = href;
                link.dataset.pmpRouteStyle = "true";
                document.head.appendChild(link);
            }
            link.disabled = false;
        });
    }

    function loadScript(src) {
        if (loadedScripts.has(src)) return loadedScripts.get(src);

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = false;
            script.onload = resolve;
            script.onerror = () => {
                loadedScripts.delete(src);
                reject(new Error("Unable to load page script: " + src));
            };
            document.body.appendChild(script);
        });

        loadedScripts.set(src, promise);
        return promise;
    }

    async function loadScripts(scripts = []) {
        for (const src of scripts) await loadScript(src);
    }

    async function unmountActiveModules() {
        for (const name of [...activeModules].reverse()) {
            try {
                await window.PMPModules?.[name]?.unmount?.();
            } catch (error) {
                console.error("Error unmounting page module:", name, error);
            }
        }
        activeModules = [];
    }

    async function mountModules(names = []) {
        for (const name of names) {
            const module = window.PMPModules?.[name];
            if (!module?.mount) {
                throw new Error("Page module is not registered: " + name);
            }
            await module.mount();
            activeModules.push(name);
        }
    }

    function getOverlayContainer() {
        let target = document.getElementById("page-overlays");
        if (!target) {
            target = document.createElement("div");
            target.id = "page-overlays";
            document.body.appendChild(target);
        }
        return target;
    }

    function moveInitialOverlays() {
        const content = document.getElementById("page-content");
        const target = getOverlayContainer();
        const candidates = [...document.body.querySelectorAll(".modal, [id$='-modal']")]
            .filter(element => !content?.contains(element) && !target.contains(element));
        const topLevel = candidates.filter(element =>
            !candidates.some(other => other !== element && other.contains(element))
        );
        topLevel.forEach(element => target.appendChild(element));
    }

    function replacePageOverlays(sourceDocument, sourceContent) {
        const target = getOverlayContainer();
        target.replaceChildren();
        const candidates = [...sourceDocument.body.querySelectorAll(".modal, [id$='-modal']")]
            .filter(element => !sourceContent.contains(element));

        const topLevel = candidates.filter(element =>
            !candidates.some(other => other !== element && other.contains(element))
        );

        topLevel.forEach(element => target.appendChild(element.cloneNode(true)));
    }

    function updatePageContent(sourceDocument) {
        const sourceContent = sourceDocument.getElementById("page-content");
        const targetContent = document.getElementById("page-content");

        if (!sourceContent || !targetContent) {
            throw new Error("The requested page does not contain #page-content.");
        }

        targetContent.innerHTML = sourceContent.innerHTML;
        replacePageOverlays(sourceDocument, sourceContent);
        setBodyMetadata(sourceDocument.body, getRoute(sourceDocument.location?.pathname || window.location.pathname) || {});
        return sourceContent;
    }

    async function renderFetchedPage(sourceDocument, route, pathname) {
        const sourceContent = sourceDocument.getElementById("page-content");
        const targetContent = document.getElementById("page-content");
        if (!sourceContent || !targetContent) {
            throw new Error("The requested page does not contain #page-content.");
        }

        await unmountActiveModules();
        targetContent.innerHTML = sourceContent.innerHTML;
        replacePageOverlays(sourceDocument, sourceContent);
        setBodyMetadata(sourceDocument.body, route);
        setRouteStyles(route.styles);
        await loadScripts(route.scripts);
        await mountModules(route.mount);
        updateShell(route);
        document.body.classList.remove("auth-pending");
    }

    async function navigate(url, options = {}) {
        const push = options.push !== false;
        const targetUrl = new URL(url, window.location.origin);
        if (targetUrl.origin !== window.location.origin) return;
        const pathname = normalizePath(targetUrl.pathname);
        targetUrl.pathname = pathname;
        const route = getRoute(pathname);
        if (!route) {
            window.location.assign(targetUrl.href);
            return;
        }
        if (navigationPending) return;
        navigationPending = true;

        try {
            const response = await fetch(targetUrl.href, {
                headers: { "X-PMP-Navigation": "spa" }
            });
            if (!response.ok) throw new Error("Page request failed with status " + response.status);

            const html = await response.text();
            const sourceDocument = new DOMParser().parseFromString(html, "text/html");

            if (!await authorize(route, pathname)) return;

            if (push) {
                history.pushState({ path: pathname }, "", targetUrl.href);
            }

            await renderFetchedPage(sourceDocument, route, pathname);
        } catch (error) {
            console.error("SPA navigation failed:", error);
            const content = document.getElementById("page-content");
            if (content) {
                content.innerHTML = '<section class="content"><h2>Unable to load this page</h2><p>Check the browser console and try again.</p></section>';
            }
        } finally {
            navigationPending = false;
        }
    }

    async function start() {
        const pathname = normalizePath(window.location.pathname);
        const route = getRoute(pathname);

        if (!route) {
            const result = await authorizePage();
            if (!result?.allowed) {
                window.location.replace(result?.redirect || "/auth/");
                return;
            }
            await initializeShell();
            document.body.classList.remove("auth-pending");
            return;
        }

        if (!await authorize(route, pathname)) return;

        try {
            moveInitialOverlays();
            await initializeShell();
            setRouteStyles(route.styles);
            await loadScripts(route.scripts);
            await mountModules(route.mount);
            updateShell(route);
            document.body.classList.remove("auth-pending");
        } catch (error) {
            console.error("SPA initialization failed:", error);
            const content = document.getElementById("page-content");
            if (content) {
                content.innerHTML = '<section class="content"><h2>Unable to initialize this page</h2><p>Check the browser console and try again.</p></section>';
            }
        }
    }

    document.addEventListener("click", event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target.closest("a[href]");
        if (!anchor || anchor.target || anchor.hasAttribute("download") || anchor.getAttribute("href").startsWith("#")) return;

        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin || !getRoute(url.pathname)) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return;

        event.preventDefault();
        navigate(url.href, { push: true });
    });

    window.addEventListener("popstate", () => {
        navigate(window.location.href, { push: false });
    });

    document.addEventListener("DOMContentLoaded", () => {
        navigationPending = true;
        start().finally(() => { navigationPending = false; });
    }, { once: true });
})();