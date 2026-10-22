// Spatial navigation for the remote's D-pad, plus pointer support (VIDAA's browser
// can drive pages with an on-screen cursor). Any element with class "focusable" can
// take focus; activating it calls its onclick.
//
// Optional attributes:
//   data-nav-group  on a container: re-entering it returns to the last focused child
//   scroll-x / scroll-y classes on scroll containers: focus keeps the item in view

const Nav = (function () {
  const KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: [8, 27, 461, 10009],
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 179, STOP: 413, FF: 417, RW: 412
  };
  let current = null;
  let root = document.body;
  let keyHandler = null; // screen-level override, return true to swallow

  function visible(el) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function candidates() {
    return Array.prototype.filter.call(root.querySelectorAll('.focusable'),
      (el) => !el.disabled && !el.classList.contains('disabled') && !el.closest('.disabled') && visible(el));
  }

  function groupOf(el) { return el && el.closest('[data-nav-group]'); }

  function ensureVisible(el) {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const pr = p.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (p.classList.contains('scroll-x')) {
        const pad = 40;
        if (r.left < pr.left + pad) p.scrollLeft -= (pr.left + pad - r.left);
        else if (r.right > pr.right - pad) p.scrollLeft += (r.right - pr.right + pad);
      }
      if (p.classList.contains('scroll-y')) {
        const pad = 60;
        if (r.top < pr.top + pad) p.scrollTop -= (pr.top + pad - r.top);
        else if (r.bottom > pr.bottom - pad) p.scrollTop += (r.bottom - pr.bottom + pad);
      }
      p = p.parentElement;
    }
  }

  function focus(el, opts) {
    if (!el) return;
    if (current && current !== el) current.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    const g = groupOf(el);
    if (g) g._navLast = el;
    if (!(opts && opts.noScroll)) ensureVisible(el);
    if (el.tagName === 'INPUT') el.focus();
    else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (el._onFocus) el._onFocus();
  }

  function rect(el) {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
  }

  // Pick the nearest candidate in a direction, weighting off-axis distance heavily
  // so movement stays in rows/columns.
  function move(dir) {
    const list = candidates();
    if (!current || list.indexOf(current) < 0) { focus(list[0]); return !!list[0]; }
    const c = rect(current);
    let best = null, bestScore = Infinity;
    list.forEach((el) => {
      if (el === current) return;
      const e = rect(el);
      let main, cross;
      if (dir === 'left') { main = c.l - e.r; cross = Math.abs(c.cy - e.cy); if (e.cx >= c.cx) return; }
      else if (dir === 'right') { main = e.l - c.r; cross = Math.abs(c.cy - e.cy); if (e.cx <= c.cx) return; }
      else if (dir === 'up') { main = c.t - e.b; cross = overlapGap(c.l, c.r, e.l, e.r); if (e.cy >= c.cy) return; }
      else { main = e.t - c.b; cross = overlapGap(c.l, c.r, e.l, e.r); if (e.cy <= c.cy) return; }
      // Overlapping elements (negative gap) count as adjacent.
      const score = Math.max(0, main) + cross * (dir === 'left' || dir === 'right' ? 3 : 1.5);
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (!best) return false;
    // Entering a remembered group (e.g. moving down into another row) restores its last item.
    const g = groupOf(best);
    if ((dir === 'up' || dir === 'down') && g && g !== groupOf(current) && g._navLast && list.indexOf(g._navLast) >= 0) {
      best = g._navLast;
    }
    focus(best);
    return true;
  }

  // Horizontal distance between two spans, 0 if they overlap.
  function overlapGap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  function activate() {
    if (current && current.onclick) current.onclick({ type: 'nav', target: current, preventDefault() {} });
  }

  let loggedKeys = 0;
  document.addEventListener('keydown', (e) => {
    const k = e.keyCode;
    // Whether remote keys reach the page at all depends on how the TV launched it.
    if (loggedKeys < 15) { loggedKeys++; devlog('key', k); }
    // Let text inputs keep left/right/backspace for editing.
    const inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (keyHandler && keyHandler(e, k)) { e.preventDefault(); return; }
    if (k === KEY.UP) { move('up'); e.preventDefault(); }
    else if (k === KEY.DOWN) { move('down'); e.preventDefault(); }
    else if (k === KEY.LEFT && !inInput) { move('left'); e.preventDefault(); }
    else if (k === KEY.RIGHT && !inInput) { move('right'); e.preventDefault(); }
    else if (k === KEY.ENTER && !inInput) { activate(); e.preventDefault(); }
    else if (KEY.BACK.indexOf(k) >= 0 && !(inInput && k === 8)) {
      if (Router.back()) e.preventDefault();
    }
  }, true);

  // Pointer: hovering focuses without scrolling (scrolling under the cursor is disorienting).
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('.focusable');
    if (el && el !== current && root.contains(el)) focus(el, { noScroll: true });
  }, true);

  return {
    KEY,
    focus,
    move,
    current() { return current; },
    setRoot(el) { root = el || document.body; },
    setKeyHandler(fn) { keyHandler = fn; },
    // Focus the first focusable inside `el` (or `fallback` selector).
    focusFirst(el) {
      const list = Array.prototype.filter.call((el || root).querySelectorAll('.focusable'),
        (x) => !x.classList.contains('disabled') && !x.closest('.disabled') && visible(x));
      if (list[0]) focus(list[0]);
    }
  };
})();
