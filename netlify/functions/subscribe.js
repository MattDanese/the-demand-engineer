// netlify/functions/subscribe.js
// Subscribes an email address to Kit form 4d030b8ed0 via the V3 API.
// Set KIT_API_SECRET in Netlify → Site configuration → Environment variables.

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof body === 'string' ? { message: body } : body),
  };
}

function httpsPost(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

exports.handler = async function (event, context) {
  const method = (event.httpMethod || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (method !== 'POST') {
    return respond(405, { error: 'Method not allowed. Got: ' + method });
  }

  const apiSecret = process.env.KIT_API_SECRET;
  if (!apiSecret) {
    return respond(500, { error: 'KIT_API_SECRET environment variable is not set.' });
  }

  let fields;
  try {
    fields = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON in request body.' });
  }

  const { email } = fields;
  if (!email) {
    return respond(400, { error: 'Missing required field: email.' });
  }

  const payload = JSON.stringify({ api_secret: apiSecret, email: email });

  try {
    const kit = await httpsPost(
      {
        hostname: 'api.convertkit.com',
        path:     '/v3/forms/4d030b8ed0/subscribe',
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      payload
    );

    if (kit.status >= 200 && kit.status < 300) {
      return respond(200, { success: true });
    }

    return respond(500, { error: 'Kit API returned status ' + kit.status, detail: kit.body });

  } catch (err) {
    return respond(500, { error: 'Failed to reach Kit API: ' + err.message });
  }
};
