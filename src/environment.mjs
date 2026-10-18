import { opendir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
export async function environmentSnapshot(cwd) {
  const entries = []; let truncated = false, scanned = 0;
  try {
    const dir = await opendir(cwd);
    for await (const item of dir) {
      if (++scanned > 200 || entries.length >= 40) { truncated = true; break; }
      if (item.name.startsWith('.')) continue;
      let size = null;
      try { if (item.isFile()) size = (await lstat(join(cwd, item.name))).size; } catch {}
      entries.push({ name: item.name.slice(0, 200), type: item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'symlink' : 'file', bytes: size });
    }
    return { cwd, entries, truncated, note: '直下の非隠し項目のみ。ファイル内容・環境変数は取得しない。ディレクトリ合計サイズは不明。' };
  } catch { return { cwd, unavailable: true }; }
}
