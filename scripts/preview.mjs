import http from 'node:http';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage: node scripts/preview.mjs [--port 4318]');
const port = args.length ? Number(args[1]) : 4318;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');

const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'], ['.png', 'image/png'],
  ['.ico', 'image/x-icon'], ['.webp', 'image/webp'], ['.woff2', 'font/woff2'],
]);
const allowed = new Set(['/index.html']);
for (const directory of ['src/ui', 'src/core', 'src/preview', 'assets']) await addAssets(directory);

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
  if (request.method !== 'GET' && request.method !== 'HEAD') return respond(405, 'Method not allowed');
  const hostname = request.headers.host?.split(':')[0];
  if (!['127.0.0.1', 'localhost'].includes(hostname)) return respond(403, 'Forbidden host');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${port}`).pathname);
  } catch { return respond(400, 'Bad request'); }
  if (pathname.includes('\\') || pathname.includes('\0')) return respond(403, 'Forbidden path');
  if (pathname === '/') pathname = '/index.html';
  if (!allowed.has(pathname)) return respond(404, 'Not found');
  try {
    const filename = await realpath(path.join(root, pathname.slice(1)));
    if (!filename.startsWith(`${root}${path.sep}`)) return respond(403, 'Forbidden path');
    const body = await readFile(filename);
    response.writeHead(200, { 'Content-Type': types.get(path.extname(filename).toLowerCase()), 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { respond(404, 'Not found'); }

  function respond(status, message) {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : message);
  }
});

server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Choose another with --port.` : 'Preview server could not start.');
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Avatara synthetic demo: http://127.0.0.1:${port}\nOnly project UI assets are served. No extension, browser-history, or cloud connection.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());

async function addAssets(directory) {
  let entries;
  try { entries = await readdir(path.join(root, directory), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await addAssets(relative);
    else if (entry.isFile() && types.has(path.extname(entry.name).toLowerCase()) && !entry.name.startsWith('.')) allowed.add(`/${relative}`);
  }
}
