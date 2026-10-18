import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDirectory, operatingSystem } from '../src/platform.mjs';
import { currentDirectory } from '../src/terminal.mjs';

test('Linux reads the shell PID, not the server working directory', async () => {
  assert.equal(await processDirectory(42, { platform: 'linux', resolvePath: async p => { assert.equal(p, '/proc/42/cwd'); return '/actual'; } }), '/actual');
});
test('macOS selects only shell cwd and preserves spaces and Unicode', async () => {
  const cwd = '/Users/test/日本語 project ';
  assert.equal(await processDirectory(42, { platform: 'darwin', run: async (command, args, options) => {
    assert.equal(command, '/usr/sbin/lsof');
    assert.deepEqual(args, ['-a', '-p', '42', '-d', 'cwd', '-F0n']);
    assert.equal(options.timeout, 2000);
    return { stdout: `p42\0\nfcwd\0n${cwd}\0\n` };
  }, resolvePath: async p => { assert.equal(p, cwd); return p; } }), cwd);
});
test('missing, ambiguous, escaped or failed macOS cwd never becomes a usable path', async () => {
  for (const stdout of ['', 'p42\0\nfcwd\0\n', 'nrelative\0', 'n/a\0n/b\0', 'n/a\\nname\0', 'n/a^Jname\0']) {
    await assert.rejects(processDirectory(42, { platform: 'darwin', run: async () => ({ stdout }), resolvePath: async p => p }));
  }
  await assert.rejects(processDirectory(42, { platform: 'darwin', run: async () => { throw Error('timeout'); } }), /timeout/);
});
test('cwd failure rejects stale session path while sessions without a shell keep their initial path', async () => {
  assert.equal(await currentDirectory({ cwd: '/initial' }), '/initial');
  await assert.rejects(currentDirectory({ cwd: '/stale', terminal: { pid: -1 } }), { status: 503 });
});
test('OS information distinguishes macOS from Linux', () => {
  assert.equal(operatingSystem('darwin'), 'macOS');
  assert.equal(operatingSystem('linux'), 'Linux');
});
