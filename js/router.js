// Screen stack. Each screen is an object with `el` and optional hooks:
//   onShow(), onHide(), onDestroy(), onKey(e, keyCode) -> true to swallow,
//   onBack() -> true if the screen handled Back itself (e.g. closing a panel).
// Main tabs are `persistent` roots: switching tabs hides them instead of destroying them.
// Hidden screens keep their DOM so going back restores scroll and focus.
// Browser history mirrors the stack so the TV's Back (in pointer mode) works too.

const Router = (function () {
  const stack = [];
  let container = null;
  let afterPop = null;

  function top() { return stack[stack.length - 1]; }

  function show(screen) {
    screen.el.style.display = '';
    Nav.setRoot(screen.el);
    Nav.setKeyHandler(screen.onKey ? screen.onKey.bind(screen) : null);
    if (screen.onShow) screen.onShow();
    Images.scan(); // images on a screen that was hidden couldn't load until now
    // onShow may have placed focus itself (e.g. after re-rendering); otherwise restore it.
    if (screen.el.contains(Nav.current())) return;
    if (screen.lastFocus && screen.el.contains(screen.lastFocus)) Nav.focus(screen.lastFocus);
    else Nav.focusFirst(screen.el.querySelector('.page') || screen.el); // content before the top bar
    if (!screen.el.contains(Nav.current())) Nav.focusFirst(screen.el);
  }

  function hide(screen) {
    screen.lastFocus = Nav.current();
    screen.el.style.display = 'none';
    if (screen.onHide) screen.onHide();
  }

  function destroy(screen) {
    if (screen.onDestroy) screen.onDestroy();
    if (screen.el.parentNode) screen.el.parentNode.removeChild(screen.el);
  }

  // Each history entry records the stack depth it belongs to, so one popstate can
  // unwind several screens (history.go(-n)) as well as one.
  function onPop(e) {
    const depth = Math.max(1, (e.state && e.state.depth) || 1);
    if (stack.length <= depth) return;
    while (stack.length > depth) destroy(stack.pop());
    show(top());
    const fn = afterPop;
    afterPop = null;
    if (fn) fn();
  }

  window.addEventListener('popstate', onPop);

  return {
    init(el) { container = el; },

    // An `overlay` screen (menus, pickers) draws over the previous one without hiding it.
    push(screen) {
      if (top() && screen.overlay) top().lastFocus = Nav.current();
      else if (top()) hide(top());
      stack.push(screen);
      container.appendChild(screen.el);
      history.pushState({ depth: stack.length }, '');
      show(screen);
    },

    // Make `screen` the root (a main tab), unwinding anything above the current root.
    setRoot(screen) {
      const swap = () => {
        const old = stack[0];
        if (old === screen) { show(screen); return; }
        if (old) { if (old.persistent) hide(old); else destroy(old); }
        stack[0] = screen;
        if (screen.el.parentNode !== container) container.appendChild(screen.el);
        history.replaceState({ depth: 1 }, '');
        show(screen);
      };
      if (stack.length > 1) { afterPop = swap; history.go(-(stack.length - 1)); }
      else swap();
    },

    // Replace the whole stack (e.g. after login).
    reset(screen) {
      while (stack.length) destroy(stack.pop());
      history.replaceState({ depth: 1 }, '');
      stack.push(screen);
      container.appendChild(screen.el);
      show(screen);
    },

    // Swap the top screen without adding history (e.g. next episode in the player).
    replace(screen) {
      if (stack.length) destroy(stack.pop());
      stack.push(screen);
      container.appendChild(screen.el);
      show(screen);
    },

    // Returns false at the root so the platform can exit the app. `then` runs after
    // the pop lands (history.back() is async).
    back(then) {
      if (!then && top() && top().onBack && top().onBack()) return true;
      if (stack.length <= 1) return typeof App !== 'undefined' && !!App.onRootBack();
      afterPop = then || null;
      history.back(); // popstate does the actual pop
      return true;
    },

    top
  };
})();
