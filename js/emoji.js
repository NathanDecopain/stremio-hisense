// The TV has no emoji font, so emoji in addon text (💾 👤 ⚙️, flags) render as nothing.
// This swaps them for Twemoji images (CC-BY 4.0) from jsDelivr. Chrome 53 has no
// Unicode property escapes, so the pattern is spelled out with surrogate ranges.

const Emoji = (function () {
  const BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/';
  const PICTO = '(?:[\\uD83C-\\uD83E][\\uDC00-\\uDFFF]|[\\u2600-\\u27BF\\u2B50\\u2B55\\u23E9-\\u23FA\\u231A\\u231B\\u2139\\u2194-\\u2199\\u21A9\\u21AA\\u2934\\u2935\\u3030\\u303D\\u3297\\u3299])';
  const PATTERN = new RegExp(
    '(?:\\uD83C[\\uDDE6-\\uDDFF]){2}' +                 // flags: two regional indicators
    '|' + PICTO + '\\uFE0F?(?:\\uD83C[\\uDFFB-\\uDFFF])?' + // emoji, optional variation/skin tone
    '(?:\\u200D' + PICTO + '\\uFE0F?(?:\\uD83C[\\uDFFB-\\uDFFF])?)*', // ZWJ sequences
    'g');

  // Twemoji file names are the code points in hex joined by "-", without FE0F
  // unless the sequence contains a zero-width joiner.
  function fileName(seq) {
    const points = [];
    for (let i = 0; i < seq.length; i++) {
      const c = seq.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < seq.length) {
        points.push(((c - 0xD800) * 0x400 + (seq.charCodeAt(++i) - 0xDC00) + 0x10000).toString(16));
      } else {
        points.push(c.toString(16));
      }
    }
    const hasZwj = points.indexOf('200d') >= 0;
    return points.filter((p) => hasZwj || p !== 'fe0f').join('-');
  }

  function image(seq) {
    const img = document.createElement('img');
    img.className = 'emoji';
    img.alt = seq;
    img.src = BASE + fileName(seq) + '.png';
    img.onerror = function () { this.parentNode && this.parentNode.replaceChild(document.createTextNode(seq), this); };
    return img;
  }

  // Text -> fragment of text nodes and emoji images. Keeps newlines for white-space: pre.
  function render(text) {
    const frag = document.createDocumentFragment();
    text = String(text == null ? '' : text);
    let last = 0, m;
    PATTERN.lastIndex = 0;
    while ((m = PATTERN.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(image(m[0]));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  return { render };
})();
