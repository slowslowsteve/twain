import assert from 'node:assert/strict';
import {probeProjectIdentity} from '../src/twain_project_identity.mjs';
const id='b073d20f-bd7c-4ebe-8a2a-b4e81f7cb654';
const probe=(raw,model=[1,7,7])=>probeProjectIdentity({readModel:()=>model,readActive:()=>raw});
assert.deepEqual(probe(`${id}\nTest\n7`),{ready:true,id,name:'Test',generation:7});
for(const raw of [null,'',`${id}\nTest`,`${id}\nTest\n6`,'__pending-1\nNew Set\n7','../../wrong\nTest\n7'])
    assert.equal(probe(raw).ready,false);
for(const model of [null,[0,0,0],[1,8,7],[1,0,0]])assert.equal(probe(`${id}\nTest\n7`,model).ready,false);
let count=0;
assert.equal(probeProjectIdentity({readModel:()=>[1,++count, count],readActive:()=>`${id}\nTest\n1`}).ready,false);
assert.equal(probeProjectIdentity({readModel:()=>{throw Error('offline');}}).ready,false);
// Name and grid position are not used as identity; a duplicate needs a different ID.
assert.equal(probe(`${id}\nRenamed\n7`).id,id);
const copy='01190092-7038-4282-afeb-85e90d2cd963';
assert.notEqual(probe(`${copy}\nTest Copy\n7`).id,id);
console.log('Twain identity probe: aligned live IDs only; transitions, pending and stale reads refused');
