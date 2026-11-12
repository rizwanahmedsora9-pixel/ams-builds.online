import { Hono } from 'hono';
import type { Env } from './types';
import { cfgFor, getConfig, isInstalled, bumpCache } from './lib/config';
import { publishDue } from './lib/content';
import { migrate } from './db/migrations';
import { pruneAllRevisions, pruneLocks } from './admin/revisions';
import { pruneAudit } from './lib/audit';
import install from './routes/install';
import api from './routes/api';
import admin from './routes/admin';
import site from './routes/public';

const app = new Hono<{ Bindings: Env }>();

// Install gate: until the KV flag exists every URL leads to /install; once it
// exists /install is gone for good. Host-agnostic, so it works on workers.dev
// and on any custom domain.
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const onInstaller = path === '/install' || path.startsWith('/install/');
  if (path === '/api/health') return next(); // must answer before install too
  const installed = await isInstalled(c.env);
  if (!installed && !onInstaller) {
    return new Response(null, { status: 302, headers: { Location: '/install', 'Cache-Control': 'no-store' } });
  }
  if (installed && onInstaller) return c.notFound();
  await next();
});

app.route('/install', install);
app.route('/api', api);

// Everything else is either the admin panel (under the configurable slug) or the public site.
app.all('*', async (c) => {
  const cfg = await getConfig(c.env);
  const url = new URL(c.req.url);
  const prefix = '/' + cfg.adminSlug;
  if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
    url.pathname = url.pathname.slice(prefix.length) || '/';
    const req = new Request(url.toString(), c.req.raw);
    cfgFor.set(req, cfg);
    return admin.fetch(req, c.env, c.executionCtx);
  }
  cfgFor.set(c.req.raw, cfg);
  return site.fetch(c.req.raw, c.env, c.executionCtx);
});

app.onError((err, c) => {
  console.error(err);
  return c.text('Internal error', 500);
});

export default {
  fetch: app.fetch,

  // Cron Trigger: scheduled publishing + pending DB migrations.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      if (!(await isInstalled(env))) return;
      await migrate(env);
      if ((await publishDue(env)) > 0) await bumpCache(env);
      // Housekeeping for the editor: expired edit locks and old autosaves.
      await pruneLocks(env);
      await pruneAllRevisions(env);
      // Audit retention: 90 days, so the table cannot grow without limit.
      await pruneAudit(env);
    })());
  },
} satisfies ExportedHandler<Env>;
