import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { environmentSnapshot } from '../src/environment.mjs';
test('environment snapshot includes only direct non-hidden metadata', async t => {
 const cwd=await mkdtemp(join(tmpdir(),'terminal-preview-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
 await writeFile(join(cwd,'sample.txt'),'hello');await writeFile(join(cwd,'.secret'),'secret');
 const context=await environmentSnapshot(cwd);assert.equal(context.entries.length,1);assert.equal(context.entries[0].bytes,5);assert.equal(context.entries[0].name,'sample.txt');
});
