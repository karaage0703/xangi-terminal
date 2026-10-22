import { constants } from 'node:fs';
import { copyFile, chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Keep user settings outside the source tree replaced by managed updates.
export async function prepareManagedData(workspace, sourceDir, env = process.env) {
  const dataDir = resolve(env.DATA_DIR || resolve(workspace, '.xangi'), 'extensions/data/xangi-terminal');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  for (const [from, to] of [['.env', 'config.env'], ['.runtime/preferences.json', 'preferences.json']]) {
    const target = resolve(dataDir, to);
    try {
      await copyFile(resolve(sourceDir, from), target, constants.COPYFILE_EXCL);
      await chmod(target, 0o600);
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;
    }
  }
  return dataDir;
}
