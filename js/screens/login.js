// Sign in by entering a short code on link.stremio.com from a phone, so nobody has
// to type a password with the remote. Email/password is the fallback.

function LoginScreen() {
  const screen = {};
  let pollTimer = null, alive = true;

  const codeEl = h('div.link-code', '....');
  const qr = h('img.link-qr', { alt: '' });
  const status = h('div.login-status', 'Getting a code...');

  const emailInput = h('input.text-input.focusable', { type: 'email', placeholder: 'Email' });
  const passInput = h('input.text-input.focusable', { type: 'password', placeholder: 'Password' });
  const formStatus = h('div.login-status');
  const form = h('div.login-form', { style: 'display:none', 'data-nav-group': '' },
    emailInput, passInput, UI.pill('Log in', submit, 'green'), formStatus);

  screen.el = h('div.screen.login-page',
    h('div.login-box',
      h('h1', 'Log in to Stremio'),
      h('div.login-cols',
        h('div.login-link',
          h('div.login-step', 'On your phone or computer, open'),
          h('div.link-url', 'link.stremio.com'),
          h('div.login-step', 'and enter this code:'),
          codeEl, status),
        h('div.login-qr', qr, h('div.login-step', 'or scan'))),
      h('div', { 'data-nav-group': '' },
        UI.pill('Use email and password', () => { form.style.display = ''; Nav.focus(emailInput); }),
        UI.pill('Continue without an account', () => { store.set('guest', true); App.start(); })),
      form));

  function startLink() {
    Api.linkCreate().then((res) => {
      if (!alive) return;
      codeEl.textContent = res.code;
      qr.src = res.qrcode;
      status.textContent = 'Waiting for you to log in...';
      poll(res.code, Date.now());
    }, (e) => {
      status.textContent = 'Could not get a code: ' + e.message;
      devlog('link create failed', e);
    });
  }

  function poll(code, startedAt) {
    pollTimer = setTimeout(() => {
      if (!alive) return;
      // Codes expire; fetch a fresh one every ten minutes.
      if (Date.now() - startedAt > 10 * 60 * 1000) { startLink(); return; }
      Api.linkRead(code).then((authKey) => {
        if (!alive) return;
        if (!authKey) { poll(code, startedAt); return; }
        status.textContent = 'Logged in! Loading your addons...';
        Api.finishLink(authKey).then(() => App.start());
      }, () => poll(code, startedAt));
    }, 3000);
  }

  function submit() {
    const email = emailInput.value.trim(), password = passInput.value;
    if (!email || !password) { formStatus.textContent = 'Enter your email and password.'; return; }
    formStatus.textContent = 'Logging in...';
    Api.login(email, password).then(() => App.start(), (e) => {
      formStatus.textContent = e.message || 'Login failed';
    });
  }

  passInput.onkeydown = (e) => { if (e.keyCode === 13) submit(); };

  screen.onShow = startLink;
  screen.onDestroy = () => { alive = false; clearTimeout(pollTimer); };
  return screen;
}
