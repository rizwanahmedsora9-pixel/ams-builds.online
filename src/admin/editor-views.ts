/**
 * Server-rendered pieces of the editor: the revision history, a line diff, the
 * "somebody else is editing" banner and the autosave notice. Kept out of
 * content.ts so the route file stays about behaviour, and so these fragments
 * can be tested without a database.
 */
import { Raw, html, raw } from '../lib/ui';
import { icon } from './icons';
import { collapseDiff, diffLines, type RevisionRow } from './revisions';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function when(iso: string): string {
  const date = iso.slice(0, 16).replace('T', ' ');
  return `${date} UTC`;
}

function label(row: RevisionRow): string {
  return row.note === 'autosave' ? 'Autosave' : row.note === 'restore' ? 'Restored' : 'Manual save';
}

/**
 * The history list: one row per snapshot with what changed, who did it and a
 * link to the diff. Autosaves are marked so nobody mistakes them for a
 * deliberate save.
 */
export function revisionList(rows: RevisionRow[], base: string, kind: string, contentId: number): Raw {
  if (!rows.length) {
    return html`<p class="hint" style="margin:0">No earlier versions yet. Every save from now on adds one, so you can always go back.</p>`;
  }
  return html`<ol class="revisions">
  ${rows.map((row) => html`<li class="revision revision--${row.note === 'autosave' ? 'auto' : 'manual'}">
    <div class="revision__main">
      <b>${label(row)}</b>
      <span class="revision__meta">
        <time datetime="${row.created_at}">${when(row.created_at)}</time>
        ${row.username ? html` · ${row.username}` : ''}
        · ${row.status}
      </span>
      <span class="revision__title">${row.title || '(untitled)'}</span>
    </div>
    <div class="revision__actions">
      <a class="btn ghost small" href="${base}/${kind}/${contentId}/revisions/${row.id}">Compare</a>
      <form method="post" action="${base}/${kind}/${contentId}/revisions/${row.id}/restore" class="inline">
        <button class="btn ghost small" type="submit">Restore</button>
      </form>
    </div>
  </li>`)}
</ol>`;
}

/** A line-based diff: deletions and additions interleaved, GitHub style. */
export function revisionDiff(before: RevisionRow, after: { title: string; body: string }): Raw {
  const lines = collapseDiff(diffLines(before.body || '', after.body || ''));
  const changed = lines.filter((l) => l.kind !== 'same' && l.kind !== 'gap').length;
  const titleChanged = (before.title || '') !== (after.title || '');
  return html`<div class="diff" role="table" aria-label="Changes to this version">
  ${titleChanged ? html`<p class="diff__title">Title: <del>${before.title}</del> → <ins>${after.title}</ins></p>` : ''}
  ${changed === 0
    ? html`<p class="hint">The content of these two versions is identical; only metadata changed.</p>`
    : html`<ol class="diff__lines">
      ${lines.map((line) => line.kind === 'gap'
        ? html`<li class="diff__gap">${line.text}</li>`
        : html`<li class="diff__line diff__line--${line.kind}">
            <span class="diff__no" aria-hidden="true">${line.oldNo ?? ''}</span>
            <span class="diff__no" aria-hidden="true">${line.newNo ?? ''}</span>
            <span class="diff__sign" aria-hidden="true">${line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
            <span class="diff__text">${raw(esc(line.text) || '&nbsp;')}</span>
            <span class="sr-only">${line.kind === 'add' ? 'Added line' : line.kind === 'del' ? 'Removed line' : 'Unchanged line'}</span>
          </li>`)}
    </ol>`}
</div>`;
}

/** "Alice is editing this post" with a takeover button for editors. */
export function lockBanner(holder: { username: string }, base: string, kind: string, id: number, canForce: boolean): Raw {
  return html`<div class="notice warn lock-banner" role="status" data-lock-banner>
  ${icon('alert')}
  <div>
    <b>${holder.username} is editing this ${kind === 'pages' ? 'page' : 'post'} right now.</b>
    Saving will not be blocked, but you may overwrite their changes.
    ${canForce ? html` <form method="post" action="${base}/${kind}/${id}/lock/takeover" class="inline"><button class="btn ghost small" type="submit">Edit anyway</button></form>` : ''}
  </div>
</div>`;
}

/**
 * "You have a newer autosave" - shown when the newest autosave differs from
 * what is in the database, which is what a crashed tab leaves behind.
 */
export function restoreBanner(autosave: RevisionRow, base: string, kind: string, id: number): Raw {
  return html`<div class="notice info" role="status" data-autosave-banner>
  ${icon('clock')}
  <div>
    <b>Unsaved work from ${when(autosave.created_at)} was recovered.</b>
    That autosave is newer than the saved version.
    <a href="${base}/${kind}/${id}/revisions/${autosave.id}">Compare</a> or
    <form method="post" action="${base}/${kind}/${id}/revisions/${autosave.id}/restore" class="inline"><button class="btn ghost small" type="submit">Restore it</button></form>
  </div>
</div>`;
}

export { when as formatRevisionTime };
