// netlify/functions/subscribe.js
// Server-side Kit email subscription proxy.
// Keeps the Kit form endpoint off the client to avoid CORS issues.

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

  const payload = new URLSearchParams({ email_address: email }).toString();

  try {
    const kit = await httpsPost(
      {
        hostname: 'app.kit.com',
        path:     '/forms/4d030b8ed0/subscriptions',
        method:   'POST',
        headers: {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      payload
    );

    if (kit.status >= 200 && kit.status < 300) {
      return respond(200, { success: true });
    }

    return respond(500, { error: 'Kit returned status ' + kit.status, detail: kit.body });

  } catch (err) {
    return respond(500, { error: 'Failed to reach Kit: ' + err.message });
  }
};
