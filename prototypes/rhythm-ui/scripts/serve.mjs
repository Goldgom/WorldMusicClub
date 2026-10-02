import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const allowed = new Set(['index.html', 'app.js', 'model.js', 'locales.js', 'styles.css']);
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!allowed.has(name)) { response.writeHead(404); response.end('Not found'); return; }
    const data = await readFile(path.join(root, name));
    response.writeHead(200, {
      'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(data);
  } catch { response.writeHead(500); response.end('Unable to load file'); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`WorldMusicHub UI spike: http://127.0.0.1:${port}\n`));
