import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('pages'), base = '/colomba-impostor/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (path === base.slice(0, -1)) { res.writeHead(302, { Location: base }); res.end(); return; }
    if (!path.startsWith(base)) throw new Error();
    const filename = resolve(root, path.slice(base.length) || 'index.html');
    if (!filename.startsWith(root + sep) || !types[extname(filename)] || !(await stat(filename)).isFile()) throw new Error();
    res.writeHead(200, { 'Content-Type': types[extname(filename)], 'Cache-Control': 'no-store' }); res.end(await readFile(filename));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(4187, '127.0.0.1', () => console.log(`Pages preview: http://127.0.0.1:4187${base}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
