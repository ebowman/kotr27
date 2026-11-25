import { briefingAt, sectionSummary, km } from './route-briefing.mjs';

// Reviewed public observations, not live organizer updates. No access-code URLs.
export const eventSources = Object.freeze({
  event:{name:'Ride with GPS event 512634', url:'https://ridewithgps.com/events/512634', observedOn:'2026-11-24'},
  zone:{name:'IANA tzdb zone1970.tab: IT → Europe/Rome', url:'https://data.iana.org/time-zones/tzdb/zone1970.tab', observedOn:'2026-11-25'},
});
const cleared = value => value?.rights?.access === 'public' &&
  value.rights.redistribution === 'approved' && Boolean(value.rights.approval);
export function publicValue(field) {
  return cleared(field) && field.provenance?.source && field.provenance?.observedOn ? field.value : null;
}
const dateOnly = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
export function calendarStatus({startDate, endDate, timezone}, now = new Date()) {
  if (!dateOnly(startDate) || !dateOnly(endDate) || startDate > endDate || !timezone ||
      !Number.isFinite(now.getTime())) return {phase:'pending', text:'Calendar countdown pending verified dates and timezone.'};
  let today;
  try {
    const parts = new Intl.DateTimeFormat('en', {timeZone:timezone, year:'numeric', month:'2-digit', day:'2-digit'})
      .formatToParts(now);
    const part = type => parts.find(p=>p.type===type).value;
    today = `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return {phase:'pending', text:'Calendar countdown unavailable: timezone unsupported.'}; }
  // Subtract civil date ordinals, NOT instants at a guessed departure/midnight.
  const days = (Date.parse(startDate)-Date.parse(today))/86400000;
  const phase = today < startDate ? 'before' : today <= endDate ? 'during' : 'after';
  return {phase, today, days:phase==='before' ? days : null,
    text:phase==='before' ? `${days} calendar day${days===1?'':'s'} until the listed event start date.` :
      phase==='during' ? 'Within the listed event date range; no “today” ride is assigned.' : 'The listed event date range has ended.'};
}
export function eventFacts(event) {
  const permitted = event?.id === 'kotr-2027' && event.status !== 'withdrawn' && cleared(event);
  return {
    startDate:permitted ? publicValue(event.metadata?.startDate) : null,
    endDate:permitted ? publicValue(event.metadata?.endDate) : null,
    timezone:permitted ? 'Europe/Rome' : null,
    location:permitted ? 'Bassano del Grappa, Vicenza, Italy' : null,
    organizer:permitted ? 'Eat Sleep Cycle' : null,
  };
}
export const pendingBriefing = Object.freeze([
  ['Calendar / departures', 'Pending organizer confirmation of D1–D4 calendar mapping, meeting points and departure times. No “today” or “tomorrow” route is inferred.'],
  ['Fundraising / event purpose', 'Pending a verified 2027 beneficiary, purpose statement and cleared fundraising URL. No donation link is published.'],
  ['Travel / accommodation / luggage', 'Pending cleared 2027 arrival, transfer, accommodation and luggage arrangements. No hotel is assumed.'],
  ['Support / communications', 'Pending cleared public organizer contact and support instructions. Private contacts, chat invites and emergency membership details are not published.'],
  ['Public safety / facilities', 'Pending sourced event-specific safety guidance, closures and emergency arrangements. Water, food, toilets and emergency exits are unknown; navigation cues are not facility POIs.'],
  ['Organizer updates / weather / offline', 'No live update or weather service here. Confirm current conditions and instructions with the organizer. No offline pack installed; cached pages and printed copies cannot verify changes.'],
]);

export const practiceWeeks = Object.freeze([
  {title:'Get familiar', social:'Choose a familiar short loop with a companion; agree an easy regroup point before setting off.',
    performance:'Choose a familiar short loop; notice where your effort rises and practise easing back without chasing a time.',
    feel:'Use a conversational effort; choose an easier pace whenever conversation becomes uncomfortable.',
    power:'If you already use power zones, choose your familiar easy/endurance zone (often called Z1–Z2). Zone systems vary; no watts or FTP test are required. Otherwise use the conversational cue.',
    shorter:'Choose only the familiar opening part, or a short local spin instead.'},
  {title:'Rehearse a steady section', social:'Choose a familiar gentle rise or steady flat section; agree to regroup rather than match another rider’s pace.',
    performance:'Choose one familiar steady section; practise a controlled start and even effort rather than a fastest segment.',
    feel:'Aim for an effort you can describe in full sentences; ease off rather than force the section.',
    power:'Use a familiar endurance zone (often Z2) as an optional ceiling, not a target to chase uphill. Use feel if you do not know your zones; no FTP entry needed.',
    shorter:'Use a shorter, gentler section or an easy flat loop; omit the rise.'},
  {title:'Practise transitions and kit', social:'On a familiar loop, agree where to regroup and try your intended layers, carrying setup and stop routine.',
    performance:'On a familiar loop, practise easing between sections and a calm stop/restart; compare comfort and control, not a score.',
    feel:'Keep the rehearsal comfortable; after a rise, allow breathing to settle before adding effort.',
    power:'Use your existing easy/endurance zones if helpful; let power fall on recoveries and do not chase watts downhill. Feel works equally well.',
    shorter:'Rehearse kit and a stop on a brief local loop, or check the kit without riding.'},
  {title:'Keep it simple', social:'Choose a familiar easy ride together, review regroup expectations and leave time to check kit.',
    performance:'Choose a familiar easy spin and review what felt manageable in earlier rehearsals; no final fitness test is needed.',
    feel:'Keep effort easy enough for relaxed conversation; resting instead is an option.',
    power:'If using power, stay in your familiar recovery/easy zone (often Z1); no numerical target, new FTP test or compulsory meter.',
    shorter:'Choose a brief easy spin, a kit check only, or rest.'},
]);
export function practice(week=1, goal='social', cue='feel') {
  const w = practiceWeeks[week-1];
  if (!w || !['social','performance'].includes(goal) || !['feel','power'].includes(cue)) throw Error('Invalid practice choice');
  return {...w, action:w[goal], cue:w[cue],
    recovery:'Leave room for rest or an easier day afterwards; shorten, skip or stop if the ride is not comfortable. This is a preparation idea, not medical or individualized coaching advice.',
    missed:'Missed a week? Repeat a comfortable option or resume where it suits you; do not stack missed rides to catch up.'};
}
export function practiceWeek(chapter) {
  return chapter?.kind === 'descent' ? 3 : chapter?.kind === 'ascent' ? 2 : 1;
}
export const packingItems = Object.freeze([
  'Check bike, brakes, tyres and a repair kit you know how to use',
  'Check helmet, shoes, layers and rain/sun protection for confirmed conditions',
  'Plan carried water and food; do not assume refills exist',
  'Charge devices and check the selected route revision / download',
  'Confirm travel, meeting point and organizer instructions privately',
]);
export function printableBundle(bundle) {
  return bundle?.route.kind === 'organizer' && cleared(bundle.route) && cleared(bundle.revision) &&
    bundle.route.status !== 'withdrawn' && bundle.revision.status !== 'withdrawn';
}
export function routeCard(bundle, analysis, snapshot) {
  if (!printableBundle(bundle)) return {available:false, text:
    'No cleared organizer route selected. Printable cards are organizer-route only; private local routes, recordings and the separate Semonzo example are excluded. Choose an approved route explicitly.'};
  const {route,revision} = bundle;
  const result = {available:true, name:route.name, revision:revision.id, status:revision.status,
    source:revision.provenance.source, observedOn:revision.provenance.observedOn,
    lines:['D1–D4 are source groups, not calendar or departure assignments. Provider revision date unknown.',
      'Not navigation, live position or a safety assessment. Confirm route changes before riding. Printed/downloaded copies cannot be recalled or checked for updates.']};
  if (!analysis?.identity || analysis.routeId !== route.id || analysis.revisionId !== revision.id ||
      analysis.identity.geometrySha256 !== revision.geometrySha256 || analysis.status !== 'supported') {
    result.lines.push('Profile / selected section / next effort unavailable. No substitute totals or time estimate.');
  } else {
    const a=analysis;
    result.lines.push(`${km(a.distanceM)} km horizontal route. Processed ascent ${Math.round(a.processedTotals.ascentM)} m (derived, 250 m windows); raw point ascent ${Math.round(a.rawTotals.ascentM)} m.`,
      `Source-listed distance / gain: ${a.sourceTotals?.listed ? `${km(a.sourceTotals.listed.distanceM)} km / ${a.sourceTotals.listed.gainM} m` : 'unavailable'}. Different bases; not interchangeable.`,
      'Elevation and processed grades are uncertain, not verified road grade. Windows can hide short hills; extreme elevations are not corrected or clamped.');
    if (a.warnings.length) result.lines.push(`Source sampling: ${a.warnings.length} sparse interval(s); detail between points is uncertain.`);
    if (snapshot?.identity?.routeId === route.id && snapshot.identity.revisionId === revision.id &&
        ['geometrySha256','recipe','annotationRevisionId'].every(k=>snapshot.identity[k]===a.identity[k]) &&
        snapshot.position) {
      const b=briefingAt(a,snapshot.distanceM);
      result.lines.push(`Selected position ${km(b.completedM)} km; ${km(b.remainingM)} km remaining (not GPS).`,
        `What to expect · section ${a.chapters.indexOf(b.current)+1}, ${b.current.kind}: ${sectionSummary(a,b.current)}`,
        b.currentClimb ? `Current qualifying effort: ${sectionSummary(a,b.currentClimb)}` : 'No qualifying climb at the selected position.',
        b.nextClimb ? `Next qualifying effort in ${km(b.nextClimb.startM-snapshot.distanceM)} km: ${sectionSummary(a,b.nextClimb)}` : 'No later qualifying climb; this does not imply an easy or safe route.',
        b.poi ? `Next sourced feature: ${b.poi.text}, ${km(b.poi.distanceM)} km. ${b.poi.source.name}, observed ${b.poi.source.observedOn}, ${b.poi.confidence}.` : 'Next sourced stop unknown: no later verified facility POI.');
      result.lines.push(snapshot.estimatedRide.status==='unavailable' ?
        'Shared ride-time model unavailable. Uncertain profiles (including D4S) must not be interpreted as verified road grades.' :
        'Optional ride-time scenarios remain in Explore; this card makes no arrival-time or performance promise.');
    } else result.lines.push('Selected section / next effort pending the matching shared route controller; no position substituted.');
  }
  result.lines.push('Water, food, toilets and emergency exits unknown. No actual facility POIs have been verified for these routes. Surface and cue accuracy are not field-verified.');
  return result;
}
