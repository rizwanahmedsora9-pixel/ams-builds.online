# AMS Builds — Shared CMS Guide

## 1. What happens when you save

The CMS is shared server-side storage, not a browser preview.

1. `/admin/` authenticates against the server and receives an HTTP-only session cookie.
2. Save sends the content or settings to an authenticated admin API.
3. The API writes to the `CmsSite` Durable Object in production (or `.dev-cms/` during `astro dev`).
4. The next public request reads current shared data and renders the page on the Worker.

There is **no Publish step and no rebuild**. A successful “live now for every visitor” message means the write completed. Refreshing the public page, opening it in another browser, or requesting it without cookies retrieves the same content. Public HTML uses `Cache-Control: no-store`; uploaded image bytes can be cached normally.

### Repository content and CMS content

`src/content/` and `public/images/uploads/` are the baseline included with the code. Shared edits are layered over that baseline at request time:

- Editing an existing entry creates a shared override; it does not rewrite the Git file.
- Creating an entry creates a real dynamic public URL.
- Deleting a baseline entry creates a tombstone so redeployment does not restore it.
- “Revert to file version” removes an override where that action is offered.
- Redeploying the Worker preserves shared content as long as the same Durable Object binding is retained.

## 2. Sign in and secure the account

Open `https://ams-builds.online/admin/` (or the local equivalent). A new installation starts with:

- Username: `admin`
- Password: `admin12345`

Go to **Account** and change the password immediately. Passwords are stored as PBKDF2 hashes; changing the password keeps the current session and invalidates other sessions. A failed arbitrary first login does not initialize the account.

If access is lost, do not delete the Durable Object to reset it—that would also delete shared pages, posts, settings, and uploads. Recover access through a controlled administrative procedure instead.

## 3. Pages, blog posts, and projects

From the admin navigation, choose **Pages**, **Blog**, or **Projects**, then create or edit an entry.

- **Title and slug:** the slug determines the public URL. Use lowercase letters, numbers, and dashes.
- **Body:** write Markdown and use the preview before saving.
- **Images:** choose a repository image or an uploaded shared image for hero/featured/cover fields. Images can also be included in Markdown.
- **Draft:** drafts stay out of public detail pages and listings. Public shared-data exports do not expose draft bodies.
- **SEO fields:** optional title, description, social image, and noindex settings are rendered server-side.
- **Page navigation:** enable header/footer display and set `navOrder`; navigation updates on the next request.

Public URL patterns:

```text
/<page-slug>/
/blog/<post-slug>/
/projects/<project-slug>/
```

After saving, open the URL in a private window to verify the anonymous experience. A 200 response from that fresh context—not a same-tab preview—is the publishing check.

## 4. Images

Use **Images → Upload** or the image picker in an editor.

- Accepted formats: JPEG, PNG, WebP, and GIF.
- Maximum size: 4 MB per image.
- Files are validated and stored in the Durable Object under `/images/uploads/`.
- Filename collisions receive a suffix rather than silently replacing an unrelated image.
- Deleting an uploaded image does not delete content that references it; update those references first.

Repository images remain available. Only shared uploads can be deleted from the media library.

## 5. Site settings

**Site settings** controls branding, contact/social details, homepage content and statistics, search verification, analytics, and AdSense configuration. Saving settings updates public metadata and relevant sections immediately.

The Git file `src/content/settings/site.yml` remains the fallback for a new/empty shared store.

## 6. Export and backup

**Export & Backup → Download backup** downloads JSON containing current published content, settings, deletion markers, draft metadata, and uploaded-image metadata.

Important limitations:

- Draft bodies are deliberately omitted from the public-content export.
- The JSON contains image metadata, **not image binary data**.
- There is no one-click JSON import/restore flow.

Keep separate copies of original image files. For a complete disaster-recovery backup, use an appropriate Cloudflare storage/export procedure and retain the repository baseline. Do not describe the JSON download alone as a full restore.

## 7. Local development and production preview

```bash
npm install
npm run dev
```

`astro dev` uses `.dev-cms/` for shared local edits and uploads. This directory is ignored by Git and is not production data.

To test the same Worker/runtime used in production:

```bash
npm run preview
# or, after npm run build:
npx wrangler dev --local --host 0.0.0.0 --port 4322
```

Run all checks with:

```bash
npm test
npm run build
```

The production regression runs in an isolated temporary project and local Durable Object. It does not use or delete your development or deployed content. Temporary browser-proof entries should also be removed afterward, with original settings restored.

## 8. Deploy to Cloudflare

This version must run as a Worker. Deploying `dist/` as a static site will not provide shared CMS behavior.

### Initial deployment

Authenticate in your deployment environment, never in source files or chat:

```bash
npx wrangler login
npm run build
npx wrangler deploy
```

CI can instead use a suitably scoped `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as protected secrets. The repository itself contains no Cloudflare credentials.

The configuration in `wrangler.jsonc` provides:

- Worker name `ams-builds-online`.
- Astro's built server Worker plus static assets.
- The `CMS` Durable Object binding.
- The `v1` SQLite-class migration for `CmsSite`.

### Custom domain

In the Cloudflare dashboard, add the site's Custom Domains to this Worker and confirm DNS/TLS. Merging GitHub code alone does not prove Cloudflare deployed it.

### Deployment verification

On the actual deployed origin:

1. Confirm `/`, `/blog/`, and `/admin/` return the expected responses.
2. Sign in and create a uniquely named temporary page and post, upload a real image, and attach it.
3. Open both new URLs in a fresh incognito context with no admin session; verify HTTP 200, body content, image loading, homepage/blog listing, and navigation as applicable.
4. Refresh and recheck. Optionally verify RSS and sitemap.
5. Delete only the temporary entries/upload and restore any temporary settings change.
6. Confirm temporary URLs return the styled 404 and pre-existing user content remains available.

## 9. Architecture map

```text
Browser admin
   │ authenticated API writes
   ▼
CmsSite Durable Object ◄──── public Worker requests
   │                            │
   │                            ├─ detail pages
   │                            ├─ homepage/navigation/indexes
   │                            ├─ RSS + sitemap
   │                            └─ uploaded images
   ▼
SQLite: entries, tombstones, media, credentials, sessions

Git Markdown/YAML/images ──────► baseline merged on each request
```

Markdown is rendered with `marked` and sanitized with `sanitize-html`. This avoids Shiki/oniguruma WebAssembly initialization, which is not allowed during dynamic Cloudflare requests in this application.
