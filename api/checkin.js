// api/checkin.js
// Vercel Serverless Function — TFB QR Scanner Backend Proxy
// Supports two independent Apps Script backends:
//   ₹999  single-entry: TFB_APPS_SCRIPT_URL  / TFB_API_SECRET
//   ₹1699 couple-entry: TFB_1699_APPS_SCRIPT_URL / TFB_1699_API_SECRET
//
// Routing: tokens starting with "TFB1699-" → couple backend.
//           all other tokens              → single-entry backend.
//
// Hardened against CORS bypass, brute-force PIN attacks, PII leakage, and quota exhaustion.

// ─── In-memory sliding window rate limiter (per serverless instance) ──────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;   // 1 minute
const MAX_REQUESTS_PER_WINDOW = 35;        // 35 check-in attempts per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || [];
  const recent = record.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return true;

  recent.push(now);
  rateLimitMap.set(ip, recent);

  // Periodic garbage collection
  if (rateLimitMap.size > 1000) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      if (!timestamps.length || now - timestamps[timestamps.length - 1] > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }
  return false;
}

// ─── Probe a single Apps Script backend health endpoint ───────────────────────
async function probeBackendHealth(url, label) {
  if (!url) {
    return { ok: false, reachable: false, error: 'URL not configured' };
  }
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${url}?action=health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = null; }

    return { ok: Boolean(data && data.ok), reachable: true };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      error: err.name === 'AbortError' ? `${label} health check timed out` : `${label} unreachable`
    };
  }
}

// ─── Forward a check-in POST to one Apps Script backend ───────────────────────
async function forwardToAppsScript(targetUrl, targetSecret, token, pin) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 15000);

  const upstreamRes = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      sharedSecret: targetSecret,
      action: 'checkin',
      token,
      pin
    }),
    redirect: 'follow',
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  const rawText = await upstreamRes.text();
  let data;
  try { data = JSON.parse(rawText); } catch (_) { data = null; }
  return data;
}


export default async function handler(req, res) {
  // ── Rate limiting ────────────────────────────────────────────────────────────
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.socket?.remoteAddress
                || 'unknown';

  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment before trying again.'
    });
  }

  // ── CORS / origin ────────────────────────────────────────────────────────────
  const configuredOrigin = process.env.TFB_ALLOWED_ORIGIN || 'https://qr-scanner-kappa-indol.vercel.app';
  const requestOrigin    = req.headers.origin || '';

  function isOriginAuthorized(origin) {
    if (!origin) return true; // server-to-server or curl
    try {
      const parsed = new URL(origin);
      if (parsed.origin === configuredOrigin) return true;
      if (parsed.protocol === 'https:' && /^qr-scanner(-[a-z0-9]+)?\.vercel\.app$/i.test(parsed.hostname)) return true;
      if (process.env.NODE_ENV !== 'production' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
    } catch (_) {}
    return false;
  }

  if (requestOrigin && isOriginAuthorized(requestOrigin)) {
    try { res.setHeader('Access-Control-Allow-Origin', new URL(requestOrigin).origin); }
    catch (_) { res.setHeader('Access-Control-Allow-Origin', configuredOrigin); }
  } else {
    res.setHeader('Access-Control-Allow-Origin', configuredOrigin);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (requestOrigin && !isOriginAuthorized(requestOrigin)) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN_ORIGIN', message: 'Access denied: origin not authorized.' });
  }

  // ── Env vars ─────────────────────────────────────────────────────────────────
  const APPS_SCRIPT_URL_999    = process.env.TFB_APPS_SCRIPT_URL;
  const SHARED_SECRET_999      = process.env.TFB_API_SECRET;
  const APPS_SCRIPT_URL_1699   = process.env.TFB_1699_APPS_SCRIPT_URL;
  const SHARED_SECRET_1699     = process.env.TFB_1699_API_SECRET;

  // ── GET — dual-backend health check ─────────────────────────────────────────
  if (req.method === 'GET') {
    const [health999, health1699] = await Promise.all([
      probeBackendHealth(APPS_SCRIPT_URL_999,  '₹999 backend'),
      probeBackendHealth(APPS_SCRIPT_URL_1699, '₹1699 backend')
    ]);

    // The overall "ok" only requires at least one backend to be live.
    // The frontend uses this to show its status indicator.
    const overallOk = health999.ok || health1699.ok;

    return res.status(200).json({
      ok: overallOk,
      service: 'TFB QR Check-In',
      timestamp: new Date().toISOString(),
      backends: {
        single999:  health999,
        couple1699: health1699
      }
    });
  }

  // ── POST — ticket check-in ───────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
  }

  // Enforce JSON Content-Type
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return res.status(415).json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json.' });
  }

  const { action, token, pin } = req.body || {};

  if (!action || String(action).toLowerCase() !== 'checkin') {
    return res.status(400).json({ ok: false, code: 'INVALID_ACTION', message: 'Invalid action. Expected "checkin".' });
  }

  const cleanToken = typeof token === 'string' ? token.trim() : '';
  const cleanPin   = typeof pin   === 'string' ? pin.trim()   : '';

  if (!cleanToken) {
    return res.status(400).json({ ok: false, code: 'INVALID_TOKEN', message: 'No ticket token provided.' });
  }
  if (!cleanPin) {
    return res.status(401).json({ ok: false, code: 'AUTH_FAILED', message: 'Staff access code required.' });
  }
  if (cleanToken.length > 256 || cleanPin.length > 128) {
    return res.status(400).json({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Input exceeds maximum permitted size.' });
  }

  // ── Route by token prefix ────────────────────────────────────────────────────
  const is1699Token  = cleanToken.startsWith('TFB1699-');
  const targetUrl    = is1699Token ? APPS_SCRIPT_URL_1699 : APPS_SCRIPT_URL_999;
  const targetSecret = is1699Token ? SHARED_SECRET_1699   : SHARED_SECRET_999;

  if (!targetUrl || !targetSecret) {
    const which = is1699Token ? 'TFB_1699_APPS_SCRIPT_URL / TFB_1699_API_SECRET' : 'TFB_APPS_SCRIPT_URL / TFB_API_SECRET';
    return res.status(500).json({
      ok: false,
      code: 'CONFIG_ERROR',
      message: `Server configuration error: ${which} not set in Vercel.`
    });
  }

  // ── Forward to the correct Apps Script backend ───────────────────────────────
  try {
    const data = await forwardToAppsScript(targetUrl, targetSecret, cleanToken, cleanPin);

    if (!data) {
      return res.status(502).json({
        ok: false,
        code: 'SYSTEM_ERROR',
        message: 'Google Apps Script returned an invalid response format.'
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    const isAbort = err.name === 'AbortError';
    return res.status(502).json({
      ok: false,
      code: 'GATEWAY_TIMEOUT',
      message: isAbort
        ? 'Verification request timed out. Please try again.'
        : 'Failed to communicate with the Apps Script backend.'
    });
  }
}
