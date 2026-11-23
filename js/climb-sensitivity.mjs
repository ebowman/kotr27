import { estimateAscent } from './ascent-estimator.mjs';

const maxAxisSamples = 21;
const pointKeys = ['riderKg', 'ftpW', 'bikeKitKg', 'effortFraction'];
const datasetKeys = ['riderKgAxis', 'ftpWAxis', 'baseline', 'bikeKitKg', 'effortFraction'];

function requireFields(value, keys, label) {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`Expected a plain ${label} object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unsupported ${label} field: ${String(key)}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`Missing ${label} field: ${key}`);
  }
}

function sampleAxis(axis, low, high, label) {
  if (!Array.isArray(axis)) throw new TypeError(`${label} must be an array`);
  if (axis.length < 1 || axis.length > maxAxisSamples) {
    throw new RangeError(`${label} must contain 1–${maxAxisSamples} samples`);
  }
  // Iteration also rejects holes, rather than letting Array.map skip them.
  let previous = -Infinity;
  for (const value of axis) {
    if (!Number.isFinite(value) || value < low || value > high || value <= previous) {
      throw new RangeError(`${label} must be finite, strictly increasing and within [${low}, ${high}]`);
    }
    previous = value;
  }
  return [...axis];
}

function evaluate(profile, { riderKg, ftpW, bikeKitKg, effortFraction }) {
  if (!Number.isFinite(effortFraction) || effortFraction < 0.70 || effortFraction > 0.90) {
    throw new RangeError('effortFraction must be a finite number in [0.70, 0.90]');
  }
  // The estimator validates the profile, rider, FTP and bike/kit bounds.
  // Its required lower companion is not an uncertainty bound for this dataset.
  const estimate = estimateAscent(profile, {
    riderKg, ftpW, bikeKitKg, slowerFraction: 0.60, fasterFraction: effortFraction,
  });
  const targetW = estimate.assumptions.fasterTargetW;
  const assumptions = { ...estimate.assumptions, effortFraction, targetW };
  for (const key of ['slowerFraction', 'fasterFraction', 'slowerTargetW', 'fasterTargetW']) {
    delete assumptions[key];
  }
  return {
    riderKg, ftpW, movingSeconds: estimate.total.faster.movingSeconds, targetW, assumptions,
  };
}

/**
 * Exact, unrounded moving time at any point within the estimator's rider/FTP
 * bounds (not restricted to sampled coordinates). All four options are required;
 * effortFraction is a fixed sustained fraction of FTP, not peak/duration power.
 */
export function evaluateClimbSensitivityPoint(profile, options) {
  requireFields(options, pointKeys, 'sensitivity point');
  return evaluate(profile, options);
}

/**
 * Explicit options: riderKgAxis (20–250 kg), ftpWAxis (30–650 W),
 * baseline: { riderKg, ftpW }, bikeKitKg (3–60 kg), effortFraction (0.70–0.90).
 * Each ascending axis has 1–21 samples (at most 441 grid points).
 *
 * grid[riderIndex][ftpIndex] contains exact point results; baseline is evaluated
 * separately, even off the mesh or outside its extent, within model bounds.
 * Axes are copied. No inputs are changed or retained. Common assumptions are
 * taken from the estimator; point assumptions additionally declare rider/FTP,
 * system mass and target watts. No rounding or interpolation is performed.
 */
export function buildClimbSensitivity(profile, options) {
  requireFields(options, datasetKeys, 'sensitivity dataset');
  requireFields(options.baseline, ['riderKg', 'ftpW'], 'baseline');
  const riderKgAxis = sampleAxis(options.riderKgAxis, 20, 250, 'riderKgAxis');
  const ftpWAxis = sampleAxis(options.ftpWAxis, 30, 650, 'ftpWAxis');
  const { bikeKitKg, effortFraction } = options;
  const baseline = evaluate(profile, { ...options.baseline, bikeKitKg, effortFraction });
  const grid = riderKgAxis.map(riderKg => ftpWAxis.map(ftpW =>
    evaluate(profile, { riderKg, ftpW, bikeKitKg, effortFraction })));
  const assumptions = { ...baseline.assumptions };
  for (const key of ['riderKg', 'ftpW', 'systemKg', 'targetW']) delete assumptions[key];
  return { axes: { riderKg: riderKgAxis, ftpW: ftpWAxis }, assumptions, baseline, grid };
}
