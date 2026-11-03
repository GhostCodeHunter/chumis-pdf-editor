// Behaviour shared by the landing page and the legal pages: icons, scroll reveal, header, install button.
import { icon } from './ui.js';
import { installButton, registerSW } from './pwa.js';
import { REPO_URL, COPYRIGHT_YEAR } from './config.js';

// icons
document.querySelectorAll('[data-icon]').forEach(el => { try { el.replaceWith(icon(el.dataset.icon, +el.dataset.size || 20)); } catch {} });

// footer bits
document.querySelectorAll('[data-year]').forEach(el => { el.textContent = Math.max(new Date().getFullYear(), COPYRIGHT_YEAR); });
if (REPO_URL) { document.querySelectorAll('[data-repo]').forEach(a => { a.href = REPO_URL; }); document.querySelectorAll('[data-repo-li]').forEach(li => (li.hidden = false)); }

// install buttons
document.querySelectorAll('[data-install]').forEach(slot => {
  const big = slot.dataset.size === 'lg';
  const b = installButton({ label: 'Install app', kind: big ? 'secondary' : 'ghost', size: big ? 'lg' : undefined, cls: big ? 'btn-lg' : '' });
  if (slot.hasAttribute('data-always')) b.hidden = false; // the install section always offers help, even if already installed
  slot.replaceWith(b);
});

// sticky header shadow + mobile menu
const head = document.querySelector('.site-head');
const onScroll = () => head && head.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
const menu = document.querySelector('[data-menu]');
if (menu) {
  menu.addEventListener('click', () => { const open = head.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
  head.querySelectorAll('.site-nav a').forEach(a => a.addEventListener('click', () => { head.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }));
}

// scroll reveal (respects reduced motion; content stays visible without JS)
const items = [...document.querySelectorAll('.reveal')];
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  items.forEach(el => io.observe(el));
} else items.forEach(el => el.classList.add('in'));

registerSW();
