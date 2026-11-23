import { displayMass, riderScenario } from './rider-scenario.9beeb380fc5e849f2ce5b1a0.mjs';
import { renderChapters } from './chapter-reveal.3694ff50b9313ac070e1c7a0.mjs';
import { installComparison } from './plan-comparison.35d2181dea6ec9e7adcff794.mjs';
import { loadProfile } from './semonzo-profile.92129f6d2779bd8474d70458.mjs';
import { createRideClock, stopChapterId } from './ride-clock.19a986e5d056377f05336f4e.mjs';

const el = id => document.getElementById(id);
const mass = el('mass'), unit = el('unit'), ftp = el('ftp'), effort = el('effort');
const result = el('result');
const format = n => Number(n.toFixed(2));

function installClock(profile) {
  const {segments, chapters, distanceM} = profile;
  const slider = el('minute'), paceB = el('pace-b'), stop = el('stop-b');
  const points = [[0, segments[0].startElevationM], ...segments.map(s => [s.endM, s.endElevationM])];
  const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
  const x = m => 100 * m / distanceM, y = h => 79 - 58 * (h - low) / (high - low);
  el('scale').textContent = `Elevation ${Math.round(low)}–${Math.round(high)} m`;
  el('ridge').setAttribute('d', `M0 100 L${points.map(([m,h])=>`${x(m)} ${y(h)}`).join(' L')} L100 100 Z`);
  el('boundaries').setAttribute('d', chapters.slice(1).map(c => {
    const s = segments.find(s=>s.startM===c.startM);
    return `M${x(c.startM)} ${y(s.startElevationM)} V100`;
  }).join(' '));
  let state, clock, minute = 60, selected = -1;
  const name = id => chapters.find(c => c.id === id).name;
  const moving = (index, pace) => Math.round(state.estimate.chapters[index][pace].movingSeconds / 60);
  function chapter() {
    const c = chapters[selected];
    [...el('chapter-tabs').children].forEach((b,i)=>b.setAttribute('aria-pressed', String(i === selected)));
    el('clock-insight').hidden = !!c;
    el('chapter-summary').hidden = !c;
    if (!c) return;
    const contrast = selected === 2 ? ` Long lift is gentler but takes ${moving(0,state.effort)} min in A.`
      : selected === 0 ? ` The steeper High step takes ${moving(2,state.effort)} min in A.` : ` ${c.notice}`;
    el('chapter-summary').textContent = `${c.name} · ${(100*c.netRiseM/(c.endM-c.startM)).toFixed(1)}% average grade. ` +
      `Moving time: ${moving(selected,state.effort)} min in A, ${moving(selected,paceB.value)} min in B.${contrast}`;
  }
  chapters.forEach((c,i)=>{
    const b = document.createElement('button');
    b.title = c.name;
    b.setAttribute('aria-label', `Chapter ${i+1}: ${c.name}`);
    b.style.width = `${x(c.endM-c.startM)}%`;
    const number = document.createElement('span');
    number.textContent = String(i+1).padStart(2,'0');
    b.append(number);
    b.onclick = () => { selected = i; chapter(); };
    el('chapter-tabs').append(b);
  });
  function draw(value) {
    const p = clock.atMinute(value);
    minute = p.minute;
    // The last whole-minute tick represents the exact (fractional) summit time.
    slider.value = Math.ceil(minute);
    const time = `${Math.round(minute)} min`;
    slider.setAttribute('aria-valuetext', time);
    el('minute-label').textContent = time;
    for (const key of ['a','b']) {
      const pos = p[key], mark = el(`mark-${key}`);
      mark.style.left = `${x(pos.distanceM)}%`;
      mark.style.top = `${y(pos.elevationM)}%`;
      const where = pos.status === 'finished' ? 'Summit' : pos.status === 'stopped' ? 'Stopped at Half step' : name(pos.chapterId);
      el(`pos-${key}`).textContent = `${(pos.distanceM/1000).toFixed(1)} km · ${where}`;
    }
    el('clock-insight').textContent = p.b.status === 'stopped'
      ? `Plan B stays at 9 km for the ${Number(stop.value) === 15 ? 'café' : 'photo'} stop; only its elapsed time grows.`
      : p.a.status === 'finished' && p.b.status === 'finished' ? 'Both plans end at the same summit, with the same height gained.'
      : p.a.status === 'finished' ? 'Plan A stays at the summit while Plan B completes the climb.'
      : `${name(p.a.chapterId)}: ${chapters.find(c=>c.id===p.a.chapterId).notice}`;
  }
  function scrub(value) { selected = -1; draw(value); chapter(); }
  slider.oninput = () => scrub(Number(slider.value));
  el('earlier').onclick = () => scrub(Math.max(0, Number(slider.value)-5));
  el('later').onclick = () => scrub(Number(slider.value)+5);
  function refresh(jump = false) {
    clock = createRideClock(state, paceB.value, Number(stop.value));
    el('ride').hidden = !clock;
    el('clock-error').hidden = !!clock;
    el('clock-error').textContent = clock ? '' : 'No ride estimate. Check the rider inputs.';
    el('persona').textContent = state.kind === 'example' ? 'One fictional rider, Robin · Two plans' : 'One rider · Two plans';
    if (!clock) return;
    slider.max = Math.ceil(clock.maxMinute);
    const title = pace => pace === 'slower' ? 'Time to talk' : 'Focused and steady';
    el('label-a').textContent = `A · ${title(state.effort)}`;
    el('label-b').textContent = `B · ${title(paceB.value)}`;
    if (jump && Number(stop.value)) {
      selected = -1;
      const before = state.estimate.chapters.slice(0, chapters.findIndex(c => c.id === stopChapterId));
      minute = Math.ceil(before.reduce((s,c)=>s+c[paceB.value].movingSeconds,0)/60);
    }
    draw(minute);
    chapter();
  }
  paceB.addEventListener('change', () => refresh());
  stop.addEventListener('change', () => refresh(true));
  return (next, reset) => { state = next; if (reset) { minute = 60; selected = -1; } refresh(); };
}

function install(profile, sensitivity) {
  const compare = installComparison(profile);
  const clock = installClock(profile);
  let originalMass, enteredUnit, previousKey, previousState;
  function render(resetClock = false) {
    let state;
    try {
      const key = JSON.stringify([originalMass, enteredUnit, ftp.value, effort.value]);
      // A display-unit switch retains the original entry and physical estimate.
      state = key === previousKey ? previousState : riderScenario(profile, {
        mass: originalMass, enteredUnit, ftp: ftp.value, effort: effort.value,
      });
      previousKey = key;
      previousState = state;
      renderChapters(profile, state);
      compare(state);
      clock(state, resetClock === true);
    } catch {
      renderChapters(profile, {});
      compare({});
      clock({});
      sensitivity({}, unit.value);
      result.textContent = 'The chapter profile or scenario is unavailable. No estimate can be shown.';
      return;
    }
    sensitivity(state, unit.value, resetClock === true);
    for (const input of [mass, ftp]) {
      const error = state.errors?.[input.id] || '';
      input.setAttribute('aria-invalid', String(!!error));
      el(`${input.id}-error`).textContent = error;
    }
    if (state.kind === 'invalid') {
      result.textContent = 'No estimate. ' + Object.values(state.errors).join(' ');
      return;
    }
    const { assumptions: a, total } = state.estimate;
    const key = state.effort;
    const title = { example: 'Robin’s fictional example', partial: 'Partly assumed scenario',
      personal: 'Scenario using your weight and FTP' }[state.kind];
    result.textContent = `${title}: about ${Math.round(total[key].movingSeconds / 60)} minutes moving. ` +
      `Modeled power: ${format(a[key + 'TargetW'])} W (${format(100 * a[key + 'Fraction'])}% of FTP). ` +
      `FTP: ${a.ftpW} W (${state.supplied.ftp ? 'entered' : 'Robin’s assumption'}). ` +
      `Rider: ${format(a.riderKg)} kg (${state.supplied.mass ? 'entered' : 'Robin’s assumption'}); ` +
      `bike and kit: ${a.bikeKitKg} kg (assumed). Still air, no stops.`;
  }
  function reset() {
    mass.value = ftp.value = originalMass = '';
    unit.value = enteredUnit = 'kg';
    effort.value = 'slower';
    el('pace-b').value = 'faster';
    el('stop-b').value = '0';
    render(true);
  }
  reset();
  mass.oninput = () => { originalMass = mass.value; enteredUnit = unit.value; render(); };
  unit.onchange = () => {
    if (mass.getAttribute('aria-invalid') === 'true') {
      unit.value = enteredUnit;
      result.textContent = 'No estimate. Correct or clear the weight entry before switching units.';
      mass.focus();
      return;
    }
    mass.value = displayMass(originalMass, enteredUnit, unit.value);
    render();
  };
  ftp.oninput = effort.onchange = render;
  el('example').onclick = el('clear').onclick = reset;
  el('know-ftp').onclick = () => { el('personal').open = true; ftp.focus(); };
  el('controls').disabled = false;
}

try {
  const profile = await loadProfile();
  let sensitivity = () => {};
  // A panel import/install failure must not disable the existing ride clock.
  try {
    const { installSensitivity } = await import('./climb-sensitivity-view.231a3cff244c849543ba0d9b.mjs');
    sensitivity = installSensitivity(profile);
  } catch {
    el('sensitivity-error').textContent = 'The sensitivity panel is unavailable. No sensitivity estimate is shown.';
  }
  install(profile, sensitivity);
} catch {
  result.textContent = 'The example profile is unavailable. No estimate can be shown.';
  el('clock-error').hidden = false;
  el('clock-error').textContent = result.textContent;
  el('sensitivity-error').textContent = 'The sensitivity profile is unavailable. No sensitivity estimate is shown.';
}
