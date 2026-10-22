// Library and watch progress, synced with the Stremio account's "libraryItem" datastore.
// Item shape follows stremio-core's LibraryItem; times in `state` are milliseconds.

const Library = (function () {
  let items = store.get('library', {});

  function persist() { store.set('library', items); }

  function now() { return new Date().toISOString(); }

  function blankState() {
    return {
      lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0,
      timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false
    };
  }

  function fromMeta(meta) {
    return {
      _id: meta.id,
      name: meta.name,
      type: meta.type,
      poster: meta.poster || null,
      posterShape: meta.posterShape || 'poster',
      removed: true,
      temp: true,
      _ctime: now(),
      _mtime: now(),
      state: blankState(),
      behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false }
    };
  }

  function push(item) {
    item._mtime = now();
    items[item._id] = item;
    persist();
    if (!Api.isGuest()) Api.libraryPut([item]).catch((e) => devlog('library put failed', e));
  }

  return {
    refresh() {
      if (Api.isGuest()) return Promise.resolve(items);
      return Api.libraryGetAll().then((list) => {
        items = {};
        (list || []).forEach((it) => { items[it._id] = it; });
        persist();
        return items;
      });
    },

    get(id) { return items[id] || null; },

    inLibrary(id) { const it = items[id]; return !!(it && !it.removed); },

    // Matches stremio-core: anything with a saved position that isn't purely removed.
    continueWatching() {
      return Object.keys(items).map((k) => items[k])
        .filter((it) => it.type !== 'other' && (!it.removed || it.temp) && it.state && it.state.timeOffset > 0)
        .sort((a, b) => (b._mtime > a._mtime ? 1 : -1));
    },

    list(type) {
      return Object.keys(items).map((k) => items[k])
        .filter((it) => !it.removed && (!type || it.type === type))
        .sort((a, b) => (b._mtime > a._mtime ? 1 : -1));
    },

    add(meta) {
      const it = items[meta.id] || fromMeta(meta);
      it.removed = false;
      it.temp = false;
      push(it);
    },

    remove(id) {
      const it = items[id];
      if (!it) return;
      it.removed = true;
      push(it);
    },

    // Called periodically by the player. positionSec/durationSec are seconds.
    progress(meta, videoId, positionSec, durationSec, watchedDeltaSec) {
      const it = items[meta.id] || fromMeta(meta);
      const s = it.state || (it.state = blankState());
      if (s.video_id !== videoId) { s.timeWatched = 0; s.flaggedWatched = 0; }
      s.video_id = videoId;
      s.lastWatched = now();
      s.duration = Math.round(durationSec * 1000);
      s.timeWatched += Math.round(watchedDeltaSec * 1000);
      s.overallTimeWatched += Math.round(watchedDeltaSec * 1000);
      // Like stremio-core: watched once 70% has actually been watched; past 90% (credits)
      // the resume point is cleared so it leaves Continue Watching.
      if (!s.flaggedWatched && s.duration && s.timeWatched > 0.7 * s.duration) { s.flaggedWatched = 1; s.timesWatched += 1; }
      s.timeOffset = durationSec > 0 && positionSec / durationSec > 0.9 ? 0 : Math.round(positionSec * 1000);
      push(it);
    },

    // "Dismiss" on Continue Watching: forget the resume point (core's RewindLibraryItem).
    dismiss(id) {
      const it = items[id];
      if (!it || !it.state) return;
      it.state.timeOffset = 0;
      push(it);
    },

    // Resume point in seconds for this exact video, or 0.
    resumeAt(id, videoId) {
      const it = items[id];
      if (!it || !it.state || it.state.video_id !== videoId) return 0;
      return (it.state.timeOffset || 0) / 1000;
    }
  };
})();
