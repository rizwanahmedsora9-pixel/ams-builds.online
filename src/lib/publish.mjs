// Triggers a site rebuild through a Cloudflare Workers Builds Deploy Hook.
// The hook URL is stored as the CMS_DEPLOY_HOOK secret (runtime variable).
const FALLBACK_SITE = 'https://ams-builds.online';

export function deployHookUrl(env) {
  const value = env?.CMS_DEPLOY_HOOK;
  return typeof value === 'string' && /^https:\/\//.test(value) ? value : null;
}

/**
 * POST to the deploy hook. Returns { ok, message, ... } in every case —
 * a missing hook or a rate-limited free-plan build must never throw.
 */
export async function triggerPublish(env) {
  const hook = deployHookUrl(env);
  if (!hook) {
    return {
      ok: false,
      reason: 'no-hook',
      message:
        'The rebuild hook is not configured yet. Add the CMS_DEPLOY_HOOK secret in the Cloudflare dashboard (Workers → ams-builds-online → Settings → Variables and Secrets).',
    };
  }

  try {
    const response = await fetch(hook, { method: 'POST' });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok && payload?.success) {
      const build = payload.result || {};
      return {
        ok: true,
        reason: 'triggered',
        buildUuid: build.build_uuid || null,
        branch: build.branch || null,
        alreadyExists: build.already_exists === true,
        message: build.already_exists
          ? 'A rebuild is already running — the new content will be live shortly.'
          : 'Rebuild started. The site will update in about a minute.',
      };
    }

    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const detail = errors.map((e) => e.message || e.code || '').filter(Boolean).join('; ');
    const code = errors[0]?.code;
    const status = response.status;

    // Cloudflare rate/plan limits surface here (403/429 with an error code).
    if (status === 403 || status === 429 || /limit|rate|quota|10013|10000/i.test(detail)) {
      return {
        ok: false,
        reason: 'rate-limited',
        status,
        message:
          'Cloudflare refused the rebuild trigger right now (free-plan build limits). Your content is saved — publish again in a minute, or run the rebuild manually from the Cloudflare dashboard (Workers → ams-builds-online → Settings → Builds → Deploy Hooks).',
      };
    }

    return {
      ok: false,
      reason: 'rejected',
      status,
      message: `Rebuild trigger failed (HTTP ${status}${detail ? `: ${detail}` : ''}). Your content is saved.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'network',
      message: `Could not reach the rebuild hook (${error?.message || 'network error'}). Your content is saved.`,
    };
  }
}

/** Absolute URL of the public content export used by the build. */
export function exportUrl(site) {
  const base = (site || FALLBACK_SITE).replace(/\/+$/, '');
  const override = typeof process !== 'undefined' && process.env?.CMS_EXPORT_URL;
  return override ? override : `${base}/admin/api/export`;
}
