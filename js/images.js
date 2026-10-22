// Poster loading tuned for the TV: a small download queue, retries, and visibility
// checks done by hand. Chrome 53's early IntersectionObserver misses images inside
// horizontally scrolled rows, and starting 100+ downloads at once makes the TV drop some.

const Images = (function () {
  const MAX_ACTIVE = 6;
  const RETRIES = 2;
  const MARGIN_X = 700, MARGIN_Y = 400; // preload this far outside the viewport
  const pending = [];   // <img> waiting to be checked for visibility
  const queue = [];     // visible, waiting for a download slot
  let active = 0;

  // Ask image CDNs for something close to the size we draw, to save TV memory.
  function sized(url) {
    if (!url) return url;
    return url
      .replace(/(yt3\.ggpht\.com\/[^=]+)=s\d+/, '$1=s300')
      .replace(/(image\.tmdb\.org\/t\/p\/)(original|w1280|w780|w500)\//, '$1w342/')
      .replace(/(images\.metahub\.space\/poster\/)(large|medium)\//, '$1small/');
  }

  function start(img) {
    active++;
    const done = (ok) => {
      active--;
      if (ok) img.classList.add('loaded');
      else if ((img._tries = (img._tries || 0) + 1) <= RETRIES) {
        // Back off and put it back in line; transient failures are common on the TV.
        setTimeout(() => { queue.push(img); pump(); }, 1500 * img._tries);
      } else img.classList.add('failed');
      pump();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = img._src + (img._tries ? (img._src.indexOf('?') < 0 ? '?' : '&') + 'retry=' + img._tries : '');
  }

  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      const img = queue.shift();
      if (document.body.contains(img)) start(img);
    }
  }

  function nearViewport(el) {
    if (!el.offsetParent) return false; // hidden screen or row
    const r = el.getBoundingClientRect();
    return r.right > -MARGIN_X && r.left < window.innerWidth + MARGIN_X &&
      r.bottom > -MARGIN_Y && r.top < window.innerHeight + MARGIN_Y;
  }

  function scan() {
    for (let i = pending.length - 1; i >= 0; i--) {
      const img = pending[i];
      if (!document.body.contains(img)) {
        if (img._attached) pending.splice(i, 1); // removed from the page for good
        continue;
      }
      img._attached = true;
      if (nearViewport(img)) {
        pending.splice(i, 1);
        queue.push(img);
      }
    }
    pump();
  }

  const scheduleScan = debounce(scan, 80);

  // Scrolling inside any row or page doesn't bubble, so listen in the capture phase.
  document.addEventListener('scroll', scheduleScan, true);
  window.addEventListener('resize', scheduleScan);

  return {
    sized,
    // An <img> that loads when it gets near the screen. Adds "loaded"/"failed" classes.
    lazy(cls, url) {
      const img = h('img.' + cls, { alt: '' });
      if (!url) { img.classList.add('failed'); return img; }
      img._src = sized(url);
      pending.push(img);
      scheduleScan();
      return img;
    },
    // Call after inserting or showing content so new images get considered.
    scan: scheduleScan
  };
})();
