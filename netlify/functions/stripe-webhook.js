// Stripe → Zoom automation
// ---------------------------------------------------------------------------
// When an enrollee pays by card, Stripe sends a `checkout.session.completed`
// webhook here. We verify it, then register that person on the recurring group
// Zoom meeting. Zoom issues a UNIQUE join_url per registrant and emails it to
// them automatically (as long as the meeting has registration turned on and
// "send confirmation email to registrants" enabled).
//
// No npm dependencies: Stripe signature verification uses Node's `crypto`, and
// Zoom is called with the built-in `fetch` (Node 18+ on Netlify).
//
// Required environment variables (set in Netlify → Site settings → Environment):
//   STRIPE_WEBHOOK_SECRET   Signing secret of the Stripe webhook endpoint (whsec_...)
//   ZOOM_ACCOUNT_ID         Zoom Server-to-Server OAuth: Account ID
//   ZOOM_CLIENT_ID          Zoom Server-to-Server OAuth: Client ID
//   ZOOM_CLIENT_SECRET      Zoom Server-to-Server OAuth: Client Secret
//   ZOOM_MEETING_ID         Numeric ID of the recurring group meeting (registration ON)
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  // 1. Verify the webhook really came from Stripe (and is recent).
  let stripeEvent;
  try {
    stripeEvent = verifyStripeSignature(rawBody, sig, secret);
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // 2. We only care about a completed, paid checkout.
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }
  const session = stripeEvent.data.object;
  if (session.payment_status && session.payment_status !== 'paid') {
    return { statusCode: 200, body: 'not paid yet' };
  }

  const email = session.customer_details?.email || session.customer_email;
  const fullName = (session.customer_details?.name || '').trim();
  const slot = session.client_reference_id || ''; // e.g. "Wednesday-July-9-1-00-PM"

  if (!email) {
    console.error('No email on session', session.id);
    return { statusCode: 200, body: 'no email — nothing to do' };
  }

  // 3. Register the payer on the Zoom meeting → Zoom emails them a unique link.
  try {
    const token = await getZoomToken();
    const registrant = await addZoomRegistrant(token, { email, fullName, slot });
    console.log(`Registered ${email} for ${slot || 'meeting'} — join_url issued: ${registrant.join_url ? 'yes' : 'no'}`);
  } catch (err) {
    // Return 500 so Stripe retries the delivery instead of dropping the enrollee.
    console.error('Zoom registration failed:', err.message);
    return { statusCode: 500, body: `Zoom registration failed: ${err.message}` };
  }

  return { statusCode: 200, body: 'ok' };
};

// --- Stripe signature verification (no stripe SDK needed) -------------------
// Recreates Stripe's scheme: HMAC-SHA256 of "<t>.<rawBody>" keyed by the
// endpoint signing secret, compared (constant-time) against the header's v1 sigs.
function verifyStripeSignature(payload, header, secret) {
  if (!secret) throw new Error('Missing STRIPE_WEBHOOK_SECRET');
  if (!header) throw new Error('Missing Stripe-Signature header');
  if (payload == null) throw new Error('Missing request body');

  let timestamp;
  const signatures = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) {
    throw new Error('Malformed Stripe-Signature header');
  }

  // Reject anything older than 5 minutes (replay protection).
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > 300) {
    throw new Error('Timestamp outside of tolerance');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  const matches = signatures.some((s) => {
    const sBuf = Buffer.from(s, 'utf8');
    return sBuf.length === expectedBuf.length && crypto.timingSafeEqual(sBuf, expectedBuf);
  });
  if (!matches) throw new Error('No matching signature found');

  return JSON.parse(payload);
}

// --- Zoom Server-to-Server OAuth token --------------------------------------
async function getZoomToken() {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error('Missing Zoom OAuth environment variables');
  }
  const basic = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const url = `${ZOOM_TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`Zoom token error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('Zoom token response missing access_token');
  return data.access_token;
}

// --- Add a unique registrant to the recurring group meeting -----------------
async function addZoomRegistrant(token, { email, fullName, slot }) {
  const meetingId = process.env.ZOOM_MEETING_ID;
  if (!meetingId) throw new Error('Missing ZOOM_MEETING_ID');

  const parts = fullName ? fullName.split(/\s+/) : [];
  const firstName = parts.shift() || email.split('@')[0];
  const lastName = parts.join(' ') || '-';

  const body = {
    email,
    first_name: firstName,
    last_name: lastName,
  };
  if (slot) body.comments = `Booked session: ${slot.replace(/-/g, ' ')}`;

  const res = await fetch(`${ZOOM_API}/meetings/${meetingId}/registrants`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Zoom registrant error ${res.status}: ${await res.text()}`);
  return res.json(); // includes the unique join_url (Zoom also emails it)
}
