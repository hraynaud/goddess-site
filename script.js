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
  '.service-card, .book-feature, .workshop-card, .about-content, .media-item, .contact-grid, .section-title, .section-subtitle'
).forEach(el => {
  el.classList.add('fade-in');
  observer.observe(el);
});

// Contact form handling (Formspree via AJAX)
const contactForm = document.getElementById('contactForm');

contactForm.addEventListener('submit', (e) => {
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
