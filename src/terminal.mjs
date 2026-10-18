import pty from 'node-pty';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { processDirectory } from './platform.mjs';

export const activeWorkspace = session => session.workspaces ? session.workspaces.get(session.activeWorkspace) : session;
export async function currentDirectory(session) {
  session = activeWorkspace(session);
  if (session.terminal) {
    const terminal = session.terminal;
    try {
      const cwd = await processDirectory(terminal.pid);
      if (session.terminal !== terminal) throw Error('Shell changed');
      session.cwd = cwd;
    } catch {
      throw Object.assign(Error('作業フォルダを確認できません。ターミナルへ再接続してください。'), { status: 503 });
    }
  }
  return session.cwd;
}
export function closeTerminal(session) {
  if (session.workspaces) { for (const workspace of session.workspaces.values()) closeTerminal(workspace); return; }
  clearInterval(session.cwdTimer);
  session.socket?.close(4000, 'Session ended');
  session.socket = null;
  if (session.terminal) { try { session.terminal.kill(); } catch {} session.terminal = null; }
}
export function attachTerminals(server, sessions, config) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  const send = (session, message) => {
    const ws = session.socket;
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1048576) { ws.close(4002, 'Slow connection'); return; }
    ws.send(JSON.stringify(message));
  };
  const publishCwd = async session => {
    if (session.checkingCwd) return;
    session.checkingCwd = true;
    let cwd;
    try { cwd = await currentDirectory(session); }
    catch { return; } // APIs reject stale paths; polling may recover on its next tick.
    finally { session.checkingCwd = false; }
    if (session.lastCwd !== cwd) { session.lastCwd = cwd; send(session, { type: 'cwd', cwd }); }
  };
  const start = session => {
    session.history = '';
    const shell = pty.spawn('/bin/bash', ['--noprofile', '--rcfile', fileURLToPath(new URL('./shell.bash', import.meta.url)), '-i'], {
      name: 'xterm-256color', cols: 80, rows: 24, cwd: session.cwd,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || session.cwd,
        LANG: process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8', TERM: 'xterm-256color', PS1: '\\u@\\h:\\w\\$ ', HISTFILE: '/dev/null' }
    });
    session.terminal = shell;
    const cwdTimer = setInterval(() => publishCwd(session), 1000);
    session.cwdTimer = cwdTimer; cwdTimer.unref();
    shell.onData(data => {
      session.history = (session.history + data).slice(-262144);
      if (!session.socket) return; // Drain background output into the bounded replay buffer.
      session.unacked += data.length;
      send(session, { type: 'data', data });
      if (session.unacked > 131072) shell.pause();
    });
    shell.onExit(({ exitCode, signal }) => {
      clearInterval(cwdTimer);
      if (session.terminal !== shell) return;
      session.terminal = null;
      send(session, { type: 'exit', code: exitCode, signal });
      session.socket?.close(4000, 'Shell exited');
    });
  };
  server.on('upgrade', (req, socket, head) => {
    const origin = config.origin || `http://${config.host || '127.0.0.1'}:${server.address().port}`;
    const sid = req.headers.cookie?.split('; ').find(c => c.startsWith('terminal='))?.slice(9);
    const owner = sessions.get(sid);
    const url = new URL(req.url, origin);
    const session = owner && (url.searchParams.has('workspace') ? owner.workspaces?.get(url.searchParams.get('workspace')) : activeWorkspace(owner));
    if (url.pathname !== '/api/terminal' || req.headers.host !== new URL(origin).host || req.headers.origin !== origin || !session || session.expires < Date.now()) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      session.socket?.close(4001, 'Opened in another tab');
      session.socket = ws; session.unacked = 0; session.lastCwd = null;
      ws.on('error', () => {});
      try { if (!session.terminal) start(session); } catch { ws.close(1011, 'Cannot start shell'); return; }
      send(session, { type: 'ready' });
      if (session.history) { session.unacked = session.history.length; send(session, { type: 'data', data: session.history }); }
      publishCwd(session);
      if (session.unacked > 131072) session.terminal.pause();
      else session.terminal.resume();
      ws.on('message', raw => {
        if (session.socket !== ws) return;
        if (session.expires < Date.now()) { closeTerminal(session); return; }
        try {
          const message = JSON.parse(raw.toString());
          if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 16384) {
            session.terminal?.write(message.data);
          } else if (message.type === 'resize' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols >= 2 && message.cols <= 500 && message.rows >= 2 && message.rows <= 200) {
            session.terminal?.resize(message.cols, message.rows);
          } else if (message.type === 'ack' && Number.isInteger(message.count) && message.count > 0) {
            session.unacked = Math.max(0, session.unacked - Math.min(message.count, 262144));
            if (session.unacked < 32768) session.terminal?.resume();
          } else { ws.close(1008, 'Invalid message'); }
        } catch { ws.close(1008, 'Invalid message'); }
      });
      ws.on('close', () => {
        if (session.socket !== ws) return;
        session.socket = null;
        session.unacked = 0;
        session.terminal?.resume(); // Switching tabs must not suspend a running command.
      });
    });
  });
  const expiry = setInterval(() => {
    for (const [key, session] of sessions) if (session.expires < Date.now()) { closeTerminal(session); sessions.delete(key); }
  }, 30000);
  expiry.unref();
  const shutdown = () => {
    clearInterval(expiry);
    for (const session of sessions.values()) closeTerminal(session);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  };
  server.on('close', shutdown);
  return shutdown;
}
