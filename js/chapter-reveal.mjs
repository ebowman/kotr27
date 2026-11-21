// Distances are horizontal; grades use net rise, not accumulated ascent.
const colours = ['#2c6253', '#735833', '#824836', '#455d76'];
const km = metres => Number((metres / 1000).toFixed(2));
const minutes = seconds => Math.round(seconds / 60) || '<1';
const el = id => document.getElementById(id);

export function describe(rows) {
  const peak = Math.max(...rows.map(r => r.seconds));
  const leaders = rows.filter(r => Math.round(r.seconds / 60) === Math.round(peak / 60));
  if (leaders.length > 1)
    return `${leaders.map(r => r.name).join(' and ')} share the largest slice to the nearest minute.`;
  const [lead] = leaders;
  const steep = rows.reduce((a, b) => a.grade >= b.grade ? a : b);
  if (steep.grade > lead.grade && steep.run < lead.run)
    return `${lead.name} takes the largest slice: it gains height over ${km(lead.run)} km, so the minutes accumulate for longer than on the steeper ${km(steep.run)} km of ${steep.name}.`;
  return `${lead.name} takes the largest slice of modeled moving time at this effort.`;
}

// Only move the text, never the mark. Clamp centered labels to the axis
// edges; omit a label if even that position crowds its previous neighbour.
function fitLabels(axis) {
  const bounds = axis.getBoundingClientRect();
  if (!bounds.width) return;
  let previousRight = -Infinity;
  for (const tick of axis.children) {
    const label = tick.firstElementChild;
    const width = label.getBoundingClientRect().width;
    const anchor = tick.getBoundingClientRect().left;
    const left = Math.max(bounds.left, Math.min(anchor - width / 2, bounds.right - width));
    label.style.left = `${left - anchor - tick.clientLeft}px`;
    const fits = left >= previousRight + 6 && width <= bounds.width;
    label.style.visibility = fits ? 'visible' : 'hidden';
    if (fits) previousRight = left + width;
  }
}

let axisObserver;
function draw(rows, time) {
  const widths = rows.map(r => time ? r.seconds / 60 : r.run / 1000);
  const total = widths.reduce((a, b) => a + b);
  const unit = time ? 'min' : 'km';
  el('axis-title').textContent = `${time ? 'Moving time' : 'Distance'} across the ascent · about ${time ? minutes(total * 60) : Number(total.toFixed(2))} ${unit}`;
  const heights = [0];
  for (const r of rows) heights.push(heights.at(-1) + r.rise);
  const low = Math.min(...heights), span = Math.max(...heights) - low || 1;
  const y = i => 90 - 84 * (heights[i] - low) / span;
  el('bands').replaceChildren();
  el('profile').replaceChildren();
  let x = 0;
  rows.forEach((r, i) => {
    const width = 100 * widths[i] / total;
    const band = document.createElement('span');
    band.textContent = i + 1;
    band.style.width = width + '%';
    band.style.backgroundColor = colours[i % colours.length];
    el('bands').append(band);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    p.setAttribute('points', `${x},100 ${x},${y(i)} ${x + width},${y(i + 1)} ${x + width},100`);
    p.setAttribute('fill', colours[i % colours.length]);
    el('profile').append(p);
    x += width;
  });
  // Use round tick values at their actual coordinate, not evenly spaced labels.
  const scale = 10 ** Math.floor(Math.log10(total / 4));
  const step = [1, 2, 5, 10].find(n => n * scale >= total / 4) * scale;
  el('ticks').replaceChildren();
  for (let v = 0; v <= .88 * total; v += step) {
    const tick = document.createElement('span');
    tick.style.left = `${100 * v / total}%`;
    const label = document.createElement('b');
    label.textContent = `${Number(v.toPrecision(4))} ${unit}`;
    tick.append(label);
    el('ticks').append(tick);
  }
  const axis = el('ticks');
  if (!axisObserver) {
    axisObserver = new ResizeObserver(() => fitLabels(axis));
    axisObserver.observe(axis);
  }
  fitLabels(axis);
  el('time-axis').setAttribute('aria-pressed', String(time));
  el('distance-axis').setAttribute('aria-pressed', String(!time));
}

export function renderChapters(profile, state) {
  el('chapter-game').hidden = el('revealed').hidden = true;
  for (const id of ['choices', 'readout', 'insight', 'profile', 'bands', 'ticks', 'axis-title'])
    el(id).replaceChildren();
  el('time-axis').onclick = el('distance-axis').onclick = null;
  if (!state.estimate) return;
  const rows = profile.chapters.map((c, i) => {
    const model = state.estimate.chapters[i];
    if (!c.name?.trim() || !Number.isFinite(c.netRiseM) || c.id !== model.id)
      throw new Error('Incomplete chapter profile');
    const run = c.endM - c.startM, seconds = model[state.effort].movingSeconds;
    return { name:c.name, run, rise:c.netRiseM, grade:100 * c.netRiseM / run,
      start:c.startM, end:c.endM, seconds, fast:minutes(model.faster.movingSeconds),
      slow:minutes(model.slower.movingSeconds),
      share:Math.round(100 * seconds / state.estimate.total[state.effort].movingSeconds) };
  });
  rows.forEach((r, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${i + 1}. ${r.name}`;
    b.style.setProperty('--ink', colours[i % colours.length]);
    const detail = document.createElement('small');
    detail.textContent = `${km(r.start)}–${km(r.end)} km · ${r.grade.toFixed(1)}% avg grade`;
    b.append(detail);
    b.onclick = () => {
      el('insight').textContent = `Your pick: ${r.name}. ${describe(rows)}`;
      el('revealed').hidden = false;
      draw(rows, true);
    };
    el('choices').append(b);
    const item = document.createElement('li');
    const range = r.fast === r.slow ? `both efforts round to ${r.fast} min` : `range ${r.fast}–${r.slow} min`;
    item.textContent = `${r.name} · ${km(r.start)}–${km(r.end)} km · ${r.grade.toFixed(1)}% average grade · about ${minutes(r.seconds)} min (${range}) · ${r.share}% of moving time`;
    el('readout').append(item);
  });
  el('time-axis').onclick = () => draw(rows, true);
  el('distance-axis').onclick = () => draw(rows, false);
  el('chapter-game').hidden = false;
  draw(rows, false);
}
