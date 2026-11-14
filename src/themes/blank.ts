/**
 * The blank fallback: what the site renders with when no theme is installed, no
 * theme is active, or the active theme throws while rendering.
 *
 * It is deliberately nothing. No stylesheet, no script, no classes, no partials,
 * no settings — bare semantic HTML around the content, so the moment a real
 * theme is activated, that theme is the only thing deciding how the site looks.
 *
 * It is not a theme package and it is not in any store: it is never listed,
 * installed, uploaded, stored in the database or offered in the panel. It exists
 * so the site always answers, and so "no theme yet" is visible as a clean slate
 * rather than as someone else's design.
 */
import { parseManifest, type ThemeBundle } from '../lib/theme-manifest';

/** The document. `{{{head}}}` carries the title, meta, tokens and custom code. */
const base = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{{head}}}
</head>
<body class="{{body_class}}">
<main>
{{{content}}}
</main>
{{{widgets.footer}}}
{{{footer}}}
</body>
</html>
`;

/** The front page: its CMS Page when one is set, then the latest posts. */
const home = `{{#if page}}<h1>{{page.title}}</h1>
{{{page.content}}}
{{/if}}{{#if posts}}<section>
<h2>{{#if page}}Latest posts{{else}}Posts{{/if}}</h2>
<ul>
{{#each posts}}<li><a href="{{url}}">{{title}}</a> <time datetime="{{date_iso}}">{{date}}</time>{{#if excerpt}}<p>{{excerpt}}</p>{{/if}}</li>
{{/each}}</ul>
<p><a href="/blog">All posts</a></p>
</section>{{/if}}
`;

const page = `<h1>{{page.title}}</h1>
{{{page.content}}}
`;

const post = `<article>
<h1>{{post.title}}</h1>
<p><time datetime="{{post.date_iso}}">{{post.date}}</time>{{#if post.author}} · {{post.author}}{{/if}}</p>
{{#if post.featured_image}}<img src="{{post.featured_image}}" alt="{{post.featured_alt}}">{{/if}}
{{{post.content}}}
{{#if post.categories}}<p>Posted in {{#each post.categories}}<a href="{{url}}">{{name}}</a> {{/each}}</p>{{/if}}
{{#if post.tags}}<p>Tagged {{#each post.tags}}<a href="{{url}}">{{name}}</a> {{/each}}</p>{{/if}}
{{#each post.pages}}<p><a href="{{url}}">Back to {{title}}</a></p>
{{/each}}<p><a href="/blog">Back to all posts</a></p>
</article>
`;

/** The blog index and category/tag archives. */
const archive = `<h1>{{archive.title}}</h1>
{{#if posts}}<ul>
{{#each posts}}<li><a href="{{url}}">{{title}}</a> <time datetime="{{date_iso}}">{{date}}</time>{{#if excerpt}}<p>{{excerpt}}</p>{{/if}}</li>
{{/each}}</ul>
<nav aria-label="Pagination">{{#if pagination.prev}}<a href="{{pagination.prev}}">Newer posts</a>{{/if}}{{#if pagination.next}}<a href="{{pagination.next}}">Older posts</a>{{/if}}</nav>
{{else}}<p>There is nothing published in this archive yet.</p>{{/if}}
`;

const search = `<h1>Search</h1>
<form action="/search" method="get" role="search">
<label for="blank-q">Search pages and posts</label>
<input id="blank-q" type="search" name="q" value="{{search.query}}" maxlength="120">
<button type="submit">Search</button>
</form>
{{#if search.query}}<p>{{search.total}} result(s) for “{{search.query}}”</p>{{/if}}
{{#if posts}}<ul>
{{#each posts}}<li><a href="{{url}}">{{title}}</a>{{#if excerpt}}<p>{{excerpt}}</p>{{/if}}</li>
{{/each}}</ul>{{else}}{{#if search.query}}<p>No matching pages or posts were found.</p>{{/if}}{{/if}}
`;

const notFound = `<h1>Page not found</h1>
<p>Nothing is published at this address.</p>
<p><a href="/">Back to the homepage</a> · <a href="/search">Search</a></p>
`;

const templates = { base, home, page, post, archive, search, '404': notFound };

/**
 * Parsed by the same manifest parser as an uploaded theme, so the fallback is a
 * ordinary bundle as far as the renderer is concerned. It declares no settings,
 * no assets and no widget areas of its own (the classic footer slots arrive with
 * `{{{footer}}}` like any theme that draws none).
 */
const parsed = parseManifest({
  manifest_version: 2,
  name: 'Blank',
  slug: 'blank',
  version: '1.0.0',
  description: 'The unstyled fallback the site renders with until a theme is installed and activated.',
  layout: 'base',
  templates,
  partials: {},
  css: '',
});

/** The bundle the renderer falls back to. Never stored, never installed. */
export const blankTheme: ThemeBundle = {
  name: parsed.manifest.name,
  slug: parsed.manifest.slug,
  version: parsed.manifest.version,
  templates: parsed.templates,
  partials: parsed.partials,
  css: parsed.css,
  manifest: parsed.manifest,
};

export type { ThemeBundle };
