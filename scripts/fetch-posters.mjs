// Fetches real poster art from TMDb for everything in the catalog that is an
// actual released title, and caches it under posters/.
//
// Run:  node scripts/fetch-posters.mjs [--force] [--dry] [--limit N]
//         --force  refetch titles already in the index
//         --dry    show what it would match, download nothing
//         --limit  stop after N lookups (for a quick sanity check)
//
// Needs a free TMDb key, from https://www.themoviedb.org/settings/api, in
// either the TMDB_API_KEY environment variable or a tmdb-key.txt file in the
// repo root (gitignored). Both the v3 key and the v4 read token work.
//
// Deliberately does NOT look up every screenplay. Half the library is
// unproduced Black List specs, and their titles are landmines: "Beast",
// "Dark", "Conviction", "Grace", "Ride" and "Queen" are all real films that
// TMDb would happily return a poster for -- the wrong poster, on a script that
// has nothing to do with them. So a screenplay is only searched when
// genres.mjs already recognises it as a produced work. Films from the video
// library are always searched, because those are releases by definition.

import fs from 'fs';
import path from 'path';
import {
    ROOT, POSTER_DIR, CATALOG_FILE,
    posterKey, loadIndex, saveIndex, stampPosters,
} from './posters.mjs';

const IMG_BASE = 'https://image.tmdb.org/t/p/w500';
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry');
const LIMIT = (() => {
    const i = args.indexOf('--limit');
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : Infinity;
})();

// ------------------------------------------------------------------- the key
// TMDb's settings page shows the v4 token and the v3 key together under their
// labels, and pasting the whole block into the file is the obvious thing to
// do -- so pull the credential out of whatever is in there rather than
// trusting the file to hold nothing else. Feeding a stray label into an auth
// header throws deep inside fetch, with the key in the message.
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/;
const HEX32 = /\b[0-9a-f]{32}\b/;

function extractKey(text) {
    if (!text) return null;
    const jwt = text.match(JWT);
    if (jwt) return jwt[0];              // v4 read access token
    const hex = text.match(HEX32);
    if (hex) return hex[0];              // v3 api key
    return null;
}

function readKey() {
    const env = extractKey(process.env.TMDB_API_KEY || process.env.TMDB_TOKEN || '');
    if (env) return env;
    const f = path.join(ROOT, 'tmdb-key.txt');
    if (fs.existsSync(f)) return extractKey(fs.readFileSync(f, 'utf8'));
    return null;
}

// A v4 read token is a JWT; a v3 key is a bare 32-character hex string. They
// authenticate differently, so tell them apart rather than making the user say.
const isBearer = k => JWT.test(k);

const KEY = readKey();
if (!KEY) {
    console.error('No TMDb key found.');
    console.error('');
    console.error('  1. Sign in at https://www.themoviedb.org and open');
    console.error('     Settings -> API, then request a free key.');
    console.error('  2. Save it as tmdb-key.txt in ' + ROOT);
    console.error('     (or set TMDB_API_KEY in the environment).');
    console.error('  3. Re-run: node scripts/fetch-posters.mjs');
    console.error('');
    console.error('The hub works without it -- Cover mode just falls back to');
    console.error('screenplay title pages and colour tiles.');
    process.exit(2);
}

// ----------------------------------------------------------------- requests
function apiUrl(pathname, params) {
    const u = new URL('https://api.themoviedb.org/3' + pathname);
    for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') u.searchParams.set(k, String(v));
    }
    if (!isBearer(KEY)) u.searchParams.set('api_key', KEY);
    return u;
}

async function getJson(url) {
    const headers = { accept: 'application/json' };
    if (isBearer(KEY)) headers.authorization = 'Bearer ' + KEY;
    for (let attempt = 0; attempt < 3; attempt++) {
        let res;
        try {
            res = await fetch(url, { headers });
        } catch (e) {
            if (attempt === 2) throw e;
            await sleep(600 * (attempt + 1));
            continue;
        }
        if (res.status === 429) {                       // rate limited
            const wait = Number(res.headers.get('retry-after') || 2) * 1000;
            await sleep(wait + 250);
            continue;
        }
        if (res.status === 401) {
            throw new Error('TMDb rejected the key (401). Check tmdb-key.txt.');
        }
        if (!res.ok) return null;
        return res.json();
    }
    return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ matching
const yearOf = (r, media) => {
    const d = media === 'tv' ? r.first_air_date : r.release_date;
    const y = d ? Number(String(d).slice(0, 4)) : null;
    return Number.isFinite(y) ? y : null;
};
const nameOf = (r, media) => posterKey(media === 'tv' ? (r.name || '') : (r.title || ''));

// Filenames in this library punctuate and space titles however the ripper felt
// on the day: "Thesocialnetwork", "Mr and Mrs Smith" for "Mr. & Mrs. Smith",
// "The Perks of Being a Wall Flower" for "...Wallflower". Comparing on letters
// alone, with the joining words dropped, makes all of those the same string.
const squash = t => posterKey(t).replace(/\b(and|the|a|an|of)\b/g, '').replace(/[^a-z0-9]/g, '');

// Conservative on purpose: a wrong poster is worse than a colour tile, because
// it silently asserts the file is something it is not. An exact title match
// clears the bar alone; a partial one only clears it with the year agreeing.
function score(results, title, year, media) {
    if (!results || !results.length) return [];
    const want = posterKey(title);
    const wantSquashed = squash(title);
    return results
        .filter(r => r.poster_path)
        .map(r => {
            const n = nameOf(r, media);
            const ns = squash(n);
            const y = yearOf(r, media);
            let s = 0;
            if (n === want || (ns && ns === wantSquashed)) s += 100;
            else if (ns && wantSquashed && (ns.startsWith(wantSquashed) || wantSquashed.startsWith(ns))) s += 40;
            if (year != null && y != null) {
                if (y === year) s += 30;
                else if (Math.abs(y - year) <= 1) s += 15;
                else s -= 25;
            }
            s += Math.min(8, (r.popularity || 0) / 25);
            return {
                s,
                exact: n === want || (ns && ns === wantSquashed),
                tmdbId: r.id,
                media,
                tmdbTitle: media === 'tv' ? r.name : r.title,
                tmdbYear: y,
                posterPath: r.poster_path,
                // TMDb's own user score (0-10), not IMDb or Rotten Tomatoes --
                // TMDb's search results don't carry those. vote_count is kept
                // alongside it so a rating from three votes can be told apart
                // from one backed by thousands.
                rating: typeof r.vote_average === 'number' ? r.vote_average : null,
                voteCount: r.vote_count || 0,
            };
        });
}

// Trailing noise a screenplay filename picks up and a database never carries.
const NOISE_TAIL = /\s+(pilot|screenplay|script|draft|final|sample|revised|shooting|us version|version)$/i;

async function search(title, year, kind) {
    const candidates = [];
    const ask = async (media, query, params) => {
        const json = await getJson(apiUrl('/search/' + media, { query, ...params }));
        candidates.push(...score(json && json.results, title, year, media));
    };

    // Ask both ways round and keep every candidate, rather than taking the
    // first that clears the bar. Searching movies first and stopping there is
    // how "The Office" ends up as a 1993 film instead of the series: a hit
    // that merely passes is not the same as the best one available.
    for (const media of ['movie', 'tv']) {
        const withYear = media === 'tv' ? { first_air_date_year: year } : { year };
        await ask(media, title, year != null ? withYear : {});
        // A screenplay is often dated by its draft, not its release, so a
        // year-filtered search can miss a title a plain one finds.
        if (year != null) await ask(media, title, {});
    }

    let best = candidates.sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 60) return { ...best, score: Math.round(best.s) };

    // Nothing yet. Video folders and script filenames often carry a tail the
    // real title does not ("Die Hard 1 2 3 4 5 Bruce Willis Action", "Breaking
    // Bad Pilot"), so try shedding it a word at a time -- but only accept an
    // exact title match from a shortened query, since a shorter query is by
    // definition a vaguer one.
    // Try the noise-stripped stem itself first: "Breaking Bad Pilot" becomes
    // "Breaking Bad", which is already two words, so the trim loop below would
    // never get a look at it. Then trim far enough back that a nine-word folder
    // name can still reach the two-word title buried at its front.
    const stem = title.replace(NOISE_TAIL, '').trim();
    const words = stem.split(/\s+/);
    const shorterQueries = [];
    if (stem && stem !== title) shorterQueries.push(stem);
    for (let n = words.length - 1; n >= 2 && words.length - n <= 8; n--) {
        shorterQueries.push(words.slice(0, n).join(' '));
    }
    for (const shorter of shorterQueries) {
        const tries = [];
        for (const media of ['movie', 'tv']) {
            const json = await getJson(apiUrl('/search/' + media, { query: shorter }));
            tries.push(...score(json && json.results, shorter, year, media));
        }
        const hit = tries.filter(c => c.exact).sort((a, b) => b.s - a.s)[0];
        if (hit) return { ...hit, score: Math.round(hit.s), via: shorter };
    }
    return null;
}

// ---------------------------------------------------------------------- run
const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
const index = FORCE ? {} : loadIndex();
const keptIndex = loadIndex();

// A screenplay is only searched if genres.mjs vouches for it as a real title;
// anything from the video library is a release and always gets a look.
const queue = [];
const seen = new Set();
const consider = (it, fromVideoLibrary) => {
    const key = posterKey(it.title);
    if (!key || seen.has(key)) return;
    if (!fromVideoLibrary && !(it.genres && it.genres.length)) return;
    seen.add(key);
    if (!FORCE && index[key]) return;
    queue.push({ key, title: it.title, year: it.year, kind: it.kind || 'film' });
};
catalog.items.forEach(it => consider(it, true));
catalog.videoOnly.forEach(it => consider(it, true));
catalog.scriptOnly.forEach(it => consider(it, false));

const work = queue.slice(0, LIMIT === Infinity ? queue.length : LIMIT);
console.log('Titles worth a lookup: ' + queue.length
    + (work.length < queue.length ? ' (doing ' + work.length + ')' : '')
    + ' -- ' + Object.keys(keptIndex).length + ' already cached');
if (!work.length) console.log('Nothing to fetch. Use --force to refetch.');

fs.mkdirSync(POSTER_DIR, { recursive: true });

let found = 0, missed = 0, failed = 0;
const unmatched = [];
const borrowed = [];

async function download(hit, key) {
    const file = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.jpg';
    const dest = path.join(POSTER_DIR, file);
    const res = await fetch(IMG_BASE + hit.posterPath);
    if (!res.ok) throw new Error('image ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) throw new Error('image too small (' + buf.length + ' bytes)');
    fs.writeFileSync(dest, buf);
    return { file, bytes: buf.length };
}

// Four at a time: comfortably inside TMDb's limits and still quick over ~150
// titles, without hammering a free API.
async function pool(items, size, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (i < items.length) {
            const item = items[i++];
            await fn(item);
        }
    });
    await Promise.all(workers);
}

await pool(work, 4, async job => {
    let hit;
    try {
        hit = await search(job.title, job.year, job.kind);
    } catch (e) {
        failed++;
        console.log('  ERR   ' + job.title + ' -- ' + e.message);
        return;
    }
    if (!hit) {
        missed++;
        unmatched.push(job);
        return;
    }
    const label = hit.tmdbTitle + (hit.tmdbYear ? ' (' + hit.tmdbYear + ')' : '')
        + ' [' + hit.media + ', score ' + hit.score + (hit.via ? ', via "' + hit.via + '"' : '') + ']';
    if (DRY) {
        found++;
        console.log('  would  ' + job.title.padEnd(42) + ' -> ' + label);
        return;
    }
    try {
        const dl = await download(hit, job.key);
        index[job.key] = {
            file: dl.file, title: job.title,
            tmdbId: hit.tmdbId, media: hit.media,
            tmdbTitle: hit.tmdbTitle, tmdbYear: hit.tmdbYear,
            rating: hit.rating, voteCount: hit.voteCount,
            fetchedAt: new Date().toISOString(),
        };
        found++;
        console.log('  ok     ' + job.title.padEnd(42) + ' -> ' + label);
    } catch (e) {
        failed++;
        console.log('  ERR   ' + job.title + ' -- ' + e.message);
    }
});

// Some filenames arrive with the spaces beaten out of them -- "Jerrymaguire",
// "Theofficesample Themasseuse". TMDb has no way to search for those, but the
// library usually holds the same title spelled properly, and squashed keys
// make the two identical -- so borrow the poster already found for the twin
// rather than leaving a tile. Six characters minimum, or a short key like
// "her" would adopt half the library.
{
    const twins = Object.entries(index)
        .map(([k, v]) => ({ sq: squash(k), v }))
        .filter(t => t.sq.length >= 6)
        .sort((a, b) => b.sq.length - a.sq.length);
    for (const job of unmatched.slice()) {
        const sq = squash(job.title);
        const twin = twins.find(t => sq === t.sq || sq.startsWith(t.sq));
        if (!twin) continue;
        index[job.key] = { ...twin.v, title: job.title, borrowedFrom: twin.v.title };
        borrowed.push(job.title + '  <- ' + twin.v.title);
        unmatched.splice(unmatched.indexOf(job), 1);
        missed--; found++;
    }
}

if (!DRY) {
    saveIndex(index);
    // Stamp the catalog in place so the hub picks the covers up on a reload,
    // without a full rescan of the media drive.
    const n = stampPosters(catalog, index);
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
    console.log('\nCatalog stamped: ' + n + ' of '
        + (catalog.items.length + catalog.scriptOnly.length + catalog.videoOnly.length)
        + ' titles now have a poster.');
}

console.log('\nfound ' + found + ' - no confident match ' + missed + ' - errors ' + failed);
if (borrowed.length) {
    console.log('\nBorrowed from a properly spelled twin in the library:');
    borrowed.sort().forEach(m => console.log('  ' + m));
}
if (unmatched.length) {
    console.log('\nNo confident match (left on a colour tile):');
    unmatched.map(j => j.title + (j.year ? ' (' + j.year + ')' : ''))
        .sort().forEach(m => console.log('  ' + m));
}
