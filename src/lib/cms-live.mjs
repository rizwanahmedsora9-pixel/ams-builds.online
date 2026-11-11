// Live client-side CMS hydration for the public website.
// Exits immediately with zero network fetches if the user has no local CMS edits.
import { STORE_STORAGE_KEY, createClientCms } from './cms-store.mjs';
import { renderMarkdownClient } from './markdown-browser.mjs';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtBlogDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-PK', { year: 'numeric', month: 'long', day: 'numeric' });
}

function resolveImg(path, mediaMap) {
  if (!path) return '';
  return mediaMap[path] || path;
}

function renderBlogCard(post, mediaMap) {
  const d = post.data || {};
  const href = `/blog/${encodeURIComponent(post.slug)}/`;
  const imgSrc = resolveImg(d.heroImage, mediaMap);
  const tag = Array.isArray(d.tags) && d.tags[0] ? `<span class="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-semibold">${esc(d.tags[0])}</span>` : '';
  return `
    <article class="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-soft hover:-translate-y-0.5 transition">
      ${
        imgSrc
          ? `<a href="${href}" class="block aspect-[16/9] overflow-hidden bg-slate-100"><img src="${esc(imgSrc)}" alt="${esc(d.title)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" onerror="this.parentElement.style.display='none'" /></a>`
          : ''
      }
      <div class="p-6">
        <div class="flex items-center gap-2 text-xs text-slate-500 mb-3">
          <time datetime="${esc(d.pubDate)}">${esc(fmtBlogDate(d.pubDate))}</time>
          ${tag}
        </div>
        <h3 class="text-lg font-bold text-slate-900 leading-snug"><a href="${href}" class="hover:text-amber-600">${esc(d.title)}</a></h3>
        <p class="mt-2 text-sm leading-6 text-slate-600 line-clamp-3">${esc(d.description)}</p>
        <a href="${href}" class="inline-flex items-center gap-1 mt-4 text-sm font-bold text-amber-600 hover:gap-2 transition-all">Read article <span>→</span></a>
      </div>
    </article>
  `;
}

const CAT_LABELS = { web: 'Website', android: 'Android App', software: 'Software', ecommerce: 'E-commerce' };

function renderProjectCard(project, mediaMap) {
  const d = project.data || {};
  const href = `/projects/${encodeURIComponent(project.slug)}/`;
  const imgSrc = resolveImg(d.coverImage, mediaMap);
  const catLabel = CAT_LABELS[d.category] || 'Website';
  const techs = Array.isArray(d.technologies)
    ? d.technologies.map((t) => `<span class="text-xs bg-slate-100 px-2 py-1 rounded-md text-slate-600">${esc(t)}</span>`).join('')
    : '';
  return `
    <article class="group bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-soft transition">
      ${
        imgSrc
          ? `<a href="${href}" class="block aspect-[16/9] overflow-hidden bg-slate-100"><img src="${esc(imgSrc)}" alt="${esc(d.title)}" loading="lazy" class="w-full h-full object-cover group-hover:scale-[1.02] transition duration-500" onerror="this.parentElement.style.display='none'" /></a>`
          : ''
      }
      <div class="p-6">
        <span class="inline-block bg-slate-900 text-white text-xs font-bold px-3 py-1 rounded-full">${esc(catLabel)}</span>
        <h3 class="mt-3 text-lg font-bold text-slate-900"><a href="${href}" class="hover:text-amber-600">${esc(d.title)}</a></h3>
        <p class="mt-2 text-sm text-slate-600 leading-6 line-clamp-3">${esc(d.description)}</p>
        ${techs ? `<div class="flex flex-wrap gap-1.5 mt-4">${techs}</div>` : ''}
        <a href="${href}" class="inline-flex mt-4 text-sm font-bold text-amber-600">View case study →</a>
      </div>
    </article>
  `;
}

function renderNavLinks(pages, currentPath) {
  const navPages = pages
    .filter((p) => !p.data?.draft && p.data?.showInNav)
    .sort((a, b) => (Number(a.data?.navOrder ?? 99) || 99) - (Number(b.data?.navOrder ?? 99) || 99));
  return [
    { href: '/', label: 'Home' },
    { href: '/projects/', label: 'Projects' },
    { href: '/blog/', label: 'Blog' },
    ...navPages.map((p) => ({ href: `/${p.slug}/`, label: p.data?.title || p.slug })),
  ].map((l) => ({
    ...l,
    active: l.href === '/' ? currentPath === '/' : currentPath === l.href || currentPath.startsWith(l.href),
  }));
}

function hydrateShell(cms, mediaMap) {
  const site = cms.getSettings().data;
  const pages = cms.listContent('pages');
  const current = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
  const links = renderNavLinks(pages, current);

  // Header brand
  const logoInitialEl = document.querySelector('[data-cms-logo-initial]');
  if (logoInitialEl) logoInitialEl.textContent = site.logoInitial || 'A';

  const logoText = site.logoText || site.siteName || 'AMS Builds';
  const words = logoText.split(' ');
  const firstEl = document.querySelector('[data-cms-logo-first]');
  const restEl = document.querySelector('[data-cms-logo-rest]');
  if (firstEl) firstEl.textContent = words.slice(0, 1).join(' ');
  if (restEl) {
    const rest = words.slice(1).join(' ');
    restEl.textContent = rest;
    restEl.classList.toggle('hidden', !rest);
  }

  const navDesktop = document.querySelector('[data-cms-nav-desktop]');
  if (navDesktop) {
    navDesktop.innerHTML =
      links
        .map(
          (l) =>
            `<a href="${esc(l.href)}" class="px-4 py-2 rounded-full text-sm font-medium transition ${
              l.active ? 'bg-white/10 text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'
            }">${esc(l.label)}</a>`,
        )
        .join('') +
      `<a href="/contact/" class="ml-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold px-5 py-2.5 rounded-full text-sm transition">Get a Quote →</a>`;
  }

  const navMobile = document.querySelector('#mobile-menu');
  if (navMobile) {
    navMobile.innerHTML =
      links
        .map(
          (l) =>
            `<a href="${esc(l.href)}" class="block px-4 py-3 rounded-lg font-medium ${
              l.active ? 'bg-white/10 text-white' : 'text-slate-200 hover:bg-white/10'
            }">${esc(l.label)}</a>`,
        )
        .join('') +
      `<a href="/contact/" class="block mt-3 text-center bg-amber-500 text-slate-900 font-bold px-5 py-3 rounded-xl">Get a Quote →</a>`;
  }

  // Footer
  const fInit = document.querySelector('[data-cms-footer-initial]');
  if (fInit) fInit.textContent = site.logoInitial || 'A';
  const fName = document.querySelector('[data-cms-footer-name]');
  if (fName) fName.textContent = site.logoText || site.siteName || 'AMS Builds';
  const fTag = document.querySelector('[data-cms-footer-tagline]');
  if (fTag) fTag.textContent = site.tagline || '';
  const fDesc = document.querySelector('[data-cms-footer-desc]');
  if (fDesc) fDesc.textContent = site.shortDescription || '';

  const fSocials = document.querySelector('[data-cms-footer-socials]');
  if (fSocials) {
    const wa = (site.whatsapp || '').trim();
    const socials = [
      { url: (site.facebook || '').trim(), label: 'Facebook', short: 'f' },
      { url: (site.linkedin || '').trim(), label: 'LinkedIn', short: 'in' },
      { url: (site.instagram || '').trim(), label: 'Instagram', short: '◎' },
      { url: wa ? `https://wa.me/${wa.replace(/[^\d]/g, '')}` : '', label: 'WhatsApp', short: '◉' },
      { url: (site.youtube || '').trim(), label: 'YouTube', short: '▶' },
      { url: (site.github || '').trim(), label: 'GitHub', short: '⌥' },
      { url: (site.twitter || '').trim(), label: 'X / Twitter', short: '𝕏' },
    ].filter((s) => s.url);
    fSocials.innerHTML = socials
      .map(
        (s) =>
          `<a href="${esc(s.url)}" aria-label="${esc(s.label)}" rel="noopener" target="_blank" class="w-9 h-9 rounded-full bg-white/10 grid place-items-center hover:bg-amber-500 hover:text-slate-900 transition text-sm font-bold">${esc(s.short)}</a>`,
      )
      .join('');
    fSocials.classList.toggle('hidden', socials.length === 0);
  }

  const fPages = document.querySelector('[data-cms-footer-links]');
  if (fPages) {
    const footerPages = pages
      .filter((p) => !p.data?.draft && p.data?.showInFooter)
      .sort((a, b) => (Number(a.data?.navOrder ?? 99) || 99) - (Number(b.data?.navOrder ?? 99) || 99));
    fPages.innerHTML =
      `<li><a href="/" class="hover:text-amber-400">Home</a></li>` +
      `<li><a href="/projects/" class="hover:text-amber-400">Projects</a></li>` +
      `<li><a href="/blog/" class="hover:text-amber-400">Blog</a></li>` +
      footerPages
        .map((p) => `<li><a href="/${esc(p.slug)}/" class="hover:text-amber-400">${esc(p.data?.title || p.slug)}</a></li>`)
        .join('');
  }

  const fAddress = document.querySelector('[data-cms-footer-address]');
  if (fAddress) {
    const addressLine = [site.streetAddress, site.addressLocality, site.addressRegion]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(', ');
    const localityLine = [site.addressRegion, site.addressCountry]
      .map((s) => (s || '').trim())
      .filter(Boolean)
      .join(', ');
    const phoneHref = `tel:${String(site.phone || '').replace(/[^+\d]/g, '')}`;
    const hours = String(site.openingHours || '').replace('Mo-Sa', 'Mon–Sat').replace('Mo-Fr', 'Mon–Fri');
    fAddress.innerHTML = `
      <p>📍 ${esc(addressLine)}<br/>${esc(localityLine)}</p>
      <p>📞 <a href="${esc(phoneHref)}" class="hover:text-amber-400">${esc(site.phone)}</a></p>
      <p>✉️ <a href="mailto:${esc(site.email)}" class="hover:text-amber-400">${esc(site.email)}</a></p>
      <p>🕘 ${esc(hours)}</p>
    `;
  }

  const fCopy = document.querySelector('[data-cms-footer-copy]');
  if (fCopy) {
    fCopy.textContent = `© ${new Date().getFullYear()} ${site.siteName || 'AMS Builds'}. All rights reserved.`;
  }
}

function hydrateHome(cms, mediaMap) {
  const site = cms.getSettings().data;
  const heroBadge = document.querySelector('[data-cms-hero-badge]');
  if (heroBadge) heroBadge.textContent = `📍 ${site.heroBadge || ''}`;
  const heroTitle = document.querySelector('[data-cms-hero-title]');
  if (heroTitle) heroTitle.textContent = site.heroTitle || '';
  const heroSub = document.querySelector('[data-cms-hero-subtitle]');
  if (heroSub) heroSub.textContent = site.heroSubtitle || '';
  const heroCta = document.querySelector('[data-cms-hero-cta]');
  if (heroCta) {
    heroCta.textContent = `${site.heroCtaText || 'Get a Free Quote'} →`;
    heroCta.setAttribute('href', site.heroCtaUrl || '/contact/');
  }
  const heroImg = document.querySelector('[data-cms-hero-image]');
  if (heroImg && site.heroImage) {
    heroImg.setAttribute('src', resolveImg(site.heroImage, mediaMap));
    heroImg.style.display = '';
  }

  const statsEl = document.querySelector('[data-cms-stats]');
  if (statsEl && Array.isArray(site.stats) && site.stats.length) {
    statsEl.innerHTML = site.stats
      .slice(0, 3)
      .map(
        (s) =>
          `<div><dt class="text-2xl font-extrabold text-white">${esc(s.value)}</dt><dd class="text-xs text-slate-400 mt-1">${esc(s.label)}</dd></div>`,
      )
      .join('');
  }

  const contactMeta = document.querySelector('[data-cms-contact-meta]');
  if (contactMeta) contactMeta.textContent = `📞 ${site.phone || ''} · ✉️ ${site.email || ''}`;

  const waLink = document.querySelector('[data-cms-wa-link]');
  if (waLink) {
    const digits = String(site.whatsapp || site.phone || '').replace(/[^\d]/g, '');
    waLink.setAttribute('href', `https://wa.me/${digits}`);
  }

  const projGrid = document.querySelector('[data-cms-featured-projects]');
  if (projGrid) {
    const featured = cms
      .listContent('projects')
      .filter((p) => !p.data?.draft && p.data?.featured)
      .slice(0, 3);
    projGrid.innerHTML = featured.map((p) => renderProjectCard(p, mediaMap)).join('');
  }

  const blogGrid = document.querySelector('[data-cms-latest-posts]');
  if (blogGrid) {
    const latest = cms
      .listContent('blog')
      .filter((p) => !p.data?.draft)
      .sort((a, b) => +new Date(b.data?.pubDate || 0) - +new Date(a.data?.pubDate || 0))
      .slice(0, 3);
    blogGrid.innerHTML = latest.map((p) => renderBlogCard(p, mediaMap)).join('');
  }
}

function hydrateBlogIndex(cms, mediaMap) {
  const listEl = document.querySelector('[data-cms-blog-list]');
  if (!listEl) return;
  const posts = cms
    .listContent('blog')
    .filter((p) => !p.data?.draft)
    .sort((a, b) => +new Date(b.data?.pubDate || 0) - +new Date(a.data?.pubDate || 0));
  listEl.innerHTML = posts.map((p) => renderBlogCard(p, mediaMap)).join('');

  const tagsEl = document.querySelector('[data-cms-blog-tags]');
  if (tagsEl) {
    const tags = [...new Set(posts.flatMap((p) => p.data?.tags || []))];
    tagsEl.innerHTML = tags
      .map((t) => `<span class="bg-white/10 px-3 py-1.5 rounded-full text-xs font-semibold">${esc(t)}</span>`)
      .join('');
  }

  const emptyEl = document.querySelector('[data-cms-blog-empty]');
  if (emptyEl) emptyEl.classList.toggle('hidden', posts.length > 0);
}

function hydrateProjectsIndex(cms, mediaMap) {
  const listEl = document.querySelector('[data-cms-projects-list]');
  if (!listEl) return;
  const projects = cms
    .listContent('projects')
    .filter((p) => !p.data?.draft)
    .sort((a, b) => +new Date(b.data?.date || 0) - +new Date(a.data?.date || 0));
  listEl.innerHTML = projects.map((p) => renderProjectCard(p, mediaMap)).join('');
}

function renderFullEntryHtml(entry, cms, mediaMap) {
  const site = cms.getSettings().data;
  const d = entry.data || {};
  const bodyHtml = renderMarkdownClient(entry.body || '');

  if (entry.type === 'blog') {
    const tags = Array.isArray(d.tags)
      ? d.tags.map((t) => `<span class="bg-amber-100 text-amber-800 text-xs font-bold px-3 py-1 rounded-full">${esc(t)}</span>`).join('')
      : '';
    const imgSrc = resolveImg(d.heroImage, mediaMap);
    const updated = d.updatedDate ? `<span>Updated ${esc(fmtBlogDate(d.updatedDate))}</span>` : '';
    return `
      <article class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="Breadcrumb" class="text-sm text-slate-500 mb-6">
          <ol class="flex flex-wrap items-center gap-1.5">
            <li><a href="/" class="hover:text-amber-600">Home</a> /</li>
            <li><a href="/blog/" class="hover:text-amber-600">Blog</a> /</li>
            <li class="text-slate-800 font-medium">${esc(d.title)}</li>
          </ol>
        </nav>
        <div class="grid lg:grid-cols-[1fr_320px] gap-10">
          <div>
            <header>
              <div class="flex flex-wrap gap-2 mb-4">${tags}</div>
              <h1 class="text-3xl md:text-4xl font-extrabold text-slate-900 leading-tight">${esc(d.title)}</h1>
              <p class="mt-4 text-lg text-slate-600 leading-8">${esc(d.description)}</p>
              <div class="flex flex-wrap items-center gap-4 mt-6 text-sm text-slate-500 border-y border-slate-200 py-4">
                <span>By <strong class="text-slate-800">${esc(d.author || 'AMS Builds Team')}</strong></span>
                <time datetime="${esc(d.pubDate)}">Published ${esc(fmtBlogDate(d.pubDate))}</time>
                ${updated}
              </div>
            </header>
            ${
              imgSrc
                ? `<figure class="my-8 overflow-hidden rounded-2xl shadow-soft bg-slate-100"><img src="${esc(imgSrc)}" alt="${esc(d.title)}" class="w-full aspect-[16/9] object-cover" /></figure>`
                : ''
            }
            <div class="prose-ams">${bodyHtml}</div>
          </div>
          <aside class="space-y-6 lg:sticky lg:top-24 self-start">
            <div class="bg-slate-900 text-white rounded-2xl p-6">
              <h2 class="font-bold text-lg">Need a website or app?</h2>
              <p class="text-sm text-slate-300 mt-2 leading-6">Get a free quote for your business. Fast delivery, SEO-ready, mobile-first.</p>
              <a href="/contact/" class="block text-center mt-4 bg-amber-500 text-slate-900 font-bold py-3 rounded-xl">Get Free Quote</a>
              <p class="text-xs text-slate-400 mt-3 text-center">📍 ${esc(site.addressLocality)}, ${esc(site.addressCountry)}</p>
            </div>
          </aside>
        </div>
      </article>
    `;
  }

  if (entry.type === 'projects') {
    const imgSrc = resolveImg(d.coverImage, mediaMap);
    const catLabel = CAT_LABELS[d.category] || 'Website';
    const techs = Array.isArray(d.technologies) && d.technologies.length
      ? `<div class="flex flex-wrap gap-2 mb-8">${d.technologies.map((t) => `<span class="bg-slate-100 px-3 py-1.5 rounded-full text-sm">${esc(t)}</span>`).join('')}</div>`
      : '';
    const results = Array.isArray(d.results) && d.results.length
      ? `<section class="mt-10 bg-amber-50 border border-amber-200 rounded-2xl p-6"><h2 class="font-extrabold text-slate-900 text-xl">Results</h2><ul class="mt-3 space-y-2">${d.results.map((r) => `<li class="flex gap-2"><span class="text-amber-600 font-bold">✓</span><span>${esc(r)}</span></li>`).join('')}</ul></section>`
      : '';
    return `
      <article class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <nav aria-label="Breadcrumb" class="text-sm text-slate-500 mb-6">
          <ol class="flex flex-wrap items-center gap-1.5">
            <li><a href="/" class="hover:text-amber-600">Home</a> /</li>
            <li><a href="/projects/" class="hover:text-amber-600">Projects</a> /</li>
            <li class="text-slate-800 font-medium">${esc(d.title)}</li>
          </ol>
        </nav>
        <span class="inline-block bg-slate-900 text-white text-xs font-bold px-3 py-1 rounded-full">${esc(catLabel)}</span>
        <h1 class="text-3xl md:text-4xl font-extrabold text-slate-900 mt-4 leading-tight">${esc(d.title)}</h1>
        <p class="mt-4 text-lg text-slate-600 leading-8">${esc(d.description)}</p>
        <div class="grid sm:grid-cols-3 gap-4 mt-8">
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><p class="text-xs uppercase tracking-widest text-slate-500 font-bold">Client</p><p class="font-bold text-slate-900 mt-1">${esc(d.client || 'Confidential')}</p></div>
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><p class="text-xs uppercase tracking-widest text-slate-500 font-bold">Date</p><p class="font-bold text-slate-900 mt-1">${esc(d.date)}</p></div>
          <div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><p class="text-xs uppercase tracking-widest text-slate-500 font-bold">Category</p><p class="font-bold text-slate-900 mt-1">${esc(catLabel)}</p></div>
        </div>
        ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(d.title)}" class="w-full aspect-[16/9] object-cover rounded-2xl shadow-soft my-8 bg-slate-100" />` : ''}
        ${techs}
        <div class="prose-ams">${bodyHtml}</div>
        ${results}
        <div class="mt-10 flex flex-col sm:flex-row gap-4">
          ${d.liveUrl ? `<a href="${esc(d.liveUrl)}" target="_blank" rel="noopener" class="flex-1 text-center bg-slate-900 text-white font-bold py-3.5 rounded-xl">Visit Live Project →</a>` : ''}
          <a href="/contact/" class="flex-1 text-center bg-amber-500 text-slate-900 font-bold py-3.5 rounded-xl">Start Similar Project</a>
        </div>
      </article>
    `;
  }

  // pages
  return `
    <section class="bg-slate-900 text-white">
      <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
        <nav aria-label="Breadcrumb" class="text-sm text-slate-400 mb-6">
          <ol class="flex flex-wrap items-center gap-1.5">
            <li><a href="/" class="hover:text-amber-400">Home</a> /</li>
            <li class="text-white font-medium">${esc(d.title)}</li>
          </ol>
        </nav>
        <h1 class="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight">${esc(d.heroTitle || d.title)}</h1>
        ${d.heroSubtitle ? `<p class="mt-4 text-lg text-slate-300 leading-8">${esc(d.heroSubtitle)}</p>` : ''}
      </div>
    </section>
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div class="prose-ams">${bodyHtml}</div>
    </div>
  `;
}

function hydrateDetail(cms, mediaMap) {
  const container = document.querySelector('[data-cms-detail]');
  if (!container) return;
  const type = container.dataset.cmsDetail;
  const slug = container.dataset.cmsSlug;
  const entry = cms.getEntry(type, slug);
  if (!entry || entry.data?.draft) {
    container.innerHTML = `
      <div class="max-w-2xl mx-auto px-4 py-20 text-center">
        <p class="text-xs font-bold uppercase tracking-widest text-amber-600">CMS Notice</p>
        <h1 class="text-2xl font-extrabold text-slate-900 mt-2">This entry is currently a draft or was deleted in your local CMS</h1>
        <p class="text-slate-600 mt-3 text-sm">Open <a href="/admin/" class="text-amber-600 font-bold underline">/admin/</a> to publish or restore it.</p>
      </div>
    `;
    return;
  }
  if (entry.source !== 'cms') return;

  const site = cms.getSettings().data;
  document.title = `${entry.data?.seoTitle || entry.data?.title || slug} | ${site.siteName || 'AMS Builds'}`;
  container.innerHTML = renderFullEntryHtml(entry, cms, mediaMap);
  container.querySelectorAll('.prose-ams img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && mediaMap[src]) img.setAttribute('src', mediaMap[src]);
  });
}

function hydrateDynamic404(cms, mediaMap) {
  const box = document.querySelector('[data-cms-404]');
  if (!box) return;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  let type = null;
  let slug = null;
  if (path.startsWith('/blog/')) {
    type = 'blog';
    slug = decodeURIComponent(path.slice('/blog/'.length));
  } else if (path.startsWith('/projects/')) {
    type = 'projects';
    slug = decodeURIComponent(path.slice('/projects/'.length));
  } else if (path !== '/' && !path.slice(1).includes('/')) {
    type = 'pages';
    slug = decodeURIComponent(path.slice(1));
  }
  if (!type || !slug) return;

  const entry = cms.getEntry(type, slug);
  if (!entry || entry.data?.draft) return;

  const main = document.querySelector('#main');
  if (!main) return;
  const site = cms.getSettings().data;
  document.title = `${entry.data?.seoTitle || entry.data?.title || slug} | ${site.siteName || 'AMS Builds'}`;
  main.innerHTML = renderFullEntryHtml(entry, cms, mediaMap);
  main.querySelectorAll('.prose-ams img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && mediaMap[src]) img.setAttribute('src', mediaMap[src]);
  });
}

export async function initCmsLive() {
  if (typeof localStorage === 'undefined') return;
  if (!localStorage.getItem(STORE_STORAGE_KEY)) return;

  try {
    const res = await fetch('/cms-data.json');
    if (!res.ok) return;
    const baseline = await res.json();
    const cms = createClientCms({ baseline });
    const status = await cms.getStatus();
    if (!status.hasOverrides) return;

    const mediaMap = await cms.resolveAllMediaMap();
    hydrateShell(cms, mediaMap);
    hydrateHome(cms, mediaMap);
    hydrateBlogIndex(cms, mediaMap);
    hydrateProjectsIndex(cms, mediaMap);
    hydrateDetail(cms, mediaMap);
    hydrateDynamic404(cms, mediaMap);
  } catch {
    /* non-fatal fallback to static HTML */
  }
}
