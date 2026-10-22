// Meta details (stremio-web's MetaDetails): info on the left, and a 30rem side panel with
// either the episode list (series) or the streams list (movies, or a chosen episode).
// opts: { preview, meta, videoId }. Picking an episode pushes another DetailsScreen with
// that videoId, so the remote's Back returns to the episode list.

function DetailsScreen(type, id, opts) {
  opts = opts || {};
  const screen = {};
  let meta = opts.meta || Object.assign({ id, type, name: '' }, opts.preview || {});
  let loaded = !!opts.meta;

  const bg = h('div.details-bg');
  const info = h('div.meta-preview.scroll-y');
  const panel = h('div.side-panel');
  screen.el = h('div.screen',
    bg, h('div.details-bg-fade'),
    UI.topBar({ back: true }),
    h('div.details-content', info, panel));

  let streamsPanel = null;

  // ---------- Left: meta preview ----------
  function links(category) {
    const fromLinks = (meta.links || []).filter((l) => l.category === category).map((l) => l.name);
    if (fromLinks.length) return fromLinks;
    if (category === 'Genres') return meta.genres || meta.genre || [];
    if (category === 'Cast') return meta.cast || [];
    if (category === 'Directors') return meta.director || [];
    return [];
  }

  function imdbRating() {
    const l = (meta.links || []).filter((x) => x.category === 'imdb')[0];
    return l ? l.name : meta.imdbRating;
  }

  function renderInfo() {
    if (meta.background) bg.style.backgroundImage = 'url("' + meta.background + '")';
    clear(info);
    const video = currentVideo();
    if (meta.logo) {
      const logo = Images.lazy('meta-logo', meta.logo);
      info.appendChild(logo);
      // Stremio falls back to the name when the logo fails to load.
      const check = setInterval(() => {
        if (!logo.parentNode || logo.classList.contains('loaded')) { clearInterval(check); return; }
        if (logo.classList.contains('failed')) { clearInterval(check); logo.parentNode.replaceChild(h('div.meta-name', meta.name || ''), logo); }
      }, 400);
    } else {
      info.appendChild(h('div.meta-name', meta.name || ''));
    }

    const rating = imdbRating();
    info.appendChild(h('div.runtime-info',
      meta.runtime ? h('div.item', meta.runtime) : null,
      meta.releaseInfo || meta.year ? h('div.item', String(meta.releaseInfo || meta.year)) : null,
      rating ? h('div.imdb', h('div.item', String(rating)), icon('imdb')) : null));

    [['Genres', 'Genres'], ['Cast', 'Cast'], ['Directors', 'Directors']].forEach((g) => {
      const names = links(g[0]).slice(0, g[0] === 'Cast' ? 5 : 4);
      if (!names.length) return;
      info.appendChild(h('div.link-group', h('div.overline', g[1]), names.map((n) => h('span.link-pill', n))));
    });

    const desc = (video && (video.overview || video.description)) || meta.description;
    if (desc) info.appendChild(h('div.meta-description', h('div.overline', 'Summary'), h('div.text', desc)));

    const actions = h('div.action-buttons', { 'data-nav-group': '' });
    const inLib = Library.inLibrary(meta.id);
    actions.appendChild(UI.actionButton(inLib ? 'remove-from-library' : 'add-to-library',
      inLib ? 'Remove from Library' : 'Add to Library', () => {
        if (Library.inLibrary(meta.id)) Library.remove(meta.id); else Library.add(meta);
        renderInfo();
        Nav.focus(info.querySelector('.action-button'));
      }));
    info.appendChild(actions);
  }

  // ---------- Right panel ----------
  function videos() {
    return (meta.videos || []).slice().sort((a, b) =>
      ((a.season === 0 ? 1e9 : a.season) - (b.season === 0 ? 1e9 : b.season)) || (a.episode - b.episode));
  }

  function currentVideo() {
    return opts.videoId ? (meta.videos || []).filter((v) => v.id === opts.videoId)[0] || null : null;
  }

  // stremio-core's guessStream: defaultVideoId, else a movie's own id; series show episodes.
  function streamVideoId() {
    if (opts.videoId) return opts.videoId;
    if (meta.behaviorHints && meta.behaviorHints.defaultVideoId) return meta.behaviorHints.defaultVideoId;
    if (!(meta.videos || []).length && (loaded || type !== 'series')) return meta.id;
    return null;
  }

  function renderPanel() {
    const vid = streamVideoId();
    if (vid) {
      if (!streamsPanel || streamsPanel.videoId !== vid) {
        if (streamsPanel) streamsPanel.destroy();
        // The header's back arrow returns to the episode list, like stremio-web.
        streamsPanel = StreamsPanel(meta, vid, currentVideo(), () => {
          if (opts.fromEpisodes) Router.back();
          else Router.replace(DetailsScreen(type, id, { meta }));
        });
        clear(panel);
        panel.appendChild(streamsPanel.el);
      } else {
        streamsPanel.setMeta(meta, currentVideo());
      }
      return;
    }
    clear(panel);
    if (!loaded) { panel.appendChild(h('div.message', 'Loading episodes...')); return; }
    panel.appendChild(VideosPanel(meta).el);
  }

  // Start on the episode being watched, else the first thing in the panel.
  function focusPanel() {
    const cur = panel.querySelector('.video.current');
    if (cur) Nav.focus(cur); else Nav.focusFirst(panel);
  }

  let shown = false;
  screen.onShow = () => {
    if (!shown) { shown = true; focusPanel(); return; }
    // Back from the player: progress and remembered streams may have changed.
    if (loaded && !streamVideoId()) renderPanel();
    else if (streamsPanel) streamsPanel.refreshProgress();
  };
  screen.onDestroy = () => { if (streamsPanel) streamsPanel.destroy(); };

  renderInfo();
  renderPanel();
  if (!loaded) {
    Addons.meta(type, id).then((m) => {
      meta = m;
      loaded = true;
      const cur = Nav.current();
      renderInfo();
      renderPanel();
      if (!cur || !document.body.contains(cur) || cur.classList.contains('back-button')) focusPanel();
    }, (e) => {
      loaded = true;
      devlog('meta failed', type, id, e.message);
      // Keep what the catalog gave us; movies can still list streams.
      info.appendChild(h('div.message', e.message));
      renderPanel();
    });
  }
  return screen;
}

// ---------- Episode list (VideosList) ----------
function VideosPanel(meta) {
  const vids = (meta.videos || []).slice().sort((a, b) =>
    ((a.season === 0 ? 1e9 : a.season) - (b.season === 0 ? 1e9 : b.season)) || (a.episode - b.episode));
  const seasons = [];
  vids.forEach((v) => { if (v.season != null && seasons.indexOf(v.season) < 0) seasons.push(v.season); });
  seasons.sort((a, b) => (a === 0) - (b === 0) || a - b);

  const lib = Library.get(meta.id);
  const libVideo = lib && lib.state && lib.state.video_id;
  const libEntry = vids.filter((v) => v.id === libVideo)[0];
  let season = libEntry ? libEntry.season : (seasons.filter((s) => s > 0)[0] != null ? seasons.filter((s) => s > 0)[0] : seasons[0]);

  const list = h('div.videos-list.scroll-y', { 'data-nav-group': '' });
  const seasonName = (s) => (s === 0 ? 'Specials' : 'Season ' + s);
  const select = UI.multiselect(seasonName(season),
    () => seasons.map((s) => ({ label: seasonName(s), value: s, selected: s === season })),
    (o) => setSeason(o.value, true));
  const prev = h('div.season-nav.focusable', { onclick: () => step(-1) }, icon('chevron-back'), 'Prev');
  const next = h('div.season-nav.focusable', { onclick: () => step(1) }, 'Next', icon('chevron-forward'));
  const el = h('div', { style: 'display:flex;flex-direction:column;height:100%' },
    seasons.length > 1 ? h('div.seasons-bar', { 'data-nav-group': '' }, prev, select, next) : null,
    list);

  function step(d) {
    const i = seasons.indexOf(season) + d;
    if (i >= 0 && i < seasons.length) setSeason(seasons[i], false);
  }

  function setSeason(s, focusList) {
    season = s;
    select.setTitle(seasonName(s));
    prev.classList.toggle('disabled', seasons.indexOf(s) <= 0);
    next.classList.toggle('disabled', seasons.indexOf(s) >= seasons.length - 1);
    renderList();
    if (focusList) Nav.focusFirst(list);
  }

  function renderList() {
    clear(list);
    list.scrollTop = 0;
    const now = Date.now();
    const shown = seasons.length ? vids.filter((v) => v.season === season) : vids;
    if (!shown.length) { list.appendChild(UI.emptyMessage('No videos found for this meta!')); return; }
    let current = null;
    shown.forEach((v) => {
      const released = v.released ? new Date(v.released) : null;
      const upcoming = released && released.getTime() > now;
      const isCurrent = v.id === libVideo;
      const progress = isCurrent && lib.state.duration ? lib.state.timeOffset / lib.state.duration : 0;
      const watched = isCurrent && lib.state.flaggedWatched && !lib.state.timeOffset;
      const row = h('div.video.focusable' + (isCurrent ? '.current' : ''), {
        onclick: () => Router.push(DetailsScreen(meta.type, meta.id, { meta, videoId: v.id, fromEpisodes: true }))
      },
        v.thumbnail ? h('div.video-thumb', Images.lazy('thumb', v.thumbnail),
          progress > 0 ? h('div.progress', h('div', { style: 'width:' + progress * 100 + '%' })) : null) : null,
        h('div.video-info',
          h('div.video-title', (v.episode != null ? v.episode + '. ' : '') + (v.name || v.title || v.id)),
          h('div.video-meta',
            h('div.video-released', released ? released.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''),
            upcoming ? h('div.flag.upcoming', 'Upcoming') : watched ? h('div.flag.watched', 'Watched') : null)));
      if (isCurrent) current = row;
      list.appendChild(row);
    });
    Images.scan();
    if (current) setTimeout(() => { list.scrollTop = Math.max(0, current.offsetTop - 80); }, 0);
  }

  setSeason(season, false);
  return { el };
}

// ---------- Streams list (StreamsList) ----------
function StreamsPanel(meta, videoId, video, onBack) {
  const PAGE = 40; // rows rendered at a time; the TV slows down with hundreds
  const self = { videoId };
  let filter = 'ALL', limit = PAGE, showUnplayable = false, alive = true;

  const header = h('div.streams-header', { 'data-nav-group': '' });
  const container = h('div.streams-container.scroll-y', { 'data-nav-group': '' });
  self.el = h('div', { style: 'display:flex;flex-direction:column;height:100%' }, header, container);

  // Meta-embedded streams win (stremio-core's meta_streams); otherwise one slot per addon,
  // in install order, filled in as each answers.
  const embedded = video && video.streams && video.streams.length ? video.streams : null;
  const slots = embedded
    ? [{ addon: { transportUrl: 'meta', manifest: { name: meta.name } }, state: 'ready', streams: embedded }]
    : Addons.streamAddons(meta.type, videoId).map((addon) => ({ addon, state: 'loading', streams: [] }));

  slots.forEach((slot) => {
    if (slot.state !== 'loading') return;
    Addons.streamsFrom(slot.addon, meta.type, videoId).then((streams) => {
      slot.streams = streams.filter((s) => s && (s.url || s.infoHash || s.ytId || s.externalUrl));
      slot.state = slot.streams.length ? 'ready' : 'empty';
    }, (e) => {
      slot.state = 'error';
      devlog('streams failed', slot.addon.manifest.name, e.message);
    }).then(() => { if (alive) render(); });
  });

  const rowCache = typeof Map === 'function' ? new Map() : null;

  function streamRow(slot, s) {
    if (rowCache && rowCache.has(s)) return rowCache.get(s);
    const check = Playability.check(s);
    const need = Playability.mbps(s, meta, video);
    const fits = Speed.fits(need);
    const isCached = Playability.cached(s);
    const last = StreamsBucket.get(meta.id, videoId);
    const lib = Library.get(meta.id);
    const progress = last && StreamsBucket.sameSource(last.stream, s) && lib && lib.state &&
      lib.state.video_id === videoId && lib.state.duration ? lib.state.timeOffset / lib.state.duration : 0;
    const row = h('div.stream.focusable' + (check.ok ? '' : '.unplayable'), {
      onclick: () => {
        if (!check.ok) { toast(check.reason, 4000); return; }
        Router.push(PlayerScreen({ meta, videoId, video, stream: s, addonUrl: slot.addon.transportUrl }));
      }
    },
      h('div', { style: 'flex:none' },
        h('div.addon-name', Emoji.render(s.name || slot.addon.manifest.name)),
        progress > 0 ? h('div.progress', h('div', { style: 'width:' + progress * 100 + '%' })) : null),
      h('div.description', Emoji.render(s.description || s.title || ''),
        !check.ok ? h('div.reason', check.reason)
          : isCached === false ? h('div.reason', 'Not cached on your debrid service yet: may take minutes to start')
          : !fits ? h('div.reason', 'May buffer: needs ~' + Math.round(need) + ' Mbit/s, this TV gets ~' + Math.round(Speed.get())) : null),
      h('div.play-circle', icon('play')));
    row._playable = check.ok;
    row._fits = fits;
    row._uncached = isCached === false;
    if (rowCache) rowCache.set(s, row);
    return row;
  }

  function renderHeader() {
    clear(header);
    if (video) {
      header.appendChild(h('div.back.focusable', { onclick: onBack }, icon('chevron-back')));
      header.appendChild(h('div.episode-title',
        'S' + video.season + 'E' + video.episode + ' ' + (video.name || video.title || '')));
    }
    const ready = slots.filter((s) => s.state === 'ready');
    if (ready.length > 1) {
      const current = ready.filter((s) => s.addon.transportUrl === filter)[0];
      header.appendChild(UI.multiselect(current ? current.addon.manifest.name : 'All',
        () => [{ label: 'All', value: 'ALL', selected: !current }].concat(ready.map((s) => ({
          label: s.addon.manifest.name, value: s.addon.transportUrl, selected: s === current
        }))),
        (o) => { filter = o.value; limit = PAGE; container.scrollTop = 0; render(); Nav.focusFirst(container); }));
    }
  }

  function render() {
    const hadFocus = container.contains(Nav.current());
    renderHeader();
    const ready = slots.filter((s) => s.state === 'ready');
    const loading = slots.filter((s) => s.state === 'loading').length;
    const visibleSlots = ready.filter((s) => filter === 'ALL' || s.addon.transportUrl === filter);
    if (filter !== 'ALL' && !visibleSlots.length) filter = 'ALL';

    // Addon order is kept within each group. Order: cached files that suit the measured
    // connection speed, cached but heavy files, then files the debrid service hasn't
    // cached yet (they crawl or stall while it downloads the torrent).
    const smooth = [], heavy = [], uncached = [], unplayable = [];
    (filter === 'ALL' ? ready : visibleSlots).forEach((slot) => {
      slot.streams.forEach((s) => {
        const row = streamRow(slot, s);
        (!row._playable ? unplayable : row._uncached ? uncached : row._fits ? smooth : heavy).push(row);
      });
    });
    const playable = smooth.concat(heavy, uncached);

    // Re-append in order instead of rebuilding, so the focused row keeps focus.
    while (container.firstChild) container.removeChild(container.firstChild);
    if (!slots.length) {
      container.appendChild(UI.emptyMessage('No addons were requested for streams!', 'addons'));
    } else if (!ready.length && !loading) {
      container.appendChild(UI.emptyMessage(video && video.released && new Date(video.released) > new Date()
        ? 'Upcoming...' : 'No streams were found'));
    } else if (!ready.length) {
      for (let i = 0; i < 2; i++) {
        container.appendChild(h('div.stream.placeholder', h('div.addon-name'), h('div.description', h('div'), h('div'))));
      }
    } else {
      playable.slice(0, limit).forEach((r) => container.appendChild(r));
      if (playable.length > limit) {
        container.appendChild(h('div.section-toggle.focusable', {
          onclick: () => { limit += PAGE * 2; render(); }
        }, 'Show more (' + (playable.length - limit) + ' left)'));
      }
      if (!playable.length) container.appendChild(h('div.message', 'None of these streams can play on this TV.'));
      if (unplayable.length) {
        container.appendChild(h('div.section-toggle.focusable', {
          onclick: () => { showUnplayable = !showUnplayable; render(); }
        }, (showUnplayable ? 'Hide' : 'Show') + ' streams this TV can’t play (' + unplayable.length + ')'));
        if (showUnplayable) unplayable.forEach((r) => container.appendChild(r));
      }
    }
    if (loading && ready.length) {
      container.appendChild(h('div.addons-loading', loading + (loading === 1 ? ' addon is' : ' addons are') + ' still loading',
        h('div.bar')));
    }
    // Put focus on the first stream once there is one, unless the user is elsewhere
    // (the top bar's back button doesn't count: it only has focus by default).
    const cur = Nav.current();
    if (Router.top() && Router.top().el.contains(self.el) &&
        (!cur || !document.body.contains(cur) || (hadFocus && !container.contains(cur)) || cur.classList.contains('back-button'))) {
      Nav.focusFirst(container);
    }
  }

  self.setMeta = (m, v) => { meta = m; video = v || video; renderHeader(); };
  self.refreshProgress = () => { if (rowCache) rowCache.clear(); render(); };
  self.destroy = () => { alive = false; };
  render();
  return self;
}
