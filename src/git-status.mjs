import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function git(cwd, args) {
  return (await exec('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], {
    timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })).stdout;
}
export async function gitStatus(cwd, diff = false) {
  let root;
  try { root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim(); }
  catch (e) { if (e.stderr?.includes('not a git repository')) return { repository: false }; throw e; }
  const raw = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']);
  const result = { repository: true, root, branch: '', upstream: null, ahead: 0, behind: 0, files: [], staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const line = records[i];
    if (line.startsWith('# branch.head ')) result.branch = line.slice(14);
    else if (line.startsWith('# branch.oid ')) result.commit = line.slice(13);
    else if (line.startsWith('# branch.upstream ')) result.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) { const m = line.match(/\+(\d+) -(\d+)/); if (m) { result.ahead = +m[1]; result.behind = +m[2]; } }
    else if (/^[12u?] /.test(line)) {
      const kind = line[0], status = kind === '?' ? '??' : line.split(' ')[1];
      const count = kind === '?' ? 1 : kind === '1' ? 8 : kind === '2' ? 9 : 10;
      let pos = 0; for (let j = 0; j < count; j++) pos = line.indexOf(' ', pos) + 1;
      const file = { status, path: line.slice(pos) };
      if (kind === '2') file.from = records[++i];
      result.files.push(file);
      if (kind === '?') result.untracked++;
      else if (kind === 'u') result.conflicts++;
      else { if (status[0] !== '.') result.staged++; if (status[1] !== '.') result.modified++; }
    }
  }
  if (diff) {
    result.diff = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.']);
    result.stagedDiff = await git(root, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.']);
  }
  return result;
}
