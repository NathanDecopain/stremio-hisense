// Small helpers shared by everything else.

// h('div.card', {onclick: fn}, child, 'text', [more children])
function h(tag, attrs) {
  const parts = tag.split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  let start = 1;
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k.indexOf('on') === 0) el[k] = v;
      else if (k === 'className') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.keys(v).forEach((d) => { el.dataset[d] = v[d]; });
      else el.setAttribute(k, v === true ? '' : v);
    });
    start = 2;
  }
  for (let i = start; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}

function append(el, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) child.forEach((c) => append(el, c));
  else el.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error((label || 'request') + ' timed out')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function getJSON(url, ms) {
  return withTimeout(fetch(url), ms || 15000, url).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.json();
  });
}

function getText(url, ms) {
  return withTimeout(fetch(url), ms || 15000, url).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function postJSON(url, body, ms) {
  return withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }), ms || 15000, url).then((r) => r.json());
}

// Run fn over items with at most `limit` in flight; results keep input order.
function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  function worker() {
    if (next >= items.length) return Promise.resolve();
    const i = next++;
    return Promise.resolve().then(() => fn(items[i], i))
      .then((v) => { results[i] = { ok: true, value: v }; }, (e) => { results[i] = { ok: false, error: e }; })
      .then(worker);
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  return Promise.all(workers).then(() => results);
}

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('sh.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('sh.' + key, JSON.stringify(value)); } catch (e) {}
  },
  remove(key) {
    try { localStorage.removeItem('sh.' + key); } catch (e) {}
  }
};

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return (hh ? hh + ':' + pad2(mm) : mm) + ':' + pad2(ss);
}

function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms);
  };
}

function toast(text, ms) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = 'show';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = ''; }, ms || 3000);
}

// Ship errors and logs to the dev server on the PC, because there is no way to open
// devtools on the TV. Served from the dev server, logs go by XHR. Served from GitHub
// Pages, logging is off unless the URL has ?log=<host:port>; then lines go out as image
// requests, since an https page may load http images but not make http XHRs.
const devlog = (function () {
  const local = location.port === '8000';
  const beaconMatch = /[?&]log=([\w.\-]+(?::\d+)?)/.exec(location.search);
  const beaconHost = !local && beaconMatch ? beaconMatch[1] : null;
  const enabled = local || !!beaconHost;
  const lines = [];
  let sent = 0, dropped = 0;
  const flush = debounce(() => {
    if (beaconHost) {
      // Send only lines not sent yet, in URL-sized batches.
      const fresh = lines.slice(Math.max(0, lines.length - (lines._added - sent)));
      sent = lines._added;
      let batch = [];
      const fire = () => {
        if (!batch.length) return;
        const img = new Image();
        img.src = 'http://' + beaconHost + '/beacon?d=' + encodeURIComponent(JSON.stringify(batch)) + '&r=' + Math.random();
        batch = [];
      };
      fresh.forEach((l) => {
        if (encodeURIComponent(JSON.stringify(batch.concat([l]))).length > 1800) fire();
        batch.push(l.slice(0, 600));
      });
      fire();
      return;
    }
    try {
      const x = new XMLHttpRequest();
      x.open('POST', '/report/app-log', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ ua: navigator.userAgent, lines: lines, dropped }));
    } catch (e) {}
  }, 1000);
  lines._added = 0;
  function log() {
    const msg = Array.prototype.map.call(arguments, (a) => {
      if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
      if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
      return String(a);
    }).join(' ');
    if (window.console) console.log(msg);
    if (!enabled) return;
    lines.push(new Date().toISOString().slice(11, 19) + ' ' + msg);
    lines._added++;
    if (lines.length > 300) { lines.shift(); dropped++; }
    flush();
  }
  if (enabled) {
    window.addEventListener('error', (e) => log('ERROR', e.message, (e.filename || '') + ':' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => log('UNHANDLED', e.reason));
  }
  return log;
})();
