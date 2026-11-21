import { displayMass, riderScenario } from './rider-scenario.mjs';
import { renderChapters } from './chapter-reveal.mjs';
import { installComparison } from './plan-comparison.mjs';

const el = id => document.getElementById(id);
const mass = el('mass'), unit = el('unit'), ftp = el('ftp'), effort = el('effort');
const result = el('result');
const format = n => Number(n.toFixed(2));

function install(profile) {
  const compare = installComparison(profile);
  let originalMass, enteredUnit;
  function render() {
    let state;
    try {
      state = riderScenario(profile, {
        mass: originalMass, enteredUnit, ftp: ftp.value, effort: effort.value,
      });
      renderChapters(profile, state);
      compare(state);
    } catch {
      renderChapters(profile, {});
      compare({});
      result.textContent = 'The chapter profile or scenario is unavailable. No estimate can be shown.';
      return;
    }
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
    render();
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
  el('know-ftp').onclick = () => ftp.focus();
  el('controls').disabled = false;
}

try {
  // Static local profile only. No request depends on rider state.
  const response = await fetch(new URL('../assets/semonzo-chapters.v1.json', import.meta.url));
  if (!response.ok) throw new Error('Missing profile');
  install(await response.json());
} catch {
  result.textContent = 'The example profile is unavailable. No estimate can be shown.';
}
