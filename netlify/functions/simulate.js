// netlify/functions/simulate.js
// Serverless proxy — keeps the Anthropic API key out of client-side code.
// Set the env var  Anthropic_API_for_Simulator  in the Netlify dashboard:
//   Site → Environment variables → Add variable

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── helpers ────────────────────────────────────────────────────────────────

function respond(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
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

// ── handler ────────────────────────────────────────────────────────────────

exports.handler = async function (event, context) {
  const method = (event.httpMethod || '').toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (method !== 'POST') {
    return respond(405, { error: 'Method not allowed. Got: ' + method });
  }

  const apiKey = process.env.Anthropic_API_for_Simulator;
  if (!apiKey) {
    return respond(500, { error: 'API key not configured on the server.' });
  }

  // Parse incoming body
  let fields;
  try {
    fields = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON in request body.' });
  }

  const { name, description, icp, channel, offer } = fields;
  if (!name || !description || !icp || !channel || !offer) {
    return respond(400, { error: 'Missing one or more required fields.' });
  }

  // Build prompts
  const systemPrompt =
    'You are simulating a panel of four business professionals reviewing a B2B SaaS marketing campaign. ' +
    'Each persona must respond in character — blunt, specific, and honest. Do not be generically positive. ' +
    'Also return: panel_score (average of all four scores to one decimal), verdict (one of: Kill It / Needs Work / Has Potential / Strong Play / Launch Ready), ' +
    'consensus (one sentence on what all personas agreed, good or bad), strongest_element (the single best thing about this campaign in one sentence), ' +
    'fix_these (array of exactly 3 specific, actionable fixes a demand gen manager could implement before launch). ' +
    'Return ONLY a valid JSON object with no markdown, no backticks, no preamble.';

  const userPrompt =
    'Review this campaign as four distinct personas. Return a JSON object with this exact structure:\n' +
    '{\n' +
    '  "cmo": { "score": [1-10], "reaction": "[2-4 sentences in character]" },\n' +
    '  "sales_director": { "score": [1-10], "reaction": "[2-4 sentences in character]" },\n' +
    '  "skeptical_prospect": { "score": [1-10], "reaction": "[2-4 sentences in character]" },\n' +
    '  "churned_customer": { "score": [1-10], "reaction": "[2-4 sentences in character]" },\n' +
    '  "panel_score": [average of all four scores to one decimal],\n' +
    '  "verdict": "[one of: Kill It, Needs Work, Has Potential, Strong Play, Launch Ready]",\n' +
    '  "consensus": "[one sentence max — what all four personas agreed on, good or bad]",\n' +
    '  "strongest_element": "[one sentence — the single best thing about this campaign]",\n' +
    '  "fix_these": ["[specific fix #1]", "[specific fix #2]", "[specific fix #3]"]\n' +
    '}\n' +
    'Persona voices:\n' +
    '- CMO: Strategic, ROI-focused, impatient. Evaluates pipeline potential and resource efficiency.\n' +
    '- Director of Sales: Skeptical, conversion-focused. Evaluates lead quality and whether they can actually close these.\n' +
    "- Skeptical Prospect: Busy, ad-fatigued, defensive. Evaluates whether they'd stop scrolling.\n" +
    '- Churned Customer: Burned before, candid, wary. Evaluates whether this feels like the same empty promise.\n' +
    'Campaign: Name: ' + name +
    ', Description: ' + description +
    ', Target audience: ' + icp +
    ', Channel: ' + channel +
    ', Offer: ' + offer;

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  // Call Anthropic
  let anthropic;
  try {
    anthropic = await httpsPost(
      {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length':  Buffer.byteLength(payload),
        },
      },
      payload
    );
  } catch (err) {
    return respond(502, { error: 'Failed to reach Anthropic: ' + err.message });
  }

  if (anthropic.status !== 200) {
    let detail = '';
    try { detail = JSON.parse(anthropic.body)?.error?.message || anthropic.body; } catch { detail = anthropic.body; }
    return respond(anthropic.status, { error: detail });
  }

  // Extract and clean the model's text
  let result;
  try {
    const data  = JSON.parse(anthropic.body);
    const raw   = (data.content && data.content[0] && data.content[0].text) || '';
    const clean = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    result = JSON.parse(clean);
  } catch (err) {
    return respond(500, { error: 'Could not parse model response: ' + err.message });
  }

  return respond(200, result);
};
