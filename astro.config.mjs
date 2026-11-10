// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

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
    server: {
      host: true,
      allowedHosts: true,
      port: 4321,
      strictPort: true,
    },
  },
});
