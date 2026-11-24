// One moving-time solver for v1 smoothed, horizontal-distance profiles.
const physics = Object.freeze({
  gravityMps2: 9.81, airDensityKgM3: 1.2, dragAreaM2: 0.35,
  rollingCoefficient: 0.005, drivetrainEfficiency: 0.95, speedCapMps: 12.5,
});

function bounded(value, low, high, label, context) {
  if (!Number.isFinite(value) || value < low || value > high) {
    const error = new RangeError(`${label} must be a finite number in [${low}, ${high}]`);
    if (context) error.details = {...context, field: label, value, minimum: low, maximum: high};
    throw error;
  }
  return value;
}

function modelWindow(run, rise, systemKg, targetW) {
  const roadM = Math.hypot(run, rise);
  const loadN = systemKg * physics.gravityMps2 *
    (rise + physics.rollingCoefficient * run) / roadM;
  const drag = 0.5 * physics.airDensityKgM3 * physics.dragAreaM2;
  const wheelW = v => (loadN + drag * v * v) * v;
  let speed = physics.speedCapMps;
  let pedalW = Math.max(0, wheelW(speed) / physics.drivetrainEfficiency);
  if (pedalW > targetW) {
    // Even with negative load there is exactly one positive-speed crossing
    // of a *positive* target. Bisect on its sign, not on a Newton derivative.
    let lo = 0, hi = speed;
    for (let i = 0; i < 56; i++) {
      const mid = (lo + hi) / 2;
      if (wheelW(mid) < targetW * physics.drivetrainEfficiency) lo = mid;
      else hi = mid;
    }
    speed = (lo + hi) / 2;
    pedalW = targetW;
  }
  const movingSeconds = roadM / speed;
  return { movingSeconds, pedalWorkKJ: pedalW * movingSeconds / 1000 };
}

const zero = () => ({ movingSeconds: 0, pedalWorkKJ: 0 });
function add(sum, part) {
  sum.movingSeconds += part.movingSeconds;
  sum.pedalWorkKJ += part.pedalWorkKJ;
}

const exampleOptions = Object.freeze({
  riderKg: 75, bikeKitKg: 12, ftpW: 220, slowerFraction: 0.60, fasterFraction: 0.75,
});

function resolveOptions(options, defaults = exampleOptions) {
  if (options === null || typeof options !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    throw new TypeError('Expected a plain ascent options object');
  }
  const resolved = { ...defaults };
  for (const key of Reflect.ownKeys(options)) {
    if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unsupported ascent option: ${String(key)}`);
    resolved[key] = options[key];
  }
  return resolved;
}

export function estimateAscent(profile, options = {}) {
  const { riderKg, bikeKitKg, ftpW, slowerFraction, fasterFraction } = resolveOptions(options);
  bounded(riderKg, 20, 250, 'riderKg');
  bounded(bikeKitKg, 3, 60, 'bikeKitKg');
  bounded(ftpW, 30, 650, 'ftpW');
  bounded(slowerFraction, 0.4, 0.9, 'slowerFraction');
  bounded(fasterFraction, 0.4, 0.9, 'fasterFraction');
  if (slowerFraction >= fasterFraction) throw new RangeError('Expected two increasing FTP fractions');
  const systemKg = riderKg + bikeKitKg;
  const slowerTargetW = slowerFraction * ftpW, fasterTargetW = fasterFraction * ftpW;
  return {
    ...integrateProfile(profile, systemKg, {slower: slowerTargetW, faster: fasterTargetW}),
    assumptions: { riderKg, bikeKitKg, systemKg, ftpW, slowerFraction, fasterFraction,
      slowerTargetW, fasterTargetW, ...physics, windMps: 0, stopSeconds: 0 },
  };
}

// Single-fraction entry for full-route scenarios. Same bounds, windows,
// summation order and solver as the legacy two-plan estimator.
export function estimateEffort(profile, options = {}) {
  const {riderKg, bikeKitKg, ftpW, fraction} = resolveOptions(options,
    {riderKg: 75, bikeKitKg: 12, ftpW: 220, fraction: 0.75});
  bounded(riderKg, 20, 250, 'riderKg');
  bounded(bikeKitKg, 3, 60, 'bikeKitKg');
  bounded(ftpW, 30, 650, 'ftpW');
  bounded(fraction, 0.4, 0.9, 'fraction');
  const systemKg = riderKg + bikeKitKg, targetW = ftpW * fraction;
  const result = integrateProfile(profile, systemKg, {effort: targetW});
  return {schemaVersion: 1,
    chapters: result.chapters.map(c => ({id: c.id, ...c.effort,
      windows: c.windows.map(({effort, ...w}) => ({...w, ...effort}))})),
    total: result.total.effort,
    assumptions: {riderKg, bikeKitKg, systemKg, ftpW, fraction, targetW,
      ...physics, windMps: 0, stopSeconds: 0}};
}

function integrateProfile(profile, systemKg, targets) {
  if (profile?.schemaVersion !== 1 || !Array.isArray(profile.chapters) ||
      !Array.isArray(profile.segments)) throw new TypeError('Expected v1 chapter profile');
  bounded(profile.segments.length, 1, 10000, 'segment count');
  bounded(profile.chapters.length, 1, profile.segments.length, 'chapter count');
  const chapters = [], seen = new Set();
  const lanes = Object.keys(targets);
  const totals = () => Object.fromEntries(lanes.map(key => [key, zero()]));
  const total = totals();
  let cursor = 0, distance = 0, elevation;
  for (const { id, startM, endM } of profile.chapters) {
    if (typeof id !== 'string' || !id.trim() || seen.has(id) ||
        startM !== distance || !(endM > startM)) throw new RangeError('Invalid chapter boundary or id');
    seen.add(id);
    const chapter = { id, ...totals(), windows: [] };
    while (cursor < profile.segments.length && profile.segments[cursor].chapterId === id) {
      const s = profile.segments[cursor++];
      if (s.startM !== distance || (elevation !== undefined && s.startElevationM !== elevation)) {
        throw new RangeError('Discontinuous segment');
      }
      bounded(s.endM, 0, 1000000, 'endM');
      bounded(s.startElevationM, -500, 9000, 'startElevationM');
      bounded(s.endElevationM, -500, 9000, 'endElevationM');
      const run = bounded(s.endM - s.startM, 1, 1000000, 'horizontal run');
      const rise = s.endElevationM - s.startElevationM;
      bounded(rise / run, -0.5, 0.5, 'window grade',
        {segmentIndex: cursor - 1, chapterId: id, startM: s.startM, endM: s.endM, unit: 'rise/run'});
      const results = Object.fromEntries(lanes.map(key =>
        [key, modelWindow(run, rise, systemKg, targets[key])]));
      chapter.windows.push({ startM: s.startM, endM: s.endM,
        startElevationM: s.startElevationM, endElevationM: s.endElevationM, ...results });
      for (const key of lanes) add(chapter[key], results[key]);
      distance = s.endM;
      elevation = s.endElevationM;
    }
    if (distance !== endM) throw new RangeError('Segments do not cover chapter');
    chapters.push(chapter);
    for (const key of lanes) add(total[key], chapter[key]);
  }
  if (cursor !== profile.segments.length) throw new RangeError('Unexpected trailing segments');
  return {schemaVersion: 1, chapters, total};
}
