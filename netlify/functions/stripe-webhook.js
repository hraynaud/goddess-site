// Stripe → Zoom automation (per-session registration)
// ---------------------------------------------------------------------------
// When an enrollee pays by card, Stripe sends a `checkout.session.completed`
// webhook here. We verify it, then register that person for the SPECIFIC
// session they paid for — not every session. Zoom issues a unique join link
// scoped to that one occurrence and emails it to them automatically.
//
// The practice runs three recurring meetings, one per time-of-day. Each
// meeting's weekly "occurrences" are the actual sessions:
//   • 1:00 PM  (Wed/Thu/Fri)  → env ZOOM_MEETING_ID_1PM
//   • 7:00 PM  (Wed/Thu/Fri)  → env ZOOM_MEETING_ID_7PM
//   • 11:00 AM (Sat)          → env ZOOM_MEETING_ID_11AM
// Each meeting MUST use registration type "Attendees need to register for each
// occurrence to attend" so the issued link only opens that one session.
//
// The buyer's chosen slot arrives as Stripe's `client_reference_id`, e.g.
// "Wednesday-August-6-1-00-PM". We parse the time to pick the meeting and the
// date to pick the occurrence, then register them for exactly that occurrence.
//
// No npm dependencies: Stripe signature verification uses Node's `crypto`, and
// Zoom is called with the built-in `fetch` (Node 18+ on Netlify).
//
// Required environment variables (Netlify → Site settings → Environment):
//   STRIPE_WEBHOOK_SECRET   Signing secret of the Stripe webhook endpoint (whsec_...)
//   ZOOM_ACCOUNT_ID         Zoom Server-to-Server OAuth: Account ID
//   ZOOM_CLIENT_ID          Zoom Server-to-Server OAuth: Client ID
//   ZOOM_CLIENT_SECRET      Zoom Server-to-Server OAuth: Client Secret
//   ZOOM_MEETING_ID_1PM     Numeric ID of the 1:00 PM recurring meeting
//   ZOOM_MEETING_ID_7PM     Numeric ID of the 7:00 PM recurring meeting
//   ZOOM_MEETING_ID_11AM    Numeric ID of the 11:00 AM recurring meeting
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const ZOOM_API = 'https://api.zoom.us/v2';

// Which recurring meeting hosts each session time. The env var holds that
// meeting's numeric ID. Add a row here if a new session time is introduced.
const TIME_TO_ENV = {
  '1:00 PM': 'ZOOM_MEETING_ID_1PM',
  '7:00 PM': 'ZOOM_MEETING_ID_7PM',
  '11:00 AM': 'ZOOM_MEETING_ID_11AM',
};

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
  const slot = session.client_reference_id || ''; // e.g. "Wednesday-August-6-1-00-PM"

  if (!email) {
    console.error('No email on session', session.id);
    return { statusCode: 200, body: 'no email — nothing to do' };
  }
  if (!slot) {
    console.error('No client_reference_id (session slot) on', session.id);
    return { statusCode: 200, body: 'no slot — cannot route to a session' };
  }

  // 3. Register the payer for the exact session → Zoom emails them a unique,
  //    occurrence-scoped join link.
  try {
    const token = await getZoomToken();
    const reg = await registerForSession(token, { email, fullName, slot });
    console.log(
      `Registered ${email} for ${slot} ` +
      `(meeting ${reg.meetingId}, occurrence ${reg.occurrenceId}) — ` +
      `join_url issued: ${reg.join_url ? 'yes' : 'no'}`
    );
  } catch (err) {
    // Return 500 so Stripe retries the delivery and the failure is visible in
    // both the Stripe and Netlify dashboards instead of silently dropping.
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

// --- Slot parsing -----------------------------------------------------------
// "Wednesday-August-6-1-00-PM" → { month: 'August', day: '6', timeKey: '1:00 PM' }
// The time is always the trailing "<hour>-<minute>-<AMPM>"; the date is the two
// tokens before it (month name + day number).
function parseSlot(slot) {
  const parts = String(slot).split('-').filter(Boolean);
  if (parts.length < 5) throw new Error(`Unrecognized slot format: "${slot}"`);
  const ampm = parts[parts.length - 1].toUpperCase(); // PM / AM
  const minute = parts[parts.length - 2];             // 00
  const hour = parts[parts.length - 3];               // 1 / 7 / 11
  const day = String(Number(parts[parts.length - 4])); // "6"
  const month = parts[parts.length - 5];              // August
  const timeKey = `${Number(hour)}:${minute} ${ampm}`; // "1:00 PM"
  return { month, day, timeKey };
}

// Pick the recurring meeting whose fixed time matches the booked slot.
function pickMeeting(slot) {
  const { timeKey } = parseSlot(slot);
  const envName = TIME_TO_ENV[timeKey];
  if (!envName) throw new Error(`No meeting configured for session time "${timeKey}" (slot ${slot})`);
  const meetingId = process.env[envName];
  if (!meetingId) throw new Error(`Missing environment variable ${envName}`);
  return { meetingId, timeKey };
}

// Find the occurrence (specific dated session) of a recurring meeting that
// matches the booked date, comparing in the meeting's own timezone.
async function findOccurrenceId(token, meetingId, slot) {
  const { month, day } = parseSlot(slot);
  const res = await fetch(`${ZOOM_API}/meetings/${meetingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Zoom get-meeting error ${res.status}: ${await res.text()}`);
  const meeting = await res.json();
  const tz = meeting.timezone || 'America/New_York';

  const occ = (meeting.occurrences || []).find((o) => {
    if (o.status === 'deleted') return false;
    const d = new Date(o.start_time);
    const m = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long' }).format(d);
    const dd = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(d);
    return m.toLowerCase() === month.toLowerCase() && dd === day;
  });
  if (!occ) {
    throw new Error(`No occurrence on ${month} ${day} for meeting ${meetingId} (slot ${slot})`);
  }
  return occ.occurrence_id;
}

// Register a person for one specific occurrence of a recurring meeting.
async function addRegistrant(token, meetingId, occurrenceId, { email, fullName }) {
  const parts = fullName ? fullName.split(/\s+/) : [];
  const first_name = parts.shift() || email.split('@')[0];
  const last_name = parts.join(' ') || '-';

  const url = `${ZOOM_API}/meetings/${meetingId}/registrants?occurrence_ids=${encodeURIComponent(occurrenceId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, first_name, last_name }),
  });
  if (!res.ok) throw new Error(`Zoom registrant error ${res.status}: ${await res.text()}`);
  return res.json(); // includes the unique, occurrence-scoped join_url
}

// Resolve slot → meeting → occurrence, then register the payer for it.
async function registerForSession(token, { email, fullName, slot }) {
  const { meetingId, timeKey } = pickMeeting(slot);
  const occurrenceId = await findOccurrenceId(token, meetingId, slot);
  const registrant = await addRegistrant(token, meetingId, occurrenceId, { email, fullName });
  return { ...registrant, meetingId, occurrenceId, timeKey };
}

// Exposed for local tests (test-zoom.js / test-webhook-local.js).
exports.getZoomToken = getZoomToken;
exports.registerForSession = registerForSession;
exports.parseSlot = parseSlot;
exports.pickMeeting = pickMeeting;
