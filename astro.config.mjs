// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// Public pages are server-rendered from the shared CMS store on every request.
// Saving in /admin therefore updates the site immediately for every visitor;
// no browser-local overlay, GitHub token, or rebuild hook is involved.
export default defineConfig({
  site: 'https://ams-builds.online',
  integrations: [tailwind({ applyBaseStyles: false })],
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
