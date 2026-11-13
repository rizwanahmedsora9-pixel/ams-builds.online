import { Hono } from 'hono';
import { audit } from '../../lib/audit';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings, setSettings } from '../../lib/config';
import { cleanDomain, safeUrl } from '../../lib/security';
import { card, notice, pageHead } from '../../admin/components';
import { icon } from '../../admin/icons';
import { PICKER_JS, mediaPicker } from '../../admin/media-picker';
import {
  TOKENS, cleanTokens, cssVarFor, readTokens, supportedTokens, themeValue, tokensCss, variablesFor, type TokenField,
} from '../../lib/tokens';
import { PREVIEW_TTL_MS, clearPreviewCookie, diff, setPreviewCookie, type PreviewPayload } from '../../lib/preview';
import { activeThemeFor, activeThemeTemplates, activeLayoutName, listThemes } from '../../lib/theme-store';
import { DEFAULT_WIDGET_AREAS, resolveSettings, widgetKey, type ThemeSetting, type ThemeWidgetArea } from '../../lib/theme-manifest';
import { clearThemeValueCache } from '../public';
import { csrfField, errorPage, go, html, layout, raw, type Raw } from '../../lib/ui';

/**
 * Appearance.
 *
 * The hub replaces four flat pages with six screens that answer one question
 * each: Customize (how the site looks, live), Themes (what renders it),
 * Templates (which template renders what), Menus, Widgets (the places a theme
 * opens up) and Identity (logo, favicon, social image, defaults).
 *
 * The Customizer is the piece that carries the weight: controls are generated
 * from two tables (`TOKENS` here, `theme.json` settings from the theme itself),
 * and the preview is the real site in an iframe, rendered with unsaved values
 * that travel in a signed cookie minted by `POST /appearance/preview`.
 */
const appearance = new Hono<AppEnv>();

/** A theme's own areas, or the classic footer when it declares none. */
const themeAreas = (theme: { manifest: { widgets?: ThemeWidgetArea[] } }): ThemeWidgetArea[] =>
  theme.manifest.widgets?.length ? theme.manifest.widgets : DEFAULT_WIDGET_AREAS;

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_appearance')) return errorPage(c, 403, 'Your role cannot change the appearance.');
  await next();
};
appearance.use('/appearance', guard);
appearance.use('/appearance/*', guard);
appearance.use('/widgets', guard);
appearance.use('/identity', guard);
appearance.use('/templates', guard);

/* ------------------------------------------------------------------ shared */

type ThemeRow = { slug: string; name: string; version: string };

async function currentTheme(c: Ctx) {
  return activeThemeFor(c.env);
}

/** Saved values for a theme's declared settings, not the defaults. */
async function savedThemeSettings(c: Ctx, slug: string): Promise<Record<string, string>> {
  try {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM theme_settings WHERE theme_slug=?')
      .bind(slug).all<{ key: string; value: string }>();
    const out: Record<string, string> = {};
    for (const r of results) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
}

/**
 * One control for one token. The token table decides the input type, so a new
 * token is a table entry and nothing else.
 */
function tokenField(c: Ctx, field: TokenField, value: string, themeDefault: string | null): Raw {
  const base = c.var.base;
  const id = `tok-${field.key.replace(/^token_/, '').replace(/_/g, '-')}`;
  const name = field.key;
  const help = field.help ? html`<span class="field__help">${field.help}</span>` : '';
  const fallback = themeDefault ?? field.default;
  const hit = value !== '' ? value : fallback;
  switch (field.kind) {
    case 'color':
      return html`<div class="tok-field">
        <label for="${id}">${field.label}</label>
        <div class="tok-color">
          <input type="color" id="${id}" name="${name}" value="${/^#[0-9a-f]{6}$/i.test(hit) ? hit : '#000000'}"
                 data-token="${name}" data-css-var="${cssVarFor(name)}">
          <input type="text" value="${hit}" class="tok-color__text" aria-label="${field.label} hex value"
                 maxlength="9" data-token-text="${name}" spellcheck="false">
          <button type="button" class="btn ghost small" data-token-reset="${name}" title="Use the theme's own value">Reset</button>
        </div>
        ${themeDefault ? html`<span class="field__help">Theme default: <code>${themeDefault}</code></span>` : ''}
        ${help}
      </div>`;
    case 'number':
      return html`<div class="tok-field">
        <label for="${id}">${field.label}</label>
        <div class="tok-range">
          <input type="range" id="${id}" name="${name}" min="${field.min}" max="${field.max}" step="${field.step ?? 1}"
                 value="${hit}" data-token="${name}" data-css-var="${cssVarFor(name)}" data-unit="${field.unit}">
          <output for="${id}" data-token-output="${name}">${hit}${field.unit}</output>
        </div>
        ${help}
      </div>`;
    case 'select':
      return html`<div class="tok-field">
        <label for="${id}">${field.label}</label>
        <select id="${id}" name="${name}" data-token="${name}" data-token-select="${name}">
          ${field.options.map((o) => html`<option value="${o.value}"${o.value === hit ? raw(' selected') : raw('')}>${o.label}</option>`)}
        </select>
        ${help}
      </div>`;
    default:
      return html`<div class="tok-field">
        <label for="${id}">${field.label}</label>
        <input type="text" id="${id}" name="${name}" value="${hit}" maxlength="${field.max ?? 300}"
               placeholder="${field.placeholder ?? ''}" spellcheck="false" data-token="${name}" data-css-var="${cssVarFor(name)}">
        ${help}
      </div>`;
  }
}

/** One control for a setting a theme declared in theme.json (no code per theme). */
function themeSettingField(s: ThemeSetting, value: string): Raw {
  const id = `th-${s.key}`;
  const label = html`<label for="${id}">${s.label}${s.help ? html` <span class="field__help">${s.help}</span>` : ''}</label>`;
  switch (s.type) {
    case 'toggle':
      return html`<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${s.key}" value="1"${value === '1' ? raw(' checked') : raw('')} data-theme-setting="${s.key}"> ${s.label}</label>`;
    case 'textarea':
      return html`<div class="tok-field">${label}<textarea id="${id}" name="${s.key}" rows="4" data-theme-setting="${s.key}">${value}</textarea></div>`;
      return html`<div class="tok-field">${label}<textarea id="${id}" name="${s.key}" rows="6" data-theme-setting="${s.key}">${value}</textarea></div>`;
    case 'color':
      return html`<div class="tok-field">${label}<div class="tok-color">
        <input type="color" id="${id}" name="${s.key}" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}" data-theme-setting="${s.key}">
      </div></div>`;
    case 'number':
      return html`<div class="tok-field">${label}<input type="number" id="${id}" name="${s.key}" value="${value}" step="any" data-theme-setting="${s.key}"></div>`;
    case 'select':
      return html`<div class="tok-field">${label}<select id="${id}" name="${s.key}" data-theme-setting="${s.key}">
        ${(s.options ?? []).map((o) => html`<option value="${o.value}"${o.value === value ? raw(' selected') : raw('')}>${o.label}</option>`)}
      </select></div>`;
    case 'image':
      return html`<div class="tok-field">${label}<div class="media-field">
        <input type="hidden" id="${id}" name="${s.key}" value="${value}" data-theme-setting="${s.key}" data-media-field>
        <div class="row">
          ${value && /^(\/|https?:)/.test(value) ? html`<img src="${value}" alt="" style="max-height:4rem;border-radius:.4rem">` : ''}
          <button type="button" class="btn ghost small" data-open-picker="${id}">Choose image</button>
          <input type="text" value="${value}" data-media-text aria-label="${s.label} URL" data-theme-text="${s.key}">
        </div>
      </div></div>`;
    default:
      return html`<div class="tok-field">${label}<input type="text" id="${id}" name="${s.key}" value="${value}"${s.type === 'url' ? raw(' inputmode="url"') : raw('')} data-theme-setting="${s.key}"></div>`;
  }
}

/* ------------------------------------------------------------- customize */

appearance.get('/appearance', async (c) => {
  const base = c.var.base;
  const s = await getSettings(c.env);
  const theme = await currentTheme(c);
  const saved = await savedThemeSettings(c, theme.slug);
  const values = readTokens(s);
  const themeSettings = resolveSettings(theme.manifest, saved);
  const supported = supportedTokens(theme.css);
  const unsupported = TOKENS.flatMap((g) => g.fields).filter((f) => !supported.some((x) => x.key === f.key));
  // Where the preview should start. It is only used to bring the frame back to
  // the page you were looking at after a Discard.
  const startPath = c.req.query('path') || '/';

  return layout(c, 'Customize', html`
${pageHead({
    title: 'Customize',
    sub: html`Live preview · <b>${theme.name}</b> v${theme.version}`,
    actions: html`<a class="btn ghost" href="/?preview=1&customize=1" target="_blank" rel="noopener">Open preview in a tab</a>
      <a class="btn ghost" href="${base}/themes">Change theme</a>`,
  })}
${notice(html`Changes show in the preview as you type. <b>Nothing is saved until you press Save.</b> A theme only offers the settings it can honour.`, { tone: 'info' })}

<form method="post" action="${base}/appearance" id="customizer" class="customizer"
      data-preview-url="${base}/appearance/preview" data-start-path="${startPath}"
      data-cancel-url="${base}/appearance/preview/end">
  ${csrfField(c)}
  <div class="customizer__controls">
    <div class="customizer__bar">
      <div class="seg" role="group" aria-label="Preview width">
        <button type="button" class="seg__btn" data-device="desktop" aria-pressed="true" title="Desktop">${icon('monitor', { cls: 'ico--sm' })}<span>Desktop</span></button>
        <button type="button" class="seg__btn" data-device="tablet" aria-pressed="false" title="Tablet">${icon('grid', { cls: 'ico--sm' })}<span>Tablet</span></button>
        <button type="button" class="seg__btn" data-device="mobile" aria-pressed="false" title="Mobile">${icon('user', { cls: 'ico--sm' })}<span>Mobile</span></button>
      </div>
      <span class="customizer__state" id="customizer-state" role="status" aria-live="polite">Saved</span>
      <p class="row" style="margin:0">
        <button class="btn small" type="submit">Save</button>
        <button class="btn ghost small" type="button" data-customizer-cancel>Discard</button>
      </p>
    </div>

    ${TOKENS.map((group) => {
      const fields = group.fields.filter((f) => supported.some((x) => x.key === f.key));
      if (!fields.length) return '';
      return card({
        title: group.label,
        head: html`<span class="muted">${group.blurb}</span>`,
        body: html`<div class="tok-grid">${fields.map((f) => tokenField(c, f, values[f.key] ?? '', themeValue(theme.css, f.key)))}</div>`,
      });
    })}

    ${theme.manifest.settings.length ? card({
      title: `${theme.name} settings`,
      head: html`<span class="muted">Declared by the theme in <code>theme.json</code></span>`,
      body: html`<div class="tok-grid">
        ${theme.manifest.settings.map((st) => themeSettingField(st, themeSettings[st.key] ?? ''))}
      </div>`,
    }) : ''}

    ${unsupported.length ? html`<details class="card card--quiet">
      <summary><b>Not offered by ${theme.name}</b> <span class="muted">· ${unsupported.length} design ${unsupported.length === 1 ? 'token' : 'tokens'}</span></summary>
      <p class="hint">This theme's stylesheet does not read these variables, so changing them would do nothing visible. Install a theme that uses them, or set them under Custom code.</p>
      <ul class="tok-list">${unsupported.map((f) => html`<li><code>${cssVarFor(f.key)}</code> ${f.label}</li>`)}</ul>
    </details>` : ''}

    <details class="card">
      <summary><b>Custom code</b> <span class="muted">· CSS, head, footer and JavaScript</span></summary>
      <p class="hint" style="margin-top:.6rem">Raw code, added to every public page exactly as written. Only admins can change it, and it is not checked by the theme validator.</p>
      <label for="custom_css">Additional CSS</label>
      <textarea id="custom_css" name="custom_css" class="code" spellcheck="false" placeholder=":root { --brand: #2457d6; }">${s.custom_css ?? ''}</textarea>
      <label for="custom_head">Header code</label>
      <textarea id="custom_head" name="custom_head" class="code" style="min-height:10rem" spellcheck="false" placeholder="&lt;meta name=&quot;google-site-verification&quot; content=&quot;…&quot;&gt;">${s.custom_head ?? ''}</textarea>
      <label for="custom_footer">Footer code</label>
      <textarea id="custom_footer" name="custom_footer" class="code" style="min-height:10rem" spellcheck="false">${s.custom_footer ?? ''}</textarea>
      <label for="custom_js">JavaScript</label>
      <textarea id="custom_js" name="custom_js" class="code" style="min-height:10rem" spellcheck="false" placeholder="document.documentElement.classList.add('js');">${s.custom_js ?? ''}</textarea>
      <p class="hint" style="margin-bottom:0">Scripts are wrapped in a <code>&lt;script&gt;</code> tag for you and carry the page's CSP nonce. Keep the site usable without JavaScript.</p>
    </details>

    <p class="hint">Looking for the logo, favicon or social image? They live under <a href="${base}/identity">Identity</a>.</p>
  </div>

  <div class="customizer__preview" data-device="desktop">
    <div class="customizer__frame" id="customizer-frame-wrap">
      <iframe id="customizer-frame" title="Live preview of your site" src="/?preview=1&amp;customize=1"
              data-nosnippet loading="eager"></iframe>
    </div>
    <p class="hint customizer__nojsws">With JavaScript off, save first and then open <a href="/?preview=1">the site preview</a>.</p>
  </div>
  <input type="hidden" name="start_path" value="${startPath}">
</form>
${raw(CUSTOMIZER_JS)}`, '/appearance', { wide: true });
});

appearance.post('/appearance', async (c) => {
  const f = c.var.form;
  const text = (k: string, max: number) => String(f.get(k) ?? '').slice(0, max).trim();
  const theme = await currentTheme(c);

  // Tokens: validated per field, so a bad colour cannot reach the CSS.
  const tokenInput: Record<string, unknown> = {};
  for (const field of TOKENS.flatMap((g) => g.fields)) {
    if (f.has(field.key)) tokenInput[field.key] = f.get(field.key);
  }
  const { values, problems } = cleanTokens(tokenInput);
  if (problems.length) return go(c, '/appearance', { err: problems[0] });

  // Theme settings: only keys the theme declares; toggles are "" or "1".
  const themeRows: { key: string; value: string }[] = [];
  for (const st of theme.manifest.settings) {
    if (!f.has(st.key)) continue;
    const rawValue = st.type === 'toggle'
      ? (String(f.get(st.key) ?? '') === '1' ? '1' : '')
      : String(f.get(st.key) ?? '').slice(0, 2000);
    themeRows.push({ key: st.key, value: rawValue });
  }

  // Token keys the theme does not read are still stored: the site owner may
  // switch theme later and expect their brand to follow. Nothing is emitted
  // for a variable the current theme does not read (see render.ts).
  const tokenSettings: Record<string, string> = {};
  for (const field of TOKENS.flatMap((g) => g.fields)) {
    const value = values[field.key] ?? '';
    if (value) tokenSettings[field.key] = value;
  }
  const clears: string[] = [];
  for (const field of TOKENS.flatMap((g) => g.fields)) {
    if (f.has(field.key) && !tokenSettings[field.key]) clears.push(field.key);
  }

  // Clearing a token must clear it: an empty value would still be a row, and
  // `readTokens` reads any non-empty string, so a deleted brand colour would
  // stay on the site forever.
  if (clears.length) {
    await c.env.DB.batch(clears.map((key) => c.env.DB.prepare('DELETE FROM settings WHERE site_id=1 AND key=?').bind(key)));
  }
  await setSettings(c.env, {
    ...tokenSettings,
    custom_css: text('custom_css', 100000),
    custom_head: text('custom_head', 50000),
    custom_footer: text('custom_footer', 50000),
    custom_js: text('custom_js', 50000),
  });
  if (themeRows.length) {
    try {
      await c.env.DB.batch(themeRows.map((r) => c.env.DB.prepare(
        `INSERT INTO theme_settings (theme_slug, key, value) VALUES (?,?,?)
         ON CONFLICT(theme_slug, key) DO UPDATE SET value=excluded.value`,
      ).bind(theme.slug, r.key, r.value)));
    } catch {
      return go(c, '/appearance', { err: 'This database cannot store theme settings yet. Run the updates first.' });
    }
  }
  clearPreviewCookie(c);
  clearThemeValueCache(c.env);
  await bumpCache(c.env, c.var.cfg);
  const touched = [...Object.keys(tokenSettings), ...themeRows.map((r) => r.key), 'custom_css', 'custom_head', 'custom_footer', 'custom_js']
    .filter((key) => f.has(key));
  await audit(c, 'settings', 'theme', `Saved the Customizer for “${theme.name}” (${touched.length} field${touched.length === 1 ? '' : 's'})`);
  // Stay in the Customizer when the save came from it, so the preview keeps its context.
  const fromCustomizer = String(f.get('start_path') ?? '') !== '';
  return go(c, fromCustomizer ? `/appearance?path=${encodeURIComponent(String(f.get('start_path') || '/'))}` : '/appearance', { ok: 'Saved. Every page is up to date.' });
});

/**
 * The preview channel. The browser posts the *unsaved* control values here; the
 * server validates them exactly as it would on save and mints a signed,
 * short-lived cookie. The iframe then reloads and renders the real site with
 * those values. Nothing is stored, and the cookie dies after 30 minutes.
 */
appearance.post('/appearance/preview', async (c) => {
  const f = c.var.form;
  const theme = await currentTheme(c);
  const savedSettings = await getSettings(c.env);
  const savedTokens = readTokens(savedSettings);
  const savedTheme = await savedThemeSettings(c, theme.slug);

  // Tokens: proposed values, validated; only differences from what is saved go
  // in the cookie, so it stays well under the 4 KB browser limit.
  const proposed: Record<string, string> = {};
  for (const field of TOKENS.flatMap((g) => g.fields)) {
    if (!f.has(field.key)) continue;
    proposed[field.key] = String(f.get(field.key) ?? '');
  }
  const { values: cleaned, problems } = cleanTokens(proposed);
  const tokens = diff(cleaned, savedTokens);

  const proposedTheme: Record<string, string> = {};
  for (const st of theme.manifest.settings) {
    if (!f.has(st.key)) continue;
    proposedTheme[st.key] = st.type === 'toggle' ? (String(f.get(st.key)) === '1' ? '1' : '') : String(f.get(st.key) ?? '').slice(0, 500);
  }
  const settingsOverrides = diff(proposedTheme, resolveSettings(theme.manifest, savedTheme));

  const payload: PreviewPayload = {
    exp: Date.now() + PREVIEW_TTL_MS,
    tokens: Object.keys(tokens).length ? tokens : undefined,
    settings: Object.keys(settingsOverrides).length ? settingsOverrides : undefined,
    theme: c.req.query('theme') ? String(c.req.query('theme')).slice(0, 60) : undefined,
  };
  const stored = await setPreviewCookie(c, payload);
  return c.json({
    ok: stored,
    problems,
    changed: Object.keys(tokens).length + Object.keys(settingsOverrides).length,
    css: tokensCss(tokens, { only: new Set(supportedCssNames(theme.css)) }),
    error: stored ? undefined : 'The preview is too large to channel through a cookie. Save, or preview fewer changes at once.',
  });
});

/** Every variable name a token can reach in this theme (its own names + aliases). */
function supportedCssNames(css: string): string[] {
  const only = new Set<string>();
  for (const field of supportedTokens(css)) {
    for (const name of variablesFor(field.key)) only.add(name);
  }
  return [...only];
}

/** Ends a preview session early ("Discard"). */
appearance.post('/appearance/preview/end', (c) => {
  clearPreviewCookie(c);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------- templates */

appearance.get('/templates', async (c) => {
  const base = c.var.base;
  const theme = await currentTheme(c);
  const list = (await activeThemeTemplates(c.env)).templates;
  const layoutName = await activeLayoutName(c.env);
  const { results: overrides } = await c.env.DB.prepare(
    "SELECT id, title, slug, type, template FROM content WHERE site_id=1 AND template<>'' ORDER BY type, title",
  ).all<{ id: number; title: string; slug: string; type: string; template: string }>().catch(() => ({ results: [] }));

  const describe: Record<string, string> = {
    home: 'The front page.',
    page: 'Every page that does not choose another template.',
    post: 'Every blog post that does not choose another template.',
    archive: 'Blog index, category and tag archives.',
    '404': 'Anything that is not found.',
  };

  return layout(c, 'Templates', html`
${pageHead({
    title: 'Templates',
    sub: html`From <b>${theme.name}</b>, wrapped in the <code>${layoutName}</code> layout.`,
    actions: html`<a class="btn ghost" href="${base}/themes">Themes</a>`,
  })}
${notice(html`A page or post can pick its own template in the editor. This screen lists what this theme offers, so you know what to pick.`, { tone: 'info' })}
<div class="grid3 templates">
  ${list.map((name) => html`<div class="tile tile--template">
    <b>${name}</b>
    <span>${describe[name] ?? 'A template this theme adds.'}</span>
    <span class="muted"><code>${name}.html</code> · ${theme.templates[name] ? theme.templates[name].length : 0} bytes</span>
  </div>`)}
</div>
${card({
    title: 'Pages using a custom template',
    head: html`<span class="muted">${overrides.length}</span>`,
    body: overrides.length
      ? html`<ul class="list">${overrides.map((row) => html`<li>
          <div class="t"><a href="${base}/${row.type === 'post' ? 'posts' : 'pages'}/${row.id}">${row.title}</a>
          <small>${row.type} · template <code>${row.template}</code></small></div></li>`)}</ul>`
      : html`<p class="muted" style="margin:0">No page overrides its template yet. Open a page in the editor and pick one under <b>Publish → Template</b>.</p>`,
  })}
`, '/templates');
});

/* ----------------------------------------------------------------- identity */

const IDENTITY_FIELDS: { key: string; label: string; help: string; placeholder: string }[] = [
  { key: 'site_logo', label: 'Logo', help: 'Replaces the site title in themes that support it. PNG, JPEG or WebP, roughly 2:1.', placeholder: '/media/2026/01/logo.png' },
  { key: 'favicon', label: 'Favicon', help: 'The small icon in the browser tab. A 32×32 or 512×512 PNG works everywhere.', placeholder: '/media/2026/01/icon.png' },
  { key: 'social_image', label: 'Social sharing image', help: 'Shown when a link to your site is shared. 1200×630 is the usual size.', placeholder: '/media/2026/01/share.png' },
];

appearance.get('/identity', async (c) => {
  const base = c.var.base;
  const s = await getSettings(c.env);
  return layout(c, 'Identity', html`
${pageHead({
    title: 'Identity',
    sub: 'The logo, the tab icon and the image a shared link shows.',
    actions: html`<a class="btn ghost" href="${base}/settings">Site title & tagline</a>`,
  })}
<form method="post" action="${base}/identity" id="identity">
  ${csrfField(c)}
  ${card({
    title: 'Images',
    head: html`<span class="muted">Uploaded from Media, referenced by URL</span>`,
    body: html`${IDENTITY_FIELDS.map((f) => html`<div class="media-field identity-field">
      <label for="${f.key}">${f.label}</label>
      <div class="row">
        ${s[f.key] ? html`<img src="${s[f.key]}" alt="" class="identity-field__preview">` : html`<span class="identity-field__empty">${icon('image')}</span>`}
        <input type="text" id="${f.key}" name="${f.key}" value="${s[f.key] ?? ''}" placeholder="${f.placeholder}" data-media-field data-identity-field="${f.key}">
        <button type="button" class="btn ghost small" data-open-picker="${f.key}">Choose image</button>
      </div>
      <p class="hint" style="margin-bottom:0">${f.help}</p>
    </div>`)}`,
  })}
  ${card({
    title: 'Defaults',
    head: html`<span class="muted">What an untouched theme starts from</span>`,
    body: html`<div class="tok-grid">
      <div class="tok-field">
        <label for="token_scheme">Colour scheme</label>
        <select id="token_scheme" name="token_scheme">
          ${[['auto', 'Follow the visitor'], ['light', 'Always light'], ['dark', 'Always dark']].map(([v, label]) => html`<option value="${v}"${(s.token_scheme || 'auto') === v ? raw(' selected') : raw('')}>${label}</option>`)}
        </select>
        <span class="field__help">Themes follow this through <code>color-scheme</code>.</span>
      </div>
      <div class="tok-field">
        <label for="token_brand">Brand colour</label>
        <div class="tok-color">
          <input type="color" id="token_brand" name="token_brand" value="${/^#[0-9a-f]{6}$/i.test(s.token_brand || '') ? s.token_brand : '#2457d6'}">
          <input type="text" value="${s.token_brand ?? ''}" class="tok-color__text" data-token-text="token_brand" maxlength="9" aria-label="Brand colour hex value" spellcheck="false">
        </div>
        <span class="field__help">Every design token lives in <a href="${base}/appearance">Customize</a>.</span>
      </div>
    </div>`,
  })}
  <p><button class="btn" type="submit">Save identity</button></p>
</form>
${raw(mediaPicker({ endpoint: `${base}/media/picker`, uploadUrl: `${base}/media/picker/upload`, csrf: c.var.csrf }))}
${raw(PICKER_JS)}
${raw(IDENTITY_JS)}`, '/identity');
});

appearance.post('/identity', async (c) => {
  const f = c.var.form;
  const link = (k: string) => {
    const value = String(f.get(k) ?? '').trim().slice(0, 500);
    return value ? safeUrl(value) : '';
  };
  const scheme = ['auto', 'light', 'dark'].includes(String(f.get('token_scheme') ?? '')) ? String(f.get('token_scheme')) : 'auto';
  const brand = cleanTokens({ token_brand: f.get('token_brand') }).values.token_brand ?? '';
  const values: Record<string, string> = {
    site_logo: link('site_logo'),
    favicon: link('favicon'),
    social_image: link('social_image'),
    token_scheme: scheme,
  };
  if (brand) values.token_brand = brand;
  await setSettings(c.env, values);
  if (!brand) await c.env.DB.prepare("DELETE FROM settings WHERE site_id=1 AND key='token_brand'").run();
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'settings', 'setting', 'Saved Identity (logo, favicon, social image, scheme)');
  return go(c, '/identity', { ok: 'Identity saved.' });
});

/* ------------------------------------------------------------------ widgets */

appearance.get('/widgets', async (c) => {
  const base = c.var.base;
  const s = await getSettings(c.env);
  const theme = await currentTheme(c);
  const areas = themeAreas(theme);
  const used = areas.reduce((n, a) => n + [1, 2, 3].filter((i) => (s[widgetKeyFor(a.key, i, 'body')] ?? '').trim()).length, 0);
  return layout(c, 'Widgets', html`
${pageHead({
    title: 'Widgets',
    sub: html`${areas.length} ${areas.length === 1 ? 'area' : 'areas'} from <b>${theme.name}</b> · ${used} filled`,
    actions: html`<a class="btn ghost" href="${base}/themes/${encodeURIComponent(theme.slug)}">Theme settings</a>`,
  })}
${notice(html`A widget area exists because the theme draws it with <code>{{{widgets "footer"}}}</code>. Each area holds up to three slots; leave a slot empty to hide it. Titles are plain text, bodies accept HTML.`, { tone: 'info' })}
<form method="post" action="${base}/widgets">
  ${csrfField(c)}
  ${areas.map((area) => card({
    title: area.label,
    head: html`<span class="muted"><code>widgets.${area.key}</code></span>`,
    body: html`${area.help ? html`<p class="hint" style="margin-top:0">${area.help}</p>` : ''}
      ${[1, 2, 3].map((n) => html`<div class="widget-slot">
        <h3>Slot ${n}</h3>
        <label for="widget-${area.key}-${n}-title">Title</label>
        <input type="text" id="widget-${area.key}-${n}-title" name="${widgetKeyName(area.key, n, 'title')}"
               value="${s[widgetKeyFor(area.key, n, 'title')] ?? ''}" maxlength="120" placeholder="Optional">
        <label for="widget-${area.key}-${n}-body">Content</label>
        <textarea id="widget-${area.key}-${n}-body" name="${widgetKeyName(area.key, n, 'body')}" maxlength="5000"
                  placeholder="&lt;p&gt;About this site…&lt;/p&gt;">${s[widgetKeyFor(area.key, n, 'body')] ?? ''}</textarea>
      </div>`)}`,
  }))}
  <p><button class="btn" type="submit">Save widgets</button></p>
</form>`, '/widgets');
});

// The settings key for one slot comes from the manifest module, so the panel
// and the renderer can never disagree about it.
const widgetKeyName = widgetKey;
const widgetKeyFor = (area: string, slot: number, field: 'title' | 'body') => widgetKey(area, slot, field);

appearance.post('/widgets', async (c) => {
  const f = c.var.form;
  const theme = await currentTheme(c);
  const areas = themeAreas(theme);
  const values: Record<string, string> = {};
  for (const area of areas) {
    for (const n of [1, 2, 3]) {
      for (const field of ['title', 'body'] as const) {
        const key = widgetKeyName(area.key, n, field);
        values[key] = String(f.get(key) ?? '').slice(0, field === 'title' ? 120 : 5000).trim();
      }
    }
  }
  await setSettings(c.env, values);
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'settings', 'theme', 'Saved widgets');
  return go(c, '/widgets', { ok: 'Widgets saved.' });
});

/* ------------------------------------------------------------ dashboard tile */

/** Everything the Appearance hub needs on the dashboard, in one query set. */
export async function appearanceSummary(c: Ctx): Promise<{ themes: number; active: string; templates: string[] }> {
  const [themes, active] = await Promise.all([
    listThemes(c.env),
    activeThemeTemplates(c.env).catch(() => ({ templates: [] as string[] })),
  ]);
  return {
    themes: themes.length,
    active: (await currentTheme(c)).name,
    templates: active.templates,
  };
}

/* ------------------------------------------------------------------ client */

/**
 * The Customizer's client script. Plain ES5-ish JavaScript in a string, so a
 * screen needs no build step and the panel keeps its no-framework rule.
 *
 * Flow: change a control → debounce 300 ms → POST every control value to
 * /appearance/preview → reload the iframe (cache-busted). The CSS that comes
 * back is also injected into the parent, so the swatch shows the effect even
 * while the iframe is loading. Discard ends the session; Save commits.
 */
export const CUSTOMIZER_JS = `<script>
(function () {
  'use strict';
  var form = document.getElementById('customizer');
  if (!form) return;
  var frame = document.getElementById('customizer-frame');
  var state = document.getElementById('customizer-state');
  var previewUrl = form.getAttribute('data-preview-url');
  var cancelUrl = form.getAttribute('data-cancel-url');
  var startPath = form.getAttribute('data-start-path') || '/';
  var timer = null, inflight = false, dirty = false;
  var csrf = form.querySelector('input[name="_csrf"]');

  function setState(text, tone) {
    if (!state) return;
    state.textContent = text;
    state.setAttribute('data-tone', tone || '');
  }

  function controls() {
    return form.querySelectorAll('[data-token],[data-theme-setting]');
  }

  function body() {
    var data = new URLSearchParams();
    data.append('_csrf', csrf ? csrf.value : '');
    var seen = {};
    controls().forEach(function (el) {
      var name = el.getAttribute('data-token') || el.getAttribute('data-theme-setting');
      if (!name || seen[name]) return;
      seen[name] = true;
      if (el.type === 'checkbox') { data.append(name, el.checked ? '1' : ''); return; }
      // A text mirror of a colour picker wins when it holds a valid hex.
      var twins = form.querySelectorAll('[data-token-text="' + name + '"]');
      if (twins.length && /^#[0-9a-f]{3,8}$/i.test(twins[0].value)) { data.append(name, twins[0].value); return; }
      data.append(name, el.value);
    });
    return data;
  }

  function inject(css) {
    var style = document.getElementById('customizer-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'customizer-css';
      document.head.appendChild(style);
    }
    style.textContent = css || '';
  }

  function reload() {
    if (!frame) return;
    var url = '/?preview=1&customize=1&_=' + Date.now();
    frame.src = url;
  }

  function post() {
    if (inflight) return;
    inflight = true;
    setState('Updating…', 'busy');
    fetch(previewUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      body: body().toString(),
    }).then(function (r) { return r.json(); }).then(function (res) {
      inflight = false;
      if (!res.ok) { setState(res.error || 'Preview unavailable', 'err'); return; }
      dirty = true;
      inject(res.css);
      reload();
      setState(res.changed ? 'Unsaved changes' : 'Saved', res.changed ? 'warn' : '');
    }).catch(function () {
      inflight = false;
      setState('Preview unavailable', 'err');
    });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(post, 300);
  }

  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);

  // Text mirror ↔ colour picker: keep the two in step.
  form.addEventListener('input', function (e) {
    var el = e.target;
    if (el.hasAttribute && el.hasAttribute('data-token-text')) {
      var name = el.getAttribute('data-token-text');
      var picker = form.querySelector('[data-token="' + name + '"]');
      if (picker && picker.type === 'color' && /^#[0-9a-f]{6}$/i.test(el.value)) picker.value = el.value;
    }
    if (el.hasAttribute && el.getAttribute('data-unit')) {
      var out = form.querySelector('[data-token-output="' + el.getAttribute('data-token') + '"]');
      if (out) out.textContent = el.value + el.getAttribute('data-unit');
    }
  });

  // Reset one token to the theme's own value: clear the field, re-preview.
  form.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-token-reset]') : null;
    if (!btn) return;
    var name = btn.getAttribute('data-token-reset');
    var el = form.querySelector('[data-token="' + name + '"]');
    var text = form.querySelector('[data-token-text="' + name + '"]');
    var picker = form.querySelector('input[type="color"][name="' + name + '"]');
    if (name === 'token_font_body') { if (el) el.value = 'system'; }
    else if (picker) {
      var fallback = picker.getAttribute('data-theme-default') || '#000000';
      if (el) el.value = /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : '#000000';
      if (text) text.value = fallback;
    } else if (el) el.value = '';
    schedule();
  });

  // Devices: only the frame's width changes, so the site's own breakpoints decide.
  form.querySelectorAll('[data-device]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var device = btn.getAttribute('data-device');
      var pane = form.querySelector('.customizer__preview');
      if (pane) pane.setAttribute('data-device', device);
      form.querySelectorAll('[data-device]').forEach(function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-device') === device ? 'true' : 'false');
      });
    });
  });

  // Discard: clear the signed preview cookie and reload the real site.
  var discard = form.querySelector('[data-customizer-cancel]');
  if (discard) discard.addEventListener('click', function () {
    fetch(cancelUrl, { method: 'POST', credentials: 'same-origin', body: new URLSearchParams({ _csrf: csrf ? csrf.value : '' }) })
      .catch(function () {})
      .then(function () {
        inject('');
        if (frame) frame.src = startPath + (startPath.indexOf('?') === -1 ? '?' : '&') + 'preview=1&customize=1&_=' + Date.now();
        setState('Saved', '');
      });
  });

  // Leave the page with unsaved changes: browsers ask first.
  window.addEventListener('beforeunload', function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('message', function (e) {
    if (e.data === 'ams:preview-saved') dirty = false;
  });
})();
</script>`;

const IDENTITY_JS = `<script>
(function () {
  'use strict';
  // The media picker hands back a URL; the field and its preview follow.
  document.querySelectorAll('[data-open-picker]').forEach(function (button) {
    button.addEventListener('click', function () {
      var id = button.getAttribute('data-open-picker');
      var field = document.getElementById(id);
      if (!field || !window.amsMediaPicker) return;
      var picker = window.amsMediaPicker({ onPick: function (item) {
        field.value = item.url;
        var preview = field.parentNode.querySelector('img');
        if (!preview) {
          preview = document.createElement('img');
          preview.className = 'identity-field__preview';
          preview.alt = '';
          field.parentNode.insertBefore(preview, field);
        }
        preview.src = item.url;
      } });
      if (!picker) return;
      var current = field.value;
      if (current) picker.search(current.split('/').pop() || '');
    });
  });
})();
</script>`;

export default appearance;
