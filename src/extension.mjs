import http from 'node:http';
import { mkdir, realpath } from 'node:fs/promises';
import { createApp } from './server.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function launchTicket(origin, token, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({host:'127.0.0.1', port, path:'/api/launch', method:'POST', headers:{Host:new URL(origin).host, Origin:origin, Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}}, res => {
      let data='';res.on('data', c=>data+=c);res.on('end',()=>{
        try {if(res.statusCode!==200)throw Error('起動リンクを取得できません。');const url=new URL(JSON.parse(data).url);if(url.origin!==new URL(origin).origin || !url.hash.startsWith('#launch='))throw Error('起動リンクが不正です。');resolve(url.href);}catch(e){reject(e);}
      });
    });
    req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('接続がタイムアウトしました。')));req.end('{}');
  });
}
export function createLauncher(token, origin, getLaunch) {
  if (!token) throw Error('Extension token is required');
  const target = new URL(origin);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('Invalid terminal origin');
  return http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
    if (req.url !== '/') { res.writeHead(404).end(); return; }
    let destination;
    try { destination = await getLaunch(); } catch { res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'}).end('ターミナルへ接続できません。サービスの起動状態と設定を確認してください。'); return; }
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = JSON.stringify(destination).replace(/</g, '\\u003c');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ja"><head><title>xangi-terminal</title></head><body><p>ターミナルへ接続中…</p><script>const destination=new URL(${url});const fragment=new URLSearchParams(destination.hash.slice(1));fragment.set('xangiHome',location.origin+'/');destination.hash=fragment.toString();location.replace(destination.href)</script></body></html>`);
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'serve') throw Error('Use xangi extension start xangi-terminal');
  const at = process.argv.indexOf('--workspace');
  const workspace = resolve(at >= 0 ? process.argv[at + 1] : process.cwd());
  const token = process.env.XANGI_EXTENSION_AUTH_TOKEN;
  if (!token) throw Error('Extension token is required');
  const stateDir = resolve(fileURLToPath(new URL('../.runtime', import.meta.url)));
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const server = createApp({
    token, managedToken: token, host: '127.0.0.1',
    preferencesPath: resolve(stateDir, 'preferences.json'),
    cwd: await realpath(process.env.CWD || workspace),
    xangiUrl: process.env.XANGI_URL || process.env.XANGI_EXTENSION_HOST_URL, xangiToken: process.env.XANGI_TOKEN,
    backends: process.env.LLM_BACKENDS_JSON ? JSON.parse(process.env.LLM_BACKENDS_JSON) : undefined,
    llmUrl: process.env.LLM_BASE_URL || 'http://127.0.0.1:8001/v1',
    model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY,
    disableThinking: process.env.LLM_DISABLE_THINKING === 'true',
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({schemaVersion:2,event:'ready',id:'xangi-terminal',workspace,baseUrl:`http://127.0.0.1:${server.address().port}`})));
  const stop = () => {server.shutdownTerminals(); server.close(); server.closeAllConnections(); process.stdin.pause();};
  process.stdin.resume();process.stdin.on('end',stop);for(const s of ['SIGINT','SIGTERM'])process.on(s,stop);
}
