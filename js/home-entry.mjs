// The ordinary root is Routes. Existing public index links still use the
// original resolver in this document: no copied query, redirect or replacement
// geometry, and no loss of revision / retired-placeholder recovery.
const q = new URLSearchParams(location.search);
const legacy = ['area','view','day','variant','route','rev','chapter','at','week','goal','cue']
  .some(key=>q.has(key)) || /^#seek(?:-|$)/.test(location.hash) || location.hash === '#sensitivity';
if (legacy) {
  const css = document.createElement('link');
  css.rel = 'stylesheet';css.href = new URL('../assets/site.css',import.meta.url);
  document.querySelector('link[data-rider-style]')?.remove();
  document.head.append(css);
  document.body.innerHTML = '<a class="skip" href="#site-heading">Skip to main content</a><main id="main"><div id="site-shell"></div></main>';
  await import('./site-shell.mjs');
} else {
  await import('../prototypes/rider-first/app.mjs');
  // Keep the existing opt-in/update/withdrawal contract on the real homepage,
  // below the hero, not a second cache implementation or automatic save.
  const { installOffline } = await import('./offline-view.mjs');
  installOffline(document.getElementById('home-tools'));
}
