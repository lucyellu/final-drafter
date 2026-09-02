// Run from the repo root:  node scripts/test-timeline.mjs
//
// Covers the Timeline panel: the day/time qualifier extraction, the
// chronological-jump and real-date heuristics, the derived beat list,
// default thread seeding, the 3-Act/6-Beat story-structure strips (both
// the proportional fallback and AI-analyzed results), and the Detailed
// grid/swimlane renderers.
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
const vendored = (fs.existsSync(ROOT + '/chrome')
  ? fs.readdirSync(ROOT + '/chrome').map(d => ROOT + '/chrome/' + d + '/chrome-win64/chrome.exe')
  : []).find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

const browser = await puppeteer.launch({
  ...(vendored ? { executablePath: vendored } : {}),
  headless: 'new',
  args: ['--allow-file-access-from-files', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

// The Analyze button calls out to /api/timeline-analyze -- nothing here
// should ever touch the real endpoint (or a real AI provider) during a test.
await page.evaluateOnNewDocument(() => {
  window.__analyzeCalls = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.indexOf('/api/timeline-analyze') === 0) {
      const body = JSON.parse((opts && opts.body) || '{}');
      window.__analyzeCalls.push(body);
      const labels = body.level === '6beat'
        ? ['Introduction', 'Inciting Incident', 'Rising Action', 'Crisis', 'Climax', 'Resolution']
        : ['Beginning', 'Middle', 'End'];
      const n = body.scenes.length;
      const beats = labels.map((label, i) => ({
        label, sceneIndex: Math.min(n - 1, i), note: 'Fake AI note for ' + label, dateLabel: i === 0 ? 'YEAR 1' : null
      }));
      return Promise.resolve(new Response(JSON.stringify({ ok: true, beats }), { status: 200 }));
    }
    return realFetch(url, opts);
  };
});

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

console.log('\n== 1. sceneTimingTail / chrono heuristics ==');

const timing = await page.evaluate(() => {
  const cases = [
    'INT. KITCHEN - DAY',
    'INT. KITCHEN - CONTINUOUS',
    'EXT. FIELD - THREE WEEKS LATER',
    'INT. OFFICE - THE NEXT MORNING',
    'INT. CAVE - TEN YEARS EARLIER',
    'INT. BUNKER - DAY 3',
    'INT. SAME -- LATER',
  ];
  return cases.map(c => ({ c, tail: sceneTimingTail(c) }));
});
const byInput = Object.fromEntries(timing.map(t => [t.c, t.tail]));
ok('plain DAY qualifier captured', byInput['INT. KITCHEN - DAY'] === 'DAY', byInput);
ok('CONTINUOUS captured', byInput['INT. KITCHEN - CONTINUOUS'] === 'CONTINUOUS', byInput);
ok('multi-word jump phrase captured whole',
  byInput['EXT. FIELD - THREE WEEKS LATER'] === 'THREE WEEKS LATER', byInput);

const jumps = await page.evaluate(() => ({
  weeksLater: chronoJumpDays('THREE WEEKS LATER'),
  nextMorning: chronoJumpDays('THE NEXT MORNING'),
  yearsEarlier: chronoJumpDays('TEN YEARS EARLIER'),
  same: chronoJumpDays('CONTINUOUS'),
  anchor: chronoAnchorDays('DAY 3'),
  noAnchor: chronoAnchorDays('DAY'),
}));
ok('"THREE WEEKS LATER" -> +21 days', jumps.weeksLater === 21, jumps);
ok('"THE NEXT MORNING" -> +1 day', jumps.nextMorning === 1, jumps);
ok('"TEN YEARS EARLIER" -> -3650 days', jumps.yearsEarlier === -3650, jumps);
ok('no jump phrase -> 0', jumps.same === 0, jumps);
ok('explicit "DAY 3" anchor -> 3', jumps.anchor === 3, jumps);
ok('bare "DAY" is not an anchor', jumps.noAnchor === null, jumps);

const dates = await page.evaluate(() => ({
  monthYear: extractDateLabel('DECEMBER 1945', ''),
  yearOnly: extractDateLabel('', 'It happened sometime in 1963, or so they say.'),
  monthOnly: extractDateLabel('APRIL', ''),
  none: extractDateLabel('DAY', 'Nothing dated here.'),
}));
ok('month + year both found -> combined label', dates.monthYear === 'DECEMBER 1945', dates);
ok('a bare year in scene text is picked up', dates.yearOnly === '1963', dates);
ok('a bare month is picked up', dates.monthOnly === 'APRIL', dates);
ok('no date text -> null, never invented', dates.none === null, dates);

console.log('\n== 2. buildTimelineData: beats, chronology, "SAME -- LATER" continuation ==');

const built = await page.evaluate(() => {
  const scenes = [
    ['INT. HOUSE - DAY', 'Alice makes coffee.', 'ALICE'],
    ['INT. SAME -- LATER', 'Alice reads the paper.', 'ALICE'],
    ['EXT. STREET - THREE WEEKS LATER', 'Bob and Alice argue.', 'BOB'],
    ['INT. BUNKER - DAY 1', 'Carl waits.', 'CARL'],
    ['INT. BUNKER - DAY 3', 'Carl leaves.', 'CARL'],
  ];
  document.getElementById('editor-page').innerHTML = '<div class="page-frame">' + scenes.map(([h, action, ch]) =>
    `<div class="scene-heading">${h}</div><div class="character">${ch}</div><div class="dialogue">Line.</div><div class="action">${action}</div>`
  ).join('') + '</div>';
  extractEntities();
  return {
    sceneCount: timelineData.sceneCount,
    names: timelineData.beats.map(b => b.name),
    chronoDays: timelineData.beats.map(b => b.chronoDay),
    house2Chars: [...timelineData.beats[0].characters],
    threadCount: appState.timeline.threads.length,
  };
});
ok('5 sluglines collapse to 4 beats ("SAME -- LATER" merges into the prior scene)',
  built.sceneCount === 4, built);
ok('"SAME -- LATER" scene keeps the same location name',
  built.names[0] === 'HOUSE' && built.names[1] === 'STREET', built);
ok('chronology: HOUSE day 0, STREET +21, BUNKER anchored to day 1 then day 3',
  JSON.stringify(built.chronoDays) === JSON.stringify([0, 21, 1, 3]), built);
ok('characters attach to the beat they were spoken in',
  built.house2Chars.includes('ALICE'), built);
ok('default threads seed from the top characters once a cast exists',
  built.threadCount > 0 && built.threadCount <= 5, built);

console.log('\n== 3. Beat annotations persist independently of re-extraction ==');

const annotated = await page.evaluate(() => {
  setBeatMeta(0, { key: true, note: 'Opening beat' });
  extractEntities(); // re-derive beats; annotations must survive by ordinal
  return { meta: beatMeta(0), isKey: FDTimeline.isBeatKey(timelineData.beats[0]) };
});
ok('manual note/key survive a re-extraction', annotated.meta.note === 'Opening beat' && annotated.isKey === true, annotated);

console.log('\n== 4. Detailed grid/swimlane, and the 3-Act/6-Beat strips, render without throwing ==');

const rendered = await page.evaluate(() => {
  FDTimeline.setLevel('detailed');
  FDTimeline.setDetailView('grid');
  const gridRows = document.querySelectorAll('#timeline-grid-host tbody tr').length;
  FDTimeline.toggleKeyOnly();
  const filteredRows = document.querySelectorAll('#timeline-grid-host tbody tr').length;
  FDTimeline.toggleKeyOnly();
  FDTimeline.setDetailView('swimlane');
  const dotCount = document.querySelectorAll('#timeline-svg .timeline-node').length;
  FDTimeline.setOrder('chrono');
  const chronoDotCount = document.querySelectorAll('#timeline-svg .timeline-node').length;
  FDTimeline.setOrder('presented');

  FDTimeline.setLevel('3act');
  const threeActCards = document.querySelectorAll('#timeline-beatstrip-host .tl-beat-card').length;
  FDTimeline.setLevel('6beat');
  const sixBeatCards = document.querySelectorAll('#timeline-beatstrip-host .tl-beat-card').length;
  FDTimeline.setLevel('detailed');

  return { gridRows, filteredRows, dotCount, chronoDotCount, threeActCards, sixBeatCards };
});
ok('grid draws one row per beat', rendered.gridRows === 4, rendered);
ok('key-only filter narrows the row count', rendered.filteredRows > 0 && rendered.filteredRows <= rendered.gridRows, rendered);
ok('swimlane draws a node per beat/thread assignment', rendered.dotCount > 0, rendered);
ok('swimlane still draws after switching to chronological order', rendered.chronoDotCount === rendered.dotCount, rendered);
ok('3-Act strip draws 3 cards', rendered.threeActCards === 3, rendered);
ok('6-Beat strip draws 6 cards', rendered.sixBeatCards === 6, rendered);

console.log('\n== 5. Thread management ==');

const threadOps = await page.evaluate(() => {
  const id = 'th-test';
  const beat0 = timelineData.beats[0];
  appState.timeline.threads.push({ id, name: 'Prophecy', color: 'hsl(10,70%,60%)' });
  const onBeforeToggle = FDTimeline.isBeatThreadOn(beat0, id);
  FDTimeline.toggleBeatThread(beat0, id);
  const onAfterToggle = FDTimeline.isBeatThreadOn(beat0, id);
  FDTimeline.deleteThread(id);
  const goneAfterDelete = appState.timeline.threads.some(t => t.id === id);
  const orphanCleaned = beatMeta(0).threads.includes(id);

  // A thread named after a character defaults ON for any scene that
  // character is in, without ever being explicitly toggled.
  const aliceThread = appState.timeline.threads.find(t => t.name === 'ALICE');
  const autoOnForHouse = aliceThread ? FDTimeline.isBeatThreadOn(beat0, aliceThread.id) : null;
  const bobThread = appState.timeline.threads.find(t => t.name === 'BOB');
  const autoOffForHouse = bobThread ? FDTimeline.isBeatThreadOn(beat0, bobThread.id) : null;

  return { onBeforeToggle, onAfterToggle, goneAfterDelete, orphanCleaned, autoOnForHouse, autoOffForHouse };
});
ok('a new custom thread starts off for a scene', threadOps.onBeforeToggle === false, threadOps);
ok('toggling a beat onto a thread records it', threadOps.onAfterToggle === true, threadOps);
ok('deleting a thread removes it from the list', threadOps.goneAfterDelete === false, threadOps);
ok('deleting a thread also strips it from beats that referenced it', threadOps.orphanCleaned === false, threadOps);
ok('a character-named thread defaults on for scenes that character is in',
  threadOps.autoOnForHouse === true, threadOps);
ok('a character-named thread defaults off for scenes that character is not in',
  threadOps.autoOffForHouse === false, threadOps);

console.log('\n== 6. Analyze wiring (fetch intercepted, no real network) ==');

const analyzed = await page.evaluate(async () => {
  FDTimeline.setLevel('3act');
  await FDTimeline.analyze();
  const beats = FDTimeline._currentStructureBeats('3act');
  return {
    calls: window.__analyzeCalls.length,
    level: window.__analyzeCalls[0] && window.__analyzeCalls[0].level,
    sceneCount: window.__analyzeCalls[0] && window.__analyzeCalls[0].scenes.length,
    labels: beats.map(b => b.label),
    notes: beats.map(b => b.note),
    firstDate: beats[0].dateLabel,
    isAnalyzed: !!appState.timeline.structure['3act'],
  };
});
ok('analyze() calls the endpoint once with the current level', analyzed.calls === 1 && analyzed.level === '3act', analyzed);
ok('analyze() sends the full scene list, not just a subset', analyzed.sceneCount === 4, analyzed);
ok('analyze() applies the returned labels in order', JSON.stringify(analyzed.labels) === JSON.stringify(['Beginning', 'Middle', 'End']), analyzed);
ok('analyze() applies the returned notes', analyzed.notes.every(n => n.startsWith('Fake AI note')), analyzed);
ok('analyze() applies a returned dateLabel', analyzed.firstDate === 'YEAR 1', analyzed);
ok('a level is marked analyzed once AI results land', analyzed.isAnalyzed, analyzed);

const mechanicalFallback = await page.evaluate(() => {
  const beats = FDTimeline._currentStructureBeats('6beat'); // never analyzed
  return { labels: beats.map(b => b.label), allMechanical: beats.every(b => b.mechanical === true) };
});
ok('an unanalyzed level falls back to the proportional guess',
  JSON.stringify(mechanicalFallback.labels) ===
  JSON.stringify(['Introduction', 'Inciting Incident', 'Rising Action', 'Crisis', 'Climax', 'Resolution']) &&
  mechanicalFallback.allMechanical, mechanicalFallback);

console.log('\n== 7. Save/load round-trip carries timeline state ==');

const roundTrip = await page.evaluate(() => {
  const json = scriptJSON();
  const data = JSON.parse(json);
  return {
    hasTimeline: !!(data.lists && data.lists.timeline),
    threadCount: data.lists.timeline.threads.length,
    beatKeys: Object.keys(data.lists.timeline.beats),
  };
});
ok('scriptJSON() includes lists.timeline', roundTrip.hasTimeline, roundTrip);
ok('saved timeline carries the annotated beat', roundTrip.beatKeys.includes('b0'), roundTrip);

console.log('\n== 8. No console errors ==');
// FDStudioHub.loadCatalog() asks the local server for /api/catalog at boot.
// Over file:// there is no server, so that one request always fails; it
// predates this branch and says nothing about the timeline (see test-map.mjs).
const relevant = errors.filter(e => !/ERR_FILE_NOT_FOUND/.test(e));
ok('clean run', relevant.length === 0, relevant.slice(0, 5));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
