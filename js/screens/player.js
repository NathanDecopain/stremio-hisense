// Player (stremio-web's Player route) on a plain <video>: the TV decodes HEVC/EAC3/MKV
// itself. VIDAA exposes embedded audio and subtitle tracks through the standard
// audioTracks/textTracks APIs, the same way stremio-video's VidaaVideo uses them.
//
// opts: { meta, videoId, video, stream, addonUrl }
// Remote while the controls are hidden: Left/Right seek 10s, OK pause/play, Up/Down show
// controls. Media keys work any time. Back leaves the player.

function PlayerScreen(opts) {
  const screen = {};
  let meta = opts.meta, video = opts.video || null;
  const stream = opts.stream, videoId = opts.videoId;
  const SEEK = 10;

  const v = h('video.player-video', { preload: 'auto' });
  const stage = h('div', { style: 'position:absolute;left:0;top:0;right:0;bottom:0' }, v);
  const subs = new Subtitles.Overlay(stage, v);
  const bgLayer = h('div.player-bg');
  const buffering = h('div.buffering.show', meta.logo ? h('img', { src: meta.logo, alt: '' }) : icon('symbol'));
  const errorText = h('div.text');
  const errorLayer = h('div.player-error', errorText, UI.pill('Back', () => Router.back(), 'purple', 'chevron-back'));
  const indicator = h('div.indicator');
  const nextPopupSlot = h('div');

  const titleEl = h('div.title', '');
  const top = h('div.player-top', h('div.top-bar',
    h('div.back-button.focusable', { onclick: () => Router.back() }, icon('chevron-back')), titleEl));

  const elapsed = h('div.time', '--:--:--');
  const total = h('div.time', '--:--:--');
  const played = h('div.seek-played');
  const bufferedBar = h('div.seek-buffered');
  const thumb = h('div.seek-thumb');
  const seekBar = h('div.seek-bar.focusable', { onclick: seekFromPointer },
    h('div.seek-track', bufferedBar, played, thumb));
  const playBtn = h('div.control-button.focusable', { onclick: togglePlay }, icon('pause'));
  const nextBtn = h('div.control-button.focusable', { onclick: () => goNext(), style: 'display:none' }, icon('next'));
  const subsBtn = h('div.control-button.focusable.disabled', { onclick: openSubtitlesMenu }, icon('subtitles'));
  const audioBtn = h('div.control-button.focusable', { onclick: openAudioMenu, style: 'display:none' }, icon('audio-tracks'));
  const SCALES = [['fit', 'Fit', 'video-scale-fit'], ['cover', 'Crop', 'video-scale-crop'], ['fill', 'Stretch', 'video-scale-stretch']];
  let scale = 0;
  const scaleBtn = h('div.control-button.focusable', { onclick: cycleScale }, icon(SCALES[0][2]));
  const controlBar = h('div.control-bar',
    h('div.seek-row', elapsed, seekBar, total),
    h('div.control-buttons', { 'data-nav-group': '' }, playBtn, nextBtn, h('div.spacer'), subsBtn, audioBtn, scaleBtn));

  screen.el = h('div.screen.player', bgLayer, stage, buffering, errorLayer, top, controlBar, nextPopupSlot, indicator);

  let destroyed = false, immersed = false, hideTimer = null, saveTimer = null, lastTick = null;
  let tracks = [], currentTrack = null, state = {}, nextVideo = null, nextStream, popupDismissed = false;
  const timing = { start: Date.now(), waits: 0 };

  // ---------- Title / meta ----------
  function setTitle() {
    if (video) titleEl.textContent = meta.name + ' - ' + (video.name || video.title || 'Episode ' + video.episode) +
      ' (' + video.season + 'x' + video.episode + ')';
    else titleEl.textContent = meta.name || '';
    if (meta.background) bgLayer.style.backgroundImage = 'url("' + meta.background + '")';
  }

  function computeNext() {
    if (!meta.videos || !meta.videos.length || !video) return null;
    const vids = meta.videos.slice().sort((a, b) =>
      ((a.season === 0 ? 1e9 : a.season) - (b.season === 0 ? 1e9 : b.season)) || (a.episode - b.episode));
    const i = vids.findIndex((x) => x.id === videoId);
    const n = i >= 0 ? vids[i + 1] : null;
    if (!n) return null;
    if (n.released && new Date(n.released).getTime() > Date.now()) return null;
    if (n.season === 0 && video.season !== 0) return null; // don't roll into specials
    return n;
  }

  // Like stremio-core: ask only this stream's addon for the next episode, and take the
  // first result in the same bingeGroup.
  function findNextStream() {
    if (nextStream !== undefined || !nextVideo) return Promise.resolve(nextStream);
    const addon = Addons.all().filter((a) => a.transportUrl === opts.addonUrl)[0];
    if (!addon) { nextStream = null; return Promise.resolve(null); }
    return Addons.streamsFrom(addon, meta.type, nextVideo.id).then((list) => {
      nextStream = list.filter((s) => StreamsBucket.bingeMatch(s, stream) && Playability.check(s).ok)[0] || null;
      return nextStream;
    }, () => { nextStream = null; return null; });
  }

  function goNext() {
    if (!nextVideo || destroyed) return;
    saveProgress(true);
    findNextStream().then((ns) => {
      if (destroyed) return;
      Router.replace(ns
        ? PlayerScreen({ meta, videoId: nextVideo.id, video: nextVideo, stream: ns, addonUrl: opts.addonUrl })
        : DetailsScreen(meta.type, meta.id, { meta, videoId: nextVideo.id }));
    });
  }

  function onMeta() {
    if (video && meta.videos) video = meta.videos.filter((x) => x.id === videoId)[0] || video;
    setTitle();
    nextVideo = computeNext();
    nextBtn.style.display = nextVideo ? '' : 'none';
  }

  // ---------- Overlay visibility (3s auto-hide while playing, like stremio-web) ----------
  function showControls() {
    if (destroyed) return;
    immersed = false;
    screen.el.classList.remove('immersed');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideControls, 3000);
    if (!top.contains(Nav.current()) && !controlBar.contains(Nav.current()) && !nextPopupSlot.contains(Nav.current())) {
      Nav.focus(screen.lastFocus && controlBar.contains(screen.lastFocus) ? screen.lastFocus : playBtn);
    }
  }
  function hideControls() {
    if (destroyed || v.paused || errorLayer.classList.contains('show')) return;
    immersed = true;
    screen.el.classList.add('immersed');
  }

  function flash(text) {
    indicator.textContent = text;
    indicator.classList.add('show');
    clearTimeout(flash.t);
    flash.t = setTimeout(() => indicator.classList.remove('show'), 1000);
  }

  // ---------- Playback ----------
  function togglePlay() {
    if (v.paused) v.play(); else v.pause();
    showControls();
  }
  function seekBy(sec) {
    if (!isFinite(v.duration)) return;
    v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + sec));
    updateTime();
  }
  function seekFromPointer(e) {
    if (e.type !== 'click' || !isFinite(v.duration)) return showControls();
    const r = seekBar.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration;
    showControls();
  }
  function cycleScale() {
    scale = (scale + 1) % SCALES.length;
    v.className = 'player-video' + (scale ? ' fit-' + SCALES[scale][0] : '');
    clear(scaleBtn).appendChild(icon(SCALES[scale][2]));
    flash('Video scale: ' + SCALES[scale][1]);
    showControls();
  }

  function hms(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--:--';
    sec = Math.floor(sec);
    return pad2(Math.floor(sec / 3600)) + ':' + pad2(Math.floor(sec % 3600 / 60)) + ':' + pad2(sec % 60);
  }
  function updateTime() {
    const d = v.duration;
    elapsed.textContent = hms(v.currentTime);
    total.textContent = hms(d);
    const pct = isFinite(d) && d ? (v.currentTime / d) * 100 : 0;
    played.style.width = pct + '%';
    thumb.style.left = pct + '%';
    if (v.buffered.length && isFinite(d) && d) bufferedBar.style.width = (v.buffered.end(v.buffered.length - 1) / d) * 100 + '%';
  }

  // ---------- Progress sync ----------
  function saveProgress(force) {
    if (!isFinite(v.duration) || !v.duration || v.currentTime < 5) return;
    const now = Date.now();
    const delta = lastTick && !v.paused ? (now - lastTick) / 1000 : 0;
    lastTick = v.paused ? null : now;
    if (!force && !delta) return;
    Library.progress(meta, videoId, v.currentTime, v.duration, Math.min(delta, 60));
  }

  // ---------- Subtitles ----------
  function embeddedTracks() {
    const out = [];
    const tt = v.textTracks;
    if (!tt) return out;
    for (let i = 0; i < tt.length; i++) {
      if (tt[i].kind !== 'subtitles' && tt[i].kind !== 'captions') continue;
      out.push({ id: 'EMBEDDED_' + i, index: i, lang: Subtitles.normLang(tt[i].language), label: tt[i].label, origin: 'Embedded', embedded: true });
    }
    return out;
  }

  function loadExternal() {
    const hints = stream.behaviorHints || {};
    const extra = {};
    if (hints.videoHash) extra.videoHash = hints.videoHash;
    if (hints.videoSize) extra.videoSize = hints.videoSize;
    if (hints.filename) extra.filename = hints.filename;
    const fromStream = (stream.subtitles || []).map((s, i) => ({ id: s.url || 'S' + i, url: s.url, lang: Subtitles.normLang(s.lang), origin: 'Stream' }));
    return Addons.subtitles(meta.type, videoId, extra).then((list) => fromStream.concat(list.map((s) => ({
      id: s.id ? s.addon + ':' + s.id : s.url, url: s.url, lang: Subtitles.normLang(s.lang), origin: s.addon
    }))), () => fromStream);
  }

  function refreshTracks(external) {
    const ext = external || tracks.filter((t) => !t.embedded);
    tracks = embeddedTracks().concat(ext);
    subsBtn.classList.toggle('disabled', !tracks.length);
  }

  function disableEmbedded() {
    const tt = v.textTracks;
    if (tt) for (let i = 0; i < tt.length; i++) tt[i].mode = 'disabled';
  }

  function selectTrack(t, quiet) {
    currentTrack = t;
    state.subLang = t ? t.lang : null;
    state.subId = t ? t.id : null;
    StreamsBucket.updateState(meta.id, videoId, { subLang: state.subLang, subId: state.subId, subEmbedded: !!(t && t.embedded) });
    disableEmbedded();
    subs.off();
    if (!t) { if (!quiet) flash('Subtitles off'); return; }
    if (t.embedded) {
      const track = v.textTracks[t.index];
      track.mode = 'showing';
      // Draw embedded cues near the bottom, as VidaaVideo does.
      track.oncuechange = () => {
        const cues = track.cues || [];
        for (let i = 0; i < cues.length; i++) { cues[i].snapToLines = false; cues[i].line = 100 - (state.subOffset || 5); }
      };
      if (!quiet) flash(Subtitles.langName(t.lang) + ' subtitles');
      return;
    }
    getText(t.url, 20000).then((text) => {
      if (destroyed || currentTrack !== t) return;
      const cues = Subtitles.parse(text);
      if (!cues.length) { toast('That subtitle file was empty or unreadable'); return; }
      subs.load(cues);
      if (!quiet) flash(Subtitles.langName(t.lang) + ' subtitles');
    }, (e) => { toast('Could not load subtitles'); devlog('subtitle fetch failed', e.message); });
  }

  // stremio-web's default pick: the saved track, else the saved/preferred language,
  // embedded first then external.
  function pickDefaultTrack() {
    if (state.subId) {
      const saved = tracks.filter((t) => t.id === state.subId)[0];
      if (saved) return selectTrack(saved, true);
    }
    const lang = 'subLang' in state ? state.subLang : Prefs.get('subtitlesLanguage');
    if (!lang) return;
    const match = tracks.filter((t) => t.embedded && t.lang === lang)[0] || tracks.filter((t) => !t.embedded && t.lang === lang)[0];
    if (match) selectTrack(match, true);
  }

  function applySubStyle() {
    subs.setStyle(state.subSize || Prefs.get('subtitlesSize'), state.subOffset != null ? state.subOffset : Prefs.get('subtitlesOffset'));
    subs.delay = (state.subDelay || 0) / 1000;
  }

  function openSubtitlesMenu() {
    if (!tracks.length) return;
    const pref = Prefs.get('subtitlesLanguage');
    const langs = [];
    tracks.forEach((t) => { if (langs.indexOf(t.lang) < 0) langs.push(t.lang); });
    langs.sort((a, b) => ((b === pref) - (a === pref)) || Subtitles.langName(a).localeCompare(Subtitles.langName(b)));
    let shownLang = currentTrack ? currentTrack.lang : null;

    const langList = h('div.menu-list.scroll-y', { 'data-nav-group': '' });
    const variantList = h('div.menu-list.scroll-y', { 'data-nav-group': '' });
    const settingsList = h('div.menu-list');

    function option(main, origin, selected, onclick) {
      return h('div.menu-option.focusable' + (origin ? '.tall' : '') + (selected ? '.selected' : ''), { onclick },
        h('div.text', h('div.main', main), origin ? h('div.origin', origin) : null), selected ? h('div.dot') : null);
    }
    function renderLangs() {
      clear(langList);
      langList.appendChild(option('Off', null, !currentTrack, () => { selectTrack(null); shownLang = null; renderAll(); }));
      langs.forEach((l) => langList.appendChild(option(Subtitles.langName(l), null, currentTrack && currentTrack.lang === l, () => {
        shownLang = l;
        const variants = tracks.filter((t) => t.lang === l);
        selectTrack(variants.filter((t) => t.embedded)[0] || variants[0]);
        renderAll();
      })));
    }
    function renderVariants() {
      clear(variantList);
      if (!shownLang) { variantList.appendChild(h('div.menu-empty', 'Subtitles are disabled')); return; }
      tracks.filter((t) => t.lang === shownLang).forEach((t, i) => {
        variantList.appendChild(option(t.label || Subtitles.langName(t.lang) + ' ' + (i + 1), t.origin, t === currentTrack, () => { selectTrack(t); renderAll(); }));
      });
    }
    function renderSettings() {
      clear(settingsList);
      const external = currentTrack && !currentTrack.embedded;
      const delay = UI.stepper('Delay', () => (external ? ((state.subDelay || 0) / 1000).toFixed(1) + 's' : '--'), (d) => {
        if (!external) return;
        state.subDelay = (state.subDelay || 0) + d * 100;
        applySubStyle();
        StreamsBucket.updateState(meta.id, videoId, { subDelay: state.subDelay });
      });
      if (!external) delay.classList.add('disabled');
      settingsList.appendChild(delay);
      settingsList.appendChild(UI.stepper('Size', () => (state.subSize || Prefs.get('subtitlesSize')) + '%', (d) => {
        const sizes = Prefs.SUBTITLE_SIZES;
        const i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(state.subSize || Prefs.get('subtitlesSize')) + d));
        state.subSize = sizes[i];
        applySubStyle();
        StreamsBucket.updateState(meta.id, videoId, { subSize: state.subSize });
      }));
      settingsList.appendChild(UI.stepper('Vertical position', () => (state.subOffset != null ? state.subOffset : Prefs.get('subtitlesOffset')) + '%', (d) => {
        const cur = state.subOffset != null ? state.subOffset : Prefs.get('subtitlesOffset');
        state.subOffset = Math.max(0, Math.min(100, cur + d * 2));
        applySubStyle();
        StreamsBucket.updateState(meta.id, videoId, { subOffset: state.subOffset });
      }));
    }
    function renderAll() {
      const idx = Array.prototype.indexOf.call(menuEl.querySelectorAll('.focusable'), Nav.current());
      renderLangs(); renderVariants(); renderSettings();
      const all = menuEl.querySelectorAll('.focusable');
      if (idx >= 0 && all.length) Nav.focus(all[Math.min(idx, all.length - 1)]);
    }

    const menuEl = h('div.player-menu',
      h('div.menu-column', h('div.menu-header', 'Subtitles Languages'), langList),
      h('div.menu-column', h('div.menu-header', 'Subtitles Variants'), variantList),
      h('div.menu-column.settings-col', h('div.menu-header', 'Subtitles Settings'), settingsList));
    renderLangs(); renderVariants(); renderSettings();
    openMenu(menuEl, () => langList.querySelector('.selected') || langList.firstChild);
  }

  function openAudioMenu() {
    const at = v.audioTracks;
    if (!at || at.length < 2) return;
    const list = h('div.menu-list.scroll-y', { 'data-nav-group': '' });
    for (let i = 0; i < at.length; i++) (function (i) {
      const tr = at[i];
      list.appendChild(h('div.menu-option.tall.focusable' + (tr.enabled ? '.selected' : ''), {
        onclick: () => Router.back(() => selectAudio(i))
      }, h('div.text', h('div.main', Subtitles.langName(tr.language)), h('div.origin', tr.label || 'Track ' + (i + 1))),
      tr.enabled ? h('div.dot') : null));
    })(i);
    openMenu(h('div.player-menu', h('div.menu-column', h('div.menu-header', 'Audio Tracks'), list)),
      () => list.querySelector('.selected') || list.firstChild);
  }

  function selectAudio(i) {
    const at = v.audioTracks;
    for (let j = 0; j < at.length; j++) at[j].enabled = j === i;
    state.audioLang = Subtitles.normLang(at[i].language);
    StreamsBucket.updateState(meta.id, videoId, { audioLang: state.audioLang });
    flash('Audio: ' + Subtitles.langName(at[i].language));
  }

  function pickDefaultAudio() {
    const at = v.audioTracks;
    if (!at || at.length < 2) return;
    audioBtn.style.display = '';
    const want = state.audioLang || Prefs.get('audioLanguage');
    let enabled = -1, match = -1;
    for (let i = 0; i < at.length; i++) {
      if (at[i].enabled && enabled < 0) enabled = i;
      if (match < 0 && Subtitles.normLang(at[i].language) === want) match = i;
    }
    if (match >= 0 && match !== enabled) selectAudio(match);
  }

  function openMenu(menuEl, initial) {
    const layer = { overlay: true };
    layer.el = h('div.screen.player-menu-layer', { onclick: (e) => { if (e.target === layer.el) Router.back(); } }, menuEl);
    layer.onShow = () => { const el = initial(); if (el) Nav.focus(el); };
    clearTimeout(hideTimer);
    Router.push(layer);
  }

  // ---------- Next episode popup ----------
  function updateNextPopup() {
    const remaining = v.duration - v.currentTime;
    const lead = Prefs.get('nextVideoPopup') / 1000;
    const show = nextVideo && lead > 0 && !popupDismissed && remaining > 0 && remaining <= lead;
    if (show && !nextPopupSlot.firstChild) {
      findNextStream();
      const watch = UI.pill('Watch now', goNext, 'purple', 'play');
      nextPopupSlot.appendChild(h('div.next-popup.fade-in',
        h('div.next-thumb', { style: 'background-image:url("' + (nextVideo.thumbnail || meta.poster || '') + '")' }),
        h('div.next-info',
          h('div.next-heading', h('span', 'Next on '), meta.name),
          h('div.next-title', (nextVideo.name || nextVideo.title || 'Episode ' + nextVideo.episode) +
            ' (S' + nextVideo.season + 'E' + nextVideo.episode + ')'),
          h('div.next-buttons', { 'data-nav-group': '' },
            UI.pill('Dismiss', () => { popupDismissed = true; clear(nextPopupSlot); showControls(); }, null, 'close'),
            watch))));
      Nav.focus(watch);
    } else if (!show && nextPopupSlot.firstChild) {
      clear(nextPopupSlot);
    }
  }

  // ---------- Video events ----------
  v.addEventListener('timeupdate', () => {
    if (!immersed) updateTime();
    if (nextVideo) updateNextPopup();
  });
  v.addEventListener('waiting', () => {
    buffering.classList.add('show');
    timing.waits++;
    if (timing.playing && !timing.stallStart) timing.stallStart = Date.now();
  });
  v.addEventListener('playing', () => {
    buffering.classList.remove('show');
    bgLayer.classList.add('hidden');
    clear(playBtn).appendChild(icon('pause'));
    lastTick = Date.now();
    if (timing.stallStart) { timing.stalled = (timing.stalled || 0) + Date.now() - timing.stallStart; timing.stallStart = 0; }
    if (!timing.playing) {
      timing.playing = Date.now() - timing.start;
      devlog('player timing (ms): metadata', timing.metadata, 'first frame', timing.playing, 'host', (stream.url.match(/\/\/([^/]+)/) || [])[1]);
    }
    showControls();
  });
  v.addEventListener('pause', () => {
    if (destroyed) return;
    clear(playBtn).appendChild(icon('play'));
    saveProgress(true);
    showControls();
  });
  v.addEventListener('loadedmetadata', () => {
    timing.metadata = Date.now() - timing.start;
    const resume = opts.time != null ? opts.time : Library.resumeAt(meta.id, videoId);
    if (resume > 5 && resume < v.duration - 30) v.currentTime = resume;
    updateTime();
    refreshTracks();
    pickDefaultAudio();
  });
  if (v.textTracks) v.textTracks.onaddtrack = () => setTimeout(() => { refreshTracks(); if (!currentTrack) pickDefaultTrack(); }, 0);
  if (v.audioTracks) v.audioTracks.onaddtrack = () => setTimeout(pickDefaultAudio, 0);
  v.addEventListener('ended', () => {
    saveProgress(true);
    if (nextVideo && Prefs.get('bingeWatching')) goNext();
    else Router.back();
  });
  v.addEventListener('error', () => {
    buffering.classList.remove('show');
    const code = v.error ? v.error.code : 0;
    errorText.textContent = code === 3 || code === 4
      ? 'This TV can’t play this file’s format. Go back and choose a different stream.'
      : code === 2
        ? 'Network error. The link may have expired: go back and choose the stream again.'
        : 'Playback failed (error ' + code + '). Go back and choose a different stream.';
    errorLayer.classList.add('show');
    devlog('video error', code, 'after', Date.now() - timing.start, 'ms');
    Nav.focusFirst(errorLayer);
  });

  // ---------- Keys ----------
  screen.onKey = (e, k) => {
    const K = Nav.KEY;
    if (k === K.PLAY) { v.play(); showControls(); return true; }
    if (k === K.PAUSE) { v.pause(); return true; }
    if (k === K.PLAY_PAUSE) { togglePlay(); return true; }
    if (k === K.FF) { seekBy(SEEK * 3); flash(hms(v.currentTime)); return true; }
    if (k === K.RW) { seekBy(-SEEK * 3); flash(hms(v.currentTime)); return true; }
    if (k === K.STOP) { Router.back(); return true; }
    if (errorLayer.classList.contains('show')) return false;
    if (immersed && !nextPopupSlot.firstChild) {
      if (k === K.LEFT || k === K.RIGHT) { seekBy(k === K.LEFT ? -SEEK : SEEK); showControls(); Nav.focus(seekBar); return true; }
      if (k === K.ENTER) { togglePlay(); return true; }
      if (k === K.UP || k === K.DOWN) { showControls(); return true; }
      return false;
    }
    if (Nav.current() === seekBar && (k === K.LEFT || k === K.RIGHT)) {
      seekBy(k === K.LEFT ? -SEEK : SEEK); showControls(); return true;
    }
    showControls();
    return false;
  };

  screen.el.addEventListener('mousemove', debounce(showControls, 50));

  let started = false;
  screen.onShow = () => {
    if (!started) {
      started = true;
      setTitle();
      // Remember this stream; inherit subtitle/audio choices from the last one used here.
      const prev = StreamsBucket.last(meta, videoId);
      state = StreamsBucket.inheritState(prev, stream);
      StreamsBucket.save(meta, videoId, stream, opts.addonUrl, state);
      applySubStyle();
      // Diagnostic: route the video through the dev server, which logs every request.
      // Only in the TV's regular browser (opened via /app/?diag=1): when launched as an
      // installed app, the TV's video player can't reach devices on the home network.
      const viaPc = location.port === '8000' && /[?&]diag=1/.test(location.search);
      devlog('player start', (stream.name || '').replace(/\n/g, ' '), viaPc ? '(via PC)' : '(direct)', 'url length', stream.url.length);
      const startVideo = (src) => {
        if (destroyed) return;
        v.src = src;
        const p = v.play();
        if (p && p.catch) p.catch((e) => devlog('play() rejected', e.message));
      };
      // Dev-server experiments can swap in another video URL (Prefs.overrideSrc).
      const override = location.port === '8000' && Prefs.get('overrideSrc');
      if (override) { devlog('using override src', override); startVideo(override); }
      else if (viaPc) proxyUrl(stream).then((src) => { devlog('proxy src', src.replace(/\/proxy\/(\w+)\/.*/, '/proxy/$1/...')); startVideo(src); },
        (e) => { devlog('proxy register failed', e.message); startVideo(stream.url); });
      else startVideo(stream.url);
      setTimeout(() => devlog('after 3s: currentSrc set', !!v.currentSrc, 'networkState', v.networkState, 'readyState', v.readyState,
        v.error ? 'error ' + v.error.code : 'no error'), 3000);
      // While it's loading or stalled, report what the player is doing every 5 seconds.
      const status = setInterval(() => {
        if (destroyed) { clearInterval(status); return; }
        const stalled = !timing.playing || timing.stallStart;
        if (!stalled) return;
        const ahead = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
        devlog('player waiting: readyState', v.readyState, 'networkState', v.networkState,
          'at', Math.round(v.currentTime), 's, buffered ahead', ahead.toFixed(1), 's, since start', Math.round((Date.now() - timing.start) / 1000), 's');
      }, 5000);
      saveTimer = setInterval(() => saveProgress(false), 10000);
      loadExternal().then((ext) => {
        if (destroyed) return;
        refreshTracks(ext);
        if (!currentTrack) pickDefaultTrack();
      });
      if (meta.videos || meta.type !== 'series') onMeta();
      else Addons.meta(meta.type, meta.id).then((m) => { if (!destroyed) { meta = m; onMeta(); } }, () => {});
    }
    showControls();
  };

  // Dev-server proxy URL: registered first so the URL stays short (the TV's player hangs
  // on very long ones), ending in the file name because the player picks how to open a
  // video from the extension.
  function proxyUrl(s) {
    let name = (s.behaviorHints && s.behaviorHints.filename) || (s.url.split('?')[0].match(/[^/]+$/) || [''])[0];
    try { name = decodeURIComponent(name); } catch (e) { /* keep it encoded */ }
    name = (name || 'video.mkv').replace(/[^\w.\-]+/g, '_').slice(-60);
    if (!/\.(mkv|mp4|avi|webm|m4v|ts)$/i.test(name)) name += '.mkv';
    // Absolute: the TV may hand the raw src text to its hardware player, which can't
    // resolve a relative path.
    return postJSON('/proxy-register', { url: s.url }, 5000)
      .then((r) => location.protocol + '//' + location.host + '/proxy/' + r.id + '/' + name);
  }

  // Size of the file in bytes, from behaviorHints or the "💾 1.7 GB" in the description.
  function fileBytes() {
    const hints = stream.behaviorHints || {};
    if (hints.videoSize) return hints.videoSize;
    const m = String(stream.description || stream.title || '').match(/([\d.]+)\s*(GB|GiB|MB|MiB)\b/i);
    if (!m) return 0;
    return parseFloat(m[1]) * (/^G/i.test(m[2]) ? 1073741824 : 1048576);
  }

  screen.onDestroy = () => {
    const bytes = fileBytes();
    devlog('playback stats:', JSON.stringify({
      name: (stream.name || '').replace(/\n/g, ' '), firstFrameMs: timing.playing, stalls: timing.waits,
      stalledSec: Math.round(((timing.stalled || 0) + (timing.stallStart ? Date.now() - timing.stallStart : 0)) / 1000),
      watchedSec: Math.round(v.currentTime), sizeGB: bytes ? +(bytes / 1073741824).toFixed(2) : null,
      mbps: bytes && isFinite(v.duration) ? +((bytes * 8 / 1e6) / v.duration).toFixed(1) : null
    }));
    destroyed = true;
    saveProgress(true);
    clearInterval(saveTimer);
    clearTimeout(hideTimer);
    subs.destroy();
    v.pause();
    v.removeAttribute('src');
    v.load(); // releases the hardware decoder
  };

  return screen;
}
