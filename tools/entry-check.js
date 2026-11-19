// Inlined only in releases. The entry itself carries the freshness marker:
// revalidate the ordinary cache key, even within Pages' HTML max-age.
addEventListener('pageshow', async () => {
  const here = new URL(location.href);
  const release = document.querySelector('meta[name="kotr-release"]').content;
  const key = '_kotr';
  if (here.searchParams.has(key)) {
    // At most one replacement, even if an edge serves unexpected HTML.
    if (here.searchParams.get(key) === release) {
      here.searchParams.delete(key);
      history.replaceState(history.state, '', here);
    }
    return;
  }
  try {
    const response = await fetch(here, {cache:'no-cache', mode:'same-origin'});
    if (!response.ok) return;
    const next = (await response.text()).match(/<meta name="kotr-release" content="([a-f0-9]{24})">/);
    if (!next || next[1] === release) return;
    here.searchParams.set(key, next[1]);
    location.replace(here);
  } catch {
    // Keep using the rendered page if the freshness probe can't reach Pages.
  }
});
