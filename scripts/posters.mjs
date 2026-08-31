// Where cover art lives, and how the catalog gets told about it.
//
// Posters are fetched separately (scripts/fetch-posters.mjs) rather than during
// a scan, because a scan walks a spinning L: drive and should stay offline and
// fast. The two meet here: the fetcher writes posters/index.json, and both the
// scanner and the fetcher stamp that index onto the catalog the hub reads.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { genreKey } from './genres.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const POSTER_DIR = path.join(ROOT, 'posters');
export const INDEX_FILE = path.join(POSTER_DIR, 'index.json');
export const CATALOG_FILE = path.join(ROOT, 'media-catalog.json');

// The same loose title key the genre map uses, so "The Truman Show", the
// folder and the screenplay all land on one poster.
export const posterKey = genreKey;

export function loadIndex() {
    try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
    catch (e) { return {}; }
}

export function saveIndex(ix) {
    fs.mkdirSync(POSTER_DIR, { recursive: true });
    fs.writeFileSync(INDEX_FILE, JSON.stringify(ix, null, 2));
}

// Every title in the catalog, as one list -- the three buckets all take covers.
export function allEntries(catalog) {
    return catalog.items.concat(catalog.scriptOnly, catalog.videoOnly);
}

// Stamped as a URL, not a disk path: the hub only ever asks the server for it.
export function stampPosters(catalog, ix) {
    if (!ix) ix = loadIndex();
    let n = 0;
    for (const it of allEntries(catalog)) {
        const hit = ix[posterKey(it.title)];
        if (hit && hit.file) { it.poster = '/posters/' + hit.file; n++; }
        else delete it.poster;
        if (hit && typeof hit.rating === 'number') { it.rating = hit.rating; it.voteCount = hit.voteCount || 0; }
        else { delete it.rating; delete it.voteCount; }
    }
    catalog.counts.posters = n;
    return n;
}
