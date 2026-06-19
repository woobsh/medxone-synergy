(function () {
    var state = {
        categories: [],
        products: [],
        inquiries: [],
        editingProductId: null,
        editingCategoryId: null,
        pendingConfirm: null,
    };

    // ----- Image compression helpers (browser-side) -----
    function formatBytes(n) {
        if (n == null) return "";
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
        return (n / (1024 * 1024)).toFixed(2) + " MB";
    }

    function loadImageFromFile(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error("Could not read image")); };
                img.src = reader.result;
            };
            reader.onerror = function () { reject(new Error("Could not read file")); };
            reader.readAsDataURL(file);
        });
    }

    function canvasToBlob(canvas, quality) {
        return new Promise(function (resolve) {
            canvas.toBlob(function (b) { resolve(b); }, "image/jpeg", quality);
        });
    }

    async function renderToJpeg(img, maxDim, quality) {
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        // White background for transparent PNGs (JPEG has no alpha)
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return await canvasToBlob(canvas, quality);
    }

    /**
     * Iteratively reduce quality then dimensions until the JPEG is under
     * `targetBytes`. Returns a File-like Blob (with a .name) or null on failure.
     */
    async function compressImage(file, targetBytes) {
        var img = await loadImageFromFile(file);
        var maxDim = Math.min(2400, Math.max(img.naturalWidth, img.naturalHeight));
        var quality = 0.85;
        var blob = await renderToJpeg(img, maxDim, quality);
        var attempts = 0;
        while (blob && blob.size > targetBytes && attempts < 12) {
            if (quality > 0.45) {
                quality = +(quality - 0.1).toFixed(2);
            } else {
                maxDim = Math.max(640, Math.floor(maxDim * 0.82));
                quality = 0.75;
            }
            blob = await renderToJpeg(img, maxDim, quality);
            attempts++;
        }
        if (!blob) return null;
        // Wrap as File so multipart upload keeps a sensible filename.
        var name = (file.name || "image").replace(/\.[^.]+$/, "") + ".jpg";
        try {
            return new File([blob], name, { type: "image/jpeg" });
        } catch (e) {
            // Older Safari fallback — Blob with a .name property attached.
            blob.name = name;
            return blob;
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        if (window.MEDXONE.getToken()) {
            showDashboard();
        } else {
            showLogin();
        }
        wireLogin();
        wireDashboard();
        wireProductModal();
        wireCategoryModal();
        wireConfirmModal();
        if (window.lucide) window.lucide.createIcons();
    });

    // ---------- Login ----------
    function showLogin() {
        document.getElementById("loginView").style.display = "";
        document.getElementById("dashboardView").style.display = "none";
    }
    function showDashboard() {
        document.getElementById("loginView").style.display = "none";
        document.getElementById("dashboardView").style.display = "grid";
        verifyAndLoad();
    }
    function wireLogin() {
        var form = document.getElementById("loginForm");
        var alertBox = document.getElementById("loginAlert");
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            alertBox.innerHTML = "";
            var btn = form.querySelector("button[type=submit]");
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Signing in…';
            try {
                var data = await window.MEDXONE.api("/auth/login", {
                    method: "POST",
                    auth: false,
                    body: {
                        email: document.getElementById("email").value.trim(),
                        password: document.getElementById("password").value,
                    },
                });
                window.MEDXONE.setToken(data.access_token);
                showDashboard();
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="login-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="log-in" width="18" height="18"></i> Sign in';
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    async function verifyAndLoad() {
        try {
            await window.MEDXONE.api("/auth/me");
            await Promise.all([loadCategories(), loadProducts()]);
            renderProducts();
            renderCategorySelect();
            if (window.lucide) window.lucide.createIcons();
        } catch (e) {
            window.MEDXONE.clearToken();
            showLogin();
        }
    }

    // ---------- Dashboard nav ----------
    function wireDashboard() {
        document.querySelectorAll(".admin-nav button[data-view]").forEach(function (b) {
            b.addEventListener("click", function () {
                var view = b.getAttribute("data-view");
                document.querySelectorAll(".admin-nav button[data-view]").forEach(function (x) { x.classList.remove("active"); });
                b.classList.add("active");
                ["products", "categories", "inquiries"].forEach(function (v) {
                    document.getElementById(v + "View").style.display = v === view ? "" : "none";
                });
                if (view === "categories") renderCategories();
                if (view === "inquiries") loadInquiries();
            });
        });
        document.getElementById("logoutBtn").addEventListener("click", function () {
            window.MEDXONE.clearToken();
            window.location.reload();
        });
        document.getElementById("addProductBtn").addEventListener("click", function () {
            openProductModal(null);
        });
        document.getElementById("addCategoryBtn").addEventListener("click", function () {
            openCategoryModal(null);
        });
    }

    // ---------- Data loaders ----------
    async function loadCategories() {
        state.categories = await window.MEDXONE.api("/categories", { auth: false });
    }
    async function loadProducts() {
        state.products = await window.MEDXONE.api("/products", { auth: false });
    }
    async function loadInquiries() {
        try {
            state.inquiries = await window.MEDXONE.api("/inquiries");
            renderInquiries();
        } catch (e) {
            document.getElementById("inquiriesTable").innerHTML = '<div class="empty-state">Could not load inquiries.</div>';
        }
    }

    // ---------- Products ----------
    function renderProducts() {
        var container = document.getElementById("productsTable");
        if (!state.products.length) {
            container.innerHTML = '<div class="empty-state" data-testid="empty-products-admin">No products yet. Click "Add Product" to create one.</div>';
            return;
        }
        var rows = state.products.map(function (p) {
            var img = window.MEDXONE.absoluteImageUrl(p.image_url) || "";
            return (
                '<tr data-testid="product-row-' + p.id + '">' +
                '<td><div class="thumb-cell">' + (img ? '<img src="' + window.MEDXONE.escapeHtml(img) + '" alt="">' : '') + '</div></td>' +
                '<td><strong>' + window.MEDXONE.escapeHtml(p.name) + '</strong><br><span class="text-muted" style="font-size:0.85rem">' + window.MEDXONE.escapeHtml(p.short_description || "") + '</span></td>' +
                '<td>' + window.MEDXONE.escapeHtml(p.category_name || "—") + '</td>' +
                '<td>' + window.MEDXONE.escapeHtml(p.contact_email || "—") + '<br>' + window.MEDXONE.escapeHtml(p.contact_phone || "") + '</td>' +
                '<td><div class="row-actions">' +
                '<button class="btn btn-outline btn-sm" data-action="edit-product" data-id="' + p.id + '" data-testid="edit-product-' + p.id + '"><i data-lucide="pencil" width="14" height="14"></i></button>' +
                '<button class="btn btn-danger btn-sm" data-action="delete-product" data-id="' + p.id + '" data-testid="delete-product-' + p.id + '"><i data-lucide="trash-2" width="14" height="14"></i></button>' +
                '</div></td>' +
                '</tr>'
            );
        }).join("");
        container.innerHTML =
            '<table class="data-table" data-testid="products-table">' +
            '<thead><tr><th>Image</th><th>Product</th><th>Category</th><th>Contact</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
        container.querySelectorAll("button[data-action=edit-product]").forEach(function (b) {
            b.addEventListener("click", function () {
                openProductModal(b.getAttribute("data-id"));
            });
        });
        container.querySelectorAll("button[data-action=delete-product]").forEach(function (b) {
            b.addEventListener("click", function () {
                askConfirm("Delete product", "This will permanently remove the product from the catalog.", function () {
                    deleteProduct(b.getAttribute("data-id"));
                });
            });
        });
        if (window.lucide) window.lucide.createIcons();
    }

    function renderCategorySelect() {
        var sel = document.getElementById("pCategory");
        sel.innerHTML = state.categories
            .map(function (c) {
                return '<option value="' + c.id + '">' + window.MEDXONE.escapeHtml(c.name) + '</option>';
            }).join("");
    }

    function openProductModal(id) {
        state.editingProductId = id;
        document.getElementById("productModalTitle").textContent = id ? "Edit Product" : "Add Product";
        document.getElementById("productModalAlert").innerHTML = "";
        renderCategorySelect();
        var preview = document.getElementById("imagePreview");
        if (id) {
            var p = state.products.find(function (x) { return x.id === id; });
            document.getElementById("pName").value = p.name || "";
            document.getElementById("pCategory").value = p.category_id || "";
            document.getElementById("pShort").value = p.short_description || "";
            document.getElementById("pDesc").value = p.description || "";
            document.getElementById("pSpecs").value = p.specifications || "";
            document.getElementById("pEmail").value = p.contact_email || "";
            document.getElementById("pPhone").value = p.contact_phone || "";
            document.getElementById("pImageUrl").value = p.image_url || "";
            if (p.image_url) {
                preview.style.display = "";
                preview.innerHTML = '<img src="' + window.MEDXONE.escapeHtml(window.MEDXONE.absoluteImageUrl(p.image_url)) + '" alt="">';
            } else {
                preview.style.display = "none";
                preview.innerHTML = "";
            }
        } else {
            document.getElementById("productForm").reset();
            document.getElementById("pImageUrl").value = "";
            preview.style.display = "none";
            preview.innerHTML = "";
            if (state.categories.length) document.getElementById("pCategory").value = state.categories[0].id;
        }
        openModal("productModal");
    }

    function wireProductModal() {
        var form = document.getElementById("productForm");
        var fileInput = document.getElementById("pImageFile");
        var preview = document.getElementById("imagePreview");
        var alertBox = document.getElementById("productModalAlert");

        fileInput.addEventListener("change", async function () {
            var file = fileInput.files && fileInput.files[0];
            if (!file) return;
            // Auto-compress large images entirely in the browser so the
            // backend's 1.5 MB hard cap is never the bottleneck for admins.
            var TARGET_BYTES = 1_200_000; // aim well under the 1.5MB server cap
            try {
                if (file.size > TARGET_BYTES) {
                    alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-compressing">Image is ' + formatBytes(file.size) + ' — compressing in your browser…</div>';
                    var compressed = await compressImage(file, TARGET_BYTES);
                    if (compressed && compressed.size < file.size) {
                        alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-compressed">Compressed ' + formatBytes(file.size) + ' → ' + formatBytes(compressed.size) + '. Uploading…</div>';
                        file = compressed;
                    } else {
                        alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-uploading">Uploading image…</div>';
                    }
                } else {
                    alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-uploading">Uploading image…</div>';
                }
            } catch (compressErr) {
                console.warn("Compression failed, uploading original:", compressErr);
                alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-uploading">Uploading image…</div>';
            }
            try {
                var fd = new FormData();
                fd.append("file", file, file.name || "image.jpg");
                var result = await window.MEDXONE.api("/upload", { method: "POST", body: fd });
                document.getElementById("pImageUrl").value = result.url;
                preview.style.display = "";
                preview.innerHTML = '<img src="' + window.MEDXONE.escapeHtml(window.MEDXONE.absoluteImageUrl(result.url)) + '" alt="">';
                alertBox.innerHTML = '<div class="alert alert-success" data-testid="image-uploaded">Image uploaded (' + formatBytes(result.size) + ').</div>';
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="image-upload-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            }
        });

        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            alertBox.innerHTML = "";
            var payload = {
                name: document.getElementById("pName").value.trim(),
                category_id: document.getElementById("pCategory").value,
                short_description: document.getElementById("pShort").value.trim(),
                description: document.getElementById("pDesc").value.trim(),
                specifications: document.getElementById("pSpecs").value.trim(),
                image_url: document.getElementById("pImageUrl").value,
                contact_email: document.getElementById("pEmail").value.trim(),
                contact_phone: document.getElementById("pPhone").value.trim(),
            };
            var btn = form.querySelector("button[type=submit]");
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Saving…';
            try {
                if (state.editingProductId) {
                    await window.MEDXONE.api("/products/" + state.editingProductId, { method: "PUT", body: payload });
                    window.MEDXONE.toast("Product updated", "success");
                } else {
                    await window.MEDXONE.api("/products", { method: "POST", body: payload });
                    window.MEDXONE.toast("Product added", "success");
                }
                closeModal("productModal");
                await loadProducts();
                renderProducts();
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="product-save-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            } finally {
                btn.disabled = false;
                btn.innerHTML = 'Save Product';
            }
        });
    }

    async function deleteProduct(id) {
        try {
            await window.MEDXONE.api("/products/" + id, { method: "DELETE" });
            window.MEDXONE.toast("Product deleted", "success");
            await loadProducts();
            renderProducts();
        } catch (e) {
            window.MEDXONE.toast(e.message, "error");
        }
    }

    // ---------- Categories ----------
    function renderCategories() {
        var container = document.getElementById("categoriesTable");
        if (!state.categories.length) {
            container.innerHTML = '<div class="empty-state" data-testid="empty-categories">No categories yet.</div>';
            return;
        }
        var rows = state.categories.map(function (c) {
            return (
                '<tr data-testid="category-row-' + c.id + '">' +
                '<td><strong>' + window.MEDXONE.escapeHtml(c.name) + '</strong></td>' +
                '<td>' + window.MEDXONE.escapeHtml(c.description || "—") + '</td>' +
                '<td><div class="row-actions">' +
                '<button class="btn btn-outline btn-sm" data-action="edit-category" data-id="' + c.id + '" data-testid="edit-category-' + c.id + '"><i data-lucide="pencil" width="14" height="14"></i></button>' +
                '<button class="btn btn-danger btn-sm" data-action="delete-category" data-id="' + c.id + '" data-testid="delete-category-' + c.id + '"><i data-lucide="trash-2" width="14" height="14"></i></button>' +
                '</div></td>' +
                '</tr>'
            );
        }).join("");
        container.innerHTML =
            '<table class="data-table" data-testid="categories-table">' +
            '<thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
        container.querySelectorAll("button[data-action=edit-category]").forEach(function (b) {
            b.addEventListener("click", function () { openCategoryModal(b.getAttribute("data-id")); });
        });
        container.querySelectorAll("button[data-action=delete-category]").forEach(function (b) {
            b.addEventListener("click", function () {
                askConfirm("Delete category", "Categories must be empty before deletion.", function () {
                    deleteCategory(b.getAttribute("data-id"));
                });
            });
        });
        if (window.lucide) window.lucide.createIcons();
    }

    function openCategoryModal(id) {
        state.editingCategoryId = id;
        document.getElementById("categoryModalTitle").textContent = id ? "Edit Category" : "Add Category";
        document.getElementById("categoryModalAlert").innerHTML = "";
        if (id) {
            var c = state.categories.find(function (x) { return x.id === id; });
            document.getElementById("cName").value = c.name || "";
            document.getElementById("cDesc").value = c.description || "";
        } else {
            document.getElementById("categoryForm").reset();
        }
        openModal("categoryModal");
    }

    function wireCategoryModal() {
        var form = document.getElementById("categoryForm");
        var alertBox = document.getElementById("categoryModalAlert");
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            alertBox.innerHTML = "";
            var payload = {
                name: document.getElementById("cName").value.trim(),
                description: document.getElementById("cDesc").value.trim(),
            };
            try {
                if (state.editingCategoryId) {
                    await window.MEDXONE.api("/categories/" + state.editingCategoryId, { method: "PUT", body: payload });
                    window.MEDXONE.toast("Category updated", "success");
                } else {
                    await window.MEDXONE.api("/categories", { method: "POST", body: payload });
                    window.MEDXONE.toast("Category added", "success");
                }
                closeModal("categoryModal");
                await loadCategories();
                renderCategories();
                renderProducts();
            } catch (err) {
                alertBox.innerHTML = '<div class="alert alert-error" data-testid="category-save-error">' + window.MEDXONE.escapeHtml(err.message) + '</div>';
            }
        });
    }

    async function deleteCategory(id) {
        try {
            await window.MEDXONE.api("/categories/" + id, { method: "DELETE" });
            window.MEDXONE.toast("Category deleted", "success");
            await loadCategories();
            renderCategories();
        } catch (e) {
            window.MEDXONE.toast(e.message, "error");
        }
    }

    // ---------- Inquiries ----------
    function renderInquiries() {
        var container = document.getElementById("inquiriesTable");
        if (!state.inquiries.length) {
            container.innerHTML = '<div class="empty-state">No inquiries yet.</div>';
            return;
        }
        var rows = state.inquiries.map(function (i) {
            var d = new Date(i.created_at);
            return (
                '<tr>' +
                '<td>' + d.toLocaleString() + '</td>' +
                '<td><strong>' + window.MEDXONE.escapeHtml(i.name) + '</strong><br><span class="text-muted" style="font-size:0.85rem">' + window.MEDXONE.escapeHtml(i.email) + (i.phone ? ' · ' + window.MEDXONE.escapeHtml(i.phone) : "") + '</span></td>' +
                '<td>' + (i.product_name ? window.MEDXONE.escapeHtml(i.product_name) : '<span class="text-muted">General inquiry</span>') + '</td>' +
                '<td style="white-space:pre-line; max-width:340px">' + window.MEDXONE.escapeHtml(i.message) + '</td>' +
                '</tr>'
            );
        }).join("");
        container.innerHTML =
            '<table class="data-table">' +
            '<thead><tr><th>Date</th><th>From</th><th>Product</th><th>Message</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }

    // ---------- Modal helpers ----------
    function openModal(id) {
        document.getElementById(id).classList.add("open");
        if (window.lucide) window.lucide.createIcons();
    }
    function closeModal(id) {
        document.getElementById(id).classList.remove("open");
    }
    document.addEventListener("click", function (e) {
        if (e.target.matches("[data-close-modal]")) {
            var m = e.target.closest(".modal-backdrop");
            if (m) m.classList.remove("open");
        }
        if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
            e.target.classList.remove("open");
        }
    });

    function wireConfirmModal() {
        document.getElementById("confirmYes").addEventListener("click", function () {
            closeModal("confirmModal");
            if (state.pendingConfirm) state.pendingConfirm();
            state.pendingConfirm = null;
        });
    }
    function askConfirm(title, body, onYes) {
        document.getElementById("confirmTitle").textContent = title;
        document.getElementById("confirmBody").textContent = body;
        state.pendingConfirm = onYes;
        openModal("confirmModal");
    }
})();
