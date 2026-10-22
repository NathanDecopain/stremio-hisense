// Settings (stremio-web's Settings route): a section menu on the left, options on the right.

function SettingsScreen() {
  const screen = { persistent: true };
  const menu = h('div.settings-menu', { 'data-nav-group': '' });
  const content = h('div.settings-content.scroll-y');
  screen.el = UI.mainPage('settings', h('div.settings-page', menu, content));

  const SUB_LANGS = ['eng', 'spa', 'fre', 'ger', 'ita', 'por', 'pob', 'dut', 'pol', 'rus', 'ara', 'tur', 'swe', 'dan', 'fin', 'nor', 'gre', 'heb', 'hun', 'cze', 'rum', 'chi', 'jpn', 'kor', 'hin', 'ukr'];
  const sections = {};

  function option(label, control, sub) {
    return h('div.option', h('div.option-label', label, sub ? h('div.sub', sub) : null), h('div.option-control', control));
  }

  function prefSelect(key, choices, fmt) {
    return UI.multiselect(fmt(Prefs.get(key)), () => choices.map((c) => ({ label: fmt(c), value: c, selected: c === Prefs.get(key) })),
      (o) => { Prefs.set(key, o.value); render(); });
  }

  function prefToggle(key) {
    const t = UI.toggle(Prefs.get(key));
    return h('div.option-toggle.focusable', { onclick: () => { Prefs.set(key, !Prefs.get(key)); t.classList.toggle('checked', Prefs.get(key)); } }, t);
  }

  function section(id, title, children) {
    const el = h('div.settings-section', { 'data-nav-group': '' }, h('h2', title), children);
    sections[id] = el;
    return el;
  }

  function build() {
    clear(content);
    const auth = Api.auth();
    const email = auth && auth.user && auth.user.email;
    content.appendChild(section('general', 'General', [
      option(auth ? (email || 'Signed in') : 'Anonymous user',
        auth ? UI.pill('Log out', () => App.logout()) : UI.pill('Log in', () => Router.reset(LoginScreen()), 'green')),
      option('Sync addons and library', UI.pill('Sync now', () => {
        toast('Syncing...');
        App.sync().then(() => toast('Synced'), (e) => toast('Sync failed: ' + e.message));
      }), 'After installing or removing addons on stremio.com'),
      option('TV home screen', typeof window.Hisense_installApp === 'function'
        ? UI.pill('Install icon', installToLauncher, 'green', 'add')
        : h('div', { style: 'opacity:.5' }, 'Only on a Hisense VIDAA TV'),
      'Adds Stremio to the TV’s app list so it opens like Netflix')
    ]));

    const langName = (l) => (l ? Subtitles.langName(l) : 'Off');
    content.appendChild(section('player', 'Player', [
      option('Subtitles language', prefSelect('subtitlesLanguage', [null].concat(SUB_LANGS), langName)),
      option('Subtitles size', prefSelect('subtitlesSize', Prefs.SUBTITLE_SIZES, (s) => s + '%')),
      option('Default audio track', prefSelect('audioLanguage', SUB_LANGS, langName)),
      option('Connection speed: ' + (Speed.get() ? Speed.get() + ' Mbit/s' : 'not measured'),
        UI.pill('Test now', () => {
          toast('Testing the connection (about 20 seconds)...', 20000);
          Speed.test(2, 20000000).then((m) => { toast(m ? 'This TV gets about ' + Math.round(m) + ' Mbit/s' : 'Speed test failed'); render(); });
        }), 'Streams too big for this speed are listed after the ones that play smoothly'),
      option('Auto play next episode', prefToggle('bingeWatching')),

      option('Next episode popup', prefSelect('nextVideoPopup', [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 45000, 60000, 90000],
        (ms) => (ms ? ms / 1000 + ' seconds before the end' : 'Off')))
    ]));

    const addons = Addons.all();
    content.appendChild(section('addons', 'Addons', [
      h('div', { style: 'opacity:.6;margin-bottom:1.5rem' }, 'Install or remove addons on stremio.com, then use Sync now. Addons that only work with the desktop app (Local Files) are hidden.'),
      addons.map((a) => h('div.addon-row',
        a.manifest.logo ? h('img', { src: a.manifest.logo, alt: '', onerror: function () { this.style.visibility = 'hidden'; } }) : null,
        h('div', h('div.name', Emoji.render(a.manifest.name + '  ' + (a.manifest.version || ''))), h('div.desc', Emoji.render(a.manifest.description || '')))))
    ]));

    content.appendChild(section('about', 'About', [
      h('div', { style: 'opacity:.6;line-height:1.8em;margin-bottom:2rem' },
        'A lightweight Stremio client for Hisense VIDAA TVs, recreating stremio-web (GPL-2.0). ',
        'Font: Plus Jakarta Sans (SIL OFL 1.1). Icons: Stremio icons (MIT). Emoji: Twemoji (CC-BY 4.0).')
    ]));
  }

  function buildMenu(selected) {
    clear(menu);
    [['general', 'General'], ['player', 'Player'], ['addons', 'Addons'], ['about', 'About']].forEach((m) => {
      menu.appendChild(h('div.menu-item.focusable' + (m[0] === selected ? '.selected' : ''), {
        onclick: () => { content.scrollTop = sections[m[0]].offsetTop - 20; buildMenu(m[0]); Nav.focusFirst(sections[m[0]]); }
      }, m[1]));
    });
  }

  // Re-rendering replaces every control, so keep focus on the same position.
  function render() {
    const cur = content.contains(Nav.current()) ? Nav.current() : screen.lastFocus;
    const before = Array.prototype.indexOf.call(content.querySelectorAll('.focusable'), cur);
    build();
    const after = content.querySelectorAll('.focusable');
    if (before >= 0 && after.length) Nav.focus(after[Math.min(before, after.length - 1)]);
  }

  screen.refresh = render;
  screen.onShow = () => { if (!content.firstChild) render(); };
  buildMenu('general');
  build();
  return screen;
}

// Registers the app as a VIDAA launcher app, then asks the launcher to refresh the way
// the VIDAA store does. This firmware's signature is
// (appId, appName, thumbnail, iconSmall, iconBig, appUrl, callback).
function installToLauncher() {
  const appUrl = location.href.replace(/[#?].*$/, '').replace(/index\.html$/, '');
  const icon = appUrl + 'icon.png';
  const appId = 'stremio-hisense-port';
  const done = (status) => {
    devlog('installApp status', status, appUrl);
    try {
      (window.omi_platform || window.opera_omi).sendPlatformMessage(JSON.stringify({
        type: 'APPMessage', MsgType: 'appControl', action: 'updateAppState', source: 'browser', startAppType: 2,
        param: { event: 'AllAppsUpdate', SubModuleName: 'AllApps', startFrom: '', appInfo: appId }
      }));
    } catch (e) { devlog('launcher refresh failed', e.message); }
    toast('Stremio was added to your TV’s apps. If it doesn’t show, restart the TV.', 7000);
  };
  try {
    let called = false;
    window.Hisense_installApp(appId, 'Stremio', icon, icon, icon, appUrl, (status) => { called = true; done(status); });
    setTimeout(() => { if (!called) done('no callback'); }, 3000);
  } catch (e) {
    devlog('installApp threw', e.message);
    toast('Install failed: ' + e.message, 6000);
  }
}
