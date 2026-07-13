// Mobile Navigation Toggle
const navToggle = document.getElementById('navToggle');
const navMenu = document.getElementById('navMenu');

navToggle.addEventListener('click', () => {
  navMenu.classList.toggle('open');
  navToggle.classList.toggle('active');
});

// Close mobile menu on link click
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navMenu.classList.remove('open');
    navToggle.classList.remove('active');
  });
});

// Navbar scroll effect
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  if (window.scrollY > 60) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// Scroll-triggered fade-in animations
const observerOptions = {
  threshold: 0.15,
  rootMargin: '0px 0px -40px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

// Apply fade-in to key elements
document.querySelectorAll(
  '.about-content, .contact-grid, .section-title, .section-subtitle'
).forEach(el => {
  el.classList.add('fade-in');
  observer.observe(el);
});

// Bilingual testimonial video language toggle (English / Español)
// The videos are YouTube embeds, so we swap the iframe's src between the
// English and Spanish embed URLs. autoplay=1 is safe here because the swap
// is driven by a deliberate user click (button gesture).
document.querySelectorAll('.lang-toggle').forEach(toggle => {
  const frame = toggle.parentElement.querySelector('.bilingual-video');
  if (!frame) return;

  toggle.querySelectorAll('.lang-toggle__btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.dataset.lang;
      const nextSrc = frame.dataset[lang];
      if (!nextSrc) return;

      const currentBase = (frame.getAttribute('src') || '').split('?')[0];
      if (currentBase === nextSrc) return;

      // Update button states (and the sliding highlight via .is-active)
      toggle.querySelectorAll('.lang-toggle__btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      frame.setAttribute('src', nextSrc + '?autoplay=1&rel=0');
    });
  });
});

// Contact form handling (Formspree via AJAX)
const contactForm = document.getElementById('contactForm');

if (contactForm) contactForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const btn = contactForm.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;

  const formData = new FormData(contactForm);

  fetch(contactForm.action, {
    method: 'POST',
    body: formData,
    headers: { 'Accept': 'application/json' }
  })
    .then(response => {
      if (response.ok) {
        btn.textContent = 'Message Sent!';
        btn.style.background = 'linear-gradient(135deg, #7b5ea7, #5a3d8a)';
        btn.style.color = '#fff';
        contactForm.reset();
      } else {
        btn.textContent = 'Error — Try Again';
        btn.style.background = '#a94442';
        btn.style.color = '#fff';
      }
    })
    .catch(() => {
      btn.textContent = 'Error — Try Again';
      btn.style.background = '#a94442';
      btn.style.color = '#fff';
    })
    .finally(() => {
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.style.color = '';
        btn.disabled = false;
      }, 3000);
    });
});

// Lightbox — single chat screenshots and the letters carousel
const lightbox = document.getElementById('lightbox');
if (lightbox) {
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  let items = [];   // [{ src, alt }]
  let index = 0;

  const render = () => {
    const item = items[index];
    if (!item) return;
    lightboxImg.setAttribute('src', item.src);
    lightboxImg.setAttribute('alt', item.alt || '');
    const multi = items.length > 1;
    lightboxPrev.hidden = !multi;
    lightboxNext.hidden = !multi;
  };

  // Tall images (phone screenshots) get width-capped + scroll; wide ones fit the viewport.
  lightboxImg.addEventListener('load', () => {
    const tall = lightboxImg.naturalHeight > lightboxImg.naturalWidth * 1.3;
    lightbox.classList.toggle('lightbox--tall', tall);
  });

  const openLightbox = (list, start = 0) => {
    items = list;
    index = start;
    render();
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    lightboxClose.focus();
  };

  const closeLightbox = () => {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    lightboxImg.setAttribute('src', '');
  };

  const step = (delta) => {
    index = (index + delta + items.length) % items.length;
    render();
  };

  // Single-image chat screenshots
  document.querySelectorAll('.chat-link').forEach(link => {
    link.addEventListener('click', () =>
      openLightbox([{ src: link.dataset.chatSrc, alt: 'Message exchange with the mother' }]));
  });

  // Letters deck → carousel of all letter cards
  const deck = document.getElementById('lettersDeck');
  if (deck) {
    const letters = [...deck.querySelectorAll('.letter-card')]
      .map(img => ({ src: img.getAttribute('src'), alt: img.alt }));
    const openDeck = () => openLightbox(letters, 0);
    deck.addEventListener('click', openDeck);
    deck.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDeck(); }
    });
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxPrev.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  lightboxNext.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  // Click on the backdrop (not the image or buttons) closes it
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft' && items.length > 1) step(-1);
    else if (e.key === 'ArrowRight' && items.length > 1) step(1);
  });
}
