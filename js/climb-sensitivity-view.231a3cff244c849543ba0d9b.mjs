import { buildClimbSensitivity, compareClimbSensitivity } from './climb-sensitivity.81874826f46d2d10afbe5903.mjs';

const el = name => document.getElementById(`sensitivity-${name}`);
const kgPerLb = 0.45359237;
const short = n => String(Number(n.toFixed(6)));

// Never call a nonzero change "unchanged", or round it into a signed zero.
export function formatSensitivityChange(value) {
  if (value === 0) return '0.00';
  const rounded = Math.abs(value).toFixed(2);
  return `${value < 0 ? '-' : '+'}${rounded === '0.00' ? '<0.01' : rounded}`;
}

// Nine uniform samples plus the untouched baseline: <=10 per axis. Clip only
// the display extent, never a rider input. Half-ranges remain positive at bounds.
function axis(center, radius, min, max) {
  const low = Math.max(min, center - radius), high = Math.min(max, center + radius);
  const samples = Array.from({ length: 9 }, (_, i) =>
    i === 8 ? high : low + (high - low) * i / 8);
  // Avoid a second, roundoff-distance middle sample for decimal baselines.
  if (low === center - radius && high === center + radius) samples[4] = center;
  return [...new Set([...samples, center])].sort((a, b) => a - b);
}

export function sensitivityUnavailable(message = 'The sensitivity profile or panel is unavailable. No sensitivity estimate is shown.') {
  el('content').hidden = true;
  el('chart').replaceChildren();
  for (const name of ['baseline', 'limits', 'scale', 'selection', 'minutes', 'watts', 'ftp', 'mass', 'comparisons']) {
    el(name).replaceChildren();
    el(name).removeAttribute('value');
  }
  el('error').textContent = message;
}

export function installSensitivity(profile) {
  let data, state, unit = 'kg', key, frame, row = 0, col = 0;
  const effort = el('effort'), chart = el('chart');
  const mass = kg => unit === 'lb' ? kg / kgPerLb : kg;
  const color = (seconds, low, high) =>
    `hsl(190 55% ${82 - 52 * (high === low ? 0.5 : (seconds - low) / (high - low))}%)`;
  function fail(message) {
    cancelAnimationFrame(frame);
    frame = undefined;
    data = key = undefined;
    sensitivityUnavailable(message);
  }
  // All callbacks, including drawing errors, are panel-local.
  const guarded = fn => (...args) => {
    try { fn(...args); } catch { fail(); }
  };
  function baseline() {
    row = data.axes.riderKg.indexOf(data.baseline.riderKg);
    col = data.axes.ftpW.indexOf(data.baseline.ftpW);
  }
  function readout() {
    const p = data.grid[row][col];
    el('ftp').value = String(col);
    el('mass').value = String(row);
    el('selection').textContent = `FTP ${p.ftpW} W; rider ${mass(p.riderKg)} ${unit}` +
      ` (${p.riderKg} kg rider + 12 kg kit = ${p.assumptions.systemKg} kg system).`;
    for (const [name, value] of [['minutes', p.movingSeconds / 60], ['watts', p.targetW]]) {
      el(name).value = String(value);
      el(name).textContent = String(value);
    }
    const comparisons = compareClimbSensitivity(profile, data, { riderKg:p.riderKg, ftpW:p.ftpW });
    el('comparisons').replaceChildren(...Object.entries(comparisons).map(([name, result]) => {
      const card = document.createElement('section');
      card.dataset.scenario = name;
      const heading = document.createElement('h4');
      heading.textContent = {
        baseline:'Baseline', weight:'Selected weight · baseline FTP',
        ftp:'Selected FTP · baseline weight', combined:'Both selected values',
      }[name];
      card.append(heading);
      function line(label, field, value, display, suffix = '') {
        const row = document.createElement('p'), datum = document.createElement('data');
        datum.dataset.field = field;
        datum.value = String(value);
        datum.textContent = display;
        row.append(label, datum, suffix);
        card.append(row);
      }
      line('Rider: ', 'riderKg', result.riderKg, String(mass(result.riderKg)), ` ${unit} + 12 kg kit`);
      line('FTP: ', 'ftpW', result.ftpW, String(result.ftpW), ' W');
      line('FTP / rider kg: ', 'riderWattsPerKg', result.riderWattsPerKg, result.riderWattsPerKg.toFixed(3), ' W/kg');
      line('Sustained power: ', 'targetW', result.targetW, String(result.targetW), ' W');
      line('Moving time: ', 'movingMinutes', result.movingSeconds / 60, (result.movingSeconds / 60).toFixed(2), ' min');
      line('Change from baseline: ', 'deltaMinutes', result.deltaMinutes,
        formatSensitivityChange(result.deltaMinutes), ' min');
      line('Relative change: ', 'deltaPercent', result.deltaPercent,
        formatSensitivityChange(result.deltaPercent), `% · ${result.direction}`);
      return card;
    }));
  }
  function draw() {
    const xs = data.axes.ftpW, ys = data.axes.riderKg;
    const seconds = data.grid.flat().map(p => p.movingSeconds);
    const low = Math.min(...seconds), high = Math.max(...seconds);
    const heatmap = el('mode').value === 'heatmap';
    const weightView = el('view').value === 'weight';
    el('view').disabled = heatmap;
    const normalize = (n, a) => (n - a[0]) / (a.at(-1) - a[0]);
    function project(x, y, z) {
      if (heatmap) return [90 + 470 * x, 340 - 280 * y];
      return weightView
        ? [370 + 180 * x - 300 * y, 355 - 130 * x - 55 * y - 150 * z]
        : [245 + 300 * x - 175 * y, 355 - 55 * x - 130 * y - 150 * z];
    }
    const point = (i, j) => project(normalize(xs[j], xs), normalize(ys[i], ys),
      high === low ? 0 : (data.grid[i][j].movingSeconds - low) / (high - low));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 640 440');
    svg.setAttribute('aria-hidden', 'true'); // Equivalent named selectors/readout below.
    const add = (tag, attrs, text, parent = svg) => {
      const node = document.createElementNS(svg.namespaceURI, tag);
      for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
      if (text !== undefined) node.textContent = text;
      parent.append(node);
      return node;
    };
    const line = (a, b) => add('line', { x1:a[0], y1:a[1], x2:b[0], y2:b[1],
      stroke:'#163c34', 'stroke-width':2, 'pointer-events':'none' });
    const text = (p, label, anchor = 'middle') =>
      add('text', { x:p[0], y:p[1], 'text-anchor':anchor, 'pointer-events':'none' }, label);
    const origin = project(0, 0, 0), xEnd = project(1, 0, 0), yEnd = project(0, 1, 0);
    const items = [];
    // Depth is floor-screen Y: distant patches/points first, no rotating camera.
    const depth = (x, y) => project(x, y, 0)[1];
    for (let i = 0; i < ys.length; i++) for (let j = 0; j < xs.length; j++) {
      const x = normalize(xs[j], xs), y = normalize(ys[i], ys);
      const p = data.grid[i][j];
      if (heatmap) {
        const left = j ? (x + normalize(xs[j - 1], xs)) / 2 : 0;
        const right = j < xs.length - 1 ? (x + normalize(xs[j + 1], xs)) / 2 : 1;
        const bottom = i ? (y + normalize(ys[i - 1], ys)) / 2 : 0;
        const top = i < ys.length - 1 ? (y + normalize(ys[i + 1], ys)) / 2 : 1;
        add('polygon', { points:[project(left,bottom,0), project(right,bottom,0),
          project(right,top,0), project(left,top,0)].map(p => p.join(',')).join(' '),
        fill:color(p.movingSeconds,low,high), stroke:'#fffdf6', 'data-i':i, 'data-j':j });
      } else if (i < ys.length - 1 && j < xs.length - 1) {
        const nextX = normalize(xs[j + 1], xs), nextY = normalize(ys[i + 1], ys);
        items.push({ depth:depth((x + nextX) / 2, (y + nextY) / 2), draw:() =>
          add('polygon', { points:[point(i,j),point(i,j+1),point(i+1,j+1),point(i+1,j)].map(p => p.join(',')).join(' '),
            fill:color((p.movingSeconds + data.grid[i][j+1].movingSeconds +
              data.grid[i+1][j+1].movingSeconds + data.grid[i+1][j].movingSeconds) / 4,low,high),
            stroke:'#45675e', 'stroke-width':1 }) });
      }
      items.push({ depth:depth(x,y) + .01, draw:() => {
        const [cx, cy] = point(i,j);
        const group = add('g', { 'data-i':i, 'data-j':j });
        add('circle', { cx,cy,r:12,fill:'transparent' }, undefined, group);
        add('circle', { cx,cy,r:3.5,fill:'#163c34',stroke:'#fffdf6','stroke-width':1 }, undefined, group);
      } });
    }
    items.sort((a,b) => a.depth - b.depth).forEach(item => item.draw());
    line(origin,xEnd); line(origin,yEnd);
    text([xEnd[0],xEnd[1]+27], 'X: FTP (W)');
    text([yEnd[0],yEnd[1]-15], `Y: Rider (${unit})`, heatmap ? 'start' : 'middle');
    if (!heatmap) {
      const zEnd = project(0,0,1);
      line(origin,zEnd);
      text([zEnd[0]+8,zEnd[1]-12], 'Z: Moving min', 'start');
      text([origin[0]+8,origin[1]+25], short(low/60), 'start');
      text([zEnd[0]+8,zEnd[1]+20], short(high/60), 'start');
    }
    const bi = ys.indexOf(data.baseline.riderKg), bj = xs.indexOf(data.baseline.ftpW);
    const [bx,by] = point(bi,bj), [cx,cy] = point(row,col);
    add('path', { d:`M${bx} ${by-9} l9 9 -9 9 -9 -9 Z`, fill:'#fffdf6', stroke:'#163c34',
      'stroke-width':3, 'pointer-events':'none' });
    add('circle', { cx,cy,r:13,fill:'none',stroke:'#fffdf6','stroke-width':7,'pointer-events':'none' });
    add('circle', { cx,cy,r:13,fill:'none',stroke:'#8a3c22','stroke-width':3,'pointer-events':'none' });
    chart.replaceChildren(svg);
    el('scale').replaceChildren();
    for (const label of [`${short(low/60)} min`, `${short(high/60)} min`]) {
      const span = document.createElement('span');
      span.textContent = label;
      el('scale').append(span);
    }
    readout();
  }
  function labels() {
    const { axes, baseline:b } = data;
    const kind = { example:'Robin’s fictional baseline', partial:'Partly assumed baseline',
      personal:'Your weight and FTP baseline' }[state.kind];
    el('baseline').textContent = `${kind}: ${b.ftpW} W FTP ` +
      `(${state.supplied.ftp ? 'entered' : 'assumed'}), ${mass(b.riderKg)} ${unit} rider ` +
      `(${state.supplied.mass ? 'entered' : 'assumed'}), ${data.assumptions.effortFraction * 100}% sustained effort.`;
    el('limits').textContent = `X: FTP ${axes.ftpW[0]}–${axes.ftpW.at(-1)} W. ` +
      `Y: Rider ${short(mass(axes.riderKg[0]))}–${short(mass(axes.riderKg.at(-1)))} ${unit}. ` +
      'Z: Modeled moving minutes.';
    el('mass-label').textContent = `Selected rider weight (${unit})`;
    for (const [name, values, format] of [['ftp',axes.ftpW,v => `${v} W`],
      ['mass',axes.riderKg,v => `${mass(v)} ${unit}`]]) {
      el(name).replaceChildren(...values.map((v,i) => new Option(format(v), String(i))));
    }
  }
  function refresh() {
    frame = undefined;
    const fraction = Number(effort.value) / 100;
    const { riderKg, ftpW } = state.estimate.assumptions;
    const nextKey = JSON.stringify([riderKg,ftpW,fraction]);
    if (key !== nextKey) {
      data = buildClimbSensitivity(profile, { riderKgAxis:axis(riderKg,20,20,250),
        ftpWAxis:axis(ftpW,100,30,650), baseline:{riderKg,ftpW}, bikeKitKg:12, effortFraction:fraction });
      key = nextKey;
      baseline();
    }
    labels();
    draw();
    el('error').textContent = '';
    el('content').hidden = false;
  }
  const update = guarded((next, displayUnit, reset = false) => {
    state = next;
    unit = displayUnit;
    if (reset) { effort.value = '80'; if (data) baseline(); }
    el('effort-label').textContent = `${effort.value}%`;
    if (!state?.estimate) {
      fail(state?.kind === 'invalid'
        ? 'No sensitivity estimate. Correct or clear the rider inputs. ' + Object.values(state.errors).join(' ')
        : undefined);
      return;
    }
    // Hide old results immediately, then coalesce to the latest state in one
    // animation-frame callback. No async physics can overwrite a newer input.
    el('content').hidden = true;
    el('error').textContent = 'Updating sensitivity…';
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(guarded(refresh));
  });
  effort.oninput = () => update(state,unit);
  el('mode').onchange = el('view').onchange = guarded(() => { if (data) draw(); });
  el('home').onclick = guarded(() => { if (data) { baseline(); draw(); } });
  el('ftp').onchange = guarded(() => { col = Number(el('ftp').value); draw(); });
  el('mass').onchange = guarded(() => { row = Number(el('mass').value); draw(); });
  chart.onclick = guarded(event => {
    const target = event.target.closest('[data-i]');
    if (!target || !data) return;
    row = Number(target.dataset.i); col = Number(target.dataset.j);
    chart.focus({ preventScroll:true });
    draw();
  });
  chart.onkeydown = guarded(event => {
    if (!data || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') baseline();
    else {
      col = Math.max(0, Math.min(data.axes.ftpW.length - 1, col +
        (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)));
      row = Math.max(0, Math.min(data.axes.riderKg.length - 1, row +
        (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0)));
    }
    draw();
  });
  return update;
}
