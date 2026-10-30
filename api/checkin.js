// api/checkin.js
// Vercel Serverless Function (Node.js runtime)

export default async function handler(req, res) {
  // Set CORS headers for same-origin or preview safety
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const APPS_SCRIPT_URL = process.env.TFB_APPS_SCRIPT_URL;
  const SHARED_SECRET = process.env.TFB_API_SECRET;

  // 1. Health check endpoint (GET /api/checkin)
  if (req.method === 'GET') {
    if (!APPS_SCRIPT_URL || !SHARED_SECRET) {
      return res.status(500).json({
        ok: false,
        error: 'Missing environment variables: TFB_APPS_SCRIPT_URL or TFB_API_SECRET not set in Vercel.'
      });
    }

    try {
      // Test connectivity to Apps Script endpoint
      const healthCheck = await fetch(`${APPS_SCRIPT_URL}?action=ping`, {
        method: 'GET',
        redirect: 'follow'
      });
      return res.status(200).json({
        ok: true,
        status: 'healthy',
        appsScriptConnected: healthCheck.ok
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        status: 'apps_script_unreachable',
        error: err.message
      });
    }
  }

  // 2. Ticket Check-In (POST /api/checkin)
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { token, pin } = req.body || {};

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Missing ticket token' });
  }

  if (!APPS_SCRIPT_URL || !SHARED_SECRET) {
    return res.status(500).json({
      ok: false,
      error: 'Server configuration error: TFB_APPS_SCRIPT_URL or TFB_API_SECRET missing.'
    });
  }

  try {
    // Contract expected by Code.gs:
    // { sharedSecret, action: 'checkin', token, pin }
    const payload = {
      sharedSecret: SHARED_SECRET,
      action: 'checkin',
      token: String(token).trim(),
      pin: pin ? String(pin).trim() : ''
    };

    // Google Apps Script doPost redirects (302). Fetch with 'redirect: follow' handles this.
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // If Apps Script returns an HTML error page or raw text
      return res.status(502).json({
        ok: false,
        error: 'Invalid response from Apps Script backend',
        details: responseText.slice(0, 300)
      });
    }

    // Forward the backend status and payload to frontend
    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Failed to communicate with Google Apps Script backend',
      details: error.message
    });
  }
}