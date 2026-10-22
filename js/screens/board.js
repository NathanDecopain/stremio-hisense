// Board (home): Continue Watching, then one row per catalog without required extras,
// in addon install order then manifest order (stremio-core's board model).

function BoardScreen() {
  const screen = { persistent: true };
  const rows = h('div');
  const continueRow = UI.metaRow('Continue Watching');
  const content = h('div.board-content.scroll-y', continueRow, rows);
  screen.el = UI.mainPage('board', content);

  let continueSig = null;
  function fillContinue() {
    const items = Library.continueWatching().slice(0, 20);
    // Rebuilding drops the focused card, so only do it when something changed.
    const sig = items.map((it) => it._id + '@' + it.state.timeOffset + '@' + it.state.video_id).join('|');
    if (sig === continueSig) return;
    continueSig = sig;
    continueRow.setItems(items.map((it) => {
      const s = it.state;
      const meta = { id: it._id, type: it.type, name: it.name, poster: it.poster,
        posterShape: it.posterShape === 'landscape' ? 'square' : it.posterShape };
      const last = StreamsBucket.get(it._id, s.video_id);
      const videoId = s.video_id || it._id;
      return UI.metaItem(meta, {
        progress: s.duration ? s.timeOffset / s.duration : 0,
        // With a remembered stream, resume straight into the player.
        onPlay: last && last.stream.url ? () => Router.push(PlayerScreen({
          meta, videoId, stream: last.stream, addonUrl: last.addonUrl
        })) : null,
        onclick: () => Router.push(DetailsScreen(meta.type, meta.id, {
          preview: meta, videoId: it.type === 'series' ? s.video_id : null
        }))
      });
    }));
  }

  function catalogTitle(c) {
    return (c.cat.name || c.cat.id) + ' - ' + UI.typeLabel(c.cat.type);
  }

  function loadCatalogs() {
    clear(rows);
    const cats = Addons.boardCatalogs();
    if (!cats.length) {
      rows.appendChild(UI.emptyMessage('No catalogs. Install addons from stremio.com, then choose Sync in Settings.', 'addons'));
      return;
    }
    const rowEls = cats.map((c) => {
      const r = UI.metaRow(catalogTitle(c), () => App.goTab('discover', { addon: c.addon, cat: c.cat }));
      rows.appendChild(r);
      return r;
    });
    // Top rows first; the TV's CPU and network don't like 20 parallel catalogs.
    // 10 per row like stremio-web's CATALOG_PREVIEW_SIZE; "See All" opens the rest.
    const t0 = Date.now();
    mapLimit(cats, 3, (c, i) => Addons.catalog(c.addon, c.cat).then((metas) => {
      rowEls[i].setItems(metas.slice(0, 10).map((m) => UI.metaItem(m)));
      if (i === 0) devlog('board: first row after', Date.now() - t0, 'ms;', Math.round(performance.now()), 'ms since app start');
    }, (e) => {
      // Stremio hides empty catalogs and shows other errors in the row.
      devlog('catalog failed', c.addon.manifest.name, c.cat.id, e.message);
      if (/HTTP 404|empty/i.test(e.message)) rowEls[i].style.display = 'none';
      else rowEls[i].setMessage(e.message.indexOf('fetch') >= 0 ? 'Could not reach ' + c.addon.manifest.name : e.message);
    })).then(() => devlog('board: all rows after', Date.now() - t0, 'ms'));
  }

  screen.onShow = fillContinue;
  screen.refresh = () => { fillContinue(); loadCatalogs(); };

  loadCatalogs();
  return screen;
}
