import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmod, stat } from 'node:fs/promises';
const require = createRequire(import.meta.url);

// node-pty 1.1.0 ships Darwin spawn-helper without execute bits (upstream #850).
// Apply at installation, not while serving requests; never require sudo.
export async function preparePty({ platform = process.platform, root = dirname(require.resolve('node-pty/package.json')), arch = process.arch } = {}) {
  if (platform !== 'darwin') return;
  for (const directory of ['build/Release', 'build/Debug', `prebuilds/darwin-${arch}`]) {
    const helper = join(root, directory, 'spawn-helper');
    let info;
    try { info = await stat(helper); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!info.isFile()) throw Error(`Not a file: ${helper}`);
    if ((info.mode & 0o111) !== 0o111) await chmod(helper, (info.mode & 0o777) | 0o111);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePty();
