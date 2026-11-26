// Generic physics/validation coverage retained from the retired example UI.
// Active browser controls are covered by route-pace-browser/preferences-browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateAscent } from '../js/ascent-estimator.mjs';
import { riderScenario } from '../js/rider-scenario.mjs';
import { comparePlans } from '../js/plan-comparison.mjs';
import { describe as explainChapters } from '../js/chapter-reveal.mjs';

const route = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const blank = { mass: '', enteredUnit: 'kg', ftp: '', effort: 'slower' };
test('a stop changes only elapsed time; chapter gaps follow the two selected paces', () => {
  for (const effort of ['slower', 'faster']) {
    const state = riderScenario(route, { ...blank, ftp: '245', effort });
    for (const pace of ['slower', 'faster']) {
      const ride = comparePlans(state, pace, 0), cafe = comparePlans(state, pace, 15);
      assert.deepEqual(cafe, {...ride, b: {...ride.b, elapsedSeconds: ride.b.elapsedSeconds + 900}});
      assert.equal(ride.b.elapsedSeconds, state.estimate.total[pace].movingSeconds);
      if (effort === pace) {
        assert.deepEqual(ride.a, ride.b);
        assert.equal(ride.gap, 0);
      } else {
        assert.deepEqual(ride.largest, ['long-lift']);
        assert.ok(ride.gap > 0);
        assert.notEqual(ride.a.pedalWorkKJ, ride.b.pedalWorkKJ);
      }
    }
  }
  assert.equal(comparePlans(riderScenario(route, {...blank, mass:'abc'}), 'slower', 0), null);
});
test('optional fields map to estimator overrides; invalid drafts expose no estimate', () => {
  for (const [mass, ftp, kind] of [['', '', 'example'], ['81', '', 'partial'],
    ['', '250', 'partial'], ['81', '250', 'personal']]) {
    const state = riderScenario(route, { ...blank, mass, ftp });
    assert.equal(state.kind, kind);
    assert.deepEqual(state.estimate, estimateAscent(route, { slowerFraction: .7, fasterFraction: .8,
      ...(mass && { riderKg: 81 }), ...(ftp && { ftpW: 250 }) }));
  }
  for (const [field, values] of [['mass', ['1', '251', '0x50', ' ']],
    ['ftp', ['abc', '250watts', '0', '651', 'Infinity', '-123']]]) {
    for (const value of values) {
      const state = riderScenario(route, { ...blank, mass: '81', ftp: '250', [field]: value });
      assert.equal(state.kind, 'invalid');
      assert.ok(state.errors[field]);
      assert.equal(state.estimate, undefined);
    }
    const pounds = riderScenario(route, { ...blank, mass: '180', enteredUnit: 'lb' });
    assert.equal(pounds.estimate.assumptions.riderKg, 180 * .45359237);
  }
});
test('equal or indistinguishable rounded durations do not single out a chapter', () => {
  for (const seconds of [600, 611]) {
    const text = explainChapters([{name:'One', seconds:600}, {name:'Two', seconds}, {name:'Three', seconds:529}]);
    assert.match(text, /^One and Two share.*nearest minute/);
  }
});
