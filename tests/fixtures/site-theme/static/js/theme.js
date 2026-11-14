(function () {
  'use strict';
  var doc = document, root = doc.documentElement;

  /* Mobile navigation */
  var navBtn = doc.querySelector('.nav-toggle');
  var nav = doc.getElementById('primary-navigation');
  function setNav(open) {
    if (!navBtn || !nav) return;
    navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    nav.classList.toggle('is-open', open);
  }
  if (navBtn && nav) {
    navBtn.addEventListener('click', function () {
      setNav(navBtn.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('a')) setNav(false);
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        setNav(false);
        var open = doc.querySelectorAll('.has-children.is-open');
        for (var i = 0; i < open.length; i++) open[i].classList.remove('is-open');
      }
    });
    doc.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (!e.target.closest('.site-header')) {
        setNav(false);
        var o = doc.querySelectorAll('.has-children.is-open');
        for (var i = 0; i < o.length; i++) o[i].classList.remove('is-open');
      }
    });
  }

  /* Submenu toggles (touch + mobile) */
  var subBtns = doc.querySelectorAll('.subnav-toggle');
  Array.prototype.forEach.call(subBtns, function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.has-children');
      if (!item) return;
      var open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });

  /* Light / dark toggle (remembered per browser) */
  var themeBtn = doc.querySelector('.theme-toggle');
  function isDark() {
    var t = root.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('site-theme', next); } catch (e) {}
    });
  }

  /* Sticky header shadow + back-to-top */
  var header = doc.querySelector('.site-header');
  var toTop = doc.querySelector('.to-top');
  function onScroll() {
    var y = window.pageYOffset || root.scrollTop;
    if (header) header.classList.toggle('is-scrolled', y > 8);
    if (toTop) {
      toTop.hidden = false;
      toTop.classList.toggle('is-visible', y > 500);
    }
  }
  if (toTop) toTop.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* Share buttons (built from the current page so no template data is needed) */
  var share = doc.querySelector('[data-share]');
  if (share) {
    var url = encodeURIComponent(window.location.href);
    var title = encodeURIComponent(doc.title);
    var targets = {
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url,
      x: 'https://twitter.com/intent/tweet?url=' + url + '&text=' + title,
      whatsapp: 'https://wa.me/?text=' + title + '%20' + url,
      linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + url
    };
    Array.prototype.forEach.call(share.querySelectorAll('[data-share-target]'), function (a) {
      var href = targets[a.getAttribute('data-share-target')];
      if (href) a.setAttribute('href', href);
    });
    var copy = share.querySelector('[data-share-copy]');
    if (copy) copy.addEventListener('click', function () {
      var done = function () {
        copy.classList.add('is-done');
        setTimeout(function () { copy.classList.remove('is-done'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(window.location.href).then(done, function () {});
      } else {
        var ta = doc.createElement('textarea');
        ta.value = window.location.href;
        doc.body.appendChild(ta); ta.select();
        try { doc.execCommand('copy'); done(); } catch (e) {}
        doc.body.removeChild(ta);
      }
    });
  }

  /* Gentle reveal-on-scroll; content stays visible if JS or IntersectionObserver is missing */
  if ('IntersectionObserver' in window && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    var items = doc.querySelectorAll('.post-card, .page-tile, .section-heading, .page-children');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var t = en.target;
          t.classList.add('is-in');
          io.unobserve(t);
          setTimeout(function () { t.classList.remove('will-reveal', 'is-in'); }, 800);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(items, function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) return;
      el.classList.add('will-reveal');
      io.observe(el);
    });
  }
})();
