// Shared pinned-SDK loader and paint checks for official-route terrain.
// Importing this local file does not request the SDK or any provider tiles.
const terrainSDK = (() => {
  const sdk = 'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl';
  function resource(isScript) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement(isScript ? 'script' : 'link');
      tag.onload = resolve;
      tag.onerror = reject;
      if (isScript) tag.src = sdk + '.js';
      else { tag.rel = 'stylesheet'; tag.href = sdk + '.css'; }
      document.head.append(tag);
    });
  }
  let ready, failed=false;
  return (explicitRetry=false) => {
    if (explicitRetry && failed) ready=null;
    return ready ??= Promise.all([resource(false), resource(true)]).then(
      () => {failed=false;return true;}, () => {failed=true;return false;});
  };
})();

function visibleRasterTiles(map,src) {
  return map.transform.coveringTiles({tileSize:src.tileSize,minzoom:src.minzoom,
    maxzoom:src.maxzoom,roundZoom:src.roundZoom,reparseOverscaled:src.reparseOverscaled});
}

// 2.15 has no public raster equivalent of queryRenderedFeatures. Inspect
// the pinned SDK's live raster source cache (not its speculative requests).
// A loaded parent is usable imagery while a sharper child is in flight.
function rasterCoverage(map, layers=map.getStyle().layers.filter(l=>l.type==='raster')) {
  if (!layers.length) throw Error('Satellite layer unavailable');
  // A renderable flat raster tile can still be transparent on its first
  // paint during the default tile fade. Show its imagery on that paint.
  for (const layer of layers) map.setPaintProperty(layer.id,'raster-fade-duration',0);
  const contains=(a,b)=>a.z<=b.z && (b.x>>(b.z-a.z))===a.x && (b.y>>(b.z-a.z))===a.y;
  // On terrain the raster is NOT drawn into the camera's ideal tile
  // selection. The SDK draws textures onto its own proxy regions. A
  // textured ancestor or a complete mosaic of bound children suffices.
  function textured(proxy,tiles) {
    const p=proxy.canonical, regions=[];
    for (const id of tiles) {
      if (id.wrap!==proxy.wrap) continue;
      const c=id.canonical;
      if (contains(c,p)) return true;
      if (contains(p,c)) regions.push(c);
    }
    const covered=[];
    let area=0;
    for (const c of regions.sort((a,b)=>a.z-b.z)) {
      if (covered.some(a=>contains(a,c))) continue;
      covered.push(c);
      area+=4**(p.z-c.z);
    }
    return area===1;
  }
  return () => {
    // Use the caches bound to the current style. A successful response or
    // decoded preload tile is not evidence that the painter drew it.
    const caches=layers.map(l=>map.style._getSourceCache(l.source));
    const tr=map.transform.elevation;
    if (tr?.proxyToSource) return tr.proxyCoords.length>0 && tr.proxyCoords.every(proxy=>
      textured(proxy,caches.flatMap(cache=>(tr.proxyToSource[proxy.key]?.[cache.id] || [])
        .filter(id=>cache.getTile(id)?.texture))));
    const visible=visibleRasterTiles(map,caches[0].getSource());
    const drawn=caches.flatMap(cache=>cache.getRenderableIds().map(key=>cache.getTileByID(key))
      .filter(tile=>tile?.texture).map(tile=>tile.tileID));
    return visible.length>0 && visible.every(id=>textured(id,drawn));
  };
}

window.kotrTerrainTools = {loadSDK:()=>terrainSDK(true), rasterCoverage};
