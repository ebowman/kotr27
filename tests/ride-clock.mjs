import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { riderScenario } from '../js/rider-scenario.mjs';
import { createRideClock } from '../js/ride-clock.mjs';

const route = JSON.parse(readFileSync(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const scenario = (inputs = {}, profile = route) => riderScenario(profile, {
  mass: '', enteredUnit: 'kg', ftp: '', effort: 'slower', ...inputs,
});
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} vs ${expected}`);

test('every modeled window reconciles and maps its own midpoint on the signed profile', () => {
  const state = scenario(), {chapters, total} = state.estimate;
  const clock = createRideClock(state, 'faster');
  for (const [key, pace] of [['a', 'slower'], ['b', 'faster']]) {
    let seconds = 0, i = 0;
    for (const chapter of chapters) {
      let sum = 0, work = 0;
      for (const w of chapter.windows) {
        const {chapterId, startM, endM, startElevationM, endElevationM} = route.segments[i++];
        assert.deepEqual([chapter.id, w.startM, w.endM, w.startElevationM, w.endElevationM],
          [chapterId, startM, endM, startElevationM, endElevationM]);
        const middle = clock.atMinute((seconds + sum + w[pace].movingSeconds / 2) / 60)[key];
        assert.equal(middle.chapterId, chapterId);
        assert.equal(middle.status, 'moving');
        near(middle.distanceM, (startM + endM) / 2);
        near(middle.elevationM, (startElevationM + endElevationM) / 2);
        sum += w[pace].movingSeconds;
        work += w[pace].pedalWorkKJ;
      }
      assert.equal(sum, chapter[pace].movingSeconds);
      assert.equal(work, chapter[pace].pedalWorkKJ);
      seconds += sum;
    }
    assert.equal(i, route.segments.length);
    assert.equal(seconds, total[pace].movingSeconds);
  }
});

test('Plan B holds on [arrival, departure) at Half step and then follows its original moving plan', () => {
  const state = scenario(), {estimate} = state;
  const boundary = route.segments.find(w => w.chapterId === 'half-step');
  for (const pace of ['slower', 'faster']) {
    const direct = createRideClock(state, pace);
    const arrivalSeconds = estimate.chapters[0][pace].movingSeconds;
    for (const stop of [5, 15]) {
      const clock = createRideClock(state, pace, stop);
      const arrive = arrivalSeconds / 60, depart = (arrivalSeconds + stop * 60) / 60;
      const hold = {chapterId: 'half-step', status: 'stopped',
        distanceM: boundary.startM, elevationM: boundary.startElevationM};
      assert.deepEqual(clock.atMinute(arrive - .001), direct.atMinute(arrive - .001));
      for (const t of [arrive, arrive + stop / 2, depart - .000001]) {
        assert.deepEqual(clock.atMinute(t).b, hold);
        assert.deepEqual(clock.atMinute(t).a, direct.atMinute(t).a);
      }
      assert.deepEqual(clock.atMinute(depart).b, {...hold, status: 'moving'});
      const resumed = clock.atMinute(depart + 1).b;
      assert.ok(resumed.distanceM > boundary.startM);
      near(resumed.distanceM, direct.atMinute(arrive + 1).b.distanceM);
      near(resumed.elevationM, direct.atMinute(arrive + 1).b.elevationM);
      assert.equal(clock.finishMinuteB, (estimate.total[pace].movingSeconds + stop * 60) / 60);
      assert.equal(clock.finishMinuteA, direct.finishMinuteA);
    }
  }
});

test('shared clock clamps; each marker holds exactly from its own summit time', () => {
  const state = scenario({effort: 'faster'});
  const clock = createRideClock(state, 'slower', 15);
  const summit = {chapterId: route.chapters.at(-1).id, status: 'finished',
    distanceM: route.distanceM, elevationM: route.segments.at(-1).endElevationM};
  const start = {chapterId: route.chapters[0].id, status: 'moving',
    distanceM: 0, elevationM: route.segments[0].startElevationM};
  assert.deepEqual(clock.atMinute(-1), {minute: 0, a: start, b: start});
  for (const [key, t] of [['a', clock.finishMinuteA], ['b', clock.finishMinuteB]]) {
    assert.equal(clock.atMinute(t - .000001)[key].status, 'moving');
    assert.deepEqual(clock.atMinute(t)[key], summit);
  }
  assert.equal(clock.atMinute(clock.finishMinuteA).b.status, 'moving');
  assert.deepEqual(clock.atMinute(1e6), {minute: clock.finishMinuteB, a: summit, b: summit});
});

test('same efforts coincide; rebuilding with amended rider parameters reclamps the previous minute', () => {
  const clock = createRideClock(scenario(), 'slower');
  for (const t of [0, 1, 60, clock.maxMinute]) {
    const {a, b} = clock.atMinute(t);
    assert.deepEqual(a, b);
  }
  for (const inputs of [{ftp: '300'}, {mass: '60'}, {effort: 'faster'}]) {
    const next = createRideClock(scenario(inputs), 'faster');
    assert.ok(next.atMinute(60).a.distanceM > clock.atMinute(60).a.distanceM);
    assert.ok(next.maxMinute < clock.maxMinute);
    assert.equal(next.atMinute(clock.maxMinute).minute, next.maxMinute);
  }
});

test('invalid drafts, unsupported choices, missing stop boundary and nonfinite clocks yield no result', () => {
  const state = scenario();
  assert.equal(createRideClock(scenario({ftp: 'not watts'}), 'slower'), null);
  assert.equal(createRideClock(state, 'fastest'), null);
  for (const stop of [-1, 10, '5', NaN]) assert.equal(createRideClock(state, 'faster', stop), null);
  const other = structuredClone(route);
  other.chapters[1].id = 'another-chapter';
  for (const w of other.segments) if (w.chapterId === 'half-step') w.chapterId = other.chapters[1].id;
  assert.equal(createRideClock(scenario({}, other), 'faster', 5), null);
  const clock = createRideClock(state, 'slower');
  for (const t of [undefined, NaN, Infinity, -Infinity, '0']) assert.equal(clock.atMinute(t), null);
});
