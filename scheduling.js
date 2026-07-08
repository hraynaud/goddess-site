// Scheduling page — generate predetermined slots and handle selection.
// Front-end UX only for now: no backend, no email. Submit shows an in-page confirmation.
(function () {
  const grid = document.getElementById('slotGrid');
  if (!grid) return;

  // Availability rules. Day index: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  const RULES = {
    3: ['1:00 PM', '7:00 PM'], // Wednesday
    4: ['1:00 PM', '7:00 PM'], // Thursday
    5: ['1:00 PM', '7:00 PM'], // Friday
    6: ['11:00 AM'],           // Saturday
  };
  const WEEKS_AHEAD = 4;

  // Build a QR-code-looking placeholder as inline SVG (no external service).
  // It does NOT encode a real payment link — swap for a real QR before launch.
  function makeQrPlaceholder(modules, cell) {
    modules = modules || 25;
    cell = cell || 8;
    const size = modules * cell;
    const DARK = '#0d0d2b';
    const LIGHT = '#f5f0e8';
    const inZone = (r, c, br, bc) => r >= br && r < br + 7 && c >= bc && c < bc + 7;
    const isFinder = (r, c) =>
      inZone(r, c, 0, 0) || inZone(r, c, 0, modules - 7) || inZone(r, c, modules - 7, 0);
    const finder = (br, bc) =>
      `<rect x="${bc * cell}" y="${br * cell}" width="${7 * cell}" height="${7 * cell}" fill="${DARK}"/>` +
      `<rect x="${(bc + 1) * cell}" y="${(br + 1) * cell}" width="${5 * cell}" height="${5 * cell}" fill="${LIGHT}"/>` +
      `<rect x="${(bc + 2) * cell}" y="${(br + 2) * cell}" width="${3 * cell}" height="${3 * cell}" fill="${DARK}"/>`;
    let rects = '';
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (isFinder(r, c)) continue;
        if (Math.random() > 0.55) {
          rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${DARK}"/>`;
        }
      }
    }
    rects += finder(0, 0) + finder(0, modules - 7) + finder(modules - 7, 0);
    return `<svg class="qr-code" viewBox="0 0 ${size} ${size}" width="180" height="180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Payment QR code placeholder"><rect width="${size}" height="${size}" fill="${LIGHT}"/>${rects}</svg>`;
  }

  const fmt = (d) =>
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let rendered = 0;
  for (let i = 1; i <= WEEKS_AHEAD * 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const slots = RULES[d.getDay()];
    if (!slots) continue;
    rendered++;

    const card = document.createElement('div');
    card.className = 'slot-day';
    card.innerHTML = `<h3 class="slot-day-label">${fmt(d)}</h3>`;

    const times = document.createElement('div');
    times.className = 'slot-times';
    slots.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = t;
      btn.dataset.label = fmt(d);
      btn.dataset.time = t;
      times.appendChild(btn);
    });
    card.appendChild(times);
    grid.appendChild(card);
  }

  if (!rendered) document.getElementById('slotEmpty').hidden = false;

  // Populate the Venmo/Zelle QR-code placeholders
  const venmoQr = document.getElementById('qr-venmo');
  const zelleQr = document.getElementById('qr-zelle');
  if (venmoQr) venmoQr.innerHTML = makeQrPlaceholder();
  if (zelleQr) zelleQr.innerHTML = makeQrPlaceholder();

  const form = document.getElementById('bookingForm');
  const summary = document.getElementById('bookingSummary');
  const dateField = document.getElementById('selectedDate');
  const timeField = document.getElementById('selectedTime');
  const methodField = document.getElementById('selectedMethod');

  const stepInfo = document.getElementById('stepInfo');
  const stepPayment = document.getElementById('stepPayment');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const continueBtn = document.getElementById('continueToPayment');
  const completeBtn = document.getElementById('completeBooking');
  const methodButtons = document.getElementById('paymentMethods');

  const METHOD_LABELS = { card: 'Credit Card', paypal: 'PayPal', venmo: 'Venmo', zelle: 'Zelle' };

  // ---- Stripe (Credit Card) — no backend required ----
  // To take live card payments:
  //   1. In Stripe (dashboard.stripe.com) → Payment Links → New, create a
  //      Payment Link for a $21 product/price.
  //   2. Paste its URL below (it looks like https://buy.stripe.com/xxxxxxxx).
  // Stripe hosts the card form, PCI, and receipts — nothing card-related
  // touches this site. Until a real link is set, Credit Card falls back to
  // the front-end preview confirmation.
  // NOTE: this is a TEST-mode link (test_ prefix). Before launch, regenerate the
  // same Payment Link in Stripe's live mode and replace the URL below.
  const STRIPE_PAYMENT_LINK = 'https://book.stripe.com/test_aFacN44UGeT6d0Z7bf1ZS00';
  const SESSION_PRICE = '$21';

  // ---- Zoom links ----
  // Credit Card (automated): payment triggers a Stripe webhook handled by
  //   netlify/functions/stripe-webhook.js, which registers the payer on the
  //   recurring group meeting. Zoom then emails them a UNIQUE join link.
  //   Set the Stripe Payment Link's post-payment message to tell buyers to
  //   check their email for it. See zoom-automation-setup.md.
  // PayPal / Venmo / Zelle (manual): no automatic payment signal, so these
  //   still show the shared recurring link below in the on-page confirmation.
  // Paste the shared recurring meeting link below (looks like https://zoom.us/j/xxxx).
  const ZOOM_LINK = 'https://us05web.zoom.us/j/83741087066';

  // Select a slot → enable + populate the request form
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.slot-btn');
    if (!btn) return;
    grid.querySelectorAll('.slot-btn.selected').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    dateField.value = btn.dataset.label;
    timeField.value = btn.dataset.time;
    summary.innerHTML = `Selected: <strong>${btn.dataset.label}</strong> at <strong>${btn.dataset.time}</strong>`;
    form.classList.add('active');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Step 1 → enable "Continue to Payment" only when name + email are valid
  const infoReady = () =>
    nameInput.value.trim() !== '' && emailInput.checkValidity() && emailInput.value.trim() !== '';
  const refreshContinue = () => { continueBtn.disabled = !infoReady(); };
  nameInput.addEventListener('input', refreshContinue);
  emailInput.addEventListener('input', refreshContinue);

  continueBtn.addEventListener('click', () => {
    if (!infoReady()) return;
    stepInfo.hidden = true;
    stepPayment.hidden = false;
    stepPayment.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  document.getElementById('backToInfo').addEventListener('click', () => {
    stepPayment.hidden = true;
    stepInfo.hidden = false;
    stepInfo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Step 2 → pick a payment method, reveal its panel, enable "Complete Booking"
  methodButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('.payment-method');
    if (!btn) return;
    const method = btn.dataset.method;
    methodButtons.querySelectorAll('.payment-method').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('selected', active);
      b.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.payment-panel').forEach((p) => { p.hidden = true; });
    document.getElementById(`panel-${method}`).hidden = false;
    methodField.value = METHOD_LABELS[method];
    completeBtn.disabled = false;
    completeBtn.textContent = method === 'card' ? `Pay ${SESSION_PRICE} by Card` : 'Complete Reservation';
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dateField.value || !methodField.value) return;

    // Credit Card → hand off to Stripe's hosted checkout (no backend needed).
    // Pass the email + chosen slot so the payment can be matched to the reservation.
    const isCard = methodField.value === 'Credit Card';
    const stripeReady = !STRIPE_PAYMENT_LINK.includes('YOUR_PAYMENT_LINK');
    if (isCard && stripeReady) {
      const url = new URL(STRIPE_PAYMENT_LINK);
      if (emailInput.value) url.searchParams.set('prefilled_email', emailInput.value);
      url.searchParams.set(
        'client_reference_id',
        `${dateField.value} ${timeField.value}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
      );
      window.location.href = url.toString();
      return;
    }

    // Manual methods (and Credit Card before Stripe is connected) → in-page confirmation
    const note =
      isCard && !stripeReady
        ? "Card checkout isn't connected yet — add your Stripe Payment Link in scheduling.js to take live card payments."
        : 'Be sure to complete your payment using the option you selected — your spot is confirmed once payment is received.';

    // Show the recurring Zoom link (the Waiting Room gates who actually gets in).
    const zoomReady = !ZOOM_LINK.includes('YOUR_MEETING_ID');
    const zoomBlock = zoomReady
      ? `<p>Join your session here:</p>
         <a class="btn btn-primary" href="${ZOOM_LINK}" target="_blank" rel="noopener">Open Zoom Link</a>
         <p class="booking-confirm-note">Please arrive 10 minutes early &mdash; you'll be admitted from the waiting room once your payment is confirmed.</p>`
      : `<p class="booking-confirm-note">Your Zoom link will appear here once the recurring meeting link is added in scheduling.js.</p>`;

    const confirm = document.createElement('div');
    confirm.className = 'booking-confirm';
    confirm.innerHTML = `
      <h3>Reservation confirmed &#10024;</h3>
      <p>Your spot is reserved for <strong>${dateField.value}</strong> at <strong>${timeField.value}</strong>.</p>
      <p>Payment method: <strong>${methodField.value}</strong></p>
      <p class="booking-confirm-note">${note}</p>
      ${zoomBlock}
      <button type="button" class="btn btn-outline" id="bookingReset">Reserve another spot</button>`;
    form.replaceWith(confirm);
    confirm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('bookingReset').addEventListener('click', () => location.reload());
  });
})();
