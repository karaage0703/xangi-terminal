import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
const exec = promisify(execFile);

export const operatingSystem = (platform = process.platform) => platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;

export async function processDirectory(pid, { platform = process.platform, run = exec, resolvePath = realpath } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid shell PID');
  if (platform === 'linux') return resolvePath(`/proc/${pid}/cwd`);
  if (platform !== 'darwin') throw Error('Unsupported operating system');
  // Limit selection to this shell's cwd, never parse a human-readable table.
  const { stdout } = await run('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-F0n'], {
    timeout: 2000, maxBuffer: 65536, env: { ...process.env, LC_ALL: 'en_US.UTF-8' }
  });
  const names = stdout.split('\0').filter(field => field.startsWith('n')).map(field => field.slice(1));
  // lsof escapes non-printable names ambiguously. Refuse rather than query a
  // different existing directory whose literal name happens to match the escape.
  if (names.length !== 1 || !names[0].startsWith('/') || /[\\^\x00-\x1f\x7f]/.test(names[0])) throw Error('Cannot determine shell directory');
  return resolvePath(names[0]);
}
