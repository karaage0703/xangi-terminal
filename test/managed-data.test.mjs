import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareManagedData } from '../src/managed-data.mjs';

test('settings survive source replacement and existing data is never overwritten', async t => {
  const root = await mkdtemp(join(tmpdir(), 'terminal-data-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  await mkdir(join(source, '.runtime'), { recursive: true });
  await writeFile(join(source, '.env'), 'XANGI_URL=http://localhost:1234\n');
  await writeFile(join(source, '.runtime/preferences.json'), '{"agentId":"chosen"}');
  const data = await prepareManagedData(root, source, {});
  assert.equal((await stat(join(data, 'config.env'))).mode & 0o777, 0o600);
  await writeFile(join(source, '.runtime/preferences.json'), '{"agentId":"old"}');
  await prepareManagedData(root, source, {});
  assert.equal(await readFile(join(data, 'preferences.json'), 'utf8'), '{"agentId":"chosen"}');
  await rm(source, { recursive: true });
  assert.equal(await prepareManagedData(root, source, {}), data);
  assert.match(await readFile(join(data, 'config.env'), 'utf8'), /1234/);
  const alternate = await prepareManagedData(root, source, { DATA_DIR: join(root, 'custom') });
  assert.equal(alternate, join(root, 'custom/extensions/data/xangi-terminal'));
});
