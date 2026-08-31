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

// The Studio Hub (hub.html) reads screenplays, books, and films that live
// outside the repo, so those folders -- and nothing else on the disk -- are
// readable through /media. See serveMedia() for how a request is checked
// against them. Keep in sync with SCRIPT_ROOT/BOOK_ROOTS in scan-media.mjs.
const MEDIA_ROOTS = [
    'L:\\Media\\Text\\Screenplays',
    'L:\\Media\\Text\\Books',
    'L:\\Media\\Text\\Illustrated',
    'L:\\Media\\Text\\Papers',
    'L:\\Media\\Video',
];
const MEDIA_EXT = new Set(['.pdf', '.epub', '.txt', '.md', '.mkv', '.mp4', '.avi', '.m4v', '.webm', '.mov', '.srt', '.vtt']);
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

function findChromeExecutable() {
    const user = process.env.USERPROFILE || 'C:\\Users\\lucyl';
    const candidates = [
        path.join(user, '.cache/puppeteer/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe'),
        path.join(__dirname, '../chrome/win64-152.0.7977.42/chrome-win64/chrome.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return undefined;
}

async function scrapePinterestImagesWithPuppeteer(targetUrl) {
    try {
        const puppeteerModule = await import('puppeteer').catch(() => null);
        if (!puppeteerModule) return [];
        const puppeteer = puppeteerModule.default || puppeteerModule;
        const executablePath = findChromeExecutable();

        const browser = await puppeteer.launch({
            executablePath,
            headless: 'new',
            args: ['--disable-web-security', '--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        
        const capturedImages = new Set();
        page.on('response', res => {
            const u = res.url();
            if (u.includes('i.pinimg.com') && /\.(jpg|png|webp|jpeg)/i.test(u)) {
                if (!u.includes('/75x75') && !u.includes('/30x30') && !u.includes('/avatars/')) {
                    capturedImages.add(u.replace(/\/(?:236x|474x|564x|200x150|75x75_RS)\//, '/736x/'));
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 12000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));

        const domImgs = await page.evaluate(() => {
            const list = Array.from(document.querySelectorAll('img')).map(i => i.src || i.srcset).filter(Boolean);
            return list.filter(s => s.includes('i.pinimg.com'));
        }).catch(() => []);

        domImgs.forEach(u => {
            if (/\.(jpg|png|webp|jpeg)/i.test(u) && !u.includes('/75x75') && !u.includes('/30x30') && !u.includes('/avatars/')) {
                capturedImages.add(u.replace(/\/(?:236x|474x|564x|200x150|75x75_RS)\//, '/736x/'));
            }
        });

        await browser.close().catch(() => {});
        return Array.from(capturedImages);
    } catch (e) {
        console.error('Puppeteer board scrape error:', e.message);
        return [];
    }
}

async function fetchUrlMetadata(res, targetUrl) {
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

    try {
        const r = await fetch(targetUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const finalUrl = r.url || targetUrl;
        const html = await r.text();

        let ogImg = (html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                     html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
                     html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                     html.match(/name=["']twitter:image:src["']\s+content=["']([^"']+)["']/i))?.[1];

        if (ogImg && isPin) {
            ogImg = ogImg.replace(/\/(?:200x150|236x|474x|564x)\//, '/736x/');
        }

        // Direct regex matches from HTML
        const pinimgMatches = html.match(/https?:\/\/[a-zA-Z0-9_\-\.\/\\]*i\.pinimg\.com[a-zA-Z0-9_\-\.\/\\]*\.(?:jpg|png|webp|jpeg)/gi) || [];
        const unescaped = pinimgMatches.map(m => m.replace(/\\u002F/g, '/').replace(/\\/g, ''));
        let boardImages = [...new Set(unescaped.map(img => img.replace(/\/(?:236x|474x|564x|200x150|75x75_RS)\//, '/736x/')))]
            .filter(img => !img.includes('/75x75') && !img.includes('/30x30') && !img.includes('/avatars/'));

        if (!ogImg && boardImages.length > 0) {
            ogImg = boardImages[0];
        }

        // If Pinterest board or few images from static HTML, scrape with Puppeteer
        const isBoardUrl = isPin && !finalUrl.includes('/pin/');
        if (isPin && (isBoardUrl || boardImages.length <= 1)) {
            const pupImages = await scrapePinterestImagesWithPuppeteer(finalUrl);
            if (pupImages.length > 0) {
                boardImages = [...new Set([...boardImages, ...pupImages])];
                if (!ogImg && boardImages.length > 0) ogImg = boardImages[0];
            }
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
            images: boardImages,
            isBoard: isBoardUrl || boardImages.length > 1,
            description: unescapeHtml(ogDesc) || '',
            siteName: siteName || (isPin ? 'Pinterest' : domain),
            isPinterest: isPin
        });
    } catch (err) {
        let domain = 'Web';
        try { domain = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch (_) {}
        sendJson(res, 200, {
            ok: false,
            url: targetUrl,
            title: isPin ? 'Pinterest Board' : 'Web Link',
            image: null,
            images: [],
            description: 'Failed to fetch preview: ' + err.message,
            siteName: isPin ? 'Pinterest' : domain,
        });
    }
}

function proxyImage(req, res, targetUrl) {
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

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    };

    fetch(targetUrl, { headers, signal: AbortSignal.timeout(10000) })
        .then(async r => {
            if (!r.ok) {
                res.writeHead(r.status, { 'Content-Type': 'text/plain' });
                res.end('Failed to fetch image: ' + r.statusText);
                return;
            }
            const contentType = r.headers.get('content-type') || 'image/jpeg';
            const buf = Buffer.from(await r.arrayBuffer());
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(buf);
        })
        .catch(err => {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Proxy error: ' + err.message);
        });
}

const STORYBOARD_DIR = path.join(ROOT, 'storyboards');

function ensureStoryboardDir() {
    if (!fs.existsSync(STORYBOARD_DIR)) {
        fs.mkdirSync(STORYBOARD_DIR, { recursive: true });
    }
    return STORYBOARD_DIR;
}

function openStoryboardFolder(res) {
    try {
        const dir = ensureStoryboardDir();
        const child = spawn('cmd', ['/c', 'start', '', dir], { detached: true, stdio: 'ignore' });
        child.unref();
        sendJson(res, 200, { ok: true, path: dir });
    } catch (e) {
        sendJson(res, 500, { error: String(e.message) });
    }
}

// Pollinations' free tier allows exactly one queued generation per IP -- a
// second concurrent request is refused outright with
//   "Queue full for IP: <addr>: 1 requests already queued (max: 1)"
// and, because the page cannot see that, the shot silently ended up with a
// placeholder. Abandoning a request locally does not hand the slot back either,
// so overlapping callers have to be serialised here rather than raced upstream.
// Everything that talks to a single-slot endpoint goes through this chain.
const providerQueues = new Map();
function runQueued(key, task) {
    const prev = providerQueues.get(key) || Promise.resolve();
    // The chain must not break on a rejected task, or every later caller
    // inherits that rejection instead of getting its turn.
    const next = prev.then(() => task(), () => task());
    providerQueues.set(key, next.then(() => {}, () => {}));
    return next;
}

// Free image endpoints answer a burst with 429 rather than queueing it, and a
// flat retry delay just spends the remaining attempts inside the same cooldown
// window. Back off exponentially, honour Retry-After when the server sends one,
// and carry the status code out on the error so callers can tell a rate limit
// apart from a dead endpoint.
async function fetchWithRetry(url, options = {}, retries = 1, delayMs = 1000) {
    let lastErr = null;
    for (let i = 0; i <= retries; i++) {
        let waitMs = delayMs * Math.pow(2, i);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
            const r = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!r.ok) {
                // These endpoints explain themselves in the error body -- the
                // Pollinations 429 names the queue limit it hit. Carrying that
                // through beats another bare "HTTP 429" in the log.
                let detail = '';
                try {
                    const raw = (await r.text()).slice(0, 400);
                    try { detail = JSON.parse(raw).message || JSON.parse(raw).error || raw; }
                    catch (_) { detail = raw; }
                } catch (_) { /* body already consumed or empty */ }

                const err = new Error(`HTTP ${r.status}: ${r.statusText}${detail ? ' - ' + detail : ''}`);
                err.status = r.status;
                err.detail = detail;
                if (r.status === 429) {
                    err.rateLimited = true;
                    const ra = parseInt(r.headers.get('retry-after') || '', 10);
                    if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = Math.min(ra * 1000, 60000);
                }
                throw err;
            }
            return r;
        } catch (err) {
            lastErr = err;
            if (err && err.retryAfterMs) waitMs = err.retryAfterMs;
            if (i < retries) {
                console.warn(`[fetchWithRetry] attempt ${i + 1}/${retries + 1} failed (${err.message}); retrying in ${waitMs}ms`);
                await new Promise(res => setTimeout(res, waitMs));
            }
        }
    }
    throw lastErr;
}

function saveCustomImage(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        try {
            const data = JSON.parse(body || '{}');
            let dataUrl = data.dataUrl || data.base64 || '';
            if (!dataUrl) { sendJson(res, 400, { error: 'Missing dataUrl' }); return; }

            const dir = ensureStoryboardDir();
            let ext = '.jpg';
            if (dataUrl.includes('image/png')) ext = '.png';
            else if (dataUrl.includes('image/webp')) ext = '.webp';
            else if (dataUrl.includes('image/svg')) ext = '.svg';

            const base64Data = dataUrl.replace(/^data:image\/[a-z\+\-]+;base64,/, '');
            const buf = Buffer.from(base64Data, ext === '.svg' ? 'utf8' : 'base64');

            const filename = (data.filename || `upload_${Date.now()}`).replace(/[^a-zA-Z0-9_\-]/g, '_') + ext;
            const diskPath = path.join(dir, filename);
            fs.writeFileSync(diskPath, buf);

            sendJson(res, 200, {
                ok: true,
                imageUrl: '/storyboards/' + filename,
                localPath: diskPath,
                filename: filename
            });
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
    });
}

// DALL-E / gpt-image only render a fixed set of canvas sizes, so pick the one
// closest to the ratio that was asked for. Cards letterbox the difference
// rather than stretching it.
function openaiSize(model, ratio) {
    const sizes = String(model).startsWith('gpt-image')
        ? ['1024x1024', '1536x1024', '1024x1536']
        : ['1024x1024', '1792x1024', '1024x1792'];
    let best = sizes[0], bestDelta = Infinity;
    for (const s of sizes) {
        const [w, h] = s.split('x').map(Number);
        const delta = Math.abs(Math.log((w / h) / ratio));
        if (delta < bestDelta) { bestDelta = delta; best = s; }
    }
    return best;
}

function generateAiImage(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        try {
            const data = JSON.parse(body || '{}');
            const prompt = (data.prompt || 'Cinematic film frame, highly detailed').trim();
            const aspectRatio = data.aspectRatio || '16:9';
            const provider = data.provider || 'pollinations';
            const model = data.model || 'flux';
            const seed = data.seed || Math.floor(Math.random() * 1000000);
            const sceneNum = data.sceneNum || '1';
            const shotNum = data.shotNum || '1';

            // The page computes the exact frame size (multiples of 8) and
            // sends it along; the table below is only for older callers that
            // post an aspectRatio on its own.
            let width = 1024;
            let height = 576; // 16:9
            if (aspectRatio === '2.39:1') { width = 1024; height = 432; }
            else if (aspectRatio === '4:3') { width = 1024; height = 768; }
            else if (aspectRatio === '9:16') { width = 576; height = 1024; }
            else if (aspectRatio === '1:1') { width = 1024; height = 1024; }
            const reqW = parseInt(data.width, 10);
            const reqH = parseInt(data.height, 10);
            if (reqW >= 256 && reqW <= 2048 && reqH >= 256 && reqH <= 2048) {
                width = reqW;
                height = reqH;
            }

            if (provider === 'pollinations') {
                const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&seed=${seed}&nologo=true`;
                
                try {
                    // Pollinations queues generations, so a first call under
                    // load routinely runs past a short deadline. Three tries at
                    // 45s each is the difference between a frame and a blank
                    // card -- the old 16s single retry gave up on most of a
                    // parallel batch.
                    const r = await runQueued('pollinations', () => fetchWithRetry(pollUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                        },
                        timeoutMs: 90000
                    }, 4, 5000));

                    const buf = Buffer.from(await r.arrayBuffer());
                    if (buf.length > 500) {
                        const dir = ensureStoryboardDir();
                        const filename = `shot_s${sceneNum}_sh${shotNum}_${Date.now()}_${seed % 10000}.jpg`;
                        const diskPath = path.join(dir, filename);
                        fs.writeFileSync(diskPath, buf);

                        const b64 = 'data:image/jpeg;base64,' + buf.toString('base64');
                        sendJson(res, 200, {
                            ok: true,
                            imageUrl: '/storyboards/' + filename,
                            localPath: diskPath,
                            filename: filename,
                            base64: b64,
                            provider: 'pollinations'
                        });
                        return;
                    }
                } catch (fetchErr) {
                    console.warn('[generate-image] pollinations download failed:', fetchErr.message);
                    // Handing back the upstream URL under ok:true was a lie the
                    // page had no way to catch: the browser usually cannot load
                    // that URL either, so the card pinned a broken <img> and the
                    // run reported success. Say what happened and let the client
                    // try the direct URL itself -- it verifies before committing.
                    sendJson(res, 200, {
                        ok: false,
                        error: fetchErr.rateLimited
                            ? 'Pollinations rate limit (HTTP 429) - the free endpoint only accepts about one request at a time'
                            : 'Pollinations download failed: ' + fetchErr.message,
                        rateLimited: !!fetchErr.rateLimited,
                        status: fetchErr.status || 0,
                        directUrl: pollUrl,
                        provider: 'pollinations'
                    });
                    return;
                }

                sendJson(res, 200, {
                    ok: false,
                    error: 'Pollinations returned an empty image',
                    directUrl: pollUrl,
                    provider: 'pollinations'
                });
                return;
            }

            if (provider === 'gemini' && data.geminiKey) {
                const geminiModel = data.geminiModel || 'imagen-3.0-generate-002';
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:predict?key=${data.geminiKey}`;
                const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        instances: [{ prompt: prompt }],
                        parameters: { sampleCount: 1, aspectRatio: aspectRatio === '2.39:1' ? '16:9' : aspectRatio }
                    }),
                    signal: AbortSignal.timeout(45000)
                });
                const resp = await r.json();
                if (resp.predictions && resp.predictions[0] && resp.predictions[0].bytesBase64Encoded) {
                    const buf = Buffer.from(resp.predictions[0].bytesBase64Encoded, 'base64');
                    const dir = ensureStoryboardDir();
                    const filename = `shot_s${sceneNum}_sh${shotNum}_${Date.now()}_gemini.jpg`;
                    const diskPath = path.join(dir, filename);
                    fs.writeFileSync(diskPath, buf);

                    const b64 = 'data:image/jpeg;base64,' + resp.predictions[0].bytesBase64Encoded;
                    sendJson(res, 200, {
                        ok: true,
                        imageUrl: '/storyboards/' + filename,
                        localPath: diskPath,
                        filename: filename,
                        base64: b64,
                        provider: 'gemini'
                    });
                    return;
                }
                throw new Error(resp.error?.message || 'Google Gemini / Imagen generation failed');
            }

            if (provider === 'openai' && (data.openaiKey || data.customKey)) {
                const key = data.openaiKey || data.customKey;
                const r = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': key.startsWith('Bearer ') ? key : 'Bearer ' + key
                    },
                    body: JSON.stringify({
                        model: data.openaiModel || 'dall-e-3',
                        prompt: prompt,
                        n: 1,
                        size: openaiSize(data.openaiModel || 'dall-e-3', width / height),
                        response_format: 'b64_json'
                    }),
                    signal: AbortSignal.timeout(55000)
                });
                const resp = await r.json();
                if (resp.data && resp.data[0]) {
                    const dir = ensureStoryboardDir();
                    const filename = `shot_s${sceneNum}_sh${shotNum}_${Date.now()}_openai.png`;
                    const diskPath = path.join(dir, filename);
                    let b64 = '';
                    if (resp.data[0].b64_json) {
                        const buf = Buffer.from(resp.data[0].b64_json, 'base64');
                        fs.writeFileSync(diskPath, buf);
                        b64 = 'data:image/png;base64,' + resp.data[0].b64_json;
                    } else if (resp.data[0].url) {
                        const imgRes = await fetch(resp.data[0].url);
                        const buf = Buffer.from(await imgRes.arrayBuffer());
                        fs.writeFileSync(diskPath, buf);
                        b64 = 'data:image/png;base64,' + buf.toString('base64');
                    }
                    sendJson(res, 200, {
                        ok: true,
                        imageUrl: '/storyboards/' + filename,
                        localPath: diskPath,
                        filename: filename,
                        base64: b64,
                        provider: 'openai'
                    });
                    return;
                }
                throw new Error(resp.error?.message || 'OpenAI DALL-E generation failed');
            }

            if (provider === 'custom' && data.customUrl) {
                const headers = { 'Content-Type': 'application/json' };
                if (data.customKey) headers['Authorization'] = data.customKey;
                const r = await fetch(data.customUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ prompt, n: 1, size: `${width}x${height}` }),
                    signal: AbortSignal.timeout(45000)
                });
                const resp = await r.json();
                const img = resp.data?.[0]?.b64_json ? 'data:image/png;base64,' + resp.data[0].b64_json : (resp.data?.[0]?.url || resp.imageUrl || resp.url);
                if (img) {
                    if (img.startsWith('data:image/')) {
                        const dir = ensureStoryboardDir();
                        const filename = `shot_s${sceneNum}_sh${shotNum}_${Date.now()}_custom.jpg`;
                        const diskPath = path.join(dir, filename);
                        const buf = Buffer.from(img.replace(/^data:image\/[a-z\+\-]+;base64,/, ''), 'base64');
                        fs.writeFileSync(diskPath, buf);
                        sendJson(res, 200, { ok: true, imageUrl: '/storyboards/' + filename, localPath: diskPath, provider: 'custom' });
                    } else {
                        sendJson(res, 200, { ok: true, imageUrl: img, provider: 'custom' });
                    }
                    return;
                }
                throw new Error('Custom endpoint did not return an image');
            }

            if (provider === 'comfyui' && data.comfyUrl) {
                const comfyUrl = data.comfyUrl.replace(/\/$/, '');
                const r = await fetch(`${comfyUrl}/prompt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: { prompt } }),
                    signal: AbortSignal.timeout(30000)
                });
                if (!r.ok) throw new Error('ComfyUI server returned ' + r.status);
                const resp = await r.json();
                sendJson(res, 200, { ok: true, comfyResponse: resp, provider: 'comfyui' });
                return;
            }

            sendJson(res, 400, { error: 'Unknown or unconfigured AI provider: ' + provider });
        } catch (e) {
            sendJson(res, 500, { error: e.message });
        }
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
    if (urlPath === '/api/open-storyboard-folder') { openStoryboardFolder(res); return; }
    if (urlPath === '/api/save-image') { saveCustomImage(req, res); return; }
    if (urlPath === '/api/fetch-meta') { fetchUrlMetadata(res, query.get('url')); return; }
    if (urlPath === '/api/proxy-image') { proxyImage(req, res, query.get('url')); return; }
    if (urlPath === '/api/generate-image') { generateAiImage(req, res); return; }

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
