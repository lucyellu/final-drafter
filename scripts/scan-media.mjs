// Scans the screenplay and video libraries, pairs them up by title/year, and
// writes media-catalog.json for the Studio Hub (hub.html) to render.
//
// Matching is name-based, because that is all the files carry: release names
// ("The.Devil.Wears.Prada.2.2026.1080p.WEBRip...") and script names
// ("the-devil-wears-prada-2006.pdf") both get stripped down to a bare title
// plus a year, and a pair only counts when the titles are identical and the
// years agree. Deliberately strict -- a wrong pairing silently opens the wrong
// film beside a script, which is worse than showing no pairing at all.
//
// Run:  node scripts/scan-media.mjs [--report]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'media-catalog.json');

const SCRIPT_ROOT = 'L:\\Media\\Text\\Screenplays';
const VIDEO_ROOT = 'L:\\Media\\Video';

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.webm', '.mov']);

// Release-scene noise. Most of it sits after the year and is cut away with it;
// this list only has to clean up the names that carry no year at all
// ("Severance Season 1 Mp4 1080p"), so it stays narrow on purpose -- a token
// like "to" or "2" would eat real titles.
const JUNK = new RegExp('\\b(' + [
    '\\d{3,4}p', '4k', '2160', '1080', '720', '480',
    'bluray', 'brrip', 'bdrip', 'webrip', 'webdl', 'hdrip', 'dvdrip', 'remux',
    'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'xvid', 'divx', '10bit', '8bit', '10bits',
    'aac', 'aac5', 'ac3', 'dts', 'ddp5', 'ddp', 'dd5', 'eac3', 'atmos', 'truehd', '6ch',
    'mp4', 'mkv', 'avi', 'm4v',
    'yts', 'yify', 'rarbg', 'rarbg', 'tgx', 'psa', 'ntb', 'megusta', 'ethel', 'rawr',
    'sartre', 'naisu', 'afm72', 'nikt0', 'gprs', 'byndr', 'mircrew', 'rapta', 'eztvx', 'vppv',
    'sample', 'season', 'complete', 'featurettes', 'criterion', 'remastered', 'remaster',
    'extended', 'unrated', 'proper', 'repack', 'screenplay', 'script', 'shooting', 'draft',
].join('|') + ')\\b', 'gi');

const STOP_PREFIX = /^(the|a|an)\s+/;

// A title plus the year it was released, recovered from a file or folder name.
function normalizeTitle(raw) {
    let s = raw
        .replace(/^www\.[^\s]+\s*-\s*/i, '')      // "www.UIndex.org  -  Title"
        .replace(/\[[^\]]*\]/g, ' ')              // [1080p] [YTS.MX]
        .replace(/['‘’]/g, '')          // lampoon's -> lampoons, not "lampoon s"
        .replace(/[._]/g, ' ')
        .replace(/\s*-\s*/g, ' ')
        .toLowerCase();

    // The first 19xx/20xx is the release year; everything after it is noise.
    const yearMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    if (yearMatch) s = s.slice(0, yearMatch.index);

    // An episode code ends the title: what follows is the episode's own name
    // ("For All Mankind S01E01 Red Moon"), which the series does not share.
    const epCut = s.match(/\bs\d{1,2}\s?e\d{1,2}\b|\b\d{1,2}x\d{2}\b/);
    if (epCut) s = s.slice(0, epCut.index);

    s = s.replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\bseasons?\s*\d{1,2}\b/g, ' ')   // "Severance Season 1 Mp4"
        .replace(JUNK, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return { title: s, year };
}

// TV episode codes: "S01E02", "1x01", or the screenplay convention of a bare
// three-digit code ("the-office-101-pilot-2005" = season 1, episode 01).
function extractEpisode(raw) {
    const s = raw.toLowerCase();
    let m = s.match(/\bs(\d{1,2})[._ ]?e(\d{1,2})\b/);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    m = s.match(/\b(\d{1,2})x(\d{2})\b/);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    m = s.match(/-(\d)(\d{2})-/);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
    return null;
}

function stripEpisodeCode(title) {
    return title
        .replace(/\bs\d{1,2}\s*e\d{1,2}\b/g, ' ')
        .replace(/\b\d{1,2}x\d{2}\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Comparison key: no leading article, no spaces, no episode code. "The Truman
// Show" and "truman.show" collapse to the same thing; "The Devil Wears Prada"
// and "The Devil Wears Prada 2" stay apart, which is the point.
function matchKey(title) {
    return stripEpisodeCode(title).replace(STOP_PREFIX, '').replace(/\s+/g, '');
}

function titleCase(s) {
    const small = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'vs', 'with']);
    return s.split(' ').map((w, i) => {
        if (i > 0 && small.has(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
}

// ---------------------------------------------------------------- screenplays
function scanScripts() {
    let entries;
    try { entries = fs.readdirSync(SCRIPT_ROOT, { withFileTypes: true }); }
    catch (e) { console.error('Cannot read ' + SCRIPT_ROOT + ': ' + e.message); return []; }

    return entries
        .filter(d => d.isFile() && /\.pdf$/i.test(d.name))
        .map(d => {
            const full = path.join(SCRIPT_ROOT, d.name);
            // "project-hail-mary-2026.pdf.pdf" -- strip every trailing .pdf.
            let base = d.name.replace(/(\.pdf)+$/i, '');

            // The Black List batch is numbered "07-COBWEB", "33-73-SECONDS":
            // the rank is not part of the title. Only strip it when the rest
            // of the name is upper-case, which is what separates that batch
            // from titles that genuinely start with a number
            // ("21-jump-street-2012", "10-things-i-hate-about-you-1999").
            const numbered = base.match(/^(\d{1,3})-(.+)$/);
            if (numbered && numbered[2] === numbered[2].toUpperCase()) base = numbered[2];

            let { title, year } = normalizeTitle(base);

            // Episode scripts are named "showname-101-episodetitle-year"; keep
            // the show, drop the episode's own title so it can pair with a
            // season folder.
            const epCode = title.match(/(?<=\s)\d{3}(?=\s)/);
            if (epCode) title = title.slice(0, epCode.index).trim();
            let size = 0;
            try { size = fs.statSync(full).size; } catch { }
            return {
                file: d.name,
                path: full,
                size,
                rawTitle: base,
                title: stripEpisodeCode(title),
                year,
                episode: extractEpisode(base),
                key: matchKey(title),
            };
        })
        .filter(s => s.key.length >= 3);
}

// -------------------------------------------------------------------- videos
function walk(dir, depth, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1, out); }
        else if (VIDEO_EXT.has(path.extname(e.name).toLowerCase())) {
            let size = 0;
            try { size = fs.statSync(p).size; } catch { }
            out.push({ path: p, name: e.name, size });
        }
    }
    return out;
}

function scanVideos() {
    const files = walk(VIDEO_ROOT, 0, [])
        .filter(v => v.size > 50 * 1024 * 1024)              // drop samples and menu art
        .filter(v => !/\bsample\b/i.test(v.name))
        .filter(v => !/[\\/]Featurettes[\\/]/i.test(v.path));

    // Group by the top-level entry under the video root: a season folder is one
    // title with many episodes, a loose .mkv is one title with one file.
    const groups = new Map();
    for (const v of files) {
        const rel = path.relative(VIDEO_ROOT, v.path);
        const top = rel.split(path.sep)[0].replace(/\.(mkv|mp4|avi|m4v|webm|mov)$/i, '');
        if (!groups.has(top)) groups.set(top, []);
        groups.get(top).push(v);
    }

    const out = [];
    for (const [group, list] of groups) {
        // Folder names are usually cleaner than release filenames, but some
        // folders are bare ("pluribus") -- fall back to a file for the year.
        let { title, year } = normalizeTitle(group);
        const alt = normalizeTitle(list[0].name);
        if (year == null) year = alt.year;
        if (title.length < 3) title = alt.title;

        const filesOut = list.map(f => ({
            path: f.path,
            name: f.name,
            size: f.size,
            ext: path.extname(f.name).toLowerCase(),
            episode: extractEpisode(f.name) || extractEpisode(path.basename(path.dirname(f.path))),
        })).sort((a, b) => {
            if (a.episode && b.episode) {
                return (a.episode.season - b.episode.season) || (a.episode.episode - b.episode.episode);
            }
            return b.size - a.size;
        });

        out.push({ group, title: stripEpisodeCode(title), year, files: filesOut, key: matchKey(title) });
    }

    // One show can arrive as several folders -- three separate Three-Body
    // torrents, two episodes of The Studio. Same title and same year means the
    // same IP, so fold them into a single entry with all their files.
    const merged = new Map();
    for (const v of out) {
        const id = v.key + '|' + (v.year == null ? '' : v.year);
        const prev = merged.get(id);
        if (!prev) { merged.set(id, v); continue; }
        prev.files = prev.files.concat(v.files).sort((a, b) => {
            if (a.episode && b.episode) {
                return (a.episode.season - b.episode.season) || (a.episode.episode - b.episode.episode);
            }
            return b.size - a.size;
        });
        // Keep the shorter folder name -- it is the one with less release noise.
        if (v.group.length < prev.group.length) prev.group = v.group;
    }
    return Array.from(merged.values());
}

// Chrome plays MP4/WebM with H.264 or (on Windows, hardware permitting) HEVC.
// Matroska and AVI are not supported containers at all, whatever is inside
// them -- those entries get an "open externally" route instead of <video>.
function playability(file) {
    const ext = file.ext;
    const n = file.name.toLowerCase();
    if (ext === '.mkv' || ext === '.avi') {
        return { level: 'external', reason: ext.slice(1).toUpperCase() + ' container is not playable in Chrome' };
    }
    if (ext === '.mp4' || ext === '.m4v' || ext === '.webm' || ext === '.mov') {
        if (/x265|h ?265|hevc/.test(n)) {
            return { level: 'maybe', reason: 'HEVC video - plays only with hardware decode support' };
        }
        return { level: 'good', reason: '' };
    }
    return { level: 'maybe', reason: 'Unrecognised container' };
}

function slug(s) {
    return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

// --------------------------------------------------------------------- build
const scripts = scanScripts();
const videos = scanVideos();

const yearsAgree = (a, b) => a == null || b == null || Math.abs(a - b) <= 1;

const usedScripts = new Set();
const usedVideos = new Set();
const items = [];

for (const v of videos) {
    const hits = scripts.filter(s => s.key === v.key && yearsAgree(s.year, v.year));
    if (!hits.length) continue;

    hits.forEach(s => usedScripts.add(s.file));
    usedVideos.add(v.group);

    // A season folder paired with per-episode scripts: line each script up with
    // the episode that carries the same season/episode code.
    const isSeries = v.files.length > 1 && v.files.some(f => f.episode);

    items.push({
        id: slug(v.title + '-' + (v.year || '')),
        title: titleCase(v.title),
        year: v.year || (hits[0] && hits[0].year) || null,
        kind: isSeries ? 'series' : 'film',
        videoFolder: v.group,
        videos: v.files.map(f => ({
            path: f.path,
            name: f.name,
            size: f.size,
            episode: f.episode,
            play: playability(f),
        })),
        scripts: hits.map(s => ({
            path: s.path,
            name: s.file,
            size: s.size,
            episode: s.episode,
        })),
    });
}

items.sort((a, b) => a.title.localeCompare(b.title));

const catalog = {
    generatedAt: new Date().toISOString(),
    roots: { scripts: SCRIPT_ROOT, videos: VIDEO_ROOT },
    counts: {
        scripts: scripts.length,
        videoTitles: videos.length,
        matched: items.length,
    },
    items,
    // Kept so the hub can offer a "what is missing its counterpart" view
    // without a second scan.
    scriptOnly: scripts.filter(s => !usedScripts.has(s.file))
        .map(s => ({ title: titleCase(s.title), year: s.year, name: s.file, path: s.path, size: s.size })),
    videoOnly: videos.filter(v => !usedVideos.has(v.group))
        .map(v => ({
            title: titleCase(v.title), year: v.year, folder: v.group,
            path: v.files[0].path, name: v.files[0].name, size: v.files[0].size,
            files: v.files.length, play: playability(v.files[0]),
        })),
};

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));

console.log('Screenplays: ' + catalog.counts.scripts);
console.log('Video titles: ' + catalog.counts.videoTitles);
console.log('Matched IPs: ' + catalog.counts.matched);
for (const it of items) {
    console.log('  - ' + it.title + ' (' + it.year + ')  [' + it.kind + ']  '
        + it.scripts.length + ' script(s), ' + it.videos.length + ' video(s), '
        + it.videos[0].play.level);
}
console.log('Wrote ' + OUT);

if (process.argv.includes('--report')) {
    console.log('\nUnmatched videos (' + catalog.videoOnly.length + '):');
    catalog.videoOnly.forEach(v => console.log('  ' + v.title + ' (' + v.year + ')'));
    console.log('\nUnmatched scripts (' + catalog.scriptOnly.length + '):');
    catalog.scriptOnly.forEach(s => console.log('  ' + s.title + ' (' + s.year + ')'));
}
