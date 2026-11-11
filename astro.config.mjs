// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://docs.astro.build/en/reference/configuration-reference/
//
// The site builds to static HTML for every content page (prerender = true)
// and runs a thin Cloudflare Worker for the admin app, its API and media
// that only exists in Durable Object storage (see worker/ and src/pages/admin*).
export default defineConfig({
  site: 'https://ams-builds.online',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap(),
  ],
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: false } }),
  build: { format: 'directory' },
  vite: {
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
