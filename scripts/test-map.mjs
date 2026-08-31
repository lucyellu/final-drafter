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

console.log('\n== 4. Map overlay renders ==');

await page.evaluate(() => FDMap.open());
await new Promise(r => setTimeout(r, 900));

const atlas = await page.evaluate(() => {
  const svg = document.getElementById('map-svg');
  return {
    open: document.getElementById('map-overlay').classList.contains('open'),
    nodes: svg.querySelectorAll('.map-node').length,
    paths: svg.querySelectorAll('path').length,
    texts: svg.querySelectorAll('text').length,
    viewBox: svg.getAttribute('viewBox'),
    sub: document.getElementById('map-sub').textContent,
    positioned: FDMap.positions.size,
    finite: [...FDMap.positions.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)),
  };
});
ok('overlay opened', atlas.open, atlas);
ok('one group per location', atlas.nodes === graph.nodes, atlas);
ok('every location got a finite position', atlas.finite && atlas.positioned === graph.nodes, atlas);
ok('viewBox set by fit()', /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(atlas.viewBox || ''), atlas);
ok('labels drawn', atlas.texts > 0, atlas);
ok('summary line filled in', /locations/.test(atlas.sub), atlas);

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
    closed: !document.getElementById('map-overlay').classList.contains('open'),
    name: target.name,
  };
});
ok('a location group is addressable by name', jumped.found, jumped);
ok('picking a place closes the map', jumped.closed, jumped);

console.log('\n== 7. Empty script ==');

const emptyState = await page.evaluate(() => {
  document.getElementById('editor-page').innerHTML =
    '<div class="page-frame"><div class="action">No sluglines here.</div></div>';
  extractEntities();
  FDMap.open();
  const shown = document.getElementById('map-empty').classList.contains('show');
  FDMap.close();
  return { shown, nodes: locationGraph.nodes.length, regions: locationGraph.regions.length };
});
ok('no locations means no graph', emptyState.nodes === 0 && emptyState.regions === 0, emptyState);
ok('empty state message shown instead of a blank map', emptyState.shown, emptyState);

console.log('\n== 8. No console errors ==');
// FDStudioHub.loadCatalog() asks the local server for /api/catalog at boot.
// Over file:// there is no server, so that one request always fails; it
// predates this branch and says nothing about the map.
const relevant = errors.filter(e => !/ERR_FILE_NOT_FOUND/.test(e));
ok('clean run', relevant.length === 0, relevant.slice(0, 5));

console.log(`\n${pass} passed, ${fail} failed\n`);
await browser.close();
process.exit(fail ? 1 : 0);
