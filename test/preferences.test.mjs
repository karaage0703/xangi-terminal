import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPreferences } from '../src/preferences.mjs';
test('partial concurrent saves preserve both preferences across restart',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'terminal-prefs-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'prefs.json');const prefs=createPreferences(path);
 await Promise.all([prefs.update({backendId:'xangi:agent'}),prefs.update({showExplanation:false})]);
 assert.deepEqual(await createPreferences(path).read(),{backendId:'xangi:agent',showExplanation:false});
});
