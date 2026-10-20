import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let now=0,reads=0,failed=false;
const claims=[];
const writes=[],leds=new Map(),buttons=new Map(),text=[];
const params=new Map();
const state={scene:0,pending:-1,bars:[1,4],phase:0,stopped:0,
 a:'0,1,2,4|0,0,0,0|0,0,0,0|0|0',b:'4,0,2,0|0,0,0,0|0,0,0,0|0|0',armed:[[0,0,0,0],[0,0,0,0]]};
const constants={MoveKnob1:71,MoveMaster:79,MoveRec:86,MoveDelete:119,MoveLeft:62,MoveRight:63,
 MoveLoop:58,Black:0,BrightRed:1,Green:126,White:120,LightGrey:118};
class FakeDate extends Date {static now(){return now;}}
const context=vm.createContext({Date:FakeDate,shadow_set_overtake_suppress_master_volume:v=>claims.push(v),
 host_module_set_param(k,v){writes.push([k,v]);params.set(k,v);if(k==='scene')state.pending=Number(v)===state.scene?-1:Number(v);if(k.endsWith('scene_bars'))state.bars[k[0]==='b'?1:0]=Number(v);},
 host_module_get_param(k){reads++; if(failed)return null;return k==='twain_status'?JSON.stringify(state):params.get(k)??'0';},
 clear_screen(){},print(x,y,s){text.push(s);}
});
const module=new vm.SourceTextModule(fs.readFileSync('src/ui_twain.js','utf8'),{context});
await module.link(async spec=>{
 const vals=spec.includes('constants')?constants:spec.includes('input_filter')?
 {setLED:(n,c)=>leds.set(n,c),setButtonLED:(n,c)=>buttons.set(n,c),decodeDelta:v=>v<64?v:v-128}:{announce(){}};
 return new vm.SyntheticModule(Object.keys(vals),function(){for(const[k,v]of Object.entries(vals))this.setExport(k,v);},{context});
});
await module.evaluate();
const cc=(n,v=127)=>context.onMidiMessageInternal([0xb0,n,v]);
const down=n=>context.onMidiMessageInternal([0x90,n,127]);
const up=n=>context.onMidiMessageInternal([0x80,n,0]);
context.init();
assert.equal(leds.get(92),33);assert.equal(leds.get(85),22); // A1/B2 columns
assert.equal(leds.get(94),0);assert.equal(leds.get(99),0); // unused pads dark
assert.equal(buttons.get(58),16);
down(92);assert.equal(writes.length,0);up(92);assert.deepEqual(writes.at(-1),['a_t1_clip','1']);
cc(86);down(85);up(85);cc(86,0);assert.deepEqual(writes.at(-1),['b_t2_record','1']);
cc(119);down(76);up(76);cc(119,0);assert.deepEqual(writes.at(-1),['a_t3_clear','1']);
cc(58);assert.equal(buttons.get(58),124);down(19);up(19);assert.deepEqual(writes.at(-1),['a_scene_bars','4']);
cc(63);down(31);up(31);assert.deepEqual(writes.at(-1),['b_scene_bars','16']);
cc(58,0);assert.equal(buttons.get(58),16);assert(text.includes('A Bar 1/4'));
const before=writes.length;cc(71,5);assert.equal(writes.length,before); // no clip, no arbitrary scene/FX changes
params.set('a_t1_level','100');down(92);cc(79,5);up(92);assert.deepEqual(writes.at(-1),['a_t1_level','105']);
assert(!writes.slice(before).some(([k])=>k==='scene'||k.endsWith('_clip')));
const fx=['hp','lp','comp','sat','chorus','reverb','delay'];
for(let i=0;i<7;i++){down(93);cc(71+i,7);up(93);assert.deepEqual(writes.at(-1),[`b_t1_${fx[i]}`,'7']);}
const beforeMaster=writes.length;cc(79,2);assert.equal(writes.length,beforeMaster);
assert(claims.includes(1));assert.equal(claims.at(-1),0);
cc(63);assert.equal(state.pending,1);cc(63);assert.equal(state.pending,1);cc(62);assert.equal(state.pending,-1);
state.armed[0][0]=4;context.onResume();assert.equal(leds.get(92),1);now=250;context.tick();assert.equal(leds.get(92),0);
state.phase=2.2;context.onResume();assert(text.includes('A Bar 3/4'));assert.equal(leds.get(18),120);
const r=reads;for(let i=0;i<12;i++)context.tick();assert.equal(reads-r,6);
failed=true;context.onResume();assert(text.includes('A Bar 3/4'));failed=false;
// The host may replace these globals with the track editor's bridge during callbacks.
context.host_module_get_param=()=>null;context.host_module_set_param=()=>{throw Error('wrong DSP');};
down(84);up(84);assert.deepEqual(writes.at(-1),['a_t2_clip','1']);
// A later native LED repaint must be repaired periodically, not only at resume.
leds.set(84,0);now+=1200;context.tick();assert.notEqual(leds.get(84),0);
console.log('Twain UI: clip gestures, seven FX, hold Loop, volume, consistent scenes and LED repair passed');
