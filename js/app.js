// Boot, main tabs and sync. Tabs (Board, Discover, Library, Settings) are created once and
// kept alive; Back on any tab returns to Board, and Back on Board leaves the app.

const App = (function () {
  const tabs = {};
  const FACTORIES = { board: BoardScreen, discover: DiscoverScreen, library: LibraryScreen, settings: SettingsScreen };
  let currentTab = null;

  function sync() {
    return Promise.all([Addons.refresh(), Library.refresh()]);
  }

  function refreshTabs() {
    Object.keys(tabs).forEach((k) => { if (tabs[k].refresh) tabs[k].refresh(); });
  }

  function dropTabs() {
    Object.keys(tabs).forEach((k) => {
      const el = tabs[k].el;
      if (el.parentNode) el.parentNode.removeChild(el);
      delete tabs[k];
    });
    currentTab = null;
  }

  const App = {
    goTab(name, params) {
      if (!tabs[name]) tabs[name] = FACTORIES[name]();
      currentTab = name;
      Router.setRoot(tabs[name]);
      if (params && tabs[name].select) tabs[name].select(params);
    },

    openSearch() {
      if (Router.top() && Router.top().isSearch) return;
      const s = SearchScreen();
      s.isSearch = true;
      Router.push(s);
    },

    onRootBack() {
      if (currentTab && currentTab !== 'board') { App.goTab('board'); return true; }
      return false;
    },

    sync() {
      return sync().then(refreshTabs);
    },

    // After login or "continue without an account".
    start() {
      dropTabs();
      Router.reset({ el: h('div.screen', h('div.empty-message', h('div.label', 'Loading your addons...'))) });
      sync().then(null, (e) => {
        devlog('sync failed', e);
        toast('Could not reach Stremio (' + e.message + '). Showing saved data.', 5000);
      }).then(() => App.goTab('board'));
    },

    logout() {
      Api.logout();
      StreamsBucket.clear();
      dropTabs();
      Router.reset(LoginScreen());
    },

    boot() {
      // Measure the connection once, in the background, so streams can be ranked by it,
      // but only while browsing: during playback it would steal bandwidth from the video.
      const measureWhenIdle = () => {
        if (Speed.get()) return;
        if (Router.top() && Router.top().persistent) Speed.test(1, 15000000);
        else setTimeout(measureWhenIdle, 60000);
      };
      setTimeout(measureWhenIdle, 15000);
      if (store.get('auth', null) || store.get('guest', false)) {
        if (Addons.all().length) {
          // Show cached data immediately, then refresh in the background.
          App.goTab('board');
          sync().then(refreshTabs, (e) => devlog('background sync failed', e));
        } else {
          App.start();
        }
      } else {
        Router.reset(LoginScreen());
      }
    }
  };
  return App;
})();

// Running from the dev server: pick up remote switches (e.g. the video proxy diagnostic).
if (location.port === '8000') {
  getJSON('/dev-config', 5000).then((cfg) => {
    Object.keys(cfg || {}).forEach((k) => Prefs.set(k, cfg[k]));
    devlog('dev-config applied', cfg);
  }, () => {});
}

Router.init(document.getElementById('app'));
devlog('boot', location.href, 'window type:', window.__opera_window_type, 'history:', history.length);
App.boot();
