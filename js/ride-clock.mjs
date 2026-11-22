// The stop is on arrival at Half step (the end of Long lift), not a delay
// spread across Plan B's moving windows.
export const stopChapterId = 'half-step';

function timeline(estimate, pace, stopMinutes) {
  const intervals = [];
  let priorChapters = 0, elapsedMinutes = 0, stopSeconds = 0;
  function append(chapterId, status, w, endMinute) {
    intervals.push({ chapterId, status, startMinute: elapsedMinutes, endMinute,
      startM: w.startM, endM: w.endM,
      startElevationM: w.startElevationM, endElevationM: w.endElevationM });
    elapsedMinutes = endMinute;
  }
  for (const chapter of estimate.chapters) {
    if (stopMinutes && chapter.id === stopChapterId) {
      const {startM, startElevationM} = chapter.windows[0];
      stopSeconds = stopMinutes * 60;
      append(chapter.id, 'stopped', {startM, endM: startM, startElevationM,
        endElevationM: startElevationM}, (priorChapters + stopSeconds) / 60);
    }
    // Keep the estimator's summation order so chapter/summit timestamps
    // agree at the exact boundary, before any display rounding.
    let chapterSeconds = 0;
    for (const w of chapter.windows) {
      chapterSeconds += w[pace].movingSeconds;
      append(chapter.id, 'moving', w, (priorChapters + chapterSeconds + stopSeconds) / 60);
    }
    priorChapters += chapter[pace].movingSeconds;
  }
  return { intervals, finishMinute: elapsedMinutes };
}

function position(plan, minute) {
  // Half-open intervals: arrival is stopped; departure is moving.
  const w = plan.intervals.find(i => minute < i.endMinute);
  if (!w) {
    const last = plan.intervals.at(-1);
    return {chapterId: last.chapterId, status: 'finished', distanceM: last.endM,
      elevationM: last.endElevationM};
  }
  const fraction = (minute - w.startMinute) / (w.endMinute - w.startMinute);
  return {chapterId: w.chapterId, status: w.status,
    distanceM: w.startM + fraction * (w.endM - w.startM),
    elevationM: w.startElevationM + fraction * (w.endElevationM - w.startElevationM)};
}

// Accept one riderScenario result; no re-estimation or retained rider inputs.
export function createRideClock(state, paceB, stopMinutes = 0) {
  const paces = ['slower', 'faster'];
  if (!state?.estimate || !paces.includes(state.effort) || !paces.includes(paceB) ||
      ![0, 5, 15].includes(stopMinutes)) return null;
  if (stopMinutes && !state.estimate.chapters.some(c => c.id === stopChapterId)) return null;
  const a = timeline(state.estimate, state.effort, 0);
  const b = timeline(state.estimate, paceB, stopMinutes);
  const maxMinute = Math.max(a.finishMinute, b.finishMinute);
  return {maxMinute, finishMinuteA: a.finishMinute, finishMinuteB: b.finishMinute,
    atMinute(value) {
      if (!Number.isFinite(value)) return null;
      const minute = Math.max(0, Math.min(value, maxMinute));
      return {minute, a: position(a, minute), b: position(b, minute)};
    }};
}
