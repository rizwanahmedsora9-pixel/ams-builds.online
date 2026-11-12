import type { Ctx } from '../types';
import { can } from './auth';
import { pendingComments } from './comments';
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
:root{--bg:#f3f5f8;--card:#fff;--fg:#1c2330;--muted:#677386;--line:#dfe4ec;--accent:#2457d6;--accent-fg:#fff;--danger:#c0362c;--ok:#1d7a46;--warn:#9a6700;--side:#1d2327;--side-fg:#e4e7eb;--side-muted:#a7b0bd;--side-line:#323a44;--side-hover:#2c3338;--top:#2457d6}
@media (prefers-color-scheme:dark){:root{--bg:#0f131a;--card:#181e28;--fg:#e6e9ef;--muted:#97a1b2;--line:#2a3342;--accent:#5d8bf4;--danger:#ef6a60;--ok:#4cc38a;--warn:#e0b341;--side:#141a22;--side-fg:#e6e9ef;--side-muted:#98a4b5;--side-line:#2a3342;--side-hover:#232b37;--top:#2c5bd0}}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
h1{font-size:1.4rem;margin:0 0 1rem}h2{font-size:1.05rem;margin:0 0 .7rem}
.top{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:.6rem;height:3.2rem;padding:0 .9rem;background:var(--top);color:#fff;box-shadow:0 1px 0 rgba(0,0,0,.15)}
.top .site{display:flex;align-items:center;gap:.5rem;font-weight:700;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;text-decoration:none}
.top .site .globe{font-size:1.05rem;filter:drop-shadow(0 0 1px rgba(0,0,0,.35))}
.top .view{color:#fff;text-decoration:none;border:1px solid rgba(255,255,255,.55);border-radius:.4rem;padding:.25rem .6rem;font-size:.8rem;white-space:nowrap}
.top .view:hover{background:rgba(255,255,255,.15)}
.burger{font-size:1.45rem;line-height:1;cursor:pointer;padding:.3rem .4rem;margin-left:-.4rem;user-select:none;color:#fff}
#nav-t,#side-c{position:absolute;opacity:0;pointer-events:none;width:0;height:0}
.side{display:none;background:var(--side);color:var(--side-fg);border-bottom:1px solid var(--side-line);padding:.45rem}
#nav-t:checked~.side{display:block}
.side .nav-item{display:flex;align-items:center;gap:.55rem;padding:.62rem .6rem;border-radius:.45rem;color:var(--side-fg);text-decoration:none;font-size:.94rem;line-height:1.2}
.side .nav-item:hover,.side button:hover{background:var(--side-hover)}
.side .nav-item.on{background:var(--accent);color:#fff}
.side .ico{width:1.45rem;flex:0 0 1.45rem;text-align:center;font-size:.98rem}
.side .label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.side .bubble{min-width:1.35rem;padding:.02rem .38rem;border-radius:1rem;background:var(--danger);color:#fff;font-size:.72rem;font-weight:700;text-align:center}
.side .sub{display:flex;flex-direction:column;padding:.1rem 0 .3rem 2rem}
.side .sub a{padding:.34rem .5rem;border-radius:.35rem;color:var(--side-muted);font-size:.86rem;text-decoration:none}
.side .sub a:hover{color:#fff;background:var(--side-hover)}
.side .sub a.on{color:#fff;font-weight:600;background:rgba(255,255,255,.08)}
.side .sep{height:1px;background:var(--side-line);margin:.4rem .35rem}
.side .side-foot{margin-top:.5rem;border-top:1px solid var(--side-line);padding-top:.4rem}
.side .side-foot button{display:flex;align-items:center;gap:.55rem;width:100%;text-align:left;padding:.55rem .6rem;border:0;border-radius:.45rem;background:none;color:var(--side-muted);font:inherit;font-size:.88rem;cursor:pointer}
.side .collapse{display:flex;align-items:center;gap:.55rem;margin-top:.4rem;padding:.6rem;border-radius:.45rem;background:var(--accent);color:#fff;font-size:.92rem;cursor:pointer;user-select:none}
.side .collapse:hover{filter:brightness(1.07)}
.side .collapse .ico{font-size:.85rem;transition:transform .15s}
.side .collapse{display:none}
.main{padding:1rem .9rem 3rem;max-width:60rem;margin:0 auto}
@media (min-width:860px){
  .burger{display:none}
  .shell{display:grid;grid-template-columns:auto 1fr;align-items:start}
  .side{display:block;width:13.5rem;position:sticky;top:3.2rem;height:calc(100vh - 3.2rem);overflow-y:auto;min-height:calc(100vh - 3.2rem);border-bottom:0;border-right:1px solid var(--side-line);padding:.7rem .55rem 1rem}
  #side-c:checked~.side{width:4.1rem;padding-left:.35rem;padding-right:.35rem}
  #side-c:checked~.side .label,#side-c:checked~.side .bubble{display:none}
  #side-c:checked~.side .sub{display:none}
  #side-c:checked~.side .sep{display:none}
  #side-c:checked~.side .nav-item,#side-c:checked~.side .collapse{justify-content:center;padding:.62rem .3rem}
  #side-c:checked~.side .collapse .ico{transform:rotate(180deg)}
  #side-c:checked~.side .side-foot button{justify-content:center}
  .side .collapse{display:flex}
  .main{padding:1.6rem 2rem 3rem;margin:0;width:100%;max-width:70rem}
  .main:has(.posts-admin){max-width:none}
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
.media-admin{width:100%;max-width:100rem}
.media-heading-row{display:flex;align-items:center;gap:.65rem;margin-bottom:.8rem}
.media-heading-row h1{font-size:1.45rem;font-weight:500;margin:0}
.media-upload{position:relative}
.media-upload summary{list-style:none;cursor:pointer}
.media-upload summary::-webkit-details-marker{display:none}
.media-upload-form{position:absolute;top:calc(100% + .5rem);right:0;z-index:5;width:min(30rem,calc(100vw - 2rem));padding:1rem;background:var(--card);border:1px solid var(--line);border-radius:.5rem;box-shadow:0 .6rem 1.5rem rgba(0,0,0,.16)}
.media-upload-form input[type=file]{width:100%;padding:.4rem;border:1px solid var(--line);border-radius:.35rem;background:var(--bg);color:var(--fg)}
.media-upload-form .hint{margin:.5rem 0 .8rem}
.media-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap;padding:.8rem 1rem;margin-bottom:1rem;background:var(--card);border:1px solid var(--line)}
.media-toolbar-left{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.media-view-toggle{display:flex;align-items:center;gap:.15rem}
.media-view-toggle a{display:inline-flex;align-items:center;justify-content:center;width:1.8rem;height:1.8rem;color:var(--muted);text-decoration:none;font-size:1.2rem}
.media-view-toggle a.current{color:var(--fg)}
.media-filter-form{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.media-filter-form select{width:auto;min-width:8rem;padding:.38rem .55rem;border-radius:.2rem;background:var(--card);font-size:.86rem}
.media-filter-form select:first-of-type{min-width:9rem}
.media-filter-form .btn,.media-bulk-actions .btn,.media-bulk-toggle{padding:.35rem .65rem;border-radius:.2rem;font-size:.84rem;font-weight:500}
.media-bulk-actions{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}
.media-select-all{display:flex;align-items:center;gap:.35rem;margin:0 .2rem 0 0;font-size:.82rem;font-weight:400}
.media-select-all input{accent-color:var(--accent)}
.media-search-form{display:flex;align-items:center;gap:.55rem;margin:0 0 0 auto}
.media-search-form label{margin:0;font-size:.82rem;font-weight:400;color:var(--muted)}
.media-search-form input{width:min(17rem,38vw);padding:.4rem .55rem;border:1px solid var(--line);border-radius:.2rem;background:var(--card);color:var(--fg);font:inherit}
.media-gallery{grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.75rem}
.media-gallery .media-item{position:relative}
.media-gallery .thumb{aspect-ratio:1.25;background:var(--bg)}
.media-gallery .media-item figcaption{display:flex;flex-direction:column;gap:.12rem;min-height:3.4rem}
.media-gallery .media-item figcaption strong{font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.media-gallery .media-item figcaption span{color:var(--muted);font-size:.74rem}
.media-gallery .media-item-actions{display:flex;align-items:center;flex-wrap:wrap}
.media-gallery .media-select{position:absolute;z-index:2;top:.45rem;left:.45rem;display:flex;align-items:center;justify-content:center;width:1.55rem;height:1.55rem;margin:0;border-radius:.25rem;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.2)}
.media-gallery .media-select input{width:1rem;height:1rem;accent-color:var(--accent)}
.media-file-icon{display:inline-flex;align-items:center;justify-content:center;width:4.4rem;height:3.3rem;border:1px solid var(--line);border-radius:.3rem;background:var(--card);color:var(--muted);font-size:.75rem;font-weight:700;letter-spacing:.04em}
.media-list-wrap{width:100%;overflow-x:auto;background:var(--card);border:1px solid var(--line)}
.media-list-table{width:100%;min-width:48rem;border-collapse:collapse;background:var(--card);font-size:.86rem}
.media-list-table th,.media-list-table td{text-align:left;padding:.6rem .55rem;border-top:1px solid var(--line);vertical-align:middle}
.media-list-table th{border-top:0;color:var(--muted);font-size:.78rem;font-weight:600}
.media-list-table tbody tr:nth-child(odd){background:rgba(103,115,134,.055)}
.media-list-table .media-check-col{width:2.6rem;text-align:center}
.media-list-table input[type=checkbox]{accent-color:var(--accent)}
.media-list-file{display:flex;align-items:center;gap:.65rem;min-width:13rem}
.media-list-file>span{display:flex;flex-direction:column;gap:.1rem;min-width:0}
.media-list-file strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.media-list-file small{color:var(--muted);font-size:.76rem}
.media-list-thumb{display:flex;align-items:center;justify-content:center;width:3.5rem;height:3.5rem;flex:0 0 3.5rem;overflow:hidden;background:var(--bg);border:1px solid var(--line);border-radius:.3rem}
.media-list-thumb img{width:100%;height:100%;object-fit:cover}
.media-list-table .media-item-actions{display:flex;align-items:center;gap:.3rem;flex-wrap:wrap}
.media-empty{display:grid;place-items:center;min-height:22rem;color:var(--muted);font-size:1rem;text-align:center}
.media-footer{display:flex;align-items:center;justify-content:space-between;gap:.7rem;flex-wrap:wrap;margin-top:.75rem}
@media (max-width:760px){
  .media-toolbar{align-items:stretch}
  .media-toolbar-left{width:100%}
  .media-filter-form{flex:1}
  .media-filter-form select{flex:1;min-width:0}
  .media-search-form{width:100%;margin-left:0}
  .media-search-form input{width:auto;flex:1;min-width:0}
}
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
.stats{grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr))}
.badge.pending{color:var(--warn)}.badge.approved{color:var(--ok)}.badge.spam{color:var(--danger)}.badge.trash{color:var(--muted)}
.filters{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.9rem}
.filters a{display:inline-block;padding:.3rem .7rem;border:1px solid var(--line);border-radius:2rem;text-decoration:none;color:var(--muted);font-size:.84rem;background:var(--card)}
.filters a.on{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:600}
.filters a b{font-weight:700}
.list li.wrap{align-items:flex-start;flex-wrap:wrap}
.list li.wrap .t a{white-space:normal}
.list .excerpt{color:var(--muted);font-size:.86rem;margin-top:.2rem;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.list .who{font-size:.78rem;color:var(--muted)}
.table{width:100%;border-collapse:collapse;font-size:.9rem}
.table th,.table td{text-align:left;padding:.55rem .45rem;border-top:1px solid var(--line);vertical-align:middle}
.table th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);border-top:0}
.table td.actions{text-align:right;white-space:nowrap}
.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.posts-admin{width:100%;max-width:100rem}
.posts-heading-row{display:flex;align-items:center;gap:.55rem;margin-bottom:.7rem}
.posts-heading-row h1{font-size:1.55rem;font-weight:500;margin:0}
.posts-add{padding:.32rem .75rem;border-radius:.2rem;font-size:.87rem;font-weight:500}
.posts-add.btn.ghost{background:var(--card)}
.posts-status-nav{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem;margin:0 0 .55rem;font-size:.88rem}
.posts-status-nav a{text-decoration:none;color:var(--accent)}
.posts-status-nav a.current{color:var(--fg);font-weight:600}
.posts-status-nav a:not(:last-child)::after{content:"|";margin-left:.45rem;color:var(--muted);font-weight:400}
.posts-status-nav b{font-weight:400}
.posts-search-row{display:flex;justify-content:flex-end;margin:.15rem 0 .65rem}
.posts-search{display:flex;align-items:center;gap:.4rem}
.posts-search input{width:min(18rem,48vw);padding:.4rem .55rem;border-radius:.2rem;background:var(--card)}
.posts-search .btn,.posts-bulk-control .btn,.post-filter-form .btn{padding:.35rem .65rem;border-radius:.2rem;font-size:.84rem;font-weight:500}
.posts-controls-row{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;margin-bottom:.35rem}
.posts-bulk-control,.post-filter-form{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap}
.posts-bulk-control select,.post-filter-form select{width:auto;min-width:8.5rem;padding:.38rem .55rem;border-radius:.2rem;background:var(--card);font-size:.86rem}
.post-filter-form select:first-of-type{min-width:8.5rem}
.post-filter-form select:nth-of-type(2){min-width:9rem}
.posts-bulk-form{margin:0}
.posts-table-wrap{width:100%;overflow-x:auto;background:var(--card);border:1px solid var(--line)}
.posts-table{width:100%;min-width:58rem;border-collapse:collapse;background:var(--card);font-size:.88rem}
.posts-table th,.posts-table td{text-align:left;padding:.62rem .58rem;border-top:1px solid var(--line);vertical-align:middle}
.posts-table th{color:var(--muted);font-size:.79rem;font-weight:600;white-space:nowrap;border-top:0}
.posts-table tbody tr:nth-child(odd){background:rgba(103,115,134,.055)}
.posts-table tbody tr:hover{background:rgba(36,87,214,.055)}
.posts-table .posts-check-column{width:2.65rem;text-align:center;padding-left:.35rem;padding-right:.35rem}
.posts-table .posts-check-column input{width:1rem;height:1rem;vertical-align:middle;accent-color:var(--accent)}
.posts-table .posts-comments-column{width:5rem;text-align:center}
.posts-sort{display:inline-flex;align-items:center;gap:.28rem;color:var(--accent);text-decoration:none}
.posts-sort span{font-size:.95rem;color:var(--muted)}
.posts-sort.active span{color:var(--accent)}
.posts-title-cell{min-width:13rem}
.posts-title-link{font-weight:600;text-decoration:none}
.post-row-actions{display:flex;align-items:center;gap:.35rem;height:0;overflow:hidden;font-size:.78rem;opacity:0;transition:opacity .12s}
.posts-table tr:hover .post-row-actions,.posts-table tr:focus-within .post-row-actions{height:auto;opacity:1}
.posts-date-cell{white-space:nowrap}
.posts-date-cell strong,.posts-date-cell time{display:block;font-size:.82rem;font-weight:400}
.posts-date-cell strong{color:var(--fg)}
.posts-date-cell time{color:var(--muted)}
.post-comment-count{display:inline-flex;align-items:center;justify-content:center;min-width:1.6rem;height:1.5rem;padding:0 .35rem;border-radius:.3rem;background:#6c7781;color:#fff;font-size:.76rem;font-weight:700}
.posts-empty{text-align:center!important;padding:2rem!important;color:var(--muted)}
.posts-table-footer{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap;margin:.4rem 0 1rem}
.posts-count{color:var(--muted);font-size:.82rem}
.posts-pagination{display:flex;justify-content:space-between;min-height:2rem}
.pages-admin .posts-table{min-width:44rem}
.page-draft-label{color:var(--muted);font-size:.82rem}
@media (max-width:720px){
  .posts-search-row{justify-content:stretch}
  .posts-search{width:100%}
  .posts-search input{width:auto;flex:1;min-width:0}
  .posts-controls-row{align-items:flex-start}
  .posts-bulk-control,.post-filter-form{width:100%}
  .post-filter-form select{flex:1;min-width:0!important}
  .post-row-actions{height:auto;opacity:1}
}
.kv{display:grid;grid-template-columns:minmax(8rem,14rem) 1fr;gap:.35rem .9rem;font-size:.9rem;margin:0}
.kv dt{color:var(--muted)}
.kv dd{margin:0}
.pill{display:inline-block;font-size:.75rem;font-weight:700;padding:.1rem .5rem;border-radius:1rem;border:1px solid currentColor}
.pill.on{color:var(--ok)}.pill.off{color:var(--muted)}
.notice{padding:.6rem .8rem;border:1px solid var(--line);border-left:.25rem solid var(--accent);border-radius:.4rem;background:var(--bg);font-size:.9rem;margin:0 0 .8rem}
.grid3{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))}
.tile{display:block;background:var(--card);border:1px solid var(--line);border-radius:.7rem;padding:.9rem;text-decoration:none;color:var(--fg)}
.tile:hover{border-color:var(--accent)}
.tile b{display:block;margin-bottom:.2rem}
.tile span{color:var(--muted);font-size:.85rem}
.widget-slot{border-top:1px solid var(--line);padding-top:.9rem;margin-top:.9rem}
.widget-slot:first-of-type{border-top:0;padding-top:0;margin-top:0}
.comment-body-preview{color:var(--muted);font-size:.86rem;margin-top:.25rem;white-space:pre-wrap}
.pos{color:var(--ok);font-weight:600}.neg{color:var(--danger);font-weight:600}
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

/** One sidebar entry: a top-level page with an optional list of sub-pages. */
type NavChild = { path: string; label: string; show?: boolean };
type NavGroup = { key: string; path: string; label: string; icon: string; show: boolean; badge?: number; children?: NavChild[] };

const ADMIN_SECTIONS: Record<string, string> = {
  '/updates': 'updates',
  '/posts': 'posts',
  '/media': 'media',
  '/pages': 'pages',
  '/comments': 'comments',
  '/terms': 'posts',
  '/themes': 'appearance',
  '/menus': 'appearance',
  '/widgets': 'appearance',
  '/appearance': 'appearance',
  '/plugins': 'plugins',
  '/users': 'users',
  '/tools': 'tools',
  '/settings': 'settings',
};

/**
 * Full admin page: WordPress-style sidebar (grouped, with sub-menus, badges and
 * a collapsible rail), top bar, flash message and the page body.
 */
export async function layout(c: Ctx, title: string, body: Raw, _active = ''): Promise<Response> {
  const base = c.var.base;
  const user = c.var.user;
  const path = c.req.path || '/';
  const search = new URL(c.req.url).search;
  const admin = can(user, 'admin');
  const editor = can(user, 'editor');

  let pending = 0;
  if (editor) {
    try {
      pending = await pendingComments(c.env);
    } catch {
      /* comments table not migrated yet */
    }
  }

  const activeKey = path === '/' ? 'home' : path === '/profile' ? 'profile' : (Object.entries(ADMIN_SECTIONS).find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? '');

  const groups: NavGroup[] = [
    { key: 'home', path: '', label: 'Dashboard', icon: '🏠', show: true },
    { key: 'updates', path: '/updates', label: 'Updates', icon: '🔄', show: admin },
    {
      key: 'posts', path: '/posts', label: 'Posts', icon: '📌', show: true, children: [
        { path: '/posts', label: 'All Posts' },
        { path: '/posts/new', label: 'Add Post' },
        { path: '/terms?taxonomy=category', label: 'Categories' },
        { path: '/terms?taxonomy=tag', label: 'Tags' },
      ],
    },
    {
      key: 'media', path: '/media', label: 'Media', icon: '🖼️', show: true, children: [
        { path: '/media', label: 'Library' },
        { path: '/media#upload', label: 'Add New' },
      ],
    },
    {
      key: 'pages', path: '/pages', label: 'Pages', icon: '📄', show: editor, children: [
        { path: '/pages', label: 'All Pages' },
        { path: '/pages/new', label: 'Add New' },
      ],
    },
    {
      key: 'comments', path: '/comments', label: 'Comments', icon: '💬', show: editor, badge: pending, children: [
        { path: '/comments', label: 'All Comments' },
        { path: '/comments?status=pending', label: 'Pending' },
        { path: '/comments?status=approved', label: 'Approved' },
        { path: '/comments?status=spam', label: 'Spam' },
        { path: '/comments?status=trash', label: 'Trash' },
      ],
    },
    {
      key: 'appearance', path: admin ? '/appearance' : '/menus', label: 'Appearance', icon: '🎨', show: admin || editor, children: [
        { path: '/appearance', label: 'Customize', show: admin },
        { path: '/themes', label: 'Themes', show: admin },
        { path: '/menus', label: 'Menus', show: editor },
        { path: '/widgets', label: 'Widgets', show: admin },
      ],
    },
    {
      key: 'plugins', path: '/plugins', label: 'Plugins', icon: '🔌', show: admin, children: [
        { path: '/plugins', label: 'Installed Plugins' },
        { path: '/plugins/new', label: 'Add New' },
      ],
    },
    {
      key: 'users', path: '/users', label: 'Users', icon: '👥', show: admin, children: [
        { path: '/users', label: 'All Users' },
        { path: '/users/new', label: 'Add New' },
      ],
    },
    {
      key: 'tools', path: '/tools', label: 'Tools', icon: '🛠️', show: admin, children: [
        { path: '/tools', label: 'Overview' },
        { path: '/tools/redirects', label: 'Redirects' },
        { path: '/tools/export', label: 'Import / Export' },
        { path: '/tools/backups', label: 'Backups' },
        { path: '/tools/health', label: 'Site Health' },
      ],
    },
    {
      key: 'settings', path: '/settings', label: 'Settings', icon: '⚙️', show: admin, children: [
        { path: '/settings', label: 'General' },
        { path: '/settings#reading', label: 'Reading' },
        { path: '/settings#discussion', label: 'Discussion' },
        { path: '/settings#domains', label: 'Domains & URL' },
      ],
    },
  ];

  const isChildActive = (child: string) => (child.includes('?') ? path + search === child : path === child);
  const visible = groups.filter((g) => g.show);
  const navItems = visible.map((g, i) => {
    const children = (g.children || []).filter((ch) => ch.show !== false);
    const open = activeKey === g.key && children.length > 0;
    return html`${i ? html`<div class="sep"></div>` : ''}
<a class="nav-item${activeKey === g.key ? ' on' : ''}" href="${base + g.path}"${activeKey === g.key ? raw(' aria-current="page"') : ''} title="${g.label}">
  <span class="ico" aria-hidden="true">${g.icon}</span><span class="label">${g.label}</span>${g.badge ? html`<span class="bubble" title="${g.badge} pending">${g.badge}</span>` : ''}
</a>
${open ? html`<div class="sub">${children.map((ch) => html`<a href="${base + ch.path}" class="${isChildActive(ch.path) ? 'on' : ''}">${ch.label}</a>`)}</div>` : ''}`;
  });

  const page = html`
<header class="top">
  <label for="nav-t" class="burger" aria-label="Menu">&#9776;</label>
  <a class="site" href="${base}"><span class="globe" aria-hidden="true">🌐</span> Dashboard</a>
  <a class="view" href="/" target="_blank" rel="noopener">View site</a>
</header>
<div class="shell">
  <input type="checkbox" id="nav-t">
  <input type="checkbox" id="side-c">
  <nav class="side" aria-label="Admin">
    ${navItems}
    <div class="side-foot">
      <a class="nav-item${activeKey === 'profile' ? ' on' : ''}" href="${base}/profile" title="Profile"><span class="ico" aria-hidden="true">👤</span><span class="label">Profile</span></a>
      <form method="post" action="${base}/logout">${csrfField(c)}<button type="submit" title="Log out"><span class="ico" aria-hidden="true">🚪</span><span class="label">Log out (${user.username})</span></button></form>
      <label for="side-c" class="collapse" title="Collapse menu"><span class="ico" aria-hidden="true">◀</span><span class="label">Collapse Menu</span></label>
    </div>
  </nav>
  <main class="main">${flash(c)}${body}</main>
</div>
${raw(`<script>
(function(){
  var box=document.getElementById('side-c');if(!box)return;
  try{if(localStorage.getItem('cms-side-collapsed')==='1')box.checked=true}catch(e){}
  box.addEventListener('change',function(){try{localStorage.setItem('cms-side-collapsed',box.checked?'1':'0')}catch(e){}});
})();
</script>`)}`;
  return c.html(shell(title + ' · Admin', page));
}

export const errorPage = (c: Ctx, status: 400 | 403 | 404, message: string): Response =>
  c.html(shell('Error', html`<div class="auth"><div class="card"><h1>${String(status)}</h1><p>${message}</p><p><a href="${c.var.base || '/'}">Back</a></p></div></div>`), status);

/** Redirect inside the admin with a flash message. */
export const go = (c: Ctx, path: string, msg?: { ok?: string; err?: string }): Response => {
  const q = msg?.ok ? `?ok=${encodeURIComponent(msg.ok)}` : msg?.err ? `?err=${encodeURIComponent(msg.err)}` : '';
  return c.redirect(c.var.base + path + q, 303);
};
