const express = require('express');
const axios = require('axios');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const HOTMART_SECRET = process.env.HOTMART_SECRET;
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";

function log(...args) {
  try { console.log('[hotmart-webhook]', ...args); } catch (_) {}
}

let ownerCache = { id: null, ts: 0 };
async function resolveOwnerIdByEmail(email) {
  if (!email) return null;
  const now = Date.now();
  if (ownerCache.id && (now - ownerCache.ts) < 3600_000) return ownerCache.id;
  try {
    const { data } = await axios.get('https://api.hubapi.com/crm/v3/owners/', {
      headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
    });
    const match = (data?.results || []).find(o => (o?.email || "").toLowerCase() === email.toLowerCase());
    if (match && match.id) {
      ownerCache = { id: match.id, ts: now };
      return match.id;
    }
  } catch (e) {
    log('owners error:', e?.response?.data || e.message);
  }
  return null;
}

async function upsertContact({ email, produto, status }) {
  if (!email) throw new Error('Email ausente do payload');
  const props = {
    email,
    origem_hotmart: 'hotmart',
    produto_hotmart: produto || '',
    status_hotmart: status || '',
    lifecyclestage: 'customer'
  };
  const ownerId = await resolveOwnerIdByEmail(OWNER_EMAIL);
  if (ownerId) props.hubspot_owner_id = ownerId;

  const url = 'https://api.hubapi.com/crm/v3/objects/contacts?idProperty=email';
  const headers = {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
  const payload = { properties: props };

  const { data } = await axios.post(url, payload, { headers });
  return data;
}

function extractHotmartFields(body) {
  const email = body?.buyer?.email
    || body?.data?.buyer_email
    || body?.email
    || body?.checkout_data?.customer_email
    || body?.purchase?.buyer_email
    || body?.payer_email
    || body?.customer?.email
    || null;

  const status = body?.status
    || body?.purchase_status
    || body?.data?.status
    || body?.event
    || body?.transaction?.status
    || body?.purchase?.status
    || '';

  const produto = body?.product?.name
    || body?.data?.product_name
    || body?.purchase?.product?.name
    || body?.item?.name
    || body?.product_name
    || '';

  const eventId = body?.id || body?.event_id || body?.transaction?.id || body?.purchase?.id || null;

  return { email, status: String(status).toLowerCase(), produto, eventId };
}

// Simple idempotency store (ok in serverless short-lived)
const processed = new Set();

// GET /hotmart just for quick debug in browser
app.get('/hotmart', (req, res) => {
  res.status(200).send('ok (GET) — use POST from Hotmart to process events');
});

app.post('/hotmart', async (req, res) => {
  const safeBody = JSON.stringify(req.body || {});
  log('REQ headers:', JSON.stringify(req.headers || {}));
  log('REQ body:', safeBody.slice(0, 4000));

  try {
    // Accept secret from multiple places: headers, query, body (including legacy hottok)
    const incomingSecret =
      req.headers['x-hotmart-secret'] ||
      req.headers['x-hotmart-signature'] ||
      req.headers['x-hottok'] ||
      req.query.secret ||
      req.query.hottok ||
      (req.body ? (req.body.secret || req.body.hottok) : undefined);

    if (HOTMART_SECRET) {
      if (!incomingSecret) {
        log('SECRET missing — expected HOTMART_SECRET but none received');
        return res.status(401).send('Unauthorized');
      }
      if (incomingSecret !== HOTMART_SECRET) {
        log('SECRET mismatch. Received:', incomingSecret, 'Expected HOTMART_SECRET');
        return res.status(401).send('Unauthorized');
      }
    }

    const body = req.body || {};
    const { email, status, produto, eventId } = extractHotmartFields(body);
    log('EXTRACTED → email:', email, '| status:', status, '| produto:', produto, '| eventId:', eventId);

    if (!email) {
      log('No email found in payload. Body keys:', Object.keys(body || {}));
      return res.status(200).send('no-email');
    }

    if (eventId) {
      if (processed.has(eventId)) {
        log('Duplicate event ignored:', eventId);
        return res.status(200).send('duplicate');
      }
      processed.add(eventId);
      setTimeout(() => processed.delete(eventId), 60 * 60 * 1000);
    }

    await upsertContact({ email, produto, status });
    log('UPSERT OK for', email);
    return res.status(200).send('ok');
  } catch (err) {
    log('ERROR:', err?.response?.data || err.message);
    return res.status(200).send('received');
  }
});

app.get('/', (_, res) => res.send('Hotmart → HubSpot webhook is online (hottok build)'));

module.exports = app;
