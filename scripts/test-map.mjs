// Run from the repo root:  node scripts/test-map.mjs
//
// Covers the location map: slugline parsing, the derived location graph
// (containment, cuts, INT/EXT), and the map overlay's render/interaction.
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

// Real World mode calls out to /api/geocode. Nothing here should ever touch
// the live Nominatim service -- installed before the page's own scripts run,
// so FDMap's fetch() calls hit this instead. Everything else still reaches
// the real network (or fails over file:// exactly as it does today).
await page.evaluateOnNewDocument(() => {
  window.__geocodeCalls = [];
  const FAKE = {
    'LOS ALAMOS': { lat: 35.8879, lon: -106.3007, display: 'Los Alamos, NM, USA' },
    'BERKELEY': { lat: 37.8716, lon: -122.2727, display: 'Berkeley, CA, USA' },
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.indexOf('/api/geocode') === 0) {
      window.__geocodeCalls.push(u);
      const q = decodeURIComponent((u.split('q=')[1] || '')).toUpperCase();
      const hit = FAKE[q];
      return Promise.resolve(new Response(JSON.stringify(
        hit ? { ok: true, found: true, ...hit } : { ok: true, found: false }
      ), { status: 200 }));
    }
    return realFetch(url, opts);
  };
});

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

console.log('\n== 1. parseSceneHeading ==');

const parsed = await page.evaluate(() => {
  const cases = [
    'INT. ARCHIVE LIBRARY - CINNA ESTATE - NIGHT - 10:15 PM #4#',
    'INT. LOW-GRID DINER - MORNING - SAME TIME #2#',
    'EXT. HUDSON RIVER FERRY - MORNING - 8:04 AM #1#',
    'INT. GATSBY BALLROOM - NIGHT',
    'INT. FARADAY TUNNEL - MEATPACKING WAREHOUSE - NIGHT - 1:15 AM #9#',
    'INT./EXT. PATROL CAR - CONTINUOUS',
    'EXT MARKET SQUARE - DAY',
    "INT. ELENA'S HOSPITAL ROOM - NIGHT",
    'INT. BUNK - SUBMARINE - PACIFIC - DAY',
    'INT. BALLROOM - DARKNESS - 12:01:03 AM #13#',
  ];
  return cases.map(c => ({ c, ...parseSceneHeading(c) }));
});
const byInput = Object.fromEntries(parsed.map(p => [p.c, p]));
const P = s => byInput[Object.keys(byInput).find(k => k.startsWith(s))];

ok('containment kept, time + scene number dropped',
  P('INT. ARCHIVE').name === 'ARCHIVE LIBRARY' &&
  JSON.stringify(P('INT. ARCHIVE').parents) === JSON.stringify(['CINNA ESTATE']),
  P('INT. ARCHIVE'));

ok('hyphenated name survives the dash split',
  P('INT. LOW-GRID').name === 'LOW-GRID DINER' && P('INT. LOW-GRID').parents.length === 0,
  P('INT. LOW-GRID'));

ok('two trailing qualifiers both stripped',
  P('EXT. HUDSON').name === 'HUDSON RIVER FERRY' && P('EXT. HUDSON').parents.length === 0,
  P('EXT. HUDSON'));

ok('EXT. detected', P('EXT. HUDSON').intExt === 'ext', P('EXT. HUDSON'));
ok('INT. detected', P('INT. GATSBY').intExt === 'int', P('INT. GATSBY'));
ok('INT./EXT. detected', P('INT./EXT.').intExt === 'both', P('INT./EXT.'));

ok('period-less prefix parsed',
  P('EXT MARKET').name === 'MARKET SQUARE' && P('EXT MARKET').intExt === 'ext',
  P('EXT MARKET'));

ok('apostrophe in name kept',
  P("INT. ELENA'S").name === "ELENA'S HOSPITAL ROOM", P("INT. ELENA'S"));

ok('multi-level containment, nearest first',
  JSON.stringify(P('INT. BUNK').parents) === JSON.stringify(['SUBMARINE', 'PACIFIC']),
  P('INT. BUNK'));

ok('a non-time middle segment is kept as a parent',
  P('INT. BALLROOM').name === 'BALLROOM' &&
  JSON.stringify(P('INT. BALLROOM').parents) === JSON.stringify(['DARKNESS']),
  P('INT. BALLROOM'));

console.log('\n== 2. Region inference (reach beats frequency) ==');

// SERVICE CORRIDOR is written under CINNA ESTATE once and under GATSBY GALA
// three times. The estate is the real container: it gathers four different
// rooms, while the gala trails only this one.
const region = await page.evaluate(() => {
  const headings = [
    'INT. ARCHIVE LIBRARY - CINNA ESTATE - NIGHT',
    'INT. SERVICE CORRIDOR - CINNA ESTATE - NIGHT',
    'INT. SERVICE CORRIDOR - GATSBY GALA - NIGHT',
    'INT. SERVICE CORRIDOR - GATSBY GALA - NIGHT',
    'INT. SERVICE CORRIDOR - GATSBY GALA - NIGHT',
    'INT. GRAND FOYER - CINNA ESTATE - NIGHT',
    'INT. GATSBY BALLROOM - CINNA ESTATE - NIGHT',
  ];
  // getBlocks() reads #editor-page > .page-frame > *, so the fixture has to
  // sit inside a page frame the way a real document does.
  document.getElementById('editor-page').innerHTML =
    '<div class="page-frame">' + headings
      .map(h => `<div class="scene-heading">${h}</div><div class="action">Beat.</div>`)
      .join('') + '</div>';
  extractEntities();
  const n = locationGraph.nodes.find(x => x.name === 'SERVICE CORRIDOR');
  return {
    corridorRegion: n ? n.region : null,
    regions: locationGraph.regions.map(r => ({ name: r.name, members: r.members.length })),
  };
});
ok('event qualifier loses to the real container',
  region.corridorRegion === 'CINNA ESTATE', region);
ok('estate gathers all four rooms',
  (region.regions.find(r => r.name === 'CINNA ESTATE') || {}).members === 4, region.regions);
ok('the one-room event does not become a region',
  !region.regions.some(r => r.name === 'GATSBY GALA'), region.regions);

console.log('\n== 2b. Slash containment is offered, not assumed ==');

const slash = await page.evaluate(() => {
  const run = headings => {
    document.getElementById('editor-page').innerHTML =
      '<div class="page-frame">' + headings
        .map(h => `<div class="scene-heading">${h}</div><div class="action">Beat.</div>`)
        .join('') + '</div>';
    extractEntities();
    return {
      names: locationGraph.nodes.map(n => n.name),
      regions: locationGraph.regions.map(r => r.name),
      byName: Object.fromEntries(locationGraph.nodes.map(n => [n.name, n.region])),
    };
  };
  return {
    gathers: run([
      'INT. KIRKLAND HOUSE/LOBBY - NIGHT',
      'INT. KIRKLAND HOUSE/STAIRWAY - NIGHT',
      'INT. MARK\'S DORM ROOM - NIGHT',
    ]),
    lone: run([
      'INT. KITCHEN/DINING ROOM - DAY',
      'INT. MARK\'S DORM ROOM - NIGHT',
    ]),
  };
});
ok('slash prefix gathering two rooms becomes a region',
  slash.gathers.regions.includes('KIRKLAND HOUSE'), slash.gathers);
ok('the names stay exactly as written',
  slash.gathers.names.includes('KIRKLAND HOUSE/LOBBY') &&
  slash.gathers.names.includes('KIRKLAND HOUSE/STAIRWAY'), slash.gathers.names);
ok('a lone slash room invents no region',
  slash.lone.regions.length === 0 && slash.lone.byName['KITCHEN/DINING ROOM'] === null,
  slash.lone);

console.log('\n== 2c. Commas, brackets, and headings that name no place ==');

const runFixture = async headings => page.evaluate(hs => {
  document.getElementById('editor-page').innerHTML =
    '<div class="page-frame">' + hs
      .map(h => `<div class="scene-heading">${h}</div><div class="action">Beat.</div>`)
      .join('') + '</div>';
  extractEntities();
  return {
    names: locationGraph.nodes.map(n => n.name),
    labels: Object.fromEntries(locationGraph.nodes.map(n => [n.name, n.label])),
    regionOf: Object.fromEntries(locationGraph.nodes.map(n => [n.name, n.region])),
    counts: Object.fromEntries(locationGraph.nodes.map(n => [n.name, n.count])),
    seats: locationGraph.nodes.filter(n => n.isSeat).map(n => n.name),
    regions: locationGraph.regions.map(r => ({ name: r.name, members: r.members.length })),
  };
}, headings);

// Nolan writes the film's two timelines into the slugline itself: "-- DAY
// (COLOUR)", "-- MOMENTS LATER (B&W)". Read as geography those come out as the
// largest regions on the map, and the real ones never appear at all.
const nolan = await runFixture([
  'INT. ROOM 2022, ATOMIC ENERGY COMMISSION -- DAY (COLOUR)',
  'INT. SENATE OFFICE -- DAY (BLACK-AND-WHITE SEQUENCE)',
  'INT. CORRIDOR, SENATE BUILDING -- MOMENTS LATER (B&W)',
  'INT. NICHOLS OFFICE, ATOMIC ENERGY COMMISSION -- NIGHT (B&W)',
]);
ok('a bracketed timeline marker is not a place',
  !nolan.regions.some(r => /COLOUR|B&W|BLACK/.test(r.name)) &&
  !nolan.names.some(n => /COLOUR|B&W/.test(n)), nolan);
ok('the comma tail is read as the container',
  nolan.regionOf['ROOM 2022, ATOMIC ENERGY COMMISSION'] === 'ATOMIC ENERGY COMMISSION',
  nolan.regionOf);
ok('a place inside its region drops the region from its label',
  nolan.labels['ROOM 2022, ATOMIC ENERGY COMMISSION'] === 'ROOM 2022', nolan.labels);
ok('the identity is still the slugline, not the label',
  nolan.names.includes('ROOM 2022, ATOMIC ENERGY COMMISSION'), nolan.names);
ok('a comma tail gathering one place invents no region',
  !nolan.regions.some(r => r.name === 'SENATE BUILDING'), nolan.regions);

// Two CORRIDORs in two buildings are two places. Shortening both to CORRIDOR
// would draw them as one, so a trim that collides is undone.
const collide = await runFixture([
  'INT. CORRIDOR, BERKELEY - DAY', 'INT. CLASSROOM, BERKELEY - DAY',
  'INT. RAD LAB, BERKELEY - DAY', 'INT. CORRIDOR, PRINCETON - DAY',
  'INT. LIBRARY, PRINCETON - DAY', 'INT. OFFICE, PRINCETON - DAY',
]);
ok('rooms in different buildings stay distinct places',
  collide.names.includes('CORRIDOR, BERKELEY') && collide.names.includes('CORRIDOR, PRINCETON'),
  collide.names);
ok('two regions inferred from commas alone', collide.regions.length === 2, collide.regions);

// "INT. SAME -- LATER" says the last place again. Read as a location it
// becomes a phantom that half the script cuts to.
const same = await runFixture([
  'INT. LECTURE HALL, ZURICH - DAY',
  'INT. SAME - LATER',
  'INT. SAME - CONTINUOUS',
  'INT. RAD LAB, BERKELEY - DAY',
]);
ok('a heading that names no place invents none',
  !same.names.includes('SAME') && !same.names.includes('CONTINUOUS'), same.names);
ok('its scenes count where they actually happen',
  same.counts['LECTURE HALL, ZURICH'] === 3, same.counts);

// A place the script also visits by the region's own name is that region's
// seat, not a separate island floating beside it.
const seat = await runFixture([
  'EXT. BERKELEY - DAY', 'EXT. BERKELEY - NIGHT',
  'INT. CLASSROOM, BERKELEY - DAY', 'INT. RAD LAB, BERKELEY - DAY',
]);
ok('the region name, visited in its own right, becomes the seat',
  seat.seats.includes('BERKELEY') && seat.regionOf['BERKELEY'] === 'BERKELEY', seat);

// Scripts disagree about which end of a dash chain contains the other. Read
// the wrong way round, a hotel bathroom becomes a region with hotels in it.
const rooms = await runFixture([
  'INT. HALSEY HOTEL - ROOM 503 - BATHROOM - NIGHT',
  'INT. EDISON HOTEL - ROOM 12 - BATHROOM - NIGHT',
  'INT. TENEMENT - BATHROOM - DAY',
]);
ok('a room word never becomes a region',
  !rooms.regions.some(r => r.name === 'BATHROOM'), rooms.regions);

// Imports that flatten the dashes leave "DREAMHOUSE. BEDROOM. MORNING."
const dots = await runFixture([
  'INT. BARBIE DREAMHOUSE. BEDROOM. MORNING.',
  'INT. BARBIE DREAMHOUSE. BEDROOM. DAY',
  'EXT. ST. LOUIS RAIL YARD - NIGHT',
]);
ok('a time word after a full stop is stripped too',
  dots.names.includes('BARBIE DREAMHOUSE. BEDROOM') &&
  dots.counts['BARBIE DREAMHOUSE. BEDROOM'] === 2, dots);
ok('an abbreviation inside a name survives it',
  dots.names.includes('ST. LOUIS RAIL YARD'), dots.names);

// One place is not a region.
const lone = await runFixture([
  'INT. KITCHEN - THE ELMS - DAY', 'INT. STREET - DAY',
]);
ok('a container holding one place draws no landmass',
  lone.regions.length === 0 && lone.regionOf['KITCHEN'] === null, lone);

console.log('\n== 3. Graph over a real script ==');

const input = await page.$('#file-input-project');
await input.uploadFile(path.resolve(ROOT, 'text/social_network.json'));
await new Promise(r => setTimeout(r, 1800));

const graph = await page.evaluate(() => ({
  nodes: locationGraph.nodes.length,
  scenes: locationGraph.sceneCount,
  edges: locationGraph.edges.length,
  selfEdges: locationGraph.edges.filter(e => e.from === e.to).length,
  weightsPositive: locationGraph.edges.every(e => e.weight >= 1),
  countsMatchSidebar: locationGraph.nodes.length === appState.locations
    .filter(l => (dynamicCounts.locations[l.name] || 0) > 0).length,
  everyNodeHasHeading: locationGraph.nodes.every(n => n.headings.length === n.count),
  intExtValid: locationGraph.nodes.every(n => ['int', 'ext', 'both', 'unknown'].includes(n.intExt)),
  hasCharacters: locationGraph.nodes.some(n => n.characters.size > 0),
}));
ok('locations found', graph.nodes > 20, graph);
ok('scene count exceeds distinct locations', graph.scenes >= graph.nodes, graph);
ok('no scene cuts to itself', graph.selfEdges === 0, graph);
ok('every route weight is at least 1', graph.weightsPositive, graph);
ok('graph and sidebar agree on the location set', graph.countsMatchSidebar, graph);
ok('heading list length matches scene count', graph.everyNodeHasHeading, graph);
ok('int/ext is always one of the four values', graph.intExtValid, graph);
ok('characters attributed to locations', graph.hasCharacters, graph);

console.log('\n== 4. The map panel renders ==');

// Mounted the way any panel is mounted. There is no other way to show it.
await page.evaluate(() => { FDPanels.setLayoutMode('split-h'); FDPanels.setSlotType('slot-2', 'location-map'); });
await new Promise(r => setTimeout(r, 900));

const atlas = await page.evaluate(() => {
  const svg = document.getElementById('map-svg');
  return {
    open: FDMap.isShowing(),
    nodes: svg.querySelectorAll('.map-node').length,
    paths: svg.querySelectorAll('path').length,
    texts: svg.querySelectorAll('text').length,
    viewBox: svg.getAttribute('viewBox'),
    sub: document.getElementById('map-sub').textContent,
    positioned: FDMap.positions.size,
    finite: [...FDMap.positions.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
  };
});
ok('the panel is showing', atlas.open, atlas);
ok('one group per location', atlas.nodes === graph.nodes, atlas);
ok('every location got a finite position', atlas.finite && atlas.positioned === graph.nodes, atlas);
ok('viewBox set by fit()', /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(atlas.viewBox || ''), atlas);
ok('labels drawn', atlas.texts > 0, atlas);
ok('summary line filled in', /locations/.test(atlas.sub), atlas);

console.log('\n== 4b. Detail: what gets named, and which routes are drawn ==');

const detail = await page.evaluate(() => {
  const svg = document.getElementById('map-svg');
  const read = () => ({
    labels: svg.querySelectorAll('.map-node text').length,
    marks: svg.querySelectorAll('.map-node').length,
    routes: svg.querySelectorAll('path[stroke-linecap="round"]').length,
  });
  FDMap.setDetail('all');   const all = read();
  FDMap.setDetail('more');  const more = read();
  FDMap.setDetail('key');   const key = read();
  const active = document.getElementById('map-detail-key').classList.contains('active');
  const region = Object.fromEntries(locationGraph.nodes.map(n => [n.name, n.region]));
  const crossing = locationGraph.edges.filter(e =>
    !(region[e.from] && region[e.from] === region[e.to])).length;
  FDMap.setDetail('all');
  return {
    all, more, key, crossing, active,
    drawnAtAll: read().routes,
    edges: locationGraph.edges.length,
  };
});
ok('every place keeps its mark at every detail',
  detail.key.marks === detail.all.marks && detail.more.marks === detail.all.marks, detail);
ok('fewer names at Key than at All', detail.key.labels < detail.all.labels, detail);
ok('More sits between the two',
  detail.more.labels >= detail.key.labels && detail.more.labels <= detail.all.labels, detail);
ok('Key draws no more roads than All', detail.key.routes <= detail.all.routes, detail);
// A cut between two rooms of one building is the building, not a journey.
ok('only journeys between places are drawn as roads',
  detail.drawnAtAll === detail.crossing, detail);
ok('the chosen detail is marked active in the toolbar', detail.active, detail);
await page.evaluate(() => FDMap.setDetail('key'));

console.log('\n== 5. Layout is stable, and reshuffle actually moves it ==');

const stable = await page.evaluate(() => {
  const before = JSON.stringify([...FDMap.positions.values()].map(p => [p.name, p.x.toFixed(3)]));
  FDMap.layout();                       // same signature, same seed
  const after = JSON.stringify([...FDMap.positions.values()].map(p => [p.name, p.x.toFixed(3)]));
  FDMap.relayout();                     // deliberately reseeded
  const shuffled = JSON.stringify([...FDMap.positions.values()].map(p => [p.name, p.x.toFixed(3)]));
  return { same: before === after, moved: before !== shuffled };
});
ok('re-running the layout reproduces it exactly', stable.same, stable);
ok('reshuffle produces a different arrangement', stable.moved, stable);

console.log('\n== 6. Skins, toggles, and picking a place ==');

const schematic = await page.evaluate(() => {
  FDMap.setSkin('console');
  const svg = document.getElementById('map-svg');
  return {
    rects: svg.querySelectorAll('rect').length,
    active: document.getElementById('map-skin-console').classList.contains('active'),
    nodes: svg.querySelectorAll('.map-node').length,
  };
});
ok('schematic skin draws rect glyphs', schematic.rects > graph.nodes, schematic);
ok('schematic tab marked active', schematic.active, schematic);
ok('same locations in both skins', schematic.nodes === graph.nodes, schematic);

const toggles = await page.evaluate(() => {
  FDMap.setSkin('atlas');
  const svg = document.getElementById('map-svg');
  const withLabels = svg.querySelectorAll('text').length;
  FDMap.toggleLabels();
  const withoutLabels = svg.querySelectorAll('text').length;
  FDMap.toggleLabels();
  const routes = () => [...svg.querySelectorAll('path[stroke-linecap="round"]')].length;
  const withRoutes = routes();
  FDMap.toggleRoutes();
  const withoutRoutes = routes();
  FDMap.toggleRoutes();
  return { withLabels, withoutLabels, withRoutes, withoutRoutes };
});
ok('labels toggle off and back', toggles.withoutLabels < toggles.withLabels, toggles);
ok('routes toggle off and back', toggles.withRoutes > 0 && toggles.withoutRoutes === 0, toggles);

// Clicking a place closes the map and scrolls its first scene into view.
const jumped = await page.evaluate(async () => {
  const target = locationGraph.nodes[0];
  const g = document.querySelector(`.map-node[data-loc="${CSS.escape(target.name)}"]`);
  if (!g) return { found: false };
  g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return {
    found: true,
    stillShowing: FDMap.isShowing(),
    name: target.name,
  };
});
ok('a location group is addressable by name', jumped.found, jumped);
// Nothing to dismiss: the map is beside the script, not over it.
ok('picking a place leaves the map where it is', jumped.stillShowing, jumped);

console.log('\n== 7. The map as a panel ==');

const panel = await page.evaluate(async () => {
  FDPanels.setSlotType('slot-2', 'location-map');
  await new Promise(r => setTimeout(r, 500));
  const stage = document.getElementById('map-stage');
  const body = document.getElementById('slot-body-2');
  const svg = document.getElementById('map-svg');
  return {
    optionOffered: !!document.querySelector('#slot-2 .pane-type-select option[value="location-map"]'),
    selectValue: document.querySelector('#slot-2 .pane-type-select').value,
    stageInPanel: !!body && body.contains(stage),
    onlyOneStage: document.querySelectorAll('#map-stage').length,
    onlyOneSvg: document.querySelectorAll('#map-svg').length,
    flush: !!body && body.classList.contains('flush-body'),
    drewNodes: svg.querySelectorAll('.map-node').length,
    showing: FDMap.isShowing(),
    slotType: layoutState.slots.find(s => s.id === 'slot-2').type,
    // Nothing of the map's own above the canvas: the pane header names it and
    // the top bar holds its tools, the same as every other panel type.
    ownChrome: stage.children.length,
    firstChild: stage.firstElementChild.id,
  };
});
ok('Location Map offered in the pane dropdown', panel.optionOffered, panel);
ok('dropdown reflects the mounted type', panel.selectValue === 'location-map', panel);
ok('the stage moved into the panel body', panel.stageInPanel, panel);
ok('there is still exactly one map', panel.onlyOneStage === 1 && panel.onlyOneSvg === 1, panel);
ok('panel body is flush', panel.flush, panel);
ok('map painted itself in the panel', panel.drewNodes === graph.nodes, panel);
ok('isShowing() true when panelled', panel.showing, panel);
ok('layout state records the type', panel.slotType === 'location-map', panel);
ok('the panel carries no chrome of its own',
  panel.ownChrome === 1 && panel.firstChild === 'map-canvas-wrap', panel);

// The map is a panel type like the others, so it has a shelf like the others,
// and mounting it brings that shelf up.
const shelf = await page.evaluate(() => ({
  activeShelf: layoutState.activeShelf,
  shelvesActive: document.querySelectorAll('.shelf-content.active').length,
  activeId: (document.querySelector('.shelf-content.active') || {}).id,
  tabOffered: !!document.querySelector('.shelf-tab[data-shelf="location-map"]'),
  tabActive: document.querySelector('.shelf-tab[data-shelf="location-map"]').classList.contains('active'),
  toolsInShelf: document.querySelectorAll('#shelf-location-map button').length,
}));
ok('the map has a tab in the top bar', shelf.tabOffered, shelf);
ok('exactly one shelf is showing', shelf.shelvesActive === 1, shelf);
ok('mounting the map brings up the map shelf',
  shelf.activeShelf === 'location-map' && shelf.activeId === 'shelf-location-map', shelf);
ok('the map tab is marked active', shelf.tabActive, shelf);
ok('the map tools live in the shelf', shelf.toolsInShelf >= 8, shelf);

// The sidebar's Map button opens a panel, not a window.
const fromSidebar = await page.evaluate(async () => {
  FDPanels.setSlotType('slot-2', 'script-render');
  FDPanels.setLayoutMode('single');
  await new Promise(r => setTimeout(r, 300));
  FDMap.show();
  await new Promise(r => setTimeout(r, 600));
  const visible = FDPanels.getVisibleSlots();
  return {
    mode: layoutState.mode,
    types: visible.map(s => s.type),
    showing: FDMap.isShowing(),
    stages: document.querySelectorAll('#map-stage').length,
  };
});
ok('the Map button puts the map in a pane', fromSidebar.types.includes('location-map'), fromSidebar);
ok('it opens a second pane rather than a window',
  fromSidebar.mode !== 'single' && fromSidebar.stages === 1, fromSidebar);
ok('and the map is showing there', fromSidebar.showing, fromSidebar);

// Asking again with the map already up must not take another pane.
const again = await page.evaluate(async () => {
  const before = FDPanels.getVisibleSlots().filter(s => s.type === 'location-map').length;
  FDMap.show();
  await new Promise(r => setTimeout(r, 400));
  return { before, after: FDPanels.getVisibleSlots().filter(s => s.type === 'location-map').length };
});
ok('asking twice does not open a second map',
  again.before === 1 && again.after === 1, again);

// Full screen is the pane header's own Solo control now, so it has to work.
// Soloing copies the pane's type into slot 1 and leaves the slot it came from
// still configured for it -- and there is only one map, so a hidden slot
// mounting it too would carry it off into a pane nobody can see.
const solo = await page.evaluate(async () => {
  FDPanels.setLayoutMode('split-h');
  FDPanels.setSlotType('slot-2', 'location-map');
  await new Promise(r => setTimeout(r, 400));
  maximizeSlot('slot-2');
  await new Promise(r => setTimeout(r, 700));
  const body1 = document.querySelector('#slot-1 .pane-body');
  return {
    mode: layoutState.mode,
    inSoloPane: body1.contains(document.getElementById('map-stage')),
    stages: document.querySelectorAll('#map-stage').length,
    nodes: document.querySelectorAll('#map-svg .map-node').length,
    showing: FDMap.isShowing(),
  };
});
ok('soloing the map pane leaves the map in it',
  solo.mode === 'single' && solo.inSoloPane && solo.stages === 1, solo);
ok('and it is still painted there',
  solo.showing && solo.nodes === graph.nodes, solo);

await page.evaluate(async () => {
  FDPanels.setLayoutMode('split-h');
  FDPanels.setSlotType('slot-2', 'location-map');
  await new Promise(r => setTimeout(r, 300));
});

// Unmounting parks it in the hidden pool, where it must not try to paint.
const parked = await page.evaluate(async () => {
  FDPanels.setSlotType('slot-2', 'script-render');
  await new Promise(r => setTimeout(r, 400));
  const pooled = document.getElementById('panel-content-pool')
    .contains(document.getElementById('map-stage'));
  const before = document.querySelectorAll('#map-svg .map-node').length;
  extractEntities();          // the keystroke path
  return { pooled, showing: FDMap.isShowing(), before };
});
ok('unmounting parks the stage in the pool', parked.pooled, parked);
ok('a parked map reports itself hidden', !parked.showing, parked);

// The frame can't grow to hold a long name: type is sized in screen pixels,
// so a wider frame widens every name too and the two chase each other. Names
// that don't fit are left off instead -- which is only right if nothing ever
// spills over the edge. Checked at both a wide and a very narrow host.
const spill = await page.evaluate(async () => {
  const measure = () => {
    const v = FDMap.view;
    let out = 0, drawn = 0;
    document.querySelectorAll('#map-svg .map-node').forEach(g => {
      const t = g.querySelector('text');
      if (!t) return;
      drawn++;
      const bb = t.getBBox();
      const m = g.transform.baseVal.consolidate();
      const e = m ? m.matrix.e : 0, f = m ? m.matrix.f : 0;
      if (bb.x + e < v.x || bb.x + bb.width + e > v.x + v.w ||
          bb.y + f < v.y || bb.y + bb.height + f > v.y + v.h) out++;
    });
    return { out, drawn };
  };
  FDPanels.setLayoutMode('single');
  FDPanels.setSlotType('slot-1', 'location-map');
  await new Promise(r => setTimeout(r, 600));
  const wide = measure();
  FDPanels.setLayoutMode('quad-4');
  FDPanels.setSlotType('slot-3', 'location-map');
  await new Promise(r => setTimeout(r, 800));
  const narrow = measure();
  return { wide, narrow };
});
ok('no label spills out of the frame, full window',
  spill.wide.out === 0 && spill.wide.drawn > 10, spill.wide);
ok('no label spills out of a quarter-width pane',
  spill.narrow.out === 0 && spill.narrow.drawn > 0, spill.narrow);
ok('a cramped pane labels fewer places, not none',
  spill.narrow.drawn < spill.wide.drawn, spill);

console.log('\n== 7b. Real World mode ==');

// A small script of its own: two rooms in a region that only exists by
// inference (no scene ever visits LOS ALAMOS on its own -- it's a region
// with no seat, the harder of the two shapes FDMap._geocodableNames() has
// to handle), one standalone real place, and one invented one.
await page.evaluate(() => {
  document.getElementById('editor-page').innerHTML =
    '<div class="page-frame">' +
    '<div class="scene-heading">INT. LAB - LOS ALAMOS - DAY</div>' +
    '<div class="action">Scientists work.</div>' +
    '<div class="scene-heading">INT. OFFICE - LOS ALAMOS - NIGHT</div>' +
    '<div class="action">A meeting.</div>' +
    '<div class="scene-heading">EXT. BERKELEY - DAY</div>' +
    '<div class="action">A campus.</div>' +
    '<div class="scene-heading">INT. THE NEBULA CHAMBER - NIGHT</div>' +
    '<div class="action">Not a real place.</div>' +
    '</div>';
  extractEntities();
  FDMap.setMode('world');
});
await new Promise(r => setTimeout(r, 3500));

const world = await page.evaluate(() => ({
  leafletShown: document.getElementById('map-leaflet').style.display !== 'none',
  losAlamos: appState.geo['LOS ALAMOS'],
  berkeley: appState.geo['BERKELEY'],
  nebula: appState.geo['THE NEBULA CHAMBER'],
  fictionShown: document.getElementById('map-fiction-strip').classList.contains('show'),
  fictionText: document.getElementById('map-fiction-strip').textContent,
  markerCount: FDMap._leafletMarkers ? FDMap._leafletMarkers.getLayers().length : -1,
  calls: window.__geocodeCalls.length,
  sub: document.getElementById('map-sub').textContent,
}));
ok('a real place resolves through the mocked lookup',
  !!world.losAlamos && world.losAlamos.lat === 35.8879, world);
ok('a standalone real place resolves too',
  !!world.berkeley && world.berkeley.lat === 37.8716, world);
ok('an invented place is cached as a resolved miss, not left pending',
  world.nebula === null, world);
ok('Leaflet host is shown once in world mode', world.leafletShown, world);
ok('unresolved places show in the fiction strip, tagged',
  world.fictionShown && world.fictionText.includes('THE NEBULA CHAMBER') && world.fictionText.includes('*fictional'),
  world);
// LOS ALAMOS's two rooms share one marker (their region's), BERKELEY gets
// its own, and the invented place gets none: three, not four.
ok("rooms in a region share their region's marker; the fictional place gets none",
  world.markerCount === 3, world);
ok('exactly three lookups were made for three geocodable names', world.calls === 3, world);
// Two geocodable names, not three -- LOS ALAMOS's two rooms count as one
// real place (their region's), same as the marker count above.
ok('summary line reports the split', /2 real places/.test(world.sub) && /1 fictional/.test(world.sub), world);

// Coming back to a mode already filled must not re-query names already in
// the cache -- this is what makes reopening a project's map instant.
await page.evaluate(() => { FDMap.setMode('conceptual'); FDMap.setMode('world'); });
await new Promise(r => setTimeout(r, 500));
const reopened = await page.evaluate(() => window.__geocodeCalls.length);
ok('reopening the map does not re-geocode cached names', reopened === 3, { reopened });

// Clicking a fictional pill jumps to its scene, the same as clicking a marker
// does -- both share FDMap._jumpTo().
const stripClick = await page.evaluate(() => {
  const pill = document.querySelector('.map-fiction-pill[data-loc="THE NEBULA CHAMBER"]');
  if (!pill) return { found: false };
  pill.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rec = locationGraph.nodes.find(n => n.name === 'THE NEBULA CHAMBER');
  return { found: true, flashed: !!(rec && rec.headings[0] && rec.headings[0].style.backgroundColor) };
});
ok('the fictional strip is addressable by name', stripClick.found, stripClick);
ok('clicking it jumps to the scene', stripClick.flashed, stripClick);

// The geocode cache rides in the project file like the rest of appState's
// lists, and survives a save -> load round trip without re-geocoding.
const roundTrip = await page.evaluate(async () => {
  const json = scriptJSON();
  const file = new File([json], 'roundtrip.fdproj', { type: 'application/json' });
  await loadProjectFile(file, null);
  return {
    geo: appState.geo,
    callsDuringLoad: window.__geocodeCalls.length,
  };
});
ok('geo cache is written into the project file and survives a reload',
  roundTrip.geo && roundTrip.geo['LOS ALAMOS'] && roundTrip.geo['LOS ALAMOS'].lat === 35.8879 &&
  roundTrip.geo['BERKELEY'] && roundTrip.geo['THE NEBULA CHAMBER'] === null,
  roundTrip);
ok('loading a project never geocodes on its own', roundTrip.callsDuringLoad === 3, roundTrip);

// Leave the map back in conceptual mode -- section 8 below asserts on the
// conceptual empty-state UI, which renderWorld() has no opinion about.
await page.evaluate(() => { FDMap.setMode('conceptual'); });

console.log('\n== 8. Empty script ==');

const emptyState = await page.evaluate(() => {
  document.getElementById('editor-page').innerHTML =
    '<div class="page-frame"><div class="action">No sluglines here.</div></div>';
  extractEntities();
  const shown = document.getElementById('map-empty').classList.contains('show');
  return { shown, nodes: locationGraph.nodes.length, regions: locationGraph.regions.length };
});
ok('no locations means no graph', emptyState.nodes === 0 && emptyState.regions === 0, emptyState);
ok('empty state message shown instead of a blank map', emptyState.shown, emptyState);

console.log('\n== 9. No console errors ==');
// FDStudioHub.loadCatalog() asks the local server for /api/catalog at boot.
// Over file:// there is no server, so that one request always fails; it
// predates this branch and says nothing about the map.
const relevant = errors.filter(e => !/ERR_FILE_NOT_FOUND/.test(e));
ok('clean run', relevant.length === 0, relevant.slice(0, 5));

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
