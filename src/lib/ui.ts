import type { Ctx } from '../types';
import { can } from './auth';
import { esc } from './security';

/** Marks a string as already-safe HTML. Everything else interpolated into html`` is escaped. */
export class Raw {
  constructor(public readonly s: string) {}
  toString(): string { return this.s; }
}
export const raw = (s: string): Raw => new Raw(s);

function val(v: unknown): string {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? val(values[i]) : ''); });
  return new Raw(out);
}

export const ADMIN_CSS = `
:root{--bg:#f3f5f8;--card:#fff;--fg:#1c2330;--muted:#677386;--line:#dfe4ec;--accent:#2457d6;--accent-fg:#fff;--danger:#c0362c;--ok:#1d7a46;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0f131a;--card:#181e28;--fg:#e6e9ef;--muted:#97a1b2;--line:#2a3342;--accent:#5d8bf4;--danger:#ef6a60;--ok:#4cc38a;--warn:#e0b341}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
h1{font-size:1.4rem;margin:0 0 1rem}h2{font-size:1.05rem;margin:0 0 .7rem}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:.6rem;height:3.2rem;padding:0 .9rem;background:var(--card);border-bottom:1px solid var(--line)}
.top .site{font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--fg);text-decoration:none}
.burger{font-size:1.5rem;line-height:1;cursor:pointer;padding:.3rem .5rem;margin-left:-.5rem;user-select:none}
#nav-t{position:absolute;opacity:0;pointer-events:none}
.side{display:none;background:var(--card);border-bottom:1px solid var(--line);padding:.4rem}
#nav-t:checked~.side{display:block}
.side a,.side button{display:block;width:100%;text-align:left;padding:.7rem .8rem;border-radius:.5rem;color:var(--fg);text-decoration:none;background:none;border:0;font:inherit;cursor:pointer}
.side a.on{background:var(--accent);color:var(--accent-fg)}
.main{padding:1rem .9rem 3rem;max-width:60rem;margin:0 auto}
@media (min-width:860px){
  .burger{display:none}
  .shell{display:grid;grid-template-columns:13rem 1fr;align-items:start}
  .side{display:block;position:sticky;top:3.2rem;min-height:calc(100vh - 3.2rem);border-bottom:0;border-right:1px solid var(--line);padding:.8rem .6rem}
  .main{padding:1.6rem 2rem 3rem;margin:0;width:100%}
}
.card{background:var(--card);border:1px solid var(--line);border-radius:.7rem;padding:1rem;margin-bottom:1rem}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-bottom:1rem}
.stat{background:var(--card);border:1px solid var(--line);border-radius:.7rem;padding:.9rem;text-decoration:none;color:var(--fg)}
.stat b{display:block;font-size:1.7rem;line-height:1.1}.stat span{color:var(--muted);font-size:.85rem}
label{display:block;font-weight:600;font-size:.9rem;margin:.9rem 0 .3rem}
label.check{display:flex;align-items:center;gap:.5rem;font-weight:400;margin:.3rem 0}
.hint{color:var(--muted);font-size:.82rem;font-weight:400;margin:.25rem 0 0}
input[type=text],input[type=email],input[type=password],input[type=url],input[type=number],input[type=datetime-local],select,textarea{width:100%;padding:.65rem .7rem;border:1px solid var(--line);border-radius:.5rem;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:6rem;resize:vertical}
textarea.code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;min-height:20rem}
input:focus,select:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
.btn{display:inline-block;padding:.65rem 1.1rem;border:1px solid var(--accent);border-radius:.5rem;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn.ghost{background:none;color:var(--accent)}
.btn.danger{background:none;border-color:var(--danger);color:var(--danger)}
.btn.small{padding:.35rem .7rem;font-size:.85rem}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem}
.between{justify-content:space-between}
.grow{flex:1}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;align-items:center;gap:.7rem;padding:.75rem 0;border-top:1px solid var(--line)}
.list li:first-child{border-top:0}
.list .t{flex:1;min-width:0}
.list .t a{font-weight:600;text-decoration:none;color:var(--fg);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list .t small{color:var(--muted)}
.badge{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:.15rem .5rem;border-radius:1rem;border:1px solid currentColor;white-space:nowrap}
.badge.published{color:var(--ok)}.badge.draft{color:var(--muted)}.badge.scheduled{color:var(--warn)}
.flash{padding:.7rem .9rem;border-radius:.5rem;margin-bottom:1rem;border:1px solid var(--ok);color:var(--ok);background:var(--card)}
.flash.err{border-color:var(--danger);color:var(--danger)}
.toolbar{display:flex;flex-wrap:wrap;gap:.3rem;margin-bottom:.4rem}
.toolbar button{padding:.35rem .65rem;border:1px solid var(--line);border-radius:.4rem;background:var(--card);color:var(--fg);font:inherit;font-size:.85rem;cursor:pointer}
.toolbar button:hover{border-color:var(--accent)}
.toolbar-separator{width:1px;background:var(--line);margin:.15rem .25rem}
.editor-heading{gap:1rem;margin-top:.9rem}
.editor-heading>label{margin:0}
.editor-modes{display:flex;border:1px solid var(--line);border-radius:.45rem;overflow:hidden}
.editor-modes button{padding:.25rem .7rem;border:0;border-left:1px solid var(--line);background:var(--card);color:var(--fg);font:inherit;font-size:.82rem;cursor:pointer}
.editor-modes button:first-child{border-left:0}
.editor-modes button[aria-pressed=true]{background:var(--accent);color:var(--accent-fg)}
.visual-editor{width:100%;min-height:20rem;padding:.75rem;border:1px solid var(--line);border-radius:.5rem;background:var(--bg);color:var(--fg);overflow-wrap:anywhere}
.visual-editor:focus{outline:2px solid var(--accent);outline-offset:-1px}
.visual-editor:empty::before{content:attr(data-placeholder);color:var(--muted);pointer-events:none}
.visual-editor img{max-width:100%;height:auto}
.visual-editor .html-block{padding:.6rem;border:1px dashed var(--line);border-radius:.35rem}
.visual-editor .video-responsive{position:relative;aspect-ratio:16/9;background:#000;overflow:hidden}
.visual-editor .video-responsive iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
dialog{width:min(36rem,calc(100% - 2rem));max-height:calc(100vh - 2rem);padding:1.2rem;border:1px solid var(--line);border-radius:.7rem;background:var(--card);color:var(--fg)}
dialog::backdrop{background:rgba(0,0,0,.55)}
dialog textarea{min-height:12rem}
.dialog-actions{justify-content:flex-end;margin-top:1rem}
.form-error{color:var(--danger);font-size:.85rem;margin:.5rem 0 0}
[hidden]{display:none!important}
.grid2{display:grid;gap:0 1rem}
@media (min-width:640px){.grid2{grid-template-columns:1fr 1fr}}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.7rem}
.media figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:.6rem;overflow:hidden;display:flex;flex-direction:column}
.media .thumb{aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--muted);font-weight:700;overflow:hidden}
.media img{width:100%;height:100%;object-fit:cover}
.media figcaption{padding:.5rem;font-size:.78rem;word-break:break-all}
.media .row{padding:0 .5rem .5rem;gap:.3rem}
.auth{max-width:25rem;margin:0 auto;padding:2rem 1rem}
.auth h1{text-align:center}
.checks{max-height:11rem;overflow:auto;border:1px solid var(--line);border-radius:.5rem;padding:.4rem .7rem}
.muted{color:var(--muted)}
.mis{list-style:none;margin:0;padding:0}
.mi{display:flex;align-items:center;gap:.5rem;padding:.5rem;margin-bottom:.4rem;border:1px solid var(--line);border-radius:.5rem;background:var(--bg)}
.mi.dragging{opacity:.6;border-color:var(--accent)}
.mi .grow{display:grid;gap:.3rem;min-width:0}
@media (min-width:640px){.mi .grow{grid-template-columns:1fr 1.4fr}}
.handle{cursor:grab;touch-action:none;user-select:none;padding:.6rem .3rem;color:var(--muted);letter-spacing:-.25em}
.mi-btns{display:flex;gap:.2rem}
.mi-btns button{width:2.1rem;height:2.1rem;border:1px solid var(--line);border-radius:.4rem;background:var(--card);color:var(--fg);font:inherit;cursor:pointer}
.store{display:grid;gap:.8rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))}
.store-item{margin:0;display:flex;flex-direction:column}
.store-item h3{margin:.7rem 0 .2rem;font-size:1.05rem}
.store-item p{margin:0 0 .8rem;font-size:.9rem;flex:1}
.swatch{height:5.5rem;border-radius:.5rem;border:1px solid var(--line)}
.pre{background:var(--bg);border:1px solid var(--line);border-radius:.5rem;padding:.7rem;overflow-x:auto;font-size:.82rem}
form.inline{display:inline}
`;

/** Bare document used by login and the installer. */
export function shell(title: string, body: Raw): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${ADMIN_CSS}</style></head><body>${body.s}</body></html>`;
}

export const csrfField = (c: Ctx): Raw => html`<input type="hidden" name="_csrf" value="${c.var.csrf}">`;

export const flash = (c: Ctx): Raw => {
  const ok = c.req.query('ok');
  const err = c.req.query('err');
  return html`${ok ? html`<div class="flash" role="status">${ok}</div>` : ''}${err ? html`<div class="flash err" role="alert">${err}</div>` : ''}`;
};

/** Full admin page with navigation. */
export function layout(c: Ctx, title: string, body: Raw, active = ''): Response {
  const base = c.var.base;
  const user = c.var.user;
  const nav: [string, string, boolean][] = [
    ['', 'Dashboard', true],
    ['/pages', 'Pages', can(user, 'editor')],
    ['/posts', 'Posts', true],
    ['/media', 'Media', true],
    ['/menus', 'Menus', can(user, 'editor')],
    ['/themes', 'Themes', can(user, 'admin')],
    ['/settings', 'Settings', can(user, 'admin')],
    ['/profile', 'Profile', true],
  ];
  const page = html`
<header class="top">
  <label for="nav-t" class="burger" aria-label="Menu">&#9776;</label>
  <a class="site" href="${base}">${title}</a>
  <a class="btn ghost small" href="/" target="_blank" rel="noopener">View site</a>
</header>
<div class="shell">
  <input type="checkbox" id="nav-t">
  <nav class="side">
    ${nav.filter((n) => n[2]).map(([path, label]) => html`<a href="${base + path}" class="${active === path ? 'on' : ''}">${label}</a>`)}
    <form method="post" action="${base}/logout">${csrfField(c)}<button type="submit">Log out (${user.username})</button></form>
  </nav>
  <main class="main">${flash(c)}${body}</main>
</div>`;
  return c.html(shell(title + ' · Admin', page));
}

export const errorPage = (c: Ctx, status: 400 | 403 | 404, message: string): Response =>
  c.html(shell('Error', html`<div class="auth"><div class="card"><h1>${String(status)}</h1><p>${message}</p><p><a href="${c.var.base || '/'}">Back</a></p></div></div>`), status);

/** Redirect inside the admin with a flash message. */
export const go = (c: Ctx, path: string, msg?: { ok?: string; err?: string }): Response => {
  const q = msg?.ok ? `?ok=${encodeURIComponent(msg.ok)}` : msg?.err ? `?err=${encodeURIComponent(msg.err)}` : '';
  return c.redirect(c.var.base + path + q, 303);
};
