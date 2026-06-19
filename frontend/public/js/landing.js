(function () {
    document.addEventListener("DOMContentLoaded", function () {
        window.MEDXONE.initHeader();
        document.getElementById("footerYear").textContent = new Date().getFullYear();
        loadCategories();
        loadFeaturedProducts();
        wireInquiryForm();
        if (window.lucide) window.lucide.createIcons();
    });

    var CATEGORY_ICONS = {
        "Diagnostic Equipment": "stethoscope",
        "Surgical Instruments": "scissors",
        "Patient Monitoring": "activity",
        "Laboratory Equipment": "flask-conical",
        "Imaging Systems": "scan",
    };

    async function loadCategories() {
        var grid = document.getElementById("categoryGrid");
        try {
            var cats = await window.MEDXONE.api("/categories", { auth: false });
            if (!cats || !cats.length) {
                grid.innerHTML = '<div class="empty-state">No categories yet.</div>';
                return;
            }
            grid.innerHTML = cats
                .map(function (c) {
                    var icon = CATEGORY_ICONS[c.name] || "package";
                    return (
                        '<a class="category-card" href="/catalog.html?category=' +
                        encodeURIComponent(c.id) +
                        '" data-testid="category-card-' + window.MEDXONE.escapeHtml(c.name) + '">' +
                        '<span class="category-icon"><i data-lucide="' + icon + '" width="22" height="22"></i></span>' +
                        '<h3>' + window.MEDXONE.escapeHtml(c.name) + '</h3>' +
                        '<p>' + window.MEDXONE.escapeHtml(c.description || "Explore devices in this category.") + '</p>' +
                        '</a>'
                    );
                })
                .join("");
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            grid.innerHTML = '<div class="empty-state">Could not load categories.</div>';
        }
    }

    async function loadFeaturedProducts() {
        var grid = document.getElementById("featuredGrid");
        try {
            var products = await window.MEDXONE.api("/products", { auth: false });
            var featured = (products || []).slice(0, 6);
            if (!featured.length) {
                grid.innerHTML = '<div class="empty-state">No products available yet.</div>';
                return;
            }
            grid.innerHTML = featured.map(renderProductCard).join("");
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            grid.innerHTML = '<div class="empty-state">Could not load products.</div>';
        }
    }

    function renderProductCard(p) {
        var img = window.MEDXONE.absoluteImageUrl(p.image_url) ||
            'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=900&auto=format&fit=crop';
        return (
            '<article class="product-card" data-testid="product-card-' + p.id + '">' +
            '<div class="product-thumb"><img src="' + window.MEDXONE.escapeHtml(img) + '" alt="' + window.MEDXONE.escapeHtml(p.name) + '" loading="lazy" /></div>' +
            '<div class="product-body">' +
            '<span class="product-cat">' + window.MEDXONE.escapeHtml(p.category_name || "Medical") + '</span>' +
            '<h3>' + window.MEDXONE.escapeHtml(p.name) + '</h3>' +
            '<p class="product-desc">' + window.MEDXONE.escapeHtml(p.short_description || "") + '</p>' +
            '<div class="product-actions">' +
            '<a class="btn btn-primary btn-sm" href="/product.html?id=' + encodeURIComponent(p.id) + '" data-testid="view-product-' + p.id + '">View Details</a>' +
            '</div>' +
            '</div>' +
            '</article>'
        );
    }

    function wireInquiryForm() {
        var form = document.getElementById("inquiryForm");
        var alertBox = document.getElementById("inquiryAlert");
        if (!form) return;
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            alertBox.innerHTML = "";
            var btn = form.querySelector("button[type=submit]");
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Sending…';
            try {
                var payload = {
                    name: document.getElementById("inqName").value.trim(),
                    email: document.getElementById("inqEmail").value.trim(),
                    phone: document.getElementById("inqPhone").value.trim(),
                    message:
                        (document.getElementById("inqOrg").value.trim()
                            ? "Organisation: " + document.getElementById("inqOrg").value.trim() + "\n\n"
                            : "") + document.getElementById("inqMessage").value.trim(),
                    inquiry_type: "general",
                };
                await window.MEDXONE.api("/inquiries", { method: "POST", body: payload, auth: false });
                alertBox.innerHTML = '<div class="alert alert-success" data-testid="inquiry-success">Thanks! We\'ll be in touch shortly.</div>';
                form.reset();
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="inquiry-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="send" width="18" height="18"></i> Send inquiry';
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }
})();
