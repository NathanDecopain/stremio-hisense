// Library (stremio-web's Library route): type dropdown, sort chips, 6-column grid.

function LibraryScreen() {
  const screen = { persistent: true };
  let type = null, sort = 'lastwatched';
  const SORTS = [
    ['lastwatched', 'last watched'], ['a-z', 'a-z'], ['z-a', 'z-a'],
    ['timeswatched', 'most watched'], ['watched', 'watched'], ['notwatched', 'not watched']
  ];
  const filters = h('div.filter-bar', { 'data-nav-group': '' });
  const grid = h('div.library-grid.scroll-y', { 'data-nav-group': '' });
  screen.el = UI.mainPage('library', h('div.library-page', filters, grid));

  function sorted(items) {
    const name = (it) => (it.name || '').toLowerCase();
    const watched = (it) => !!(it.state && (it.state.flaggedWatched || it.state.timesWatched));
    const by = {
      lastwatched: (a, b) => ((b.state && b.state.lastWatched) || b._mtime) > ((a.state && a.state.lastWatched) || a._mtime) ? 1 : -1,
      'a-z': (a, b) => name(a).localeCompare(name(b)),
      'z-a': (a, b) => name(b).localeCompare(name(a)),
      timeswatched: (a, b) => ((b.state && b.state.timesWatched) || 0) - ((a.state && a.state.timesWatched) || 0)
    };
    let list = items.slice();
    if (sort === 'watched') list = list.filter(watched);
    if (sort === 'notwatched') list = list.filter((it) => !watched(it));
    return list.sort(by[sort] || by.lastwatched);
  }

  function render() {
    clear(filters);
    clear(grid);
    if (Api.isGuest()) {
      grid.appendChild(h('div.empty-message', icon('library'),
        h('div.label', 'Library is only available for logged in users'),
        h('div', { style: 'margin-top:2rem' }, UI.pill('Log in', () => Router.reset(LoginScreen()), 'green'))));
      return;
    }
    const all = Library.list();
    const types = [];
    all.forEach((it) => { if (types.indexOf(it.type) < 0) types.push(it.type); });
    filters.appendChild(UI.multiselect(type ? UI.typeLabel(type) : 'All', () => [{ label: 'All', value: null, selected: !type }]
      .concat(types.map((t) => ({ label: UI.typeLabel(t), value: t, selected: t === type }))), (o) => { type = o.value; render(); }));
    SORTS.forEach((s) => filters.appendChild(h('div.chip.focusable' + (s[0] === sort ? '.active' : ''), {
      onclick: () => { sort = s[0]; render(); Nav.focus(filters.querySelector('.chip.active')); }
    }, s[1])));
    const items = sorted(all.filter((it) => !type || it.type === type));
    if (!items.length) { grid.appendChild(UI.emptyMessage('Empty Library', 'library')); return; }
    items.forEach((it) => grid.appendChild(UI.metaItem(
      { id: it._id, type: it.type, name: it.name, poster: it.poster, posterShape: it.posterShape },
      {
        progress: it.state && it.state.duration ? it.state.timeOffset / it.state.duration : 0,
        watched: !!(it.state && it.state.flaggedWatched)
      })));
    Images.scan();
  }

  screen.refresh = render;
  screen.onShow = () => { if (!grid.firstChild) render(); };
  render();
  return screen;
}
