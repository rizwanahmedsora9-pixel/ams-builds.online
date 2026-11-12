import { Hono } from 'hono';
import { audit } from '../../lib/audit';
import type { AppEnv, Ctx } from '../../types';
import { can } from '../../lib/auth';
import { bumpCache, getSettings, setSettings } from '../../lib/config';
import { landingEnabled, landingPlayShown, parseLandingAudioIds } from '../../lib/landing';
import { card, notice, pageHead } from '../../admin/components';
import { icon } from '../../admin/icons';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';

/**
 * Landing page.
 *
 * The welcome screen is built into the site (never a CMS Page), so its two
 * decisions live on their own screen instead of being buried in Settings: is it
 * shown at all, and does it offer the play control? The soundtrack files
 * themselves stay in Settings → Landing screen, next to the media library that
 * serves them; this screen only switches what a visitor gets.
 *
 * Both switches are stored as "1"/"0" and default to on when absent, so an
 * install that never opens this screen behaves exactly as before.
 */
const landing = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_settings')) return errorPage(c, 403, 'Only admins can change the landing page.');
  await next();
};
landing.use('/landing', guard);

/** A yes/no pair of radio cards; `on` marks the saved answer. */
function yesNo(name: string, on: boolean, yesDetail: string, noDetail: string) {
  const option = (value: '1' | '0', label: string, detail: string, active: boolean) => html`
  <label class="pref-option${active ? ' is-on' : ''}">
    <input type="radio" name="${name}" value="${value}"${active ? raw(' checked') : raw('')}>
    <span class="pref-option__body">
      <b>${label}</b>
      <span>${detail}</span>
    </span>
  </label>`;
  return html`<div class="pref-grid">
    ${option('1', 'Yes', yesDetail, on)}
    ${option('0', 'No', noDetail, !on)}
  </div>`;
}

landing.get('/landing', async (c) => {
  const base = c.var.base;
  const s = await getSettings(c.env);
  const on = landingEnabled(s);
  const play = landingPlayShown(s);
  const tracks = parseLandingAudioIds(s.landing_audio_ids).length;

  return layout(c, 'Landing page', html`
${pageHead({
  title: 'Landing page',
  sub: 'The welcome screen at your home address: whether it opens at all, and whether it offers music.',
  actions: html`<a class="btn ghost" href="/?landing=1" target="_blank" rel="noopener">${icon('external', { cls: 'ico--sm' })}Preview</a>
    <a class="btn ghost" href="${base}/settings#landing">Soundtrack</a>`,
})}
<form method="post" action="${base}/landing" id="landing-options">
  ${csrfField(c)}
  ${card({
    title: 'Show the landing page',
    head: html`<span class="muted">${on ? 'Currently on' : 'Currently off'}</span>`,
    body: html`<p class="hint" style="margin-top:0">The screen opens once per tab session, over the normal home page, until the visitor presses <b>Enter site</b>. It is not a Page and has no sample content: the name comes from <b>Settings → Site title</b>, the welcome line from <b>Settings → Tagline</b>, and the logo from <b>Appearance → Identity</b>.</p>
      ${yesNo('landing_enabled', on, 'Visitors see the welcome screen first, then enter the site.', 'The home page opens directly, with no welcome layer at all.')}`,
  })}
  ${card({
    title: 'Show the play button on the landing page',
    head: html`<span class="muted">${play ? 'Currently shown' : 'Currently hidden'}</span>`,
    body: html`<p class="hint" style="margin-top:0">The round play/pause control, the equalizer and the mute button. With it hidden the screen is just the welcome copy and <b>Enter site</b>, and no audio is downloaded. Your soundtrack stays saved, so switching this back on brings it back.</p>
      ${yesNo('landing_play_button', play, 'The screen offers the soundtrack, and pressing play starts it.', "No play control and no audio download — the screen is welcome copy only.")}
      ${notice(tracks
        ? html`<b>${tracks === 1 ? '1 track' : `${tracks} tracks`}</b> in the playlist. Add, remove or reorder them under <a href="${base}/settings#landing">Settings → Landing soundtrack</a>.`
        : html`No soundtrack yet. Upload audio under <a href="${base}/settings#landing">Settings → Landing soundtrack</a>.`)}`,
  })}
  <p><button class="btn" type="submit">Save landing options</button></p>
</form>`, '/landing');
});

landing.post('/landing', async (c) => {
  const on = String(c.var.form.get('landing_enabled') ?? '') === '1';
  const play = String(c.var.form.get('landing_play_button') ?? '') === '1';
  await setSettings(c.env, {
    landing_enabled: on ? '1' : '0',
    landing_play_button: play ? '1' : '0',
  });
  // The splash is part of the cached home response, so the generation changes.
  await bumpCache(c.env, c.var.cfg);
  await audit(c, 'settings', 'setting', `Landing page ${on ? 'on' : 'off'}, play button ${play ? 'shown' : 'hidden'}`);
  return go(c, '/landing', { ok: `Landing options saved. The welcome screen is ${on ? 'on' : 'off'}${on ? `, with the play button ${play ? 'shown' : 'hidden'}` : ''}.` });
});

export default landing;
