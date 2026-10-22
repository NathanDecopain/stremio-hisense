// Stremio addon protocol client: catalogs, meta, streams and subtitles over plain HTTP JSON.
// This replaces what stremio-core (WASM) does in the official web app.

const Addons = (function () {
  const DEFAULTS = [
    'https://v3-cinemeta.strem.io/manifest.json',
    'https://opensubtitles-v3.strem.io/manifest.json'
  ];
  let list = store.get('addons', []);

  function base(transportUrl) { return transportUrl.replace(/\/manifest\.json$/, ''); }

  // A resource entry is either "stream" or {name, types, idPrefixes}; bare names
  // inherit the manifest-level types and idPrefixes.
  function supports(addon, resource, type, id) {
    const m = addon.manifest;
    const entries = m.resources || [];
    for (let i = 0; i < entries.length; i++) {
      const r = entries[i];
      const name = typeof r === 'string' ? r : r.name;
      if (name !== resource) continue;
      const types = (typeof r === 'object' && r.types) || m.types || [];
      const prefixes = typeof r === 'object' && r.idPrefixes ? r.idPrefixes : m.idPrefixes;
      if (types.indexOf(type) < 0) continue;
      if (id && prefixes && prefixes.length && !prefixes.some((p) => id.indexOf(p) === 0)) continue;
      return true;
    }
    return false;
  }

  function extraPath(extra) {
    const keys = Object.keys(extra || {}).filter((k) => extra[k] != null && extra[k] !== '');
    if (!keys.length) return '';
    return '/' + keys.map((k) => k + '=' + encodeURIComponent(extra[k])).join('&');
  }

  // Episode ids look like "tt0903747:1:2"; stremio-core leaves the colons unescaped
  // and some addons don't decode %3A.
  function encodeId(id) { return encodeURIComponent(id).replace(/%3A/gi, ':'); }

  function resourceUrl(addon, resource, type, id, extra) {
    return base(addon.transportUrl) + '/' + resource + '/' + type + '/' + encodeId(id) + extraPath(extra) + '.json';
  }

  function hasRequiredExtra(cat) {
    return (cat.extra || []).some((e) => e.isRequired) || (cat.extraRequired || []).length > 0;
  }

  function supportsExtra(cat, name) {
    return (cat.extra || []).some((e) => e.name === name) || (cat.extraSupported || []).indexOf(name) >= 0;
  }

  // Addons served from this machine (e.g. "Local Files" at 127.0.0.1:11470) belong to the
  // desktop app's streaming server, which the TV can't reach.
  function isLocal(addon) { return /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(addon.transportUrl); }

  function enabled() { return list.filter((a) => a && a.manifest && !isLocal(a)); }

  function extraOptions(cat, name) {
    const e = (cat.extra || []).filter((x) => x.name === name)[0];
    if (e && e.options) return e.options;
    return name === 'genre' && cat.genres ? cat.genres : [];
  }

  return {
    all: enabled,

    // Load the account's installed addons (or the defaults for guests).
    refresh() {
      const load = Api.isGuest()
        ? mapLimit(DEFAULTS, 4, (url) => getJSON(url).then((manifest) => ({ transportUrl: url, manifest })))
          .then((rs) => rs.filter((r) => r.ok).map((r) => r.value))
        : Api.addonCollection();
      return load.then((addons) => {
        list = addons.map((a) => ({ transportUrl: a.transportUrl, manifest: a.manifest, flags: a.flags || {} }));
        store.set('addons', list);
        return list;
      });
    },

    // Catalogs shown as rows on the home board: no required extra like "search".
    boardCatalogs() {
      const out = [];
      enabled().forEach((addon) => {
        (addon.manifest.catalogs || []).forEach((cat) => {
          if (!hasRequiredExtra(cat)) out.push({ addon, cat });
        });
      });
      return out;
    },

    searchCatalogs() {
      const out = [];
      enabled().forEach((addon) => {
        (addon.manifest.catalogs || []).forEach((cat) => {
          if (supportsExtra(cat, 'search')) out.push({ addon, cat });
        });
      });
      return out;
    },

    extraOptions,
    supportsExtra,
    hasRequiredExtra,

    catalog(addon, cat, extra) {
      return getJSON(resourceUrl(addon, 'catalog', cat.type, cat.id, extra)).then((r) => r.metas || []);
    },

    // Asks every meta addon at once; the first one in install order that answers wins,
    // like stremio-core's AllOfResource + first-Ready rule.
    meta(type, id) {
      const candidates = enabled().filter((a) => supports(a, 'meta', type, id));
      if (!candidates.length) return Promise.reject(new Error('No addons were requested for this meta!'));
      return new Promise((resolve, reject) => {
        const results = new Array(candidates.length);
        const settle = () => {
          for (let i = 0; i < results.length; i++) {
            if (results[i] === undefined) return; // an earlier addon may still answer
            if (results[i]) { resolve(results[i]); return; }
          }
          reject(new Error('No metadata was found!'));
        };
        // One retry per addon: the TV's network occasionally drops a request.
        const fetchMeta = (addon) => getJSON(resourceUrl(addon, 'meta', type, id), 20000)
          .then(null, (e) => (/HTTP 4/.test(e.message) ? Promise.reject(e) : getJSON(resourceUrl(addon, 'meta', type, id), 20000)));
        candidates.forEach((addon, i) => {
          fetchMeta(addon).then((r) => {
            results[i] = r && r.meta ? r.meta : null;
          }, (e) => { results[i] = null; devlog('meta request failed', addon.manifest.name, e.message); }).then(settle);
        });
      });
    },

    // Addons that can answer a stream request for this video, in install order.
    streamAddons(type, videoId) {
      return enabled().filter((a) => supports(a, 'stream', type, videoId));
    },

    // Some addons answer 404 when they simply have nothing; that's an empty result.
    streamsFrom(addon, type, videoId) {
      return getJSON(resourceUrl(addon, 'stream', type, videoId), 30000)
        .then((r) => r.streams || [], (e) => (/HTTP 404/.test(e.message) ? [] : Promise.reject(e)));
    },

    subtitles(type, videoId, extra) {
      const candidates = enabled().filter((a) => supports(a, 'subtitles', type, videoId));
      return mapLimit(candidates, 4, (addon) =>
        getJSON(resourceUrl(addon, 'subtitles', type, videoId, extra), 20000)
          .then((r) => (r.subtitles || []).map((s) => Object.assign({ addon: addon.manifest.name }, s)))
      ).then((rs) => rs.reduce((acc, r) => (r.ok ? acc.concat(r.value) : acc), []));
    }
  };
})();
