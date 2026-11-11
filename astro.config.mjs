// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import { createOAuthStart, completeOAuthCallback } from './worker/oauth.js';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  site: 'https://ams-builds.online',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap(),
  ],
  output: 'static',
  build: { format: 'directory' },
  vite: {
    plugins: [
      {
        name: 'decap-admin-dev-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const rawUrl = req.url || '/';
            const pathname = rawUrl.split('?')[0];

            if (pathname === '/admin' || pathname === '/admin/') {
              req.url = '/admin/index.html' + (rawUrl.includes('?') ? '?' + rawUrl.split('?')[1] : '');
              return next();
            }

            if (pathname === '/auth' || pathname === '/api/auth') {
              const fullUrl = `http://${req.headers.host || 'localhost'}${rawUrl}`;
              const parsed = new URL(fullUrl);
              const outcome = createOAuthStart({
                method: req.method,
                query: Object.fromEntries(parsed.searchParams.entries()),
                headers: req.headers,
                requestUrl: fullUrl,
                env: process.env,
              });

              for (const [k, v] of Object.entries(outcome.headers || {})) {
                res.setHeader(k, v);
              }
              if (outcome.redirectLocation) {
                res.writeHead(outcome.status, { Location: outcome.redirectLocation });
                return res.end();
              }
              res.writeHead(outcome.status);
              return res.end(outcome.body);
            }

            if (pathname === '/callback' || pathname === '/api/callback') {
              const fullUrl = `http://${req.headers.host || 'localhost'}${rawUrl}`;
              const parsed = new URL(fullUrl);
              const outcome = await completeOAuthCallback({
                method: req.method,
                query: Object.fromEntries(parsed.searchParams.entries()),
                headers: req.headers,
                requestUrl: fullUrl,
                env: process.env,
              });

              for (const [k, v] of Object.entries(outcome.headers || {})) {
                res.setHeader(k, v);
              }
              res.writeHead(outcome.status);
              return res.end(outcome.body);
            }

            next();
          });
        },
      },
    ],
    server: {
      host: true,
      allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
      port: 4321,
      strictPort: true,
    },
    preview: {
      host: true,
      allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
      port: 4321,
      strictPort: true,
    },
  },
});
