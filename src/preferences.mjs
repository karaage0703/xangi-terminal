import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
export function createPreferences(path) {
  let value = { showExplanation: true, backendId: '' };
  let queue = (async () => {
    if (!path) return;
    try {
      const data = JSON.parse(await readFile(path, 'utf8'));
      if (typeof data.showExplanation !== 'boolean' || typeof data.backendId !== 'string') throw Error('Invalid preferences');
      value = { showExplanation: data.showExplanation, backendId: data.backendId };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  })();
  // Keep startup failures observable through read/update without an unhandled rejection.
  queue.catch(() => {});
  return {
    async read() { await queue; return { ...value }; },
    update(patch) {
      const result = queue.then(async () => {
        const next = { ...value, ...patch };
        if (path) {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await writeFile(path + '.tmp', JSON.stringify(next) + '\n', { mode: 0o600 });
          await rename(path + '.tmp', path);
        }
        value = next; return { ...value };
      });
      queue = result.catch(() => {});
      return result;
    }
  };
}
