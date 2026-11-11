// Runs the same end-to-end steps against the Cloudflare runtime (wrangler dev).
process.env.TARGET = 'cloudflare';
await import('./e2e.mjs');
