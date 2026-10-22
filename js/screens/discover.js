// Discover: Type / Catalog / Genre dropdowns, a 4-column grid and a preview panel for the
// focused item (stremio-web's Discover). OK on a poster opens its details.

function DiscoverScreen() {
  const screen = { persistent: true };
  let type = null, sel = null, genre = null, metas = [], loadingMore = false, exhausted = false, seq = 0;

  const filters = h('div.filter-bar', { 'data-nav-group': '' });
  const grid = h('div.grid.scroll-y', { 'data-nav-group': '' });
  const preview = h('div.discover-preview');
  screen.el = UI.mainPage('discover', h('div.discover', h('div.discover-catalog', filters, grid), preview));

  function catalogs() {
    return Addons.boardCatalogs().filter((c) => !Addons.hasRequiredExtra(c.cat));
  }
  function types() {
    const out = [];
    catalogs().forEach((c) => { if (out.indexOf(c.cat.type) < 0) out.push(c.cat.type); });
    return out;
  }
  function catsOfType(t) { return catalogs().filter((c) => c.cat.type === t); }
  const catName = (c) => (c.cat.name || c.cat.id);
  // boardCatalogs() builds new objects each call, so compare catalogs by key.
  const catKey = (c) => c && c.addon.transportUrl + '|' + c.cat.type + '|' + c.cat.id;
  const same = (a, b) => !!a && !!b && catKey(a) === catKey(b);

  function renderFilters() {
    clear(filters);
    filters.appendChild(UI.multiselect(UI.typeLabel(type), () => types().map((t) => ({
      label: UI.typeLabel(t), value: t, selected: t === type
    })), (o) => { type = o.value; sel = catsOfType(type)[0] || null; genre = null; reload(); }));
    filters.appendChild(UI.multiselect(sel ? catName(sel) : 'Catalog', () => catsOfType(type).map((c) => ({
      label: catName(c), sub: c.addon.manifest.name, value: c, selected: same(c, sel)
    })), (o) => { sel = o.value; genre = null; reload(); }));
    const genres = sel ? Addons.extraOptions(sel.cat, 'genre') : [];
    if (genres.length) {
      filters.appendChild(UI.multiselect(genre || 'Genre', () => [{ label: 'None', value: null, selected: !genre }].concat(
        genres.map((g) => ({ label: g, value: g, selected: g === genre }))), (o) => { genre = o.value; reload(); }));
    }
  }

  function showPreview(m) {
    clear(preview);
    if (!m) return;
    preview.appendChild(h('div.preview-bg', { style: m.poster ? 'background-image:url("' + Images.sized(m.poster) + '")' : '' }));
    const content = h('div.preview-content');
    content.appendChild(m.logo ? h('img.preview-logo', { src: m.logo, alt: '', onerror: function () { this.replaceWith ? this.replaceWith(h('div.preview-name', m.name || '')) : (this.style.display = 'none'); } })
      : h('div.preview-name', m.name || ''));
    content.appendChild(h('div.runtime-info',
      m.runtime ? h('div.item', m.runtime) : null,
      m.releaseInfo ? h('div.item', String(m.releaseInfo)) : null,
      m.imdbRating ? h('div.imdb', h('div.item', String(m.imdbRating)), icon('imdb')) : null));
    content.appendChild(h('div.preview-desc', m.description || ''));
    preview.appendChild(content);
  }

  function addItems(list) {
    list.forEach((m) => {
      grid.appendChild(UI.metaItem(m, {
        onFocus: (meta) => {
          showPreview(meta);
          // Load the next page when focus gets near the end.
          if (metas.indexOf(meta) > metas.length - 9) loadMore();
        }
      }));
    });
    Images.scan();
  }

  function reload() {
    renderFilters();
    clear(grid);
    clear(preview);
    metas = [];
    exhausted = false;
    if (!sel) { grid.appendChild(UI.emptyMessage('No catalog selected!', 'discover')); return; }
    grid.appendChild(h('div', UI.placeholderItems(8)));
    const mine = ++seq;
    Addons.catalog(sel.addon, sel.cat, genre ? { genre } : null).then((list) => {
      if (mine !== seq) return;
      clear(grid);
      metas = list;
      if (!list.length) { grid.appendChild(UI.emptyMessage('Nothing in this catalog.')); return; }
      addItems(list);
      showPreview(list[0]);
    }, (e) => {
      if (mine !== seq) return;
      clear(grid);
      grid.appendChild(UI.emptyMessage(e.message));
    });
  }

  function loadMore() {
    if (loadingMore || exhausted || !sel || !Addons.supportsExtra(sel.cat, 'skip')) return;
    loadingMore = true;
    const mine = seq;
    const extra = { skip: metas.length };
    if (genre) extra.genre = genre;
    Addons.catalog(sel.addon, sel.cat, extra).then((list) => {
      loadingMore = false;
      if (mine !== seq) return;
      const fresh = list.filter((m) => !metas.some((x) => x.id === m.id));
      if (!fresh.length) { exhausted = true; return; }
      metas = metas.concat(fresh);
      addItems(fresh);
    }, () => { loadingMore = false; });
  }

  // Called by App.goTab('discover', {addon, cat}) from a board row's "See All".
  screen.select = (params) => {
    const cats = catalogs();
    const match = params && cats.filter((c) => c.addon.transportUrl === params.addon.transportUrl && c.cat.id === params.cat.id && c.cat.type === params.cat.type)[0];
    if (match) { sel = match; type = match.cat.type; genre = null; reload(); return true; }
    return false;
  };

  screen.refresh = () => {
    if (!sel || !catalogs().some((c) => same(c, sel))) {
      type = types()[0] || null;
      sel = type ? catsOfType(type)[0] : null;
    }
    reload();
  };

  screen.refresh();
  return screen;
}
