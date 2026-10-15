const sections = {
  rest: { heading: 'A quieter night. A gentler morning.', body: 'A night that ends when you choose, instead of one more scroll. A morning with room to wake up before the messages and feeds begin.', extra: '<p>Protect the apps that keep pulling you back. Use that space to wind down, then notice how you feel when you wake. Small changes, shaped around your life.</p>' },
  evidence: { heading: 'Your screen can follow you into sleep.', body: 'If you spend an average of five hours a day on your phone, it adds up to almost 17 years of your life looking at a screen.', extra: '<p>And the impact goes beyond time. Staring at a light-emitting screen before bed suppresses melatonin, delays the body clock and reduces alertness the next morning. Phone use is linked to insufficient sleep, poorer sleep quality and excessive daytime sleepiness.</p><p class="note">Sources: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4313820/" target="_blank" rel="noopener noreferrer">Chang et al., PNAS, 2015</a>; <a href="https://pubmed.ncbi.nlm.nih.gov/27802500/" target="_blank" rel="noopener noreferrer">Carter et al., JAMA Pediatrics, 2016</a>.</p>' },
  vision: { heading: 'Technology should leave room for life.', body: 'We live in a world that keeps asking for our attention, even when we need to switch off. We believe technology can help change that.', extra: '<p>Our vision is intelligence that protects space for recovery, instead of filling every spare moment. Starting with the nights and mornings that shape how we feel.</p><p>Less pressure to stay connected. More freedom to be present.</p>' },
  blankmind: { heading: 'Make room for rest.', body: 'Begin with a free diagnosis, then configure your first recurring protection window on iPhone. Connect Apple Watch sleep if you want to understand your nights.', extra: '<p>A proposed change is a hypothesis. A completed block alone does not establish better sleep. Personalized follow-up can help you evaluate measured results and adapt your plan within your permissions.</p><p><a href="diagnosis.html">Start your free diagnosis</a></p>' },
  model: { heading: 'Intelligence that learns how you disconnect.', body: 'Blankmind AI combines usage patterns with the context you share to understand when and why you reach for your phone. It identifies recurring habits and moments when disconnecting becomes harder, then uses that understanding to shape personalised support.', extra: '<p>Through conversation and feedback, it learns what works for you and refines its recommendations. Your routines, responses and chosen permissions guide how it helps protect time for rest.</p>' },
  access: { heading: 'Start with your routine.', body: 'Talk through what keeps you on your phone and choose one change to try. Your free diagnosis and proposal continue into the iPhone app.', extra: '<p>Your first recurring window is free permanently, including manual edits, pausing and turning it off. Sleep data is optional for getting started.</p><p><a href="diagnosis.html">Start your free diagnosis</a></p>' },
  pricing: { heading: 'Your first plan stays free.', body: 'One recurring protection window, the conversation needed to implement it on iPhone, and reduced Progress with completed blocks and your latest available Watch sleep.', extra: '<p>Personalized follow-up adds multiple windows, unlimited text and voice conversations, full Progress history and comparisons, and automatic evaluation and adjustments within your permissions.</p><p>€2.99 / month or €19.99 / year (EUR reference prices), with a 3-day free trial for eligible subscribers. Your App Store shows the localized price, trial eligibility and renewal terms before you confirm. Your first recurring window stays free permanently.</p><p><a href="diagnosis.html">Start your free diagnosis</a></p>' }
};
const aliases = { product: 'blankmind', evening: 'rest', morning: 'rest', about: 'vision' };
const scroll = document.querySelector('.nav-scroll');
const desktopLinks = [...scroll.querySelectorAll('a')];
let links = [...desktopLinks];
const detail = document.querySelector('#section-detail');
const copy = document.querySelector('.detail-copy');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let selected = 'blankmind';
let settleTimer;
let animation;
let lastTime = 0;
let target = 0;
let position = 0;
let followScroll = true;
let drag;
let suppressClick = false;
const mobile = matchMedia('(max-width: 800px)');
const mobileOrder = ['blankmind', 'vision', 'model', 'evidence', 'access', 'rest', 'pricing'];
function arrangeNavigation() {
  links = mobile.matches ? mobileOrder.map(id => desktopLinks.find(link => link.dataset.section === id)) : [...desktopLinks];
  const endSpacer = scroll.lastElementChild;
  links.forEach(link => scroll.insertBefore(link, endSpacer));
}
const stepSize = () => mobile.matches ? links[0].offsetWidth : links[0].offsetHeight;
const scrollPosition = () => mobile.matches ? scroll.scrollLeft : scroll.scrollTop;
const setScrollPosition = value => { if (mobile.matches) scroll.scrollLeft = value; else scroll.scrollTop = value; };
const pointerPosition = event => mobile.matches ? event.clientX : event.clientY;
const clamp = value => Math.max(0, Math.min((links.length - 1) * stepSize(), value));

function render(id, updateHash = true) {
  if (!sections[id]) return;
  selected = id;
  const section = sections[id];
  links.forEach(link => {
    if (link.dataset.section === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const heading = section.heading.replace(/\. (?=[A-Z])/g, '. <br class="mobile-heading-break">');
  copy.innerHTML = `<h2>${heading}</h2><p>${section.body}</p>${section.extra}`;
  if (updateHash) history.replaceState(null, '', `#${id}`);
  detail.scrollTop = 0;
}

function center(id, smooth = true) {
  const index = links.findIndex(link => link.dataset.section === id);
  if (index < 0) return;
  clearTimeout(settleTimer);
  followScroll = false;
  moveTo(index * stepSize(), smooth);
}

function updateSelection() {
  const index = Math.max(0, Math.min(links.length - 1, Math.round(scrollPosition() / stepSize())));
  if (links[index].dataset.section !== selected) render(links[index].dataset.section);
}

function moveTo(destination, smooth = true) {
  target = clamp(destination);
  if (!smooth || reducedMotion.matches) {
    cancelAnimationFrame(animation);
    animation = null;
    position = target;
    setScrollPosition(target);
    paintNavigation();
    if (followScroll) updateSelection();
    return;
  }
  if (!animation) { position = scrollPosition(); lastTime = 0; animation = requestAnimationFrame(tick); }
}

function tick(time) {
  const delta = lastTime ? Math.min(time - lastTime, 50) : 16.67;
  lastTime = time;
  const distance = target - position;
  position += distance * (1 - Math.exp(-delta / 95));
  setScrollPosition(position);
  paintNavigation();
  if (followScroll) updateSelection();
  if (Math.abs(distance) > .6) animation = requestAnimationFrame(tick);
  else {
    setScrollPosition(target);
    animation = null;
    paintNavigation();
    if (followScroll) updateSelection();
  }
}

function settle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => moveTo(Math.round(target / stepSize()) * stepSize()), 180);
}

function paintNavigation() {
  const bounds = scroll.getBoundingClientRect();
  const middle = mobile.matches ? bounds.left : bounds.top + scroll.clientHeight / 2;
  links.forEach(link => {
    const rect = link.getBoundingClientRect();
    const distance = mobile.matches ? Math.abs(rect.left - middle) / rect.width : Math.abs(rect.top + rect.height / 2 - middle) / rect.height;
    link.style.setProperty('--opacity', Math.max(.12, 1 - distance * .28));
  });
}

scroll.addEventListener('scroll', () => {
  paintNavigation();
  if (!animation && !drag) {
    target = scrollPosition();
    followScroll = true;
    updateSelection();
    if (mobile.matches) settle();
  }
}, { passive: true });

document.querySelector('.composition').addEventListener('wheel', event => {
  const bounds = document.querySelector('.composition').getBoundingClientRect();
  const middleColumn = event.clientX >= bounds.width / 3 && event.clientX <= bounds.width * 2 / 3;
  if (!scroll.contains(event.target) && (innerWidth <= 800 || !middleColumn)) return;
  if (event.ctrlKey || (!mobile.matches && Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
  event.preventDefault();
  followScroll = true;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (mobile.matches ? scroll.clientWidth : scroll.clientHeight) : 1;
  const delta = mobile.matches && Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  moveTo(target + Math.max(-100, Math.min(100, delta * unit)) * .65);
  settle();
}, { passive: false });

scroll.addEventListener('pointerdown', event => {
  cancelAnimationFrame(animation);
  animation = null;
  clearTimeout(settleTimer);
  target = scrollPosition();
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  drag = { start: pointerPosition(event), top: target, moved: false };
  suppressClick = false;
});
scroll.addEventListener('dragstart', event => event.preventDefault());
scroll.addEventListener('pointermove', event => {
  if (!drag) return;
  if (Math.abs(pointerPosition(event) - drag.start) > 4) {
    drag.moved = true;
    scroll.setPointerCapture(event.pointerId);
    scroll.classList.add('dragging');
  }
  if (!drag.moved) return;
  event.preventDefault();
  followScroll = true;
  moveTo(drag.top + drag.start - pointerPosition(event));
});
function endDrag() {
  if (!drag) return;
  suppressClick = drag.moved;
  drag = null;
  scroll.classList.remove('dragging');
  settle();
}
scroll.addEventListener('pointerup', endDrag);
scroll.addEventListener('pointercancel', endDrag);
scroll.addEventListener('click', event => {
  if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
}, true);

links.forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  render(link.dataset.section);
  center(link.dataset.section);
}));

scroll.addEventListener('keydown', event => {
  const index = links.findIndex(link => link.dataset.section === selected);
  let next;
  if (event.key === 'ArrowDown' || (mobile.matches && event.key === 'ArrowRight')) next = Math.min(index + 1, links.length - 1);
  if (event.key === 'ArrowUp' || (mobile.matches && event.key === 'ArrowLeft')) next = Math.max(index - 1, 0);
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = links.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  render(links[next].dataset.section);
  center(selected);
  links[next].focus({ preventScroll: true });
});

// Horizontal swipes across the page preserve native vertical reading scroll.
const composition = document.querySelector('.composition');
let swipe;
composition.addEventListener('pointerdown', event => {
  if (!mobile.matches || event.pointerType !== 'touch' || !event.isPrimary || event.target.closest('.nav-scroll')) return;
  swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, horizontal: false };
});
composition.addEventListener('pointermove', event => {
  if (!swipe || event.pointerId !== swipe.id) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (!swipe.horizontal) {
    if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { swipe = null; return; }
    if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
    swipe.horizontal = true;
    composition.setPointerCapture(event.pointerId);
  }
  swipe.dx = dx;
  copy.style.transform = `translateX(${dx * .25}px)`;
  copy.style.opacity = String(Math.max(.5, 1 - Math.abs(dx) / 600));
});
function finishSwipe(event) {
  if (!swipe || event.pointerId !== swipe.id) return;
  const gesture = swipe;
  swipe = null;
  copy.style.transform = '';
  copy.style.opacity = '';
  if (composition.hasPointerCapture(event.pointerId)) composition.releasePointerCapture(event.pointerId);
  if (!gesture.horizontal) return;
  const index = links.findIndex(link => link.dataset.section === selected);
  const next = Math.max(0, Math.min(links.length - 1, index + (gesture.dx < 0 ? 1 : -1)));
  if (event.type === 'pointerup' && Math.abs(gesture.dx) >= 45 && next !== index) {
    render(links[next].dataset.section);
    center(selected);
    if (!reducedMotion.matches) copy.animate([
      { transform: `translateX(${gesture.dx < 0 ? 40 : -40}px)`, opacity: .5 },
      { transform: 'translateX(0)', opacity: 1 }
    ], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
  } else if (!reducedMotion.matches) {
    copy.animate([{ transform: `translateX(${gesture.dx * .25}px)`, opacity: .7 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }
}
composition.addEventListener('pointerup', finishSwipe);
composition.addEventListener('pointercancel', finishSwipe);

window.addEventListener('hashchange', () => {
  const hash = location.hash.slice(1);
  const id = aliases[hash] || hash;
  if (sections[id]) { render(id, false); center(id); }
});
window.addEventListener('resize', () => { arrangeNavigation(); center(selected, false); paintNavigation(); });
arrangeNavigation();
render('blankmind');
center(selected, false);
paintNavigation();
