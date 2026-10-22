// What this TV can play, from on-device tests (probe/ pages): H.264, HEVC 8/10-bit,
// HDR10 and Dolby Vision in MKV or MP4, with AAC/AC3/EAC3 audio, including TorBox
// links served as application/octet-stream. It cannot decode XviD/DivX (AVI) or AV1.
// In MKV, DTS audio stops the whole file from playing and TrueHD plays silently;
// FLAC/Opus/MP3 MKVs didn't play either. Torrent-only streams need a streaming server.

const Playability = (function () {
  const BAD_FORMAT = [
    [/\bxvid\b|\bdivx\b/i, 'XviD/DivX video'],
    [/\.avi\b|\bavi\b(?=[\s.\]\)|]|$)/i, 'AVI file'],
    [/\bav1\b/i, 'AV1 video'],
    [/\bdts(?:[-. ]?(?:hd|x|ma|es))*\b/i, 'DTS audio'],
    [/\btrue[-. ]?hd\b/i, 'Dolby TrueHD audio (no sound on this TV)'],
    [/\bflac\b/i, 'FLAC audio'],
    [/\bopus\b/i, 'Opus audio'],
    [/\.(wmv|flv|rmvb|rm)\b/i, 'Unsupported file type']
  ];

  function text(s) {
    const hints = s.behaviorHints || {};
    let path = '';
    try { path = decodeURIComponent((s.url || '').split('?')[0]); } catch (e) { path = s.url || ''; }
    return [s.name, s.title, s.description, hints.filename, path].filter(Boolean).join(' \n ');
  }

  // Returns { ok: true } or { ok: false, reason: 'shown to the user' }.
  function check(s) {
    if (/\[❌\]/.test(s.name || '')) return { ok: false, reason: 'Error result from the addon' };
    if (s.ytId) return { ok: false, reason: 'YouTube video' };
    if (s.externalUrl && !s.url) return { ok: false, reason: 'Opens outside Stremio' };
    if (!s.url || !/^https?:/i.test(s.url)) {
      return { ok: false, reason: s.infoHash ? 'Torrent: needs a debrid service' : 'No playable link' };
    }
    const t = text(s);
    for (let i = 0; i < BAD_FORMAT.length; i++) {
      if (BAD_FORMAT[i][0].test(t)) {
        const label = BAD_FORMAT[i][1];
        return { ok: false, reason: label.indexOf('(') >= 0 ? label : label + ' (this TV can’t decode it)' };
      }
    }
    return { ok: true };
  }

  // File size in bytes, from behaviorHints or text like "1.71 GB" in the description.
  function sizeBytes(s) {
    const hints = s.behaviorHints || {};
    if (hints.videoSize) return hints.videoSize;
    const m = String((s.description || '') + ' ' + (s.title || '')).match(/([\d.]+)\s*(GB|GiB|MB|MiB)\b/i);
    if (!m) return 0;
    return parseFloat(m[1]) * (/^G/i.test(m[2]) ? 1073741824 : 1048576);
  }

  // Runtime strings look like "57 min", "2h 5min" or "1h 30m".
  function runtimeSeconds(text) {
    if (!text) return 0;
    const hrs = String(text).match(/(\d+)\s*h/i), mins = String(text).match(/(\d+)\s*m/i);
    return ((hrs ? +hrs[1] : 0) * 60 + (mins ? +mins[1] : 0)) * 60;
  }

  // Average bitrate the stream needs, in Mbit/s, or 0 if unknown. Above 150 the size is
  // almost certainly a whole season pack rather than this file, so it's ignored.
  function mbps(s, meta, video) {
    const bytes = sizeBytes(s);
    const secs = runtimeSeconds((video && video.runtime) || (meta && meta.runtime));
    if (!bytes || secs < 600) return 0;
    const need = (bytes * 8 / 1e6) / secs;
    return need > 150 ? 0 : need;
  }

  // Debrid addons tag results "[TB+]" when the file is already cached and
  // "[TB download]" (or ⏳) when the service would have to fetch the torrent first,
  // which makes playback crawl or stall.
  const DEBRID = '(?:TB|RD|AD|PM|DL|ED|OC|TR|PK|EN)';
  const CACHED = new RegExp('\\[' + DEBRID + '\\+\\]');
  const UNCACHED = new RegExp('\\[' + DEBRID + '\\s*(?:download|\u23f3)\\]|\u23f3', 'i');
  function cached(s) {
    const name = String(s.name || '');
    if (CACHED.test(name)) return true;
    if (UNCACHED.test(name)) return false;
    return null;
  }

  return { check, sizeBytes, mbps, cached };
})();

// How fast this TV can download, measured against Cloudflare's speed test (CORS-enabled).
// The result goes through the TV's Wi-Fi too, so it covers both bottlenecks.
const Speed = (function () {
  function measure(bytes) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      let first = 0;
      const t0 = Date.now();
      x.open('GET', 'https://speed.cloudflare.com/__down?bytes=' + bytes + '&r=' + Math.random(), true);
      x.responseType = 'arraybuffer';
      x.timeout = 90000;
      x.onprogress = () => { if (!first) first = Date.now(); };
      x.onload = () => {
        const secs = (Date.now() - (first || t0)) / 1000;
        const got = x.response ? x.response.byteLength : 0;
        resolve(secs > 0 ? (got * 8 / 1e6) / secs : 0);
      };
      x.onerror = () => reject(new Error('speed test failed'));
      x.ontimeout = () => reject(new Error('speed test timed out'));
      x.send();
    });
  }

  return {
    get() { return Prefs.get('measuredMbps') || 0; },
    // Best of `runs` downloads, saved for ranking streams.
    test(runs, bytes) {
      const results = [];
      let chain = Promise.resolve();
      for (let i = 0; i < (runs || 2); i++) {
        chain = chain.then(() => measure(bytes || 20000000)).then((m) => { results.push(m); }, () => {});
      }
      return chain.then(() => {
        const best = results.length ? Math.max.apply(null, results) : 0;
        if (best) { Prefs.set('measuredMbps', Math.round(best * 10) / 10); devlog('speed test Mbit/s', results.map((r) => r.toFixed(1)).join(', ')); }
        return best;
      });
    },
    // Streams need headroom: Wi-Fi throughput swings, and bitrate peaks well above average.
    fits(needMbps) { const have = this.get(); return !have || !needMbps || needMbps <= have * 0.7; }
  };
})();
