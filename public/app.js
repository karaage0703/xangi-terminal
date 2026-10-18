const $ = id => document.getElementById(id);
let revision = 0, timer, composing = false, generating = false, generatingMode = '', pending = null, socket, term, fit, connected = false, resizeTimer;
let backendId = '', backendOptions = [];
let candidateExplanation = '', revealCandidate = false, savingPreferences = false;
function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key, value) { try { localStorage.setItem(key, value); } catch {} }
function renderExplanation() { $('commandExplanation').textContent = candidateExplanation; $('commandExplanation').hidden = !$('showExplanation').checked || !candidateExplanation; }
$('showExplanation').onchange = async () => {
  const checked = $('showExplanation').checked;
  savingPreferences = true; $('showExplanation').disabled = true;
  try { await api('preferences', { showExplanation: checked }); renderExplanation(); }
  catch (e) { $('showExplanation').checked = !checked; $('backendError').textContent = e.message; }
  finally { savingPreferences = false; $('showExplanation').disabled = false; }
};
function homeLink(value) {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return; $('xangiHome').href = url.href; $('xangiHome').hidden = false; remember('terminal-xangi-home', url.href); } catch {}
}
homeLink(stored('terminal-xangi-home'));
let workspaceId = 'default', workspaceVersion = 0, switching = false, gitBusy = false;
async function api(path, data = {}) {
  const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) { const result = await response.json(); throw Error(result.error || '通信に失敗しました。'); }
  return response;
}
function error(e) { $($('workspace').hidden ? 'loginError' : 'error').textContent = e?.message || ''; }
function invalidate() { revealCandidate = false; candidateExplanation = ''; renderExplanation(); revision++; clearTimeout(timer); pending = null; $('preview').hidden = true; }
function controls() { $('execute').disabled = !connected || !$('commandInput').value.trim(); $('cancel').disabled = !connected; }
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN || !connected) { error(Error('ターミナルに再接続してください。')); return false; }
  socket.send(JSON.stringify(message)); return true;
}
function resize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (fit && !$('workspace').hidden && $('output').getClientRects().length) { fit.fit(); if (connected) send({ type: 'resize', cols: term.cols, rows: term.rows }); } }, 60); }
function mobileView(view) {
  document.querySelector('.layout').dataset.view = view;
  document.body.classList.toggle('input-view', view === 'composer');
  $('terminalView').setAttribute('aria-pressed', String(view === 'terminal'));
  $('composerView').setAttribute('aria-pressed', String(view === 'composer'));
  resize();
}
$('terminalView').onclick = () => { document.activeElement?.blur(); mobileView('terminal'); };
$('composerView').onclick = () => { document.activeElement?.blur(); mobileView('composer'); };
function connect() {
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
  if (!term) {
    term = new window.Terminal({ cursorBlink: true, fontSize: matchMedia('(max-width:800px)').matches ? 15 : 13, scrollback: 3000, theme: { background: '#101113', foreground: '#f1f3f5', cursor: '#a7e8ce' } });
    fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open($('output'));
    term.onData(data => send({ type: 'input', data }));
    new ResizeObserver(resize).observe($('output'));
  }
  term.reset(); connected = false; controls(); $('exitStatus').textContent = '接続中…';
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/terminal?workspace=${encodeURIComponent(workspaceId)}`); socket = ws;
  ws.onmessage = event => {
    if (socket !== ws) return;
    const message = JSON.parse(event.data);
    if (message.type === 'ready') { connected = true; $('exitStatus').textContent = '接続済み · bash'; controls(); resize(); }
    if (message.type === 'data') term.write(message.data, () => { if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', count: message.data.length })); });
    if (message.type === 'cwd') { $('cwd').textContent = message.cwd; refreshGit(); }
    if (message.type === 'exit') $('exitStatus').textContent = `シェル終了 · ${message.code}`;
  };
  ws.onclose = event => {
    if (socket !== ws) return;
    connected = false; controls();
    if (event.code === 4001) $('exitStatus').textContent = '別のタブで接続中';
    else if (!$('exitStatus').textContent.startsWith('シェル終了')) $('exitStatus').textContent = '切断 · 再接続できます';
  };
  ws.onerror = () => error(Error('ターミナル接続に失敗しました。再接続するか、ページを再読み込みしてください。'));
}
async function generate(mode = 'natural') {
  if (generating) { pending = mode; return; }
  const value = $(mode === 'natural' ? 'input' : 'commandInput').value;
  if (composing) return;
  if (!value.trim()) {
    if (mode === 'command') { error(Error('確認するコマンドを入力するか、自然言語から候補を生成してください。')); $('error').scrollIntoView({block:'nearest'}); }
    return;
  }
  generatingMode = mode;
  if (mode === 'command') { $('explain').textContent = '環境を確認中…'; $('explain').disabled = true; }
  generating = true; const version = revision; $('status').textContent = mode === 'natural' ? '候補を更新中…' : '環境を確認中…'; error();
  try {
    const result = await (await api('suggest', { text: value, mode, workspace: workspaceId, backend: backendId })).json();
    if (version !== revision) return;
    if (!result.command) { $('status').textContent = result.explanation; return; }
    if (mode === 'natural') { $('commandInput').value = result.command; $('preview').hidden = true; candidateExplanation = result.explanation; renderExplanation(); $('status').textContent = 'コマンド候補を生成しました'; controls();
      if (revealCandidate) {
        const target = $('commandExplanation').hidden ? $('commandInput') : $('commandExplanation');
        target.scrollIntoView({block:'nearest'}); revealCandidate = false;
      }
      return; }
    for (const field of ['explanation','simulation','effects']) $(field).textContent = result[field];
    const labels = {executed:['この環境での実行結果','実行済み（AI報告）'], 'dry-run':['変更せずに確認した結果','dry-run'], predicted:['実行による影響の予測','予測'], unavailable:['確認できませんでした','確認不可'], unverified:['バックエンドからの実行報告','履歴未確認']};
    const label = labels[result.previewKind] || labels.unavailable;
    $('simulationTitle').textContent = label[0]; $('simulationBadge').textContent = label[1];
    $('simulationNote').textContent = `${result.previewCwd || ''} — ${result.previewNote || 'AIの予想です。'}`;
    $('evidenceTitle').hidden = !result.evidence; $('evidence').textContent = result.evidence ? `${result.evidenceSource || ''}\n${result.evidence}` : '';
    $('preview').hidden = false; $('preview').querySelector('details').open = true; $('preview').scrollIntoView({block:'start'}); $('status').textContent = '確認結果を表示しました'; controls();
  } catch (e) { if (version === revision) { error(e); $('error').scrollIntoView({block:'nearest'}); $('status').textContent = '解説を取得できませんでした。直接実行は使えます。'; } }
  finally { generating = false; generatingMode = ''; $('explain').textContent = '仮想実行・結果を確認'; $('explain').disabled = false; const next = pending; pending = null; if (next) generate(next); else if (version !== revision) $('status').textContent = ''; }
}
async function info() {
  const result = await (await api('info')).json(); $('host').textContent = result.host; $('cwd').textContent = result.cwd;
  await loadWorkspaces();
  await loadBackends();
  $('login').hidden = true; $('workspace').hidden = false; document.body.classList.add('connected'); connect();
}
function naturalInput() { invalidate(); error(); if (!composing && $('input').value.trim()) timer = setTimeout(() => generate('natural'), 400); }
for (const id of ['input','commandInput']) {
  $(id).addEventListener('compositionstart', () => { composing = true; invalidate(); });
  $(id).addEventListener('compositionend', () => { composing = false; if (id === 'input') naturalInput(); controls(); });
}
$('input').addEventListener('input', naturalInput);
$('commandInput').addEventListener('input', () => { invalidate(); controls(); });
$('refresh').onclick = () => { invalidate(); revealCandidate = true; generate('natural'); };
$('explain').onclick = () => {
  if (generating) {
    if (generatingMode === 'natural') { pending = 'command'; $('explain').textContent = '候補生成後に確認します…'; }
    return;
  }
  invalidate(); generate('command');
};
function execute() {
  const command = $('commandInput').value;
  if (switching || composing || !command.trim() || !connected) return;
  // Explicit user execution sends exactly the edited text to the persistent PTY.
  if (send({ type: 'input', data: command.replace(/\r?\n/g, '\r') + '\r' })) {
    invalidate(); $('commandInput').value = ''; $('status').textContent = ''; controls(); error();
    if (matchMedia('(max-width:800px)').matches) { $('commandInput').blur(); mobileView('terminal'); }
  }
}
$('execute').onclick = execute;
$('commandInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode !== 229) { event.preventDefault(); execute(); }
});
$('cancel').onclick = () => send({ type: 'input', data: '\x03' });
$('clear').onclick = () => term?.clear();
$('reconnect').onclick = connect;
for (const button of document.querySelectorAll('[data-key]')) button.onclick = () => { if (send({ type: 'input', data: JSON.parse(button.dataset.key) })) term.focus(); };

async function loadWorkspaces() {
  const result = await (await api('workspaces')).json(); workspaceId = result.active;
  let registered = [];
  try { registered = (await (await api('xangi/catalog')).json()).workspaces; }
  catch (e) { $('workspaceSelect').title = e.message; }
  const options = registered.map(w => {
    const existing = result.workspaces.find(local => local.path === w.path);
    const option = new Option(w.name, existing?.id || 'xangi:' + w.id); option.title = w.path; return option;
  });
  for (const w of result.workspaces) if (!registered.some(r => r.path === w.path)) {
    const option = new Option(w.name, w.id); option.title = w.path; options.push(option);
  }
  $('workspaceSelect').replaceChildren(...options);
  $('workspaceSelect').value = workspaceId;
}
async function switchWorkspace(id) {
  if (switching) return;
  switching = true; $('workspaceSelect').disabled = true; invalidate();
  connected = false; controls();
  const previous = workspaceId;
  try {
    if (id.startsWith('xangi:')) id = (await (await api('xangi/workspace', {id:id.slice(6)})).json()).added;
    await api('workspace/select', { id });
    workspaceId = id; workspaceVersion++;
    const old = socket; socket = null; old?.close();
    $('input').value = ''; $('commandInput').value = ''; $('status').textContent = '';
    $('gitDialog').close(); $('gitOpen').textContent = 'Git確認中…';
    $('gitFiles').textContent = ''; $('gitDiff').textContent = ''; $('gitStagedDiff').textContent = '';
    await loadWorkspaces(); connect(); refreshGit();
  } catch (e) { error(e); $('workspaceSelect').value = previous; connected = socket?.readyState === WebSocket.OPEN; controls(); }
  finally { switching = false; $('workspaceSelect').disabled = false; }
}
async function refreshGit() {
  if (gitBusy || switching || $('workspace').hidden) return;
  gitBusy = true; const version = workspaceVersion, cwd = $('cwd').textContent;
  try {
    const r = await (await api('git', { workspace: workspaceId, diff: $('gitDialog').open })).json();
    if (version !== workspaceVersion || cwd !== $('cwd').textContent) return;
    const summary = !r.repository ? 'Git管理外' : `${r.branch === '(detached)' ? 'detached ' + r.commit.slice(0, 8) : r.branch} · 変更${r.files.length}件`;
    $('gitOpen').textContent = summary;
    $('gitSummary').textContent = r.repository ? `${r.root}\n${summary} / ステージ${r.staged}・未ステージ${r.modified}・未追跡${r.untracked}・競合${r.conflicts} / ${r.upstream ? r.upstream + ' ↑' + r.ahead + ' ↓' + r.behind : '追跡先なし'}` : summary;
    $('gitFiles').textContent = r.files?.map(f => `${f.status} ${JSON.stringify(f.path)}${f.from ? ' ← ' + JSON.stringify(f.from) : ''}`).join('\n') || (r.repository ? '変更なし' : '');
    $('gitDiff').textContent = r.diff || '差分なし（未追跡ファイルの内容は表示しません）';
    $('gitStagedDiff').textContent = r.stagedDiff || '差分なし';
  } catch (e) { if (version === workspaceVersion) { $('gitOpen').textContent = 'Git取得エラー'; $('gitSummary').textContent = e.message; $('gitFiles').textContent = ''; $('gitDiff').textContent = ''; $('gitStagedDiff').textContent = ''; } }
  finally { gitBusy = false; }
}
$('workspaceSelect').onchange = e => switchWorkspace(e.target.value);
$('addWorkspace').onclick = () => { $('workspaceError').textContent = ''; $('workspaceDialog').showModal(); $('workspacePath').focus(); };
$('workspaceClose').onclick = () => $('workspaceDialog').close();
$('workspaceForm').onsubmit = async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try { const r = await (await api('workspace/add', { path: $('workspacePath').value })).json(); $('workspaceDialog').close(); await switchWorkspace(r.added); }
  catch (e) { $('workspaceError').textContent = e.message; }
  finally { button.disabled = false; }
};
$('gitOpen').onclick = () => { $('gitDialog').showModal(); refreshGit(); };
$('gitClose').onclick = () => $('gitDialog').close();
$('gitRefresh').onclick = refreshGit;
setInterval(() => { if (!document.hidden) refreshGit(); }, 5000);

async function bootstrap() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const launch = fragment.get('launch');
  const home = fragment.get('xangiHome');
  if (home) homeLink(home);
  if (launch || home) history.replaceState(null, '', location.pathname + location.search);
  try {
    if (launch) { await api('login', { launch }); }
    try { await info(); }
    catch {
      await api('login'); await info();
    }
  } catch { $('connecting').textContent = '接続できませんでした。xangiの拡張一覧から開き直してください。'; return; }
  finally { if (!$('workspace').hidden) $('connecting').textContent = ''; }
}
bootstrap();
function viewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
  // iOS keyboards shrink the visual viewport without changing CSS height queries.
  document.body.classList.toggle('compact-viewport', height < 550);
  resize();
}
window.visualViewport?.addEventListener('resize', viewport); window.addEventListener('resize', viewport); viewport();

function backendLabel() {
  const b = backendOptions.find(b => b.id === backendId);
  const linked = backendOptions.some(b => b.kind === 'xangi-agent');
  $('backendSelectLabel').textContent = linked ? 'エージェント' : 'バックエンド';
  $('modelControls').hidden = linked;
  $('backendModel').textContent = b?.kind === 'xangi-agent'
    ? '選んだエージェントのワークスペース・指示・AI設定を使います。コマンドの実行先は画面上部の作業フォルダです。'
    : b ? `モデル: ${b.model}` : '';
  $('modelSelect').disabled = true; $('effortSelect').disabled = true;
  $('backendOpen').textContent = '設定';
}
async function loadBackends() {
  const r = await (await api('backends')).json();
  if (backendId && backendId !== r.active) invalidate();
  backendId = r.active; backendOptions = r.backends;
  const prefs = await (await api('preferences')).json();
  $('showExplanation').checked = prefs.showExplanation; renderExplanation();
  $('backendSelect').replaceChildren(...r.backends.map(b => new Option(b.name, b.id)));
  $('backendSelect').value = backendId; backendLabel(); $('backendError').textContent = r.warning || '';

}
$('backendOpen').onclick = () => { $('backendDialog').showModal(); syncPreferences(); };
async function syncPreferences() {
  if ($('workspace').hidden || generating || savingPreferences) return;
  savingPreferences = true; $('backendSelect').disabled = true; $('showExplanation').disabled = true;
  try { await loadBackends(); } catch (e) { $('backendError').textContent = e.message; }
  finally { savingPreferences = false; $('backendSelect').disabled = false; $('showExplanation').disabled = false; }
}
setInterval(() => { if (!document.hidden) syncPreferences(); }, 5000);
window.addEventListener('focus', syncPreferences);
$('backendClose').onclick = () => $('backendDialog').close();
async function selectBackend(id, model, effort = '') {
  savingPreferences = true; $('backendSelect').disabled = true; $('modelSelect').disabled = true; $('effortSelect').disabled = true;
  invalidate(); $('status').textContent = ''; $('backendError').textContent = '';
  try { await api('backend/select', { id, model, effort }); backendId = id; $('backendSelect').value = id; backendLabel(); }
  catch (e) { $('backendSelect').value = backendId; $('backendError').textContent = e.message; }
  finally { savingPreferences = false; $('backendSelect').disabled = false; backendLabel(); }
}
$('backendSelect').onchange = () => selectBackend($('backendSelect').value, '');
$('modelSelect').onchange = () => selectBackend(backendId, $('modelSelect').value);

$('effortSelect').onchange = () => selectBackend(backendId, $('modelSelect').value, $('effortSelect').value);
