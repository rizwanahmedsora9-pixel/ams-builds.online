/**
 * Node.js entry point: runs the same CMS outside Cloudflare (VPS, Docker,
 * PaaS, laptop). Configuration via environment variables:
 *   PORT         default 8787
 *   HOST         default 0.0.0.0
 *   DATA_DIR     default ./data   (SQLite database + uploaded media)
 *   TRUST_PROXY  set to 1 when behind nginx/Caddy/a PaaS router so that
 *                X-Forwarded-Proto/-Host/-For are honoured
 */
import { serve } from '@hono/node-server';
import worker from '../index';
import { openStorage } from './storage';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || './data';
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');

const { env, purgeExpired, close } = openStorage(DATA_DIR);

// Stand-in for the Workers ExecutionContext: background work simply keeps running.
const ctx = {
  waitUntil(promise: Promise<unknown>) { promise.catch((err) => console.error('background task failed:', err)); },
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;

const firstValue = (v: string | null) => (v ? v.split(',')[0].trim() : '');

const server = serve(
  {
    port: PORT,
    hostname: HOST,
    async fetch(req: Request, bindings: { incoming: { socket: { remoteAddress?: string } } }) {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      let ip = bindings.incoming.socket.remoteAddress || 'unknown';
      if (TRUST_PROXY) {
        const proto = firstValue(headers.get('x-forwarded-proto'));
        const host = firstValue(headers.get('x-forwarded-host'));
        if (proto === 'https' || proto === 'http') url.protocol = proto + ':';
        if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) { url.port = ''; url.host = host; }
        ip = firstValue(headers.get('x-forwarded-for')) || ip;
      }
      // The app reads the client address from this header (as on Cloudflare);
      // always overwrite it so a client cannot spoof it.
      headers.set('cf-connecting-ip', ip);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(url, {
        method: req.method, headers, redirect: 'manual',
        body: hasBody ? req.body : undefined,
        ...(hasBody ? { duplex: 'half' } : {}),
      } as RequestInit);
      return worker.fetch(request, env, ctx);
    },
  },
  (info) => console.log(`CMS running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${info.port}  (data: ${DATA_DIR}${TRUST_PROXY ? ', trusting proxy headers' : ''})`),
);

// Replaces the Cloudflare Cron Trigger: scheduled publishing + migrations, once a minute.
const tick = () => {
  worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() } as ScheduledController, env, ctx).catch((err) => console.error('cron failed:', err));
  try { purgeExpired(); } catch (err) { console.error('cache cleanup failed:', err); }
};
// Say what state the site is in, so the first run is obvious.
(env.KV.get('config', 'json') as Promise<{ adminSlug?: string } | null>).then(async (cfg) => {
  const installed = !!(await env.KV.get('installed'));
  console.log(installed && cfg?.adminSlug
    ? `Site is installed. Admin panel: /${cfg.adminSlug}`
    : 'Site is not installed yet. Open /install in your browser to set it up.');
}).catch((err) => console.error('startup check failed:', err));

const timer = setInterval(tick, 60_000);
tick();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => { close(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
