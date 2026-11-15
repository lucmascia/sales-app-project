// A local stand-in for the two things the app talks to in production:
//   1. the static host serving app/
//   2. the Google Apps Script web app — here the REAL Code.gs, run against a
//      fake spreadsheet, behind an HTTP server that behaves like Google's:
//      a different origin, CORS open, POST answered with a 302 to a one-time
//      GET, and no support for preflight (OPTIONS) requests.
//
// Run `npm run serve` to try the app in a browser against it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeSpreadsheet, loadScript } from './fake-sheets.mjs';
import { CODE_GS, seedSheets } from './fixtures.mjs';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const listen = (server, port) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));

export async function startMockServer({ appPort = 0, apiPort = 0 } = {}) {
  const spreadsheet = createFakeSpreadsheet(seedSheets());
  const script = loadScript(CODE_GS, spreadsheet);
  const state = { requests: [], dropNextPostResponse: false, down: false };
  const pending = new Map();
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const sendJson = (res, output) => {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(output.getContent());
  };

  const api = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, search: url.search });
    if (state.down) return req.socket.destroy();
    if (req.method === 'OPTIONS') return res.writeHead(405).end();
    if (url.pathname === '/html') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!DOCTYPE html><html><body>Fazer login - Contas do Google</body></html>');
    }
    if (url.pathname === '/echo') {
      const output = pending.get(url.searchParams.get('token'));
      if (!output) return res.writeHead(404, cors).end();
      return sendJson(res, output);
    }
    if (url.pathname !== '/exec') return res.writeHead(404, cors).end();
    if (req.method === 'GET') return sendJson(res, script.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const output = script.doPost({ postData: { contents: body, type: req.headers['content-type'] } });
        if (state.dropNextPostResponse) { // the sheet was written, but the answer never arrives
          state.dropNextPostResponse = false;
          return undefined; // leave the request hanging until the app gives up
        }
        const token = String(pending.size + 1);
        pending.set(token, output);
        res.writeHead(302, { ...cors, Location: `/echo?token=${token}` }).end();
      });
      return undefined;
    }
    return res.writeHead(405, cors).end();
  });

  const app = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(APP_DIR, path.endsWith('/') ? `${path}index.html` : path);
    try {
      const content = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  const [apiPortUsed, appPortUsed] = [await listen(api, apiPort), await listen(app, appPort)];
  return {
    appUrl: `http://127.0.0.1:${appPortUsed}/`,
    scriptUrl: `http://127.0.0.1:${apiPortUsed}/exec`,
    htmlUrl: `http://127.0.0.1:${apiPortUsed}/html`,
    spreadsheet,
    state,
    appRows: () => (spreadsheet.getSheetByName('app') ? spreadsheet.getSheetByName('app')._rows().slice(1) : []),
    close: () => Promise.all([api, app].map((s) => new Promise((resolve) => { s.closeAllConnections(); s.close(resolve); }))),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startMockServer({ appPort: 8080, apiPort: 8081 });
  console.log(`App:               ${server.appUrl}`);
  console.log(`Link do script:    ${server.scriptUrl}`);
  console.log(`Configurar direto: ${server.appUrl}#setup=${encodeURIComponent(server.scriptUrl)}`);
}
