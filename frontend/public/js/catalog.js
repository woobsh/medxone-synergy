(function () {
    var POLL_INTERVAL = 10000; // 10 seconds
    var state = { categories: [], allProducts: [], categoryId: "", query: "" };

    document.addEventListener("DOMContentLoaded", function () {
        window.MEDXONE.initHeader();
        document.getElementById("footerYear").textContent = new Date().getFullYear();
        state.categoryId = window.MEDXONE.qs("category") || "";
        wireSearch();
        Promise.all([loadCategories(), loadProducts()]).then(render);
        if (window.lucide) window.lucide.createIcons();

        // Real-time polling — auto-update categories & products
        window.MEDXONE.poll("/categories", POLL_INTERVAL, function (cats) {
            state.categories = cats || [];
            renderChips();
            if (window.lucide) window.lucide.createIcons();
        });
        window.MEDXONE.poll("/products", POLL_INTERVAL, function (products) {
            state.allProducts = products || [];
            renderProducts();
            if (window.lucide) window.lucide.createIcons();
        });
    });

    async function loadCategories() {
        try {
            state.categories = await window.MEDXONE.api("/categories", { auth: false });
        } catch (e) {
            state.categories = [];
        }
    }

    async function loadProducts() {
        try {
            state.allProducts = await window.MEDXONE.api("/products", { auth: false });
        } catch (e) {
            state.allProducts = [];
        }
    }

    function render() {
        renderChips();
        renderProducts();
        if (window.lucide) window.lucide.createIcons();
    }

    function renderChips() {
        var chips = document.getElementById("categoryChips");
        var html = ['<button class="chip ' + (state.categoryId ? "" : "active") + '" data-cat="" data-testid="chip-all">All categories</button>'];
        state.categories.forEach(function (c) {
            html.push(
                '<button class="chip ' + (state.categoryId === c.id ? "active" : "") +
                '" data-cat="' + c.id + '" data-testid="chip-' + window.MEDXONE.escapeHtml(c.name) + '">' +
                window.MEDXONE.escapeHtml(c.name) + '</button>'
            );
        });
        chips.innerHTML = html.join("");
        chips.querySelectorAll(".chip").forEach(function (btn) {
            btn.addEventListener("click", function () {
                state.categoryId = btn.getAttribute("data-cat") || "";
                var url = new URL(window.location);
                if (state.categoryId) url.searchParams.set("category", state.categoryId);
                else url.searchParams.delete("category");
                window.history.replaceState({}, "", url);
                render();
            });
        });
    }

    function renderProducts() {
        var grid = document.getElementById("productGrid");
        var filtered = state.allProducts.filter(function (p) {
            if (state.categoryId && p.category_id !== state.categoryId) return false;
            if (state.query) {
                var hay = ((p.name || "") + " " + (p.short_description || "") + " " + (p.description || "") + " " + (p.specifications || "")).toLowerCase();
                if (hay.indexOf(state.query.toLowerCase()) === -1) return false;
            }
            return true;
        });
        if (!filtered.length) {
            grid.innerHTML = '<div class="empty-state" data-testid="empty-products">No products match your filters yet.</div>';
            return;
        }
        grid.innerHTML = filtered.map(card).join("");
        if (window.lucide) window.lucide.createIcons();
    }

    function card(p) {
        var img = window.MEDXONE.absoluteImageUrl(p.image_url);
        var thumbContent = img
            ? '<img src="' + window.MEDXONE.escapeHtml(img) + '" alt="' + window.MEDXONE.escapeHtml(p.name) + '" loading="lazy" />'
            : '<div class="no-image-placeholder" data-testid="no-image-placeholder"><i data-lucide="image-off" width="32" height="32"></i><span>No image available</span></div>';
        return (
            '<article class="product-card" data-testid="product-card-' + p.id + '">' +
            '<div class="product-thumb">' + thumbContent + '</div>' +
            '<div class="product-body">' +
            '<span class="product-cat">' + window.MEDXONE.escapeHtml(p.category_name || "Medical") + '</span>' +
            '<h3>' + window.MEDXONE.escapeHtml(p.name) + '</h3>' +
            '<p class="product-desc">' + window.MEDXONE.escapeHtml(p.short_description || "") + '</p>' +
            '<div class="product-actions">' +
            '<a class="btn btn-primary btn-sm" href="/product.html?id=' + encodeURIComponent(p.id) + '" data-testid="view-product-' + p.id + '">View Details</a>' +
            (p.contact_phone ? '<a class="btn btn-outline btn-sm" href="tel:' + window.MEDXONE.escapeHtml(p.contact_phone) + '" data-testid="call-product-' + p.id + '"><i data-lucide="phone" width="14" height="14"></i></a>' : '') +
            '</div>' +
            '</div>' +
            '</article>'
        );
    }

    function wireSearch() {
        var input = document.getElementById("searchInput");
        var t = null;
        input.addEventListener("input", function () {
            clearTimeout(t);
            t = setTimeout(function () {
                state.query = input.value.trim();
                renderProducts();
            }, 180);
        });
    }
})();
