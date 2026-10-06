// ローカル確認用の簡易サーバー（Vercel の代わり）
//   node dev.mjs            → http://localhost:3123
// public/ の静的ファイルと /api/go・/api/theaters をそのまま配信する。本番と同じく実サイトを叩く
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import go from './api/go.js';
import theaters from './api/theaters.js';

const PORT = Number(process.env.PORT) || 3123;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Vercel の res を最低限まねる
const wrap = (res) => Object.assign(res, {
  status(c) { res.statusCode = c; return res; },
  json(o) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; },
  send(s) { res.end(s); return res; },
  redirect(c, u) { res.statusCode = c; res.setHeader('Location', u); res.end(); return res; },
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  req.query = Object.fromEntries(url.searchParams);
  req.headers['x-forwarded-proto'] = 'http'; // ローカルは https ではないので、生成URLの scheme を合わせる
  try {
    if (url.pathname === '/api/go') return await go(req, wrap(res));
    if (url.pathname === '/api/theaters') return await theaters(req, wrap(res));
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const body = await readFile(join(dirname(fileURLToPath(import.meta.url)), 'public', file));
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (e) {
    res.statusCode = e.code === 'ENOENT' ? 404 : 500;
    res.end(e.code === 'ENOENT' ? 'not found' : String(e.stack || e));
  }
}).listen(PORT, () => console.log(`cinema-jump dev: http://localhost:${PORT}`));
