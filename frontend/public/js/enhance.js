// MEDXONE SYNERGY — UI enhancements (scroll reveal, header shadow, scroll-to-top)
(function () {
    // Scroll-reveal: fade-in elements when they enter the viewport
    function initReveal() {
        var els = document.querySelectorAll(".reveal");
        if (!els.length) return;
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("visible");
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
        els.forEach(function (el) { observer.observe(el); });
    }

    // Header shadow on scroll
    function initHeaderScroll() {
        var header = document.querySelector(".site-header");
        if (!header) return;
        function check() {
            if (window.scrollY > 10) header.classList.add("scrolled");
            else header.classList.remove("scrolled");
        }
        window.addEventListener("scroll", check, { passive: true });
        check();
    }

    // Scroll-to-top button
    function initScrollTop() {
        var btn = document.querySelector(".scroll-top");
        if (!btn) return;
        function check() {
            if (window.scrollY > 500) btn.classList.add("visible");
            else btn.classList.remove("visible");
        }
        window.addEventListener("scroll", check, { passive: true });
        btn.addEventListener("click", function () {
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
        check();
    }

    // Staggered reveal for grid children
    function initStagger() {
        document.querySelectorAll(".category-grid, .product-grid, .about-pillars").forEach(function (grid) {
            var children = grid.children;
            for (var i = 0; i < children.length; i++) {
                children[i].style.transitionDelay = (i * 0.06) + "s";
            }
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        initReveal();
        initHeaderScroll();
        initScrollTop();
        initStagger();
    });
})();
