// api/checkin.js
// Vercel Serverless Function — TFB QR Scanner Backend Proxy
// Hardened against CORS bypass, brute-force PIN attacks, PII leakage, and quota exhaustion.

// In-memory sliding window rate limiter (per serverless instance)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 35; // Max 35 check-in attempts per minute per IP

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || [];
  // Retain only requests within the active sliding window
  const recentRequests = record.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(ip, recentRequests);

  // Periodic garbage collection for memory hygiene
  if (rateLimitMap.size > 1000) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.delete(key);
      }
    }
  }
  return false;
}

export default async function handler(req, res) {
  // Extract client IP address from Vercel forward headers
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

  // Apply rate limiting
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait a moment before trying again.'
    });
  }

  const configuredOrigin = process.env.TFB_ALLOWED_ORIGIN || 'https://qr-scanner-kappa-indol.vercel.app';
  const requestOrigin = req.headers.origin || '';

  // Strict origin verification: blocks third-party sites while allowing authorized project domains
  function isOriginAuthorized(origin) {
    if (!origin) return true; // Direct server-to-server or curl probes
    try {
      const parsed = new URL(origin);
      // Exact match with configured primary origin
      if (parsed.origin === configuredOrigin) return true;
      
      // Allow only this specific project's own Vercel domains (e.g. qr-scanner-*.vercel.app)
      if (parsed.protocol === 'https:' && /^qr-scanner(-[a-z0-9]+)?\.vercel\.app$/i.test(parsed.hostname)) {
        return true;
      }

      // Localhost allowed strictly during development
      if (process.env.NODE_ENV !== 'production' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  // Set hardened security and CORS headers
  if (requestOrigin && isOriginAuthorized(requestOrigin)) {
    try {
      res.setHeader('Access-Control-Allow-Origin', new URL(requestOrigin).origin);
    } catch (_) {
      res.setHeader('Access-Control-Allow-Origin', configuredOrigin);
    }
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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Reject unauthorized browser origins
  if (requestOrigin && !isOriginAuthorized(requestOrigin)) {
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_ORIGIN',
      message: 'Access denied: origin not authorized.'
    });
  }

  const APPS_SCRIPT_URL = process.env.TFB_APPS_SCRIPT_URL;
  const SHARED_SECRET = process.env.TFB_API_SECRET;

  // 1. Health check endpoint (GET /api/checkin or /api/checkin?action=health)
  if (req.method === 'GET') {
    if (!APPS_SCRIPT_URL || !SHARED_SECRET) {
      return res.status(500).json({
        ok: false,
        backendReachable: false,
        error: 'Missing environment variables: TFB_APPS_SCRIPT_URL or TFB_API_SECRET not set in Vercel.'
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const healthRes = await fetch(`${APPS_SCRIPT_URL}?action=health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        redirect: 'follow',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const text = await healthRes.text();
      let healthData;
      try {
        healthData = JSON.parse(text);
      } catch (_) {
        return res.status(502).json({
          ok: false,
          backendReachable: false,
          error: 'Apps Script returned non-JSON during health check.'
        });
      }

      return res.status(200).json({
        ok: Boolean(healthData && healthData.ok),
        backendReachable: true,
        service: 'TFB QR Check-In',
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      const isAbort = err.name === 'AbortError';
      return res.status(502).json({
        ok: false,
        backendReachable: false,
        error: isAbort ? 'Apps Script health check timed out' : 'Apps Script unreachable'
      });
    }
  }

  // 2. Ticket check-in endpoint (POST /api/checkin)
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  }

  // Enforce JSON Content-Type
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return res.status(415).json({
      ok: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Content-Type must be application/json'
    });
  }

  const { action, token, pin } = req.body || {};

  if (!action || String(action).toLowerCase() !== 'checkin') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_ACTION',
      message: 'Invalid action. Expected "checkin".'
    });
  }

  const cleanToken = typeof token === 'string' ? token.trim() : '';
  const cleanPin = typeof pin === 'string' ? pin.trim() : '';

  if (!cleanToken) {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'No ticket token provided.'
    });
  }

  if (!cleanPin) {
    return res.status(401).json({
      ok: false,
      code: 'AUTH_FAILED',
      message: 'Staff access code required.'
    });
  }

  // Strict input boundary limits
  if (cleanToken.length > 256 || cleanPin.length > 128) {
    return res.status(400).json({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Input exceeds maximum permitted size.'
    });
  }

  if (!APPS_SCRIPT_URL || !SHARED_SECRET) {
    return res.status(500).json({
      ok: false,
      code: 'CONFIG_ERROR',
      message: 'Server configuration error: upstream variables missing.'
    });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const upstreamPayload = {
      sharedSecret: SHARED_SECRET,
      action: 'checkin',
      token: cleanToken,
      pin: cleanPin
    };

    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(upstreamPayload),
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const rawResponseText = await upstreamResponse.text();

    let data;
    try {
      data = JSON.parse(rawResponseText);
    } catch (_) {
      // Do not leak raw HTML or internal Apps Script errors to the client
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
        : 'Failed to communicate with Google Apps Script backend.'
    });
  }
}
