import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
const token = process.env.TERMINAL_TOKEN || (await readFile(new URL('../.runtime/access-token', import.meta.url), 'utf8')).trim();
const port = Number(process.env.PORT || 18920);
const origin = process.env.ORIGIN || `http://${process.env.HOST || '127.0.0.1'}:${port}`;
const launch = await new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/api/launch', method: 'POST', headers: {
    Host: new URL(origin).host, Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'
  } }, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => {
    try { if (res.statusCode !== 200) throw Error('起動リンクを取得できません。サーバーの起動状態と設定を確認してください。'); resolve(JSON.parse(data).url); } catch (e) { reject(e); }
  }); });
  req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('接続がタイムアウトしました。'))); req.end('{}');
});
const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [launch], { stdio: 'ignore' });
child.on('error', () => { console.error('ブラウザを開けませんでした。このコマンドはデスクトップ環境で実行してください。'); process.exitCode = 1; });
child.on('exit', code => { if (code) { console.error('ブラウザを開けませんでした。デスクトップ環境を確認してください。'); process.exitCode = 1; } });
