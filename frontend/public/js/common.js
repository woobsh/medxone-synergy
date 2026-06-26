// MEDXONE SYNERGY — shared helpers (pure JS, no frameworks).

// Backend URL (configured at build time via env if available; falls back to same origin /api)
window.MEDXONE = window.MEDXONE || {};
// All pages are served through the same Kubernetes ingress; /api/* routes
// to the FastAPI backend automatically, so relative URLs work everywhere.
window.MEDXONE.API = "/api";

window.MEDXONE.TOKEN_KEY = "medxone_token";

// Admin pages use sessionStorage so the token is auto-cleared when the
// browser tab / window is closed.  Public pages still read from
// localStorage for backwards compat (won't find a token anyway).
window.MEDXONE._isAdminPage = (window.location.pathname.indexOf("admin") !== -1);

window.MEDXONE.getToken = function () {
    try {
        if (window.MEDXONE._isAdminPage) {
            return sessionStorage.getItem(window.MEDXONE.TOKEN_KEY) || "";
        }
        return sessionStorage.getItem(window.MEDXONE.TOKEN_KEY) ||
               localStorage.getItem(window.MEDXONE.TOKEN_KEY) || "";
    } catch (e) {
        return "";
    }
};
window.MEDXONE.setToken = function (t) {
    sessionStorage.setItem(window.MEDXONE.TOKEN_KEY, t || "");
    // Also remove any legacy localStorage token
    try { localStorage.removeItem(window.MEDXONE.TOKEN_KEY); } catch (e) {}
};
window.MEDXONE.clearToken = function () {
    sessionStorage.removeItem(window.MEDXONE.TOKEN_KEY);
    try { localStorage.removeItem(window.MEDXONE.TOKEN_KEY); } catch (e) {}
};

// ---------------------------------------------------------------------------
// Real-time polling helper — fetches data on an interval and calls back only
// when the response payload differs from the last seen value.
// Returns a stop() function to cancel the interval.
// ---------------------------------------------------------------------------
window.MEDXONE.poll = function (path, intervalMs, onChange) {
    var lastHash = "";
    var running = true;

    function fingerprint(data) {
        try { return JSON.stringify(data); } catch (e) { return ""; }
    }

    async function tick() {
        if (!running) return;
        try {
            var data = await window.MEDXONE.api(path, { auth: false });
            var hash = fingerprint(data);
            if (hash !== lastHash) {
                lastHash = hash;
                onChange(data);
            }
        } catch (e) {
            // Silently ignore poll errors (API may be temporarily down)
        }
    }

    var id = setInterval(tick, intervalMs);

    return function stop() {
        running = false;
        clearInterval(id);
    };
};

window.MEDXONE.api = async function (path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (!(opts.body instanceof FormData) && opts.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }
    if (opts.auth !== false) {
        var t = window.MEDXONE.getToken();
        if (t) headers["Authorization"] = "Bearer " + t;
    }
    var resp = await fetch(window.MEDXONE.API + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body
            ? (opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body))
            : undefined,
    });
    var text = await resp.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!resp.ok) {
        var detail = (data && data.detail) || resp.statusText || "Request failed";
        if (Array.isArray(detail)) detail = detail.map(d => d.msg || JSON.stringify(d)).join(" ");
        throw new Error(detail);
    }
    return data;
};

window.MEDXONE.toast = function (msg, type) {
    var el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.setAttribute("data-testid", "toast");
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () {
        el.classList.remove("show");
        setTimeout(function () { el.remove(); }, 300);
    }, 3000);
};

window.MEDXONE.absoluteImageUrl = function (url) {
    if (!url) return "";
    return url; // /api/files/... resolves via ingress; absolute URLs pass through.
};

window.MEDXONE.qs = function (name) {
    var p = new URLSearchParams(window.location.search);
    return p.get(name) || "";
};

window.MEDXONE.escapeHtml = function (s) {
    if (s == null) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

// Mobile nav toggle (shared across pages)
window.MEDXONE.initHeader = function () {
    var btn = document.querySelector('[data-testid="mobile-menu-toggle"]');
    var nav = document.querySelector(".nav-links");
    if (btn && nav) {
        btn.addEventListener("click", function () {
            nav.classList.toggle("open");
        });
    }
    // Highlight active link based on pathname
    var p = window.location.pathname;
    document.querySelectorAll(".nav-links a").forEach(function (a) {
        var href = a.getAttribute("href") || "";
        if (
            (href === "/" && (p === "/" || p === "/index.html")) ||
            (href !== "/" && p.indexOf(href) === 0)
        ) {
            a.classList.add("active");
        }
    });
};
