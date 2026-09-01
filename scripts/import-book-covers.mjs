// Pulls book cover art from the booklit app (L:\Projects\book_app\booklit)
// instead of searching for it again. booklit scans the same L:\Media\Text
// tree and, for each EPUB/PDF, either pulls the file's own embedded cover
// image (JSZip for EPUB's OPF manifest, mupdf's first-page render for PDF) or
// falls back to a title/author search cache -- see its scripts/build-all-
// covers.mjs. That means an exact-path match here is a real cover, not a
// fuzzy title guess the way a fresh API search would be.
//
// Run:  node scripts/import-book-covers.mjs [--dry]
//
// If booklit's own public/data/catalog.json is stale (a book added to the
// library since its last run, or the run hasn't happened yet), re-run it
// first from that repo: node scripts/build-all-covers.mjs

import fs from 'fs';
import path from 'path';
import {
    POSTER_DIR, CATALOG_FILE,
    posterKey, loadIndex, saveIndex, stampPosters,
} from './posters.mjs';

const DRY = process.argv.includes('--dry');

const TEXT_ROOT = 'L:\\Media\\Text';
const BOOKLIT_ROOT = 'L:\\Projects\\book_app\\booklit';
const BOOKLIT_CATALOG = path.join(BOOKLIT_ROOT, 'public', 'data', 'catalog.json');
const BOOKLIT_PUBLIC = path.join(BOOKLIT_ROOT, 'public');

if (!fs.existsSync(BOOKLIT_CATALOG)) {
    console.error('No booklit catalog at ' + BOOKLIT_CATALOG);
    console.error('Run its cover build first: cd ' + BOOKLIT_ROOT + ' && node scripts/build-all-covers.mjs');
    process.exit(2);
}

const booklit = JSON.parse(fs.readFileSync(BOOKLIT_CATALOG, 'utf8'));
const norm = p => p.replace(/\\/g, '/').toLowerCase();
const byRelpath = new Map();
for (const b of booklit.books) {
    if (b.relpath && b.coverUrl) byRelpath.set(norm(b.relpath), b);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
const index = loadIndex();
const books = catalog.scriptOnly.filter(x => x.kind === 'book');

fs.mkdirSync(POSTER_DIR, { recursive: true });

let copied = 0, downloaded = 0, noBooklitMatch = 0, noCoverInBooklit = 0, failed = 0;

for (const book of books) {
    const key = posterKey(book.title);
    if (!key) continue;

    let rel;
    try { rel = path.relative(TEXT_ROOT, book.path); }
    catch { noBooklitMatch++; continue; }
    if (rel.startsWith('..')) { noBooklitMatch++; continue; }

    const match = byRelpath.get(norm(rel));
    if (!match) {
        // Present in booklit's library but its own extraction/search came up
        // empty too -- not worth a second guess here.
        noCoverInBooklit++;
        continue;
    }

    const file = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    try {
        if (match.coverUrl.startsWith('/data/')) {
            const src = path.join(BOOKLIT_PUBLIC, match.coverUrl.replace(/^\//, ''));
            const ext = path.extname(src) || '.jpg';
            const dest = path.join(POSTER_DIR, file + ext);
            if (!DRY) {
                fs.copyFileSync(src, dest);
                index[key] = { file: file + ext, title: book.title, source: 'booklit-extracted', fetchedAt: new Date().toISOString() };
            }
            copied++;
        } else {
            const res = await fetch(match.coverUrl);
            if (!res.ok) throw new Error('image ' + res.status);
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 500) throw new Error('image too small (' + buf.length + ' bytes)');
            const dest = path.join(POSTER_DIR, file + '.jpg');
            if (!DRY) {
                fs.writeFileSync(dest, buf);
                index[key] = { file: file + '.jpg', title: book.title, source: 'booklit-search:' + match.coverUrl, fetchedAt: new Date().toISOString() };
            }
            downloaded++;
        }
    } catch (e) {
        failed++;
        console.log('  ERR  ' + book.title + ' -- ' + e.message);
    }
}

if (!DRY) {
    saveIndex(index);
    const n = stampPosters(catalog, index);
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
    console.log('Catalog stamped: ' + n + ' titles now have cover art (films and books combined).');
}

console.log('\n' + books.length + ' books in this catalog'
    + "\n  copied from booklit's local extraction: " + copied
    + "\n  downloaded via booklit's search cache:  " + downloaded
    + '\n  in booklit but it has no cover either:   ' + noCoverInBooklit
    + '\n  not found in booklit\'s catalog at all:   ' + noBooklitMatch
    + '\n  errors:                                  ' + failed);
