import { estimateAscent } from './ascent-estimator.mjs';

const kgPerLb = 0.45359237;
const decimal = text => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim()) ? Number(text) : NaN;
const within = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

// Keep the original entry, not the rounded display, as the source of truth.
export function displayMass(text, enteredUnit, unit) {
  if (!text || enteredUnit === unit) return text;
  const value = decimal(text);
  return String(Number((unit === 'kg' ? value * kgPerLb : value / kgPerLb).toFixed(8)));
}

export function validateRider({ mass, enteredUnit, ftp, effort }) {
  const errors = {};
  const options = { slowerFraction: 0.7, fasterFraction: 0.8 };
  if (typeof mass !== 'string' || typeof ftp !== 'string')
    throw new TypeError('Rider entries must be text');
  if (!['kg', 'lb'].includes(enteredUnit) || !['slower', 'faster'].includes(effort))
    throw new TypeError('Unknown unit or effort');
  if (mass !== '') {
    options.riderKg = decimal(mass) * (enteredUnit === 'kg' ? 1 : kgPerLb);
    if (!within(options.riderKg, 20, 250))
      errors.mass = 'Use a number within the model’s 20–250 kg range (about 44.1–551.2 lb), or leave weight blank.';
  }
  if (ftp !== '') {
    options.ftpW = decimal(ftp);
    if (!within(options.ftpW, 30, 650))
      errors.ftp = 'Use a number from 30 to 650 watts, or leave FTP blank.';
  }
  if (Object.keys(errors).length) return { kind: 'invalid', errors };
  return {
    kind: mass && ftp ? 'personal' : mass || ftp ? 'partial' : 'example',
    supplied: { mass: !!mass, ftp: !!ftp }, options, effort,
  };
}

export function riderScenario(profile, input) {
  const state = validateRider(input);
  if (state.kind === 'invalid') return state;
  const {options, ...validated} = state;
  return {...validated, estimate:estimateAscent(profile, options)};
}
