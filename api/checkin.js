// api/checkin.js
// Vercel Serverless Function — TFB QR Scanner Backend Proxy
// Forwards verified requests to Google Apps Script doPost() without exposing secrets to the browser.

export default async function handler(req, res) {
  const allowedOriginSetting = process.env.TFB_ALLOWED_ORIGIN || 'https://qr-scanner-kappa-indol.vercel.app';
  const requestOrigin = req.headers.origin || req.headers.referer || '';

  // Helper to validate origin
  function isOriginAllowed(origin) {
    if (!origin) return true; // Server-to-server or direct curl/health-checks
    try {
      const url = new URL(origin);
      const host = url.origin;
      if (host === allowedOriginSetting) return true;
      // Allow local development and Vercel preview deployments
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.vercel.app')) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Set standard security & CORS headers
  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    try {
      const parsed = new URL(requestOrigin);
      res.setHeader('Access-Control-Allow-Origin', parsed.origin);
    } catch (e) {
      res.setHeader('Access-Control-Allow-Origin', allowedOriginSetting);
    }
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOriginSetting);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-Type, Date'
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Reject unauthorized browser origins
  if (req.headers.origin && !isOriginAllowed(req.headers.origin)) {
    return res.status(403).json({
      ok: false,
      code: 'FORBIDDEN_ORIGIN',
      message: 'Requests from this origin are not permitted.'
    });
  }

  const APPS_SCRIPT_URL = process.env.TFB_APPS_SCRIPT_URL;
  const SHARED_SECRET = process.env.TFB_API_SECRET;

  // 1. Health check endpoint: GET /api/checkin or GET /api/checkin?action=health
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
      } catch (e) {
        return res.status(502).json({
          ok: false,
          backendReachable: false,
          error: 'Apps Script returned non-JSON response during health check.',
          preview: text.slice(0, 150)
        });
      }

      return res.status(200).json({
        ok: Boolean(healthData && healthData.ok),
        backendReachable: true,
        service: healthData.service || 'TFB QR Check-In',
        timestamp: healthData.timestamp || new Date().toISOString()
      });

    } catch (err) {
      const isAbort = err.name === 'AbortError';
      return res.status(502).json({
        ok: false,
        backendReachable: false,
        error: isAbort ? 'Apps Script health check timed out (10s)' : (err.message || 'Apps Script unreachable')
      });
    }
  }

  // 2. Check-in endpoint: POST /api/checkin
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' });
  }

  const { action, token, pin } = req.body || {};

  if (!action || String(action).toLowerCase() !== 'checkin') {
    return res.status(400).json({
      ok: false,
      code: 'INVALID_ACTION',
      message: 'Invalid or missing action. Expected "checkin".'
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

  // Enforce reasonable input limits to protect downstream Apps Script
  if (cleanToken.length > 256 || cleanPin.length > 128) {
    return res.status(400).json({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Input exceeds maximum permitted length.'
    });
  }

  if (!APPS_SCRIPT_URL || !SHARED_SECRET) {
    return res.status(500).json({
      ok: false,
      code: 'CONFIG_ERROR',
      message: 'Server configuration error: TFB_APPS_SCRIPT_URL or TFB_API_SECRET not set in Vercel environment.'
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
    } catch (jsonErr) {
      return res.status(502).json({
        ok: false,
        code: 'SYSTEM_ERROR',
        message: 'Google Apps Script returned an unexpected non-JSON response.',
        detail: rawResponseText.slice(0, 200)
      });
    }

    // Forward the JSON result safely to the client
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
