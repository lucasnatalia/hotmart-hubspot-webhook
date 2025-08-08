const express = require('express');
const axios = require('axios');

const app = express();

// Parse both JSON and x-www-form-urlencoded (Hotmart may send either)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ENV variables (configure these in Vercel dashboard)
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;     // Your HubSpot Private App token (Bearer)
const HOTMART_SECRET = process.env.HOTMART_SECRET;   // The same secret you set in Hotmart webhook settings
const OWNER_EMAIL = process.env.OWNER_EMAIL || "";   // Optional: HubSpot owner email to assign new contacts

// --- Helpers --- //

// Optional: Resolve HubSpot ownerId from email and cache it for ~1 hour in memory
let ownerCache = { id: null, ts: 0 };
async function resolveOwnerIdByEmail(email) {
  if (!email) return null;

  const now = Date.now();
  if (ownerCache.id && (now - ownerCache.ts) < 3600_000) {
    return ownerCache.id;
  }

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
    console.error('Error fetching owners:', e?.response?.data || e.message);
  }
  return null;
}

// Upsert a contact in HubSpot by email using CRM v3
async function upsertContact({ email, produto, status }) {
  if (!email) throw new Error('Email ausente do payload');

  const props = {
    email,
    origem_hotmart: 'hotmart',
    produto_hotmart: produto || '',
    status_hotmart: status || '',
    lifecyclestage: 'customer'
  };

  // Optional owner assignment
  const ownerId = await resolveOwnerIdByEmail(OWNER_EMAIL);
  if (ownerId) {
    props.hubspot_owner_id = ownerId;
  }

  const url = 'https://api.hubapi.com/crm/v3/objects/contacts?idProperty=email';
  const headers = {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
  const payload = { properties: props };

  const { data } = await axios.post(url, payload, { headers });
  return data;
}

// Extract fields from various possible Hotmart payload shapes
function extractHotmartFields(body) {
  // Try multiple shapes to be resilient
  const email = body?.buyer?.email
    || body?.data?.buyer_email
    || body?.email
    || body?.checkout_data?.customer_email
    || body?.purchase?.buyer_email
    || null;

  const status = body?.status
    || body?.purchase_status
    || body?.data?.status
    || body?.event
    || body?.transaction?.status
    || '';

  const produto = body?.product?.name
    || body?.data?.product_name
    || body?.purchase?.product?.name
    || body?.item?.name
    || body?.product_name
    || '';

  const eventId = body?.id || body?.event_id || body?.transaction?.id || null;

  return { email, status: String(status).toLowerCase(), produto, eventId };
}

// Basic memory store for processed events (idempotency)
const processed = new Set();

// Webhook endpoint at /hotmart
app.post('/hotmart', async (req, res) => {
  try {
    // 1) Basic auth check via secret header or query
    const incomingSecret = req.headers['x-hotmart-secret'] || req.headers['x-hotmart-signature'] || req.query.secret;
    if (HOTMART_SECRET && incomingSecret !== HOTMART_SECRET) {
      return res.status(401).send('Unauthorized');
    }

    // 2) Extract useful fields
    const body = req.body || {};
    const { email, status, produto, eventId } = extractHotmartFields(body);

    // 3) Idempotency (avoid double-processing same event)
    if (eventId) {
      if (processed.has(eventId)) {
        return res.status(200).send('duplicate');
      }
      processed.add(eventId);
      // Optional: clear old IDs periodically (not critical for serverless short-lived)
      setTimeout(() => processed.delete(eventId), 60 * 60 * 1000);
    }

    // 4) Only process approved if that's your flow; you can accept all and set status property
    // if you want to restrict to approved:
    // if (status && status !== 'approved') return res.status(200).send('ignored');

    // 5) Upsert in HubSpot
    await upsertContact({ email, produto, status });

    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err?.response?.data || err.message);
    // Return 200 to avoid repeated retries; log the error for investigation
    return res.status(200).send('received');
  }
});

// Healthcheck
app.get('/', (_, res) => res.send('Hotmart → HubSpot webhook is online'));

// Vercel serverless compatibility
module.exports = app;
