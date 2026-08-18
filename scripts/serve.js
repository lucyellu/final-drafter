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

const ROOT = path.resolve(__dirname, '..');
const START_PORT = Number(process.argv[2]) || 8743;
const MAX_PORT_ATTEMPTS = 20;
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
};

let idleTimer = null;
function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        console.log('Idle for ' + (IDLE_SHUTDOWN_MS / 60000) + ' minutes, shutting down.');
        process.exit(0);
    }, IDLE_SHUTDOWN_MS);
}

const server = http.createServer((req, res) => {
    resetIdleTimer();

    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/empty.html';
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
