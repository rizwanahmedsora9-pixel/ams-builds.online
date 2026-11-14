import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../../types';
import { can, endSession, verifyPassword } from '../../lib/auth';
import { factoryReset, hasContent, resetCounts } from '../../lib/reset';
import { csrfField, errorPage, go, html, layout, raw } from '../../lib/ui';
import { card, notice } from '../../admin/components';
import { t } from '../../lib/i18n';

/**
 * System screens: the ones that change the installation itself rather than its
 * content. Today that is the factory reset - "we built the site wrong, start
 * again from zero" - which lives under Tools, next to the backups and the cache,
 * because that is where somebody looking for it will look.
 *
 * Admin-only, like everything that can destroy data.
 */
const system = new Hono<AppEnv>();

const guard = async (c: Ctx, next: () => Promise<void>) => {
  if (!can(c.var.user, 'manage_tools')) return errorPage(c, 403, t('reset.forbidden'));
  await next();
};
system.use('/tools/reset', guard);

/**
 * The word the form has to carry. Typing it costs a moment and survives a browser
 * that autofills or restores a form; the confirmation dialog on top of it
 * (`data-confirm`) only exists when JavaScript is on, and the server checks the
 * word either way.
 */
const CONFIRM_WORD = 'RESET';

system.get('/tools/reset', async (c) => {
  const base = c.var.base;
  const counts = await resetCounts(c.env);
  const onDisk = !!c.env.FILES;
  // Labelled here rather than in lib/reset.ts so every string a screen shows is a
  // literal key the catalogue test can check.
  const rows = [
    { label: t('reset.count_pages'), count: counts.pages },
    { label: t('reset.count_posts'), count: counts.posts },
    { label: t('reset.count_media'), count: counts.media },
    { label: t('reset.count_users'), count: counts.users },
    { label: t('reset.count_themes'), count: counts.themes },
    { label: t('reset.count_menus'), count: counts.menus },
    { label: t('reset.count_redirects'), count: counts.redirects },
    { label: t('reset.count_backups'), count: counts.backups },
  ];

  return layout(c, t('reset.title'), html`
<div class="row between" style="margin-bottom:1rem">
  <h1 style="margin:0">${t('reset.title')}</h1><a href="${base}/tools">&larr; Tools</a>
</div>
${notice(t('reset.intro'), { tone: 'danger', title: t('reset.warning') })}

${card({
    title: t('reset.deleted_title'),
    body: html`
      <dl class="kv">
        ${rows.map((row) => html`<dt>${row.label}</dt><dd>${row.count}</dd>`)}
      </dl>
      <p class="hint" style="margin-bottom:0">${t('reset.also_deleted')}</p>`,
  })}

${card({
    title: t('reset.next_title'),
    body: html`
      <p style="margin-top:0">${t('reset.next_body')}</p>
      <p class="hint" style="margin-bottom:0">${onDisk ? t('reset.node_note') : t('reset.worker_note')}</p>`,
  })}

${card({
    title: t('reset.export_first'),
    body: html`
      <p class="hint" style="margin-top:0">${t('reset.export_hint')}</p>
      <p style="margin:0"><a class="btn ghost small" href="${base}/tools/export/download">${t('reset.export_download')}</a></p>`,
  })}

<form method="post" action="${base}/tools/reset" class="card" data-confirm="${t('reset.dialog')}" data-reset-form>
  ${csrfField(c)}
  <h2>${t('reset.confirm_title')}</h2>
  ${hasContent(counts) ? '' : html`<p class="hint" style="margin-top:0">${t('reset.nothing_yet')}</p>`}
  <label for="current_password">${t('reset.password')}</label>
  <input type="password" id="current_password" name="current_password" required autocomplete="current-password">
  <p class="hint">${t('reset.password_hint')}</p>
  <label for="confirm">${t('reset.confirm_label', { word: CONFIRM_WORD })}</label>
  <input type="text" id="confirm" name="confirm" required autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12">
  <p class="row" style="margin:1.1rem 0 0">
    <button class="btn danger" type="submit" data-reset-submit>${t('reset.submit')}</button>
    <a class="btn ghost" href="${base}/tools">${t('reset.cancel')}</a>
  </p>
</form>
${raw(`<script>
(function(){
  var form=document.querySelector('[data-reset-form]');if(!form)return;
  var word=${JSON.stringify(CONFIRM_WORD)},input=form.querySelector('#confirm'),submit=form.querySelector('[data-reset-submit]');
  // An enhancement only: with JavaScript off the button is live, and the server
  // refuses anything that does not carry the word all the same.
  function sync(){submit.disabled=input.value.trim().toUpperCase()!==word}
  input.addEventListener('input',sync);sync();
})();
</script>`)}`, '/tools');
});

system.post('/tools/reset', async (c) => {
  const word = String(c.var.form.get('confirm') ?? '').trim().toUpperCase();
  if (word !== CONFIRM_WORD) return go(c, '/tools/reset', { err: t('reset.err_confirm', { word: CONFIRM_WORD }) });

  // The session says who is asking; the password says it is really them and not a
  // browser that was left signed in on somebody else's machine.
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(c.var.user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(c.var.form.get('current_password') ?? ''), row.password_hash))) {
    return go(c, '/tools/reset', { err: t('reset.err_password') });
  }

  const summary = await factoryReset(c.env);
  // The audit log is deleted by the reset it would have recorded, so the lasting
  // record of this is the server log.
  console.warn(
    `factory reset by ${c.var.user.username} (user ${c.var.user.id}): `
    + `${summary.tables} tables cleared, ${summary.files} files and ${summary.keys} stored keys deleted`,
  );

  // Signed out - the secret that signed the session no longer exists - and back to
  // the installer, which the root app now serves because the install lock went
  // with everything else.
  endSession(c);
  return c.redirect('/install', 303);
});

export default system;
