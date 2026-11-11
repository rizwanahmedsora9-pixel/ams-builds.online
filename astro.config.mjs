// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://docs.astro.build/en/reference/configuration-reference/
//
// Builds to pure static HTML/CSS/JS in dist/ (deployable anywhere: Vercel,
// Cloudflare Workers/Pages, Netlify, or any static host), including /admin/
// which runs the built-in client-side CMS.
export default defineConfig({
  site: 'https://ams-builds.online',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  output: 'static',
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
