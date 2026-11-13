import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { pageHead, card, notice } from '../../admin/components';
import { icon, PAGE_ICONS, pageIcons } from '../../admin/icons';
import { csrfField, go, html, layout, raw } from '../../lib/ui';
import { can } from '../../lib/capabilities';
import { getSettings, setSettings } from '../../lib/config';
import { DENSITIES, SCHEMES, parsePrefs, readPrefs, writePrefs, type Density, type Scheme } from '../../lib/prefs';

/**
 * Preferences: how the panel looks for *this* browser. Scheme, density and the
 * sidebar state are cookies (read while rendering, so there is no flash);
 * account details stay on the profile page.
 */
const preferences = new Hono<AppEnv>();

const SCHEME_INFO: { value: Scheme; label: string; detail: string; icon: string }[] = [
  { value: 'auto', label: 'Match my system', detail: 'Follow the light or dark setting of your computer or phone.', icon: 'monitor' },
  { value: 'light', label: 'Light', detail: 'Always the light panel.', icon: 'sun' },
  { value: 'dark', label: 'Dark', detail: 'Always the dark panel.', icon: 'moon' },
];

const DENSITY_INFO: { value: Density; label: string; detail: string }[] = [
  { value: 'comfortable', label: 'Comfortable', detail: 'Roomier rows and controls. The default.' },
  { value: 'compact', label: 'Compact', detail: 'Smaller type and tighter rows, for long editing sessions.' },
];

preferences.get('/preferences', async (c) => {
  const prefs = readPrefs(c);
  const base = c.var.base;
  const icons = pageIcons(await getSettings(c.env));
  const option = (name: string, value: string, checked: boolean, label: string, detail: string, iconName?: string) => html`
  <label class="pref-option${checked ? ' is-on' : ''}">
    <input type="radio" name="${name}" value="${value}"${checked ? raw(' checked') : raw('')}>
    <span class="pref-option__body">
      <b>${iconName ? html`${icon(iconName)} ` : ''}${label}</b>
      <span>${detail}</span>
    </span>
  </label>`;

  return layout(c, 'Preferences', html`
${pageHead({
    title: 'Preferences',
    sub: 'These settings belong to this browser. They do not change the site for visitors.',
    crumbs: [{ label: 'Dashboard', href: base }, { label: 'Preferences' }],
  })}
<form method="post" action="${base}/preferences">
  ${csrfField(c)}
  <div class="card">
    <h2>Colour scheme</h2>
    <p class="hint" style="margin-top:0">The panel follows your system by default. Pages you publish always follow the visitor's own setting.</p>
    <div class="pref-grid">
      ${SCHEME_INFO.map((s) => option('scheme', s.value, prefs.scheme === s.value, s.label, s.detail, s.icon))}
    </div>
  </div>
  <div class="card">
    <h2>Density</h2>
    <div class="pref-grid">
      ${DENSITY_INFO.map((d) => option('density', d.value, prefs.density === d.value, d.label, d.detail))}
    </div>
  </div>
  <div class="card">
    <h2>Sidebar</h2>
    <label class="check"><input type="checkbox" name="railCollapsed" value="1"${prefs.railCollapsed ? raw(' checked') : raw('')}> Start with the sidebar collapsed</label>
    <p class="hint">On a wide screen the sidebar can shrink to icons with the control at its bottom. This decides how it opens next time.</p>
  </div>
  <div class="btn-row" style="margin-bottom:1.5rem"><button class="btn" type="submit">Save preferences</button></div>
</form>
${can(c.var.user, 'manage_settings') ? html`<form method="post" action="${base}/preferences/page-icons" class="card" id="icon-settings">
  ${csrfField(c)}<h2>Icon Settings → Pages</h2><p class="hint">Choose the icons used in the panel for pages with children and other pages.</p>
  <label for="parent-icon">Parent page / folder icon</label><select id="parent-icon" name="parent_icon">${PAGE_ICONS.map((name) => html`<option value="${name}"${icons.parent === name ? raw(' selected') : ''}>${name}</option>`)}</select>
  <label for="child-icon">Child page / document icon</label><select id="child-icon" name="child_icon">${PAGE_ICONS.map((name) => html`<option value="${name}"${icons.child === name ? raw(' selected') : ''}>${name}</option>`)}</select>
  <p><button class="btn" type="submit">Save page icons</button></p></form>` : ''}
${card({
      title: 'Account',
      body: html`<p class="muted" style="margin-top:0">Signed in as <b>${c.var.user.username}</b> (${c.var.user.role}). Change your email or password on the profile page.</p>
<p style="margin-bottom:0"><a class="btn ghost" href="${base}/profile">Go to profile</a></p>`,
    })}`, '/preferences');
});

preferences.post('/preferences', (c) => {
  const f = c.var.form;
  const prefs = parsePrefs({
    scheme: f.get('scheme'),
    density: f.get('density'),
    railCollapsed: f.get('railCollapsed'),
  });
  writePrefs(c, prefs);
  return go(c, '/preferences', { ok: 'Preferences saved for this browser.' });
});

preferences.post('/preferences/page-icons', async (c) => {
  if (!can(c.var.user, 'manage_settings')) return c.text('Forbidden', 403);
  const parent = String(c.var.form.get('parent_icon') || '');
  const child = String(c.var.form.get('child_icon') || '');
  if (!PAGE_ICONS.includes(parent as typeof PAGE_ICONS[number]) || !PAGE_ICONS.includes(child as typeof PAGE_ICONS[number])) return go(c, '/preferences#icon-settings', { err: 'Choose valid page icons.' });
  await setSettings(c.env, { page_parent_icon: parent, page_child_icon: child });
  return go(c, '/preferences', { ok: 'Page icons saved.' });
});

export default preferences;
