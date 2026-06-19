(function () {
    document.addEventListener("DOMContentLoaded", function () {
        window.MEDXONE.initHeader();
        document.getElementById("footerYear").textContent = new Date().getFullYear();
        loadProduct();
        if (window.lucide) window.lucide.createIcons();
    });

    async function loadProduct() {
        var id = window.MEDXONE.qs("id");
        var container = document.getElementById("productContainer");
        if (!id) {
            container.innerHTML = '<div class="empty-state">No product specified.</div>';
            return;
        }
        try {
            var p = await window.MEDXONE.api("/products/" + encodeURIComponent(id), { auth: false });
            document.title = p.name + " — MEDXONE SYNERGY";
            document.getElementById("crumbName").textContent = p.name;
            container.innerHTML = renderProduct(p);
            wireQuoteForm(p);
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            container.innerHTML = '<div class="empty-state" data-testid="product-not-found">Sorry, we couldn\'t find this product.</div>';
        }
    }

    function renderProduct(p) {
        var img = window.MEDXONE.absoluteImageUrl(p.image_url) ||
            'https://images.unsplash.com/photo-1516549655169-df83a0774514?w=1200&auto=format&fit=crop';
        var contactEmail = p.contact_email || "sales@medxone.com";
        var contactPhone = p.contact_phone || "+91 98765 43210";
        return (
            '<div class="product-detail" data-testid="product-detail">' +
            '<div>' +
            '<div class="product-detail-image">' +
            '<img src="' + window.MEDXONE.escapeHtml(img) + '" alt="' + window.MEDXONE.escapeHtml(p.name) + '" />' +
            '</div>' +
            '</div>' +
            '<div>' +
            '<span class="eyebrow" data-testid="detail-category">' + window.MEDXONE.escapeHtml(p.category_name || "Medical") + '</span>' +
            '<h1 style="font-size: clamp(1.75rem, 3.5vw, 2.6rem); margin: 0.4rem 0 0.8rem;" data-testid="detail-name">' + window.MEDXONE.escapeHtml(p.name) + '</h1>' +
            '<p class="text-muted" data-testid="detail-short">' + window.MEDXONE.escapeHtml(p.short_description || "") + '</p>' +

            (p.description ? '<h3 style="margin-top:1.5rem">Description</h3><p data-testid="detail-description">' + window.MEDXONE.escapeHtml(p.description) + '</p>' : '') +

            (p.specifications ? '<h3 style="margin-top:1.5rem">Specifications</h3><div class="spec-block" data-testid="detail-specs">' + window.MEDXONE.escapeHtml(p.specifications) + '</div>' : '') +

            '<h3 style="margin-top:1.5rem">Contact for this product</h3>' +
            '<div class="contact-pills">' +
            '<a class="contact-pill" href="tel:' + window.MEDXONE.escapeHtml(contactPhone) + '" data-testid="detail-call"><i data-lucide="phone" width="16" height="16"></i> ' + window.MEDXONE.escapeHtml(contactPhone) + '</a>' +
            '<a class="contact-pill" href="mailto:' + window.MEDXONE.escapeHtml(contactEmail) + '" data-testid="detail-mail"><i data-lucide="mail" width="16" height="16"></i> ' + window.MEDXONE.escapeHtml(contactEmail) + '</a>' +
            '</div>' +

            '<form class="form-card" id="quoteForm" data-testid="quote-form">' +
            '<h3 style="margin-top:0">Request a quote</h3>' +
            '<p class="text-muted" style="margin-bottom:1.25rem">Tell us your requirements and we\'ll respond with pricing & delivery within one business day.</p>' +
            '<div id="quoteAlert"></div>' +
            '<div class="field-row">' +
            '<div class="field"><label for="qName">Full name</label><input id="qName" type="text" required data-testid="quote-name" /></div>' +
            '<div class="field"><label for="qEmail">Email</label><input id="qEmail" type="email" required data-testid="quote-email" /></div>' +
            '</div>' +
            '<div class="field"><label for="qPhone">Phone</label><input id="qPhone" type="tel" data-testid="quote-phone" /></div>' +
            '<div class="field"><label for="qMessage">Requirements</label><textarea id="qMessage" required placeholder="Quantity, delivery location, timeline…" data-testid="quote-message"></textarea></div>' +
            '<button type="submit" class="btn btn-primary btn-block" data-testid="quote-submit"><i data-lucide="send" width="18" height="18"></i> Request Quote</button>' +
            '</form>' +

            '</div>' +
            '</div>'
        );
    }

    function wireQuoteForm(p) {
        var form = document.getElementById("quoteForm");
        var alertBox = document.getElementById("quoteAlert");
        if (!form) return;
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            alertBox.innerHTML = "";
            var btn = form.querySelector("button[type=submit]");
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Sending…';
            try {
                await window.MEDXONE.api("/inquiries", {
                    method: "POST",
                    auth: false,
                    body: {
                        name: document.getElementById("qName").value.trim(),
                        email: document.getElementById("qEmail").value.trim(),
                        phone: document.getElementById("qPhone").value.trim(),
                        message: document.getElementById("qMessage").value.trim(),
                        product_id: p.id,
                        product_name: p.name,
                        inquiry_type: "quote",
                    },
                });
                alertBox.innerHTML = '<div class="alert alert-success" data-testid="quote-success">Quote request received. Our team will reach out shortly.</div>';
                form.reset();
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="quote-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="send" width="18" height="18"></i> Request Quote';
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }
})();
