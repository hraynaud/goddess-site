// Renders the Testimonials section from /api/testimonials (managed at /admin).
// Builds exactly the markup the page used to hard-code; script.js handles clicks.
(function () {
  const grid = document.getElementById('videoGrid');
  const deck = document.getElementById('lettersDeck');
  const status = document.getElementById('testimonialsStatus');
  if (!grid || !deck) return;

  const EMBED = 'https://www.youtube-nocookie.com/embed/';
  const ALLOW = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  const imgUrl = (id) => `/api/testimonials/img/${encodeURIComponent(id)}`;

  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  }

  function videoCard(v) {
    const fig = el('figure', { class: v.shape === 'horizontal' ? 'video-card video-card--wide' : 'video-card' });
    const frame = el('iframe', {
      class: v.spanishYoutubeId ? 'video-card__frame bilingual-video' : 'video-card__frame',
      src: EMBED + v.youtubeId, title: v.caption, loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin', allow: ALLOW, allowfullscreen: '',
    });
    fig.append(frame);

    if (v.spanishYoutubeId) {
      frame.dataset.en = EMBED + v.youtubeId;
      frame.dataset.es = EMBED + v.spanishYoutubeId;
      const toggle = el('div', { class: 'lang-toggle', role: 'group', 'aria-label': 'Choose video language' });
      toggle.append(
        el('span', { class: 'lang-toggle__slider', 'aria-hidden': 'true' }),
        el('button', { type: 'button', class: 'lang-toggle__btn is-active', 'data-lang': 'en', 'aria-pressed': 'true' }, 'English'),
        el('button', { type: 'button', class: 'lang-toggle__btn', 'data-lang': 'es', 'aria-pressed': 'false' }, 'Español'),
      );
      fig.append(toggle);
    }

    fig.append(el('figcaption', {}, v.caption));

    if (v.screenshotImgId) {
      const btn = el('button', {
        type: 'button', class: 'chat-link', 'aria-haspopup': 'dialog',
        'data-chat-src': imgUrl(v.screenshotImgId), 'data-chat-alt': `Messages for “${v.caption}”`,
      });
      btn.append(el('span', { 'aria-hidden': 'true' }, '📱'), document.createTextNode(' Read the messages'));
      fig.append(btn);
    }
    return fig;
  }

  function render({ videos, letters }) {
    grid.replaceChildren(...videos.map(videoCard));
    grid.hidden = videos.length === 0;

    const hint = deck.querySelector('.letters-deck__hint');
    deck.querySelectorAll('.letter-card').forEach((n) => n.remove());
    letters.forEach((l, i) => {
      // The deck fans by --i; cap it so a long list keeps the same look.
      deck.insertBefore(el('img', { class: 'letter-card', style: `--i:${Math.min(i, 4)}`, src: imgUrl(l.imgId), alt: l.alt, loading: 'lazy' }), hint);
    });
    const block = document.getElementById('lettersBlock');
    if (block) block.hidden = letters.length === 0;
  }

  fetch('/api/testimonials')
    .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then((data) => {
      render({ videos: data.videos || [], letters: data.letters || [] });
      status.hidden = true;
    })
    .catch((err) => {
      console.error('Testimonials failed to load', err);
      status.textContent = "Testimonials couldn't load right now — please refresh.";
    });
})();
