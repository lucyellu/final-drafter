// Tiny static file server for Final Drafter.
//
// Why this exists: launch-final-drafter.bat used to open empty.html straight
// off disk (file:///...). On an opaque file:// origin Chrome blocks Web
// Workers, blocks WASM instantiation, and gives unreliable IndexedDB -- a
// hard wall in front of OCR (tesseract.js is worker+WASM) and autosave/
// version history (which need IndexedDB). Serving the same file over
// http://127.0.0.1 removes all three restrictions with no code changes to
// the app itself.
//
// Run from the repo root:  node scripts/serve.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const START_PORT = Number(process.argv[2]) || 8743;
const MAX_PORT_ATTEMPTS = 20;

// The Studio Hub (hub.html) reads screenplays and films that live outside the
// repo, so those two folders -- and nothing else on the disk -- are readable
// through /media. See serveMedia() for how a request is checked against them.
const MEDIA_ROOTS = [
    'L:\\Media\\Text\\Screenplays',
    'L:\\Media\\Video',
];
const MEDIA_EXT = new Set(['.pdf', '.mkv', '.mp4', '.avi', '.m4v', '.webm', '.mov', '.srt', '.vtt']);
const CATALOG_FILE = path.join(ROOT, 'media-catalog.json');
const SCANNER = path.join(ROOT, 'scripts', 'scan-media.mjs');
// Nothing in this single-file app fetches anything from the server after
// initial load -- IndexedDB and already-running Web Workers keep working
// with the server gone. So an idle server (no requests for this long) is
// safe to shut down; it's the launcher's stand-in for "the window closed"
// without having to track Chrome's process tree, which is unreliable once
// another Chrome instance is already running.
const IDLE_SHUTDOWN_MS = 20 * 60 * 1000;

const MIME = {
    '.html': 'text/html', '.htm': 'text/html',
    '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json',
    '.ico': 'image/x-icon', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.txt': 'text/plain', '.md': 'text/markdown', '.fountain': 'text/plain',
    '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.srt': 'text/plain', '.vtt': 'text/vtt',
};

let idleTimer = null;
function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        console.log('Idle for ' + (IDLE_SHUTDOWN_MS / 60000) + ' minutes, shutting down.');
        process.exit(0);
    }, IDLE_SHUTDOWN_MS);
}

function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(body);
}

// A /media path is only served if it resolves inside one of MEDIA_ROOTS and
// carries a media extension. Both checks matter: the first stops "..\..\" from
// walking out of the library, the second stops the server from handing out
// whatever else happens to be sitting in those folders.
function resolveMediaPath(raw) {
    if (!raw) return null;
    const p = path.normalize(raw);
    const inRoot = MEDIA_ROOTS.some(root => {
        const r = path.normalize(root) + path.sep;
        return (p + path.sep).toLowerCase().startsWith(r.toLowerCase());
    });
    if (!inRoot) return null;
    if (!MEDIA_EXT.has(path.extname(p).toLowerCase())) return null;
    return p;
}

// Streams a library file, honouring Range requests. Range is what makes a
// 7 GB film seekable in a <video> tag -- without it Chrome has to pull the
// whole file before it can jump anywhere, and scrubbing is unusable.
function serveMedia(req, res, rawPath) {
    const filePath = resolveMediaPath(rawPath);
    if (!filePath) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden: outside the media library');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }

        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range;

        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            let start = m && m[1] ? parseInt(m[1], 10) : 0;
            let end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
            if (isNaN(start) || start < 0) start = 0;
            if (isNaN(end) || end >= stat.size) end = stat.size - 1;
            if (start > end) {
                res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });
                res.end();
                return;
            }
            res.writeHead(206, {
                'Content-Type': type,
                'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
            });
            const stream = fs.createReadStream(filePath, { start, end });
            stream.on('error', () => res.destroy());
            // A seek aborts the in-flight response; without this the read
            // stream keeps pulling from a 7 GB file nobody is listening to.
            res.on('close', () => stream.destroy());
            stream.pipe(res);
            return;
        }

        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    });
}

function runScanner(cb) {
    execFile(process.execPath, [SCANNER], { cwd: ROOT }, (err, stdout, stderr) => {
        if (err) { cb(new Error(stderr || err.message)); return; }
        cb(null, stdout);
    });
}

function serveCatalog(res, forceRescan) {
    const send = () => {
        fs.readFile(CATALOG_FILE, (err, data) => {
            if (err) { sendJson(res, 500, { error: 'No catalog: ' + err.message }); return; }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    };
    if (!forceRescan && fs.existsSync(CATALOG_FILE)) { send(); return; }
    runScanner(err => {
        if (err && !fs.existsSync(CATALOG_FILE)) { sendJson(res, 500, { error: String(err.message) }); return; }
        send();
    });
}

// Matroska and AVI are not containers Chrome can play at all, so the hub offers
// to hand those files to whatever the OS has registered instead. Local-only,
// bound to 127.0.0.1, and restricted to the same two library folders.
function openExternally(res, rawPath) {
    const filePath = resolveMediaPath(rawPath);
    if (!filePath) { sendJson(res, 403, { error: 'Outside the media library' }); return; }
    if (!fs.existsSync(filePath)) { sendJson(res, 404, { error: 'Not found' }); return; }
    try {
        // "start" needs an empty title argument first, or it treats a quoted
        // path as the window title and opens nothing.
        const child = spawn('cmd', ['/c', 'start', '', filePath], { detached: true, stdio: 'ignore' });
        child.unref();
        sendJson(res, 200, { ok: true, path: filePath });
    } catch (e) {
        sendJson(res, 500, { error: String(e.message) });
    }
}

function openExternalUrl(res, targetUrl) {
    if (!targetUrl) { sendJson(res, 400, { error: 'Missing target url' }); return; }
    try {
        const u = new URL(targetUrl);
        if (!['http:', 'https:'].includes(u.protocol)) {
            sendJson(res, 400, { error: 'Invalid URL protocol' });
            return;
        }
        const child = spawn('cmd', ['/c', 'start', '', targetUrl], { detached: true, stdio: 'ignore' });
        child.unref();
        sendJson(res, 200, { ok: true, url: targetUrl });
    } catch (e) {
        sendJson(res, 500, { error: String(e.message) });
    }
}

function fetchUrlMetadata(res, targetUrl) {
    if (!targetUrl) { sendJson(res, 400, { error: 'Missing url query parameter' }); return; }
    try {
        const u = new URL(targetUrl);
        if (!['http:', 'https:'].includes(u.protocol)) {
            sendJson(res, 400, { error: 'Invalid URL protocol' });
            return;
        }
    } catch (e) {
        sendJson(res, 400, { error: 'Invalid URL: ' + e.message });
        return;
    }

    const isPin = /pinterest\.|pin\.it/i.test(targetUrl);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    fetch(targetUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) })
        .then(async r => {
            const finalUrl = r.url || targetUrl;
            const html = await r.text();

            let ogImg = (html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
                         html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                         html.match(/name=["']twitter:image:src["']\s+content=["']([^"']+)["']/i))?.[1];

            if (ogImg && isPin) {
                ogImg = ogImg.replace(/\/(?:200x150|236x|474x)\//, '/736x/');
            }
            if (!ogImg && isPin) {
                const pinImgMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:736x|originals|564x|474x|236x)\/[a-f0-9\/]+\.(?:jpg|png|webp|jpeg)/i);
                if (pinImgMatch) ogImg = pinImgMatch[0].replace(/\/(?:236x|474x)\//, '/736x/');
            }

            let ogTitle = (html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
                           html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
                           html.match(/name=["']twitter:title["']\s+content=["']([^"']+)["']/i) ||
                           html.match(/<title>([^<]+)<\/title>/i))?.[1];

            let ogDesc = (html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                          html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i) ||
                          html.match(/name=["']twitter:description["']\s+content=["']([^"']+)["']/i) ||
                          html.match(/name=["']description["']\s+content=["']([^"']+)["']/i))?.[1];

            let siteName = (html.match(/property=["']og:site_name["']\s+content=["']([^"']+)["']/i) ||
                            html.match(/content=["']([^"']+)["']\s+property=["']og:site_name["']/i))?.[1];

            const unescapeHtml = (s) => (s || '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

            let domain = 'Web';
            try { domain = new URL(finalUrl).hostname.replace(/^www\./, ''); } catch (_) {}

            sendJson(res, 200, {
                ok: true,
                url: finalUrl,
                title: unescapeHtml(ogTitle) || (isPin ? 'Pinterest Board' : 'Web Reference'),
                image: ogImg || null,
                description: unescapeHtml(ogDesc) || '',
                siteName: siteName || (isPin ? 'Pinterest' : domain),
                isPinterest: isPin
            });
        })
        .catch(err => {
            let domain = 'Web';
            try { domain = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch (_) {}
            sendJson(res, 200, {
                ok: false,
                url: targetUrl,
                title: isPin ? 'Pinterest Board' : 'Web Link',
                image: null,
                description: 'Failed to fetch preview: ' + err.message,
                siteName: isPin ? 'Pinterest' : domain,
                isPinterest: isPin
            });
        });
}

const server = http.createServer((req, res) => {
    resetIdleTimer();

    const qIndex = req.url.indexOf('?');
    const query = new URLSearchParams(qIndex >= 0 ? req.url.slice(qIndex + 1) : '');
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (urlPath === '/media') { serveMedia(req, res, query.get('p')); return; }
    if (urlPath === '/api/catalog') { serveCatalog(res, query.get('rescan') === '1'); return; }
    if (urlPath === '/api/open-external') { openExternally(res, query.get('p')); return; }
    if (urlPath === '/api/open-external-url') { openExternalUrl(res, query.get('url')); return; }
    if (urlPath === '/api/fetch-meta') { fetchUrlMetadata(res, query.get('url')); return; }

    if (urlPath === '/') urlPath = '/hub.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));

    // Refuse anything that escapes the repo root (e.g. "/../../secrets").
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

function tryListen(port, attemptsLeft) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
            tryListen(port + 1, attemptsLeft - 1);
        } else {
            console.error('Could not bind to a port: ' + err.message);
            process.exit(1);
        }
    });
    server.listen(port, '127.0.0.1', () => {
        // The launcher parses this exact line to learn which port we bound.
        console.log('LISTENING:' + port);
        resetIdleTimer();
    });
}

tryListen(START_PORT, MAX_PORT_ATTEMPTS);
