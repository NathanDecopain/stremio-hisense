// Stremio account API (api.strem.io) and the "enter a code on your phone" login.

const Api = (function () {
  const BASE = 'https://api.strem.io/api/';
  const LINK = 'https://link.stremio.com/api/';

  function call(method, body) {
    return postJSON(BASE + method, body).then((res) => {
      if (res && res.error) {
        const err = new Error(res.error.message || 'API error');
        err.code = res.error.code;
        throw err;
      }
      return res ? res.result : null;
    });
  }

  function auth() { return store.get('auth', null); }

  function requireKey() {
    const a = auth();
    if (!a || !a.authKey) return Promise.reject(new Error('Not signed in'));
    return Promise.resolve(a.authKey);
  }

  function saveAuth(result) {
    store.set('auth', { authKey: result.authKey, user: result.user || null });
    return result;
  }

  return {
    auth,
    isGuest() { return !auth(); },

    login(email, password) {
      return call('login', { type: 'Login', email, password, facebook: false }).then(saveAuth);
    },

    // Phone login: show `code`/`qrcode`, then poll linkRead until it yields an authKey.
    linkCreate() {
      return getJSON(LINK + 'v2/create?type=Create').then((res) => res.result);
    },
    linkRead(code) {
      return getJSON(LINK + 'read?type=Read&code=' + encodeURIComponent(code)).then((res) => {
        if (res && res.result && res.result.authKey) return res.result.authKey;
        return null;
      });
    },
    finishLink(authKey) {
      store.set('auth', { authKey, user: null });
      return call('getUser', { type: 'GetUser', authKey }).then((user) => {
        store.set('auth', { authKey, user });
        return user;
      }, () => null);
    },

    logout() {
      const a = auth();
      store.remove('auth');
      store.remove('guest');
      store.remove('addons');
      store.remove('library');
      if (a) call('logout', { type: 'Logout', authKey: a.authKey }).catch(() => {});
    },

    addonCollection() {
      return requireKey().then((authKey) =>
        call('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: true }))
        .then((r) => r.addons || []);
    },

    libraryGetAll() {
      return requireKey().then((authKey) =>
        call('datastoreGet', { authKey, collection: 'libraryItem', ids: [], all: true }));
    },

    libraryPut(items) {
      return requireKey().then((authKey) =>
        call('datastorePut', { authKey, collection: 'libraryItem', changes: items }));
    }
  };
})();
