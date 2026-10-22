// Search: an on-screen keyboard (works with the D-pad and the pointer, and avoids VIDAA's
// slow system keyboard), recent searches, and one result row per searchable catalog.

function SearchScreen() {
  const screen = {};
  let query = '', seq = 0;
  const HISTORY_MAX = 8;

  const results = h('div.board-content');
  const keys = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
  const keyboard = h('div.keyboard', { 'data-nav-group': '' },
    keys.map((k) => h('div.key.focusable', { onclick: () => type(k) }, k.toUpperCase())),
    h('div.key.wide.focusable', { onclick: () => type(' ') }, 'Space'),
    h('div.key.focusable', { onclick: () => { query = query.slice(0, -1); changed(); } }, icon('chevron-back')),
    h('div.key.wide.focusable', { onclick: () => { query = ''; changed(); } }, 'Clear'));
  const history = h('div.search-history', { 'data-nav-group': '' });

  const page = h('div.search-page',
    h('div.search-keyboard-col.scroll-y', keyboard, history),
    h('div.search-results.scroll-y', results));
  const shell = h('div.screen');
  screen.el = shell;

  function renderShell() {
    clear(shell);
    append(shell, [UI.topBar({ query: query || 'Type to search' }), UI.sideBar(null), h('div.page', page)]);
  }

  function renderHistory() {
    clear(history);
    const items = store.get('searchHistory', []);
    if (!items.length) return;
    history.appendChild(h('div.overline', 'Search History'));
    items.forEach((q) => history.appendChild(h('div.history-item.focusable', { onclick: () => { query = q; changed(true); } }, q)));
    history.appendChild(h('div.history-item.focusable', { style: 'opacity:.5', onclick: () => { store.set('searchHistory', []); renderHistory(); } }, 'Clear history'));
  }

  function remember(q) {
    const items = store.get('searchHistory', []).filter((x) => x !== q);
    items.unshift(q);
    store.set('searchHistory', items.slice(0, HISTORY_MAX));
  }

  function type(ch) { query += ch; changed(); }

  function changed(now) {
    const pill = shell.querySelector('.search-pill .text');
    if (pill) { pill.textContent = query || 'Type to search'; pill.classList.toggle('has-value', !!query); }
    if (now) run.now(); else run();
  }

  function doSearch() {
    const q = query.trim();
    const mine = ++seq;
    clear(results);
    if (q.length < 2) return;
    remember(q);
    const cats = Addons.searchCatalogs();
    if (!cats.length) { results.appendChild(UI.emptyMessage('None of your addons support search.', 'search')); return; }
    const rows = cats.map((c) => {
      const r = UI.metaRow(UI.typeLabel(c.cat.type) + ' - ' + c.addon.manifest.name);
      results.appendChild(r);
      return r;
    });
    cats.forEach((c, i) => {
      Addons.catalog(c.addon, c.cat, { search: q }).then((metas) => {
        if (mine === seq) rows[i].setItems(metas.slice(0, 20).map((m) => UI.metaItem(m)));
      }, () => { if (mine === seq) rows[i].style.display = 'none'; });
    });
  }
  const run = debounce(doSearch, 700);
  run.now = doSearch;

  // Physical or system keyboards that send key events still work.
  screen.onKey = (e, k) => {
    if (k >= 65 && k <= 90) { type(String.fromCharCode(k + 32)); return true; }
    if (k >= 48 && k <= 57 && !e.shiftKey) { type(String.fromCharCode(k)); return true; }
    return false;
  };

  let shown = false;
  screen.onShow = () => {
    renderHistory();
    if (!shown) { shown = true; Nav.focus(keyboard.querySelector('.key')); }
  };

  renderShell();
  return screen;
}
