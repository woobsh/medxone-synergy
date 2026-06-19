// MEDXONE SYNERGY — shared helpers (pure JS, no frameworks).

// Backend URL (configured at build time via env if available; falls back to same origin /api)
window.MEDXONE = window.MEDXONE || {};
// All pages are served through the same Kubernetes ingress; /api/* routes
// to the FastAPI backend automatically, so relative URLs work everywhere.
window.MEDXONE.API = "/api";

window.MEDXONE.TOKEN_KEY = "medxone_token";

window.MEDXONE.getToken = function () {
    try {
        return localStorage.getItem(window.MEDXONE.TOKEN_KEY) || "";
    } catch (e) {
        return "";
    }
};
window.MEDXONE.setToken = function (t) {
    localStorage.setItem(window.MEDXONE.TOKEN_KEY, t || "");
};
window.MEDXONE.clearToken = function () {
    localStorage.removeItem(window.MEDXONE.TOKEN_KEY);
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
