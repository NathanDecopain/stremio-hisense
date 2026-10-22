// SRT/WebVTT parsing and a text overlay. <track> rendering on the TV is unreliable and
// can't be styled, so cues are drawn by hand.

const Subtitles = (function () {
  const LANG_NAMES = {
    eng: 'English', fre: 'French', fra: 'French', spa: 'Spanish', ger: 'German', deu: 'German',
    ita: 'Italian', por: 'Portuguese', pob: 'Portuguese (BR)', dut: 'Dutch', nld: 'Dutch',
    pol: 'Polish', rus: 'Russian', ara: 'Arabic', tur: 'Turkish', swe: 'Swedish', nor: 'Norwegian',
    dan: 'Danish', fin: 'Finnish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', hun: 'Hungarian',
    cze: 'Czech', ces: 'Czech', rum: 'Romanian', ron: 'Romanian', bul: 'Bulgarian', hrv: 'Croatian',
    srp: 'Serbian', chi: 'Chinese', zho: 'Chinese', jpn: 'Japanese', kor: 'Korean', vie: 'Vietnamese',
    tha: 'Thai', ind: 'Indonesian', may: 'Malay', hin: 'Hindi', per: 'Persian', fas: 'Persian',
    ukr: 'Ukrainian', slo: 'Slovak', slv: 'Slovenian', est: 'Estonian', lav: 'Latvian', lit: 'Lithuanian'
  };

  // Embedded tracks often carry 2-letter codes; map them onto the 3-letter ones addons use.
  const TWO_TO_THREE = {
    en: 'eng', fr: 'fre', es: 'spa', de: 'ger', it: 'ita', pt: 'por', nl: 'dut', pl: 'pol', ru: 'rus',
    ar: 'ara', tr: 'tur', sv: 'swe', no: 'nor', nb: 'nor', da: 'dan', fi: 'fin', el: 'gre', he: 'heb',
    hu: 'hun', cs: 'cze', ro: 'rum', bg: 'bul', hr: 'hrv', sr: 'srp', zh: 'chi', ja: 'jpn', ko: 'kor',
    vi: 'vie', th: 'tha', id: 'ind', ms: 'may', hi: 'hin', fa: 'per', uk: 'ukr', sk: 'slo', sl: 'slv'
  };
  function normLang(code) {
    if (!code) return 'und';
    code = String(code).toLowerCase().split(/[-_]/)[0];
    return TWO_TO_THREE[code] || code;
  }

  function langName(code) {
    code = normLang(code);
    if (code === 'und') return 'Unknown';
    return LANG_NAMES[code] || code.toUpperCase();
  }

  function toSec(ts) {
    // 00:01:02,345 | 00:01:02.345 | 01:02.345
    const m = ts.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/);
    if (!m) return NaN;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / Math.pow(10, m[4].length);
  }

  function clean(text) {
    return text
      .replace(/\{\\[^}]*\}/g, '')          // ASS-style override tags inside SRT
      .replace(/<(?!\/?(i|b|u)>)[^>]*>/g, '') // keep only i/b/u
      .trim();
  }

  function parse(text) {
    const cues = [];
    const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
    blocks.forEach((block) => {
      const lines = block.split('\n');
      const ti = lines.findIndex((l) => l.indexOf('-->') >= 0);
      if (ti < 0) return;
      const parts = lines[ti].split('-->');
      const start = toSec(parts[0]), end = toSec(parts[1]);
      if (isNaN(start) || isNaN(end)) return;
      const body = clean(lines.slice(ti + 1).join('\n'));
      if (body) cues.push({ start, end, text: body });
    });
    cues.sort((a, b) => a.start - b.start);
    return cues;
  }

  // Overlay bound to a video element.
  function Overlay(container, video) {
    this.el = h('div.subs');
    container.appendChild(this.el);
    this.video = video;
    this.cues = [];
    this.delay = 0;
    this.last = null;
    this.timer = null;
  }
  Overlay.prototype.load = function (cues) {
    this.cues = cues;
    this.last = null;
    this.el.innerHTML = '';
    if (!this.timer) this.timer = setInterval(() => this.tick(), 200);
  };
  Overlay.prototype.off = function () {
    this.cues = [];
    this.el.innerHTML = '';
    clearInterval(this.timer);
    this.timer = null;
  };
  Overlay.prototype.tick = function () {
    const t = this.video.currentTime - this.delay;
    let html = '';
    // Few cues overlap, so a linear scan over a binary-searched window is plenty.
    let lo = 0, hi = this.cues.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.cues[mid].start <= t) lo = mid; else hi = mid - 1; }
    for (let i = Math.max(0, lo - 5); i <= lo + 1 && i < this.cues.length; i++) {
      const c = this.cues[i];
      if (c.start <= t && t < c.end) html += (html ? '<br>' : '') + c.text.replace(/\n/g, '<br>');
    }
    if (html !== this.last) {
      this.last = html;
      this.el.innerHTML = html ? '<span>' + html + '</span>' : '';
    }
  };
  // size: % of the base size; offset: % of the height from the bottom (Stremio's settings).
  Overlay.prototype.setStyle = function (size, offset) {
    this.el.style.fontSize = (2.3 * size / 100) + 'rem';
    this.el.style.bottom = offset + '%';
  };
  Overlay.prototype.destroy = function () { this.off(); };

  return { parse, langName, normLang, Overlay };
})();
