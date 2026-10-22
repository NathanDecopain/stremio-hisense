// The last stream played for each (meta, video), plus player state for it (subtitle and
// audio choice, subtitle delay/size/position), like stremio-core's StreamsBucket. Local to
// this TV. Continue Watching uses it to jump straight back into the player.

const StreamsBucket = (function () {
  const MAX_ITEMS = 300;
  let items = store.get('streams', {});

  function key(metaId, videoId) { return metaId + '|' + videoId; }

  function persist() {
    const keys = Object.keys(items);
    if (keys.length > MAX_ITEMS) {
      keys.sort((a, b) => items[a].mtime - items[b].mtime);
      keys.slice(0, keys.length - MAX_ITEMS).forEach((k) => { delete items[k]; });
    }
    store.set('streams', items);
  }

  function sameSource(a, b) {
    return !!a && !!b && ((a.url && a.url === b.url) || (a.infoHash && a.infoHash === b.infoHash && a.fileIdx === b.fileIdx));
  }

  function bingeMatch(a, b) {
    const ga = a && a.behaviorHints && a.behaviorHints.bingeGroup;
    const gb = b && b.behaviorHints && b.behaviorHints.bingeGroup;
    return !!ga && ga === gb;
  }

  return {
    sameSource,
    bingeMatch,

    get(metaId, videoId) { return items[key(metaId, videoId)] || null; },

    // Current episode first, then up to 30 earlier ones (so a new episode inherits choices).
    last(meta, videoId) {
      const vids = (meta && meta.videos) || [];
      if (!vids.length) return this.get(meta.id, videoId);
      const pos = vids.findIndex((v) => v.id === videoId);
      if (pos < 0) return this.get(meta.id, videoId);
      for (let i = pos; i >= Math.max(0, pos - 30); i--) {
        const it = this.get(meta.id, vids[i].id);
        if (it) return it;
      }
      return null;
    },

    // State carried over to a new stream, following stremio-core's adjusted_state rules.
    inheritState(prev, stream) {
      if (!prev || !prev.state) return {};
      const s = prev.state;
      if (sameSource(prev.stream, stream)) return Object.assign({}, s);
      if (bingeMatch(prev.stream, stream)) {
        return { subLang: s.subLang, subSize: s.subSize, subOffset: s.subOffset, audioLang: s.audioLang,
          subEmbedded: s.subEmbedded ? s.subEmbedded : undefined };
      }
      return {};
    },

    save(meta, videoId, stream, addonUrl, state) {
      items[key(meta.id, videoId)] = {
        stream, addonUrl, type: meta.type, metaId: meta.id, videoId, state: state || {}, mtime: Date.now()
      };
      persist();
    },

    updateState(metaId, videoId, patch) {
      const it = items[key(metaId, videoId)];
      if (!it) return;
      it.state = Object.assign({}, it.state, patch);
      it.mtime = Date.now();
      persist();
    },

    clear() { items = {}; store.remove('streams'); }
  };
})();
