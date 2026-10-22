// Shared UI pieces, modelled on stremio-web's components (MainNavBars, MetaRow, MetaItem,
// MultiselectMenu, ActionButton, Stepper...).

const UI = (function () {
  const TABS = [
    ['board', 'Board', 'home'],
    ['discover', 'Discover', 'discover'],
    ['library', 'Library', 'library'],
    ['settings', 'Settings', 'settings']
  ];

  function typeLabel(type) {
    return { movie: 'Movie', series: 'Series', channel: 'Channel', tv: 'TV', other: 'Other', anime: 'Anime' }[type] ||
      (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
  }

  // Top bar: logo (or back button on sub-pages), search pill, user button.
  function topBar(opts) {
    opts = opts || {};
    const bar = h('div.top-bar');
    if (opts.back) {
      bar.appendChild(h('div.back-button.focusable', { onclick: () => Router.back() }, icon('chevron-back')));
    } else {
      bar.appendChild(h('div.logo-container', h('img.logo', { src: 'icon.png', alt: '' })));
    }
    if (opts.title != null) bar.appendChild(h('div.title', opts.title));
    if (opts.search !== false && opts.title == null) {
      bar.appendChild(h('div.search-pill.focusable', { onclick: () => App.openSearch() },
        h('div.text' + (opts.query ? '.has-value' : ''), opts.query || 'Search'),
        icon('search')));
      bar.appendChild(h('div.spacer'));
    }
    if (opts.user !== false && opts.title == null) {
      bar.appendChild(h('div.user-button.focusable', { onclick: () => App.goTab('settings') }, icon('person-outline')));
    }
    return bar;
  }

  function sideBar(active) {
    return h('div.side-bar', { 'data-nav-group': '' }, TABS.map((t) => {
      const selected = t[0] === active;
      return h('div.nav-tab.focusable' + (selected ? '.selected' : ''), { onclick: () => App.goTab(t[0]) },
        icon(selected ? t[2] : t[2] + '-outline'), h('div.label', t[1]));
    }));
  }

  // A full main page: top bar + side bar + content.
  function mainPage(tab, content, topOpts) {
    return h('div.screen', topBar(topOpts), sideBar(tab), h('div.page', content));
  }

  function fallbackIcon(type) {
    return icon({ movie: 'movies', series: 'series', channel: 'channels', tv: 'tv' }[type] || 'symbol');
  }

  // Poster card (MetaItem). opts: progress (0..1), onclick, onPlay (Continue Watching), watched, onFocus
  function metaItem(meta, opts) {
    opts = opts || {};
    const shape = meta.posterShape === 'landscape' ? 'landscape' : meta.posterShape === 'square' ? 'square' : 'poster';
    const poster = h('div.poster-container',
      h('div.poster-fallback', fallbackIcon(meta.type)),
      Images.lazy('poster', meta.poster),
      opts.watched ? h('div.watched-icon-layer', icon('checkmark')) : null,
      opts.onPlay ? h('div.play-icon-layer', icon('play')) : null,
      opts.progress > 0 ? h('div.progress-bar', h('div', { style: 'width:' + Math.min(100, opts.progress * 100) + '%' })) : null);
    const el = h('div.meta-item.focusable.' + shape, {
      onclick: () => {
        if (opts.onPlay) return opts.onPlay(meta);
        if (opts.onclick) return opts.onclick(meta);
        Router.push(DetailsScreen(meta.type, meta.id, { preview: meta }));
      }
    }, poster, h('div.title-bar', h('div.title-label', meta.name || '')));
    if (opts.onFocus) el._onFocus = () => opts.onFocus(meta);
    return el;
  }

  function placeholderItems(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(h('div.meta-item.placeholder', h('div.poster-container'), h('div.title-bar', h('div.placeholder-block'))));
    }
    return out;
  }

  // Board row (MetaRow). setItems(cards) fills it; setMessage(text) shows an error.
  function metaRow(title, seeAll) {
    const items = h('div.row-items.scroll-x', { 'data-nav-group': '' }, placeholderItems(6));
    const el = h('div.board-row',
      h('div.row-header', h('div.title', title),
        seeAll ? h('div.see-all.focusable', { onclick: seeAll }, 'See All', icon('chevron-forward')) : null),
      items);
    el.setItems = (cards) => {
      clear(items);
      if (!cards.length) { el.style.display = 'none'; return; }
      el.style.display = '';
      append(items, cards);
      Images.scan();
    };
    el.setMessage = (text) => { clear(items); items.appendChild(h('div.row-message', text)); };
    return el;
  }

  function emptyMessage(text, iconName) {
    return h('div.empty-message', icon(iconName || 'symbol'), h('div.label', text));
  }

  function actionButton(iconName, label, onclick, cls) {
    return h('div.action-button.focusable' + (label ? '.wide' : '') + (cls ? '.' + cls : ''),
      { onclick }, icon(iconName), label ? h('div.label', label) : null);
  }

  function pill(label, onclick, cls, iconName) {
    return h('div.pill-button.focusable' + (cls ? '.' + cls : ''), { onclick }, iconName ? icon(iconName) : null, label);
  }

  // Dropdown trigger (MultiselectMenu). getOptions() -> [{label, sub, selected, ...}]
  function multiselect(title, getOptions, onSelect) {
    const label = h('div.label', title);
    const el = h('div.multiselect.focusable', {
      onclick: () => dropdown(el, getOptions(), onSelect)
    }, label, icon('caret-down'));
    el.setTitle = (t) => { label.textContent = t; };
    return el;
  }

  // Opens a list under `anchor` as an overlay screen. Back or a choice closes it.
  function dropdown(anchor, options, onSelect) {
    const r = anchor.getBoundingClientRect();
    const list = h('div.dropdown.scroll-y', { 'data-nav-group': '' });
    const width = Math.max(r.width, 220);
    const left = Math.max(10, Math.min(r.left, window.innerWidth - width - 10));
    list.style.cssText = 'left:' + left + 'px;width:' + width + 'px;';
    const below = window.innerHeight - r.bottom - 10;
    if (below > 200) list.style.top = (r.bottom + 4) + 'px';
    else list.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    list.style.maxHeight = Math.min(294, Math.max(below, r.top - 10)) + 'px';
    options.forEach((o) => {
      list.appendChild(h('div.dropdown-option.focusable' + (o.selected ? '.selected' : ''), {
        onclick: () => Router.back(() => onSelect(o))
      }, h('div.label', Emoji.render(o.label)), o.sub ? h('div.sub', Emoji.render(o.sub)) : null, o.selected ? h('div.dot') : null));
    });
    const screen = { overlay: true };
    screen.el = h('div.screen.dropdown-layer', { onclick: (e) => { if (e.target === screen.el) Router.back(); } }, list);
    screen.onShow = () => {
      const sel = list.querySelector('.selected') || list.firstChild;
      if (sel) Nav.focus(sel);
    };
    Router.push(screen);
  }

  function stepper(title, getValue, onStep) {
    const value = h('div.value', getValue());
    const step = (d) => { onStep(d); value.textContent = getValue(); };
    return h('div',
      h('div.stepper-title', title),
      h('div.stepper', { 'data-nav-group': '' },
        h('div.step.focusable', { onclick: () => step(-1) }, icon('remove')),
        value,
        h('div.step.focusable', { onclick: () => step(1) }, icon('add'))));
  }

  function toggle(checked) { return h('div.toggle' + (checked ? '.checked' : '')); }

  return {
    TABS, typeLabel, topBar, sideBar, mainPage, metaItem, placeholderItems, metaRow,
    emptyMessage, actionButton, pill, multiselect, dropdown, stepper, toggle, fallbackIcon
  };
})();
