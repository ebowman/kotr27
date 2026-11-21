const el = id => document.getElementById(id);
const minutes = seconds => Math.round(seconds / 60);

// Compare the two outputs of one riderScenario, never two independent riders.
export function comparePlans(state, paceB, stopMinutes) {
  if (!state.estimate || !['slower', 'faster'].includes(paceB) ||
      ![0, 5, 15].includes(stopMinutes)) return null;
  const {total, chapters} = state.estimate;
  const plan = (pace, stop) => ({ ...total[pace], elapsedSeconds: total[pace].movingSeconds + stop * 60 });
  const gaps = chapters.map(c => minutes(Math.abs(c[state.effort].movingSeconds - c[paceB].movingSeconds)));
  const gap = Math.max(...gaps);
  return { a: plan(state.effort, 0), b: plan(paceB, stopMinutes), gap,
    largest: chapters.filter((_, i) => gaps[i] === gap).map(c => c.id) };
}

export function installComparison(profile) {
  const pace = el('pace-b'), stop = el('stop-b');
  for (const chapter of profile.chapters) {
    const link = document.createElement('a'), li = document.createElement('li');
    link.href = `./index.html#seek-${Math.round(chapter.startM)}`;
    link.textContent = `${chapter.name} · ${chapter.startM / 1000} km`;
    li.append(link);
    el('flyover-links').append(li);
  }
  let state;
  function render() {
    const result = stop.value !== '' && comparePlans(state, pace.value, Number(stop.value));
    el('comparison').hidden = !result;
    if (!result) {
      for (const id of ['plan-a','plan-b','shared-assumptions','takeaway','work']) el(id).textContent = '';
      return;
    }
    const { assumptions: s } = state.estimate;
    const title = { example: 'Robin’s fictional reference', partial: 'Partly assumed scenario',
      personal: 'Your weight and FTP' }[state.kind];
    el('shared-assumptions').textContent = `${title} · Both plans: ${Number(s.riderKg.toFixed(2))} kg rider ` +
      `(${state.supplied.mass ? 'entered' : 'assumed'}), ${s.bikeKitKg} kg bike and kit (assumed), ` +
      `${s.ftpW} W FTP (${state.supplied.ftp ? 'entered' : 'assumed'}), still air. Times are rounded to the nearest minute.`;
    function line(label, key, plan, pause) {
      const effort = key === 'slower' ? 'Time to talk' : 'Focused and steady';
      return `${label} · ${effort} (${Math.round(100*s[key+'Fraction'])}% of FTP), ${pause}: ` +
        `${minutes(plan.movingSeconds)} min moving · ${minutes(plan.elapsedSeconds)} min elapsed.`;
    }
    el('plan-a').textContent = line('Plan A', state.effort, result.a, 'no stop');
    el('plan-b').textContent = line('Plan B', pace.value, result.b, stop.selectedOptions[0].textContent);
    const names = profile.chapters.filter(c => result.largest.includes(c.id)).map(c => c.name);
    el('takeaway').textContent = (state.effort === pace.value
      ? 'At the same pace, neither plan spends longer moving in any chapter.'
      : result.gap === 0 ? 'All chapter time differences round to zero minutes.'
      : `The biggest moving-time difference is in ${names.join(' and ')}: about ${result.gap} min less there in Plan ${state.effort === 'faster' ? 'A' : 'B'}.`) +
      (Number(stop.value) ? ` The stop adds ${stop.value} minutes to Plan B’s clock, not to the climb itself.`
        : ' With no stops, elapsed time is just moving time.');
    el('work').textContent = `Modeled pedal work: about ${Math.round(result.a.pedalWorkKJ)} kJ in Plan A and ${Math.round(result.b.pedalWorkKJ)} kJ in Plan B.`;
  }
  pace.onchange = stop.onchange = render;
  return next => { state = next; render(); };
}
