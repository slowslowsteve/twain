import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let now=0,reads=0,failed=false;
const claims=[],rects=[];
const writes=[],leds=new Map(),buttons=new Map(),text=[];
const params=new Map();
const state={scene:0,pending:-1,bars:[1,4,2,8],phase:0,stopped:0,custom:[0,0,0,0],muted:[0,0,0,0],master:100,master_mute:0,undo:0,
 a:'0,1,2,4|0,0,0,0|0,0,0,0|0|0',b:'4,0,2,0|0,0,0,0|0,0,0,0|0|0',c:'0,0,0,0|0,0,0,0',d:'0,0,0,0|0,0,0,0',armed:Array.from({length:4},()=>[0,0,0,0])};
const constants={MoveKnob1:71,MoveMaster:79,MoveRec:86,MoveDelete:119,MoveLeft:62,MoveRight:63,
 MoveLoop:58,MoveUndo:56,MoveShift:49,MoveMute:88,Black:0,BrightRed:1,Green:126,White:120,LightGrey:118};
class FakeDate extends Date {static now(){return now;}}
const context=vm.createContext({Date:FakeDate,shadow_set_overtake_suppress_master_volume:v=>claims.push(v),
 host_module_set_param(k,v){writes.push([k,v]);params.set(k,v);if(k==='scene')state.pending=Number(v)===state.scene?-1:Number(v);if(k.endsWith('scene_bars'))state.bars['abcd'.indexOf(k[0])]=Number(v);},
 host_module_get_param(k){reads++; if(failed)return null;return k==='twain_status'?JSON.stringify(state):params.get(k)??'0';},
 fill_rect(...v){rects.push(v);},clear_screen(){},print(x,y,s){text.push(s);}
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
assert.equal(leds.get(92),119);assert.equal(leds.get(85),119); // A1/B2 columns
assert.equal(leds.get(94),119);assert.equal(leds.get(99),0); // C is available; unused pads dark
assert.equal(buttons.get(58),16);
down(92);assert.equal(writes.length,0);up(92);assert.deepEqual(writes.at(-1),['a_t1_clip','1']);
cc(86);down(85);up(85);cc(86,0);assert.deepEqual(writes.at(-1),['b_t2_record','1']);
cc(119);down(76);up(76);cc(119,0);assert.deepEqual(writes.at(-1),['a_t3_clear','1']);
cc(58);assert.equal(buttons.get(58),124);down(19);up(19);assert.deepEqual(writes.at(-1),['a_scene_bars','4']);
cc(63);down(31);up(31);assert.deepEqual(writes.at(-1),['b_scene_bars','16']);
cc(58,0);assert.equal(buttons.get(58),16);assert(text.includes('A Bar 1/4'));
const before=writes.length;cc(71,5);assert.equal(writes.length,before); // no clip, no arbitrary scene/FX changes
params.set('a_t1_level','100');down(92);cc(79,5);up(92);assert(writes.some(([k,v])=>k==='a_t1_level'&&v==='105'));assert.deepEqual(writes.at(-1),['edit_end','1']);
assert(!writes.slice(before).some(([k])=>k==='scene'||k.endsWith('_clip')));
const fx=['hp','lp','comp','sat','chorus','reverb','delay'];
for(let i=0;i<7;i++){down(93);cc(71+i,7);up(93);assert(writes.some(([k,v])=>k===`b_t1_${fx[i]}`&&v==='7'));}
const beforeMaster=writes.length;cc(79,2);assert.equal(writes.length,beforeMaster);
assert(claims.includes(1));assert.equal(claims.at(-1),0);
cc(63);assert.equal(state.pending,1);cc(63);assert.equal(state.pending,2);cc(63);assert.equal(state.pending,3);cc(62);assert.equal(state.pending,2);cc(62);cc(62);assert.equal(state.pending,-1);
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

state.custom=[1,0,0,0];state.armed=Array.from({length:4},()=>[0,0,0,0]);context.onResume();
assert.equal(leds.get(92),97); // subtly tinted empty clip with settings
assert.equal(leds.get(85),119);
state.undo=5;context.onResume();assert.equal(buttons.get(56),124);
cc(56);assert.deepEqual(writes.at(-1),['undo','1']);
// Touch shows a value; double touch resets it. Releases aren't additional taps.
params.set('a_t1_lp','73');down(92);
const changes=writes.length;
context.onMidiMessageInternal([0x90,1,127]);context.onMidiMessageInternal([0x80,1,0]);
assert.equal(writes.length,changes);assert(text.includes('A1 LP filter: 73%'));
now+=100;context.onMidiMessageInternal([0x90,1,127]);context.onMidiMessageInternal([0x80,1,0]);
assert.deepEqual(writes.at(-1),['a_t1_lp','0']);up(92);
assert.deepEqual(writes.at(-1),['edit_end','1']);
assert(!writes.slice(changes).some(([k])=>k==='a_t1_clip'));
// Spaced touches / a turn between touches must not accidentally reset.
params.set('a_t1_hp','40');down(92);
context.onMidiMessageInternal([0x90,0,127]);context.onMidiMessageInternal([0x80,0,0]);now+=1000;
context.onMidiMessageInternal([0x90,0,127]);context.onMidiMessageInternal([0x80,0,0]);cc(71,1);now+=100;
context.onMidiMessageInternal([0x90,0,127]);up(92);
assert.equal(params.get('a_t1_hp'),'41');
params.set('b_t1_delay_rate','5');down(93);cc(78,1);up(93);
assert.equal(params.get('b_t1_delay_rate'),'6');assert(text.includes('B1 Delay rate: 1/8T'));
// Double touch knob 8 returns to the default eighth note, not rate index zero.
down(93);for(let i=0;i<2;i++){now+=100;context.onMidiMessageInternal([0x90,7,127]);context.onMidiMessageInternal([0x80,7,0]);}up(93);
assert.equal(params.get('b_t1_delay_rate'),'5');
console.log('Twain UI: undo, empty-settings tint, touch readout, double reset and triplet rate passed');

// Duplicate touch packets while a finger is still resting aren't three taps.
params.set('a_t1_comp','55');down(92);
for(let i=0;i<3;i++)context.onMidiMessageInternal([0x90,2,127]);
up(92);assert.equal(params.get('a_t1_comp'),'55');

params.set('a_t1_level','125');down(92);
for(let i=0;i<2;i++){now+=100;context.onMidiMessageInternal([0x90,8,127]);context.onMidiMessageInternal([0x80,8,0]);}
up(92);assert.equal(params.get('a_t1_level'),'100');
// A duplicate pad note-on must not perform both delete stages in one press.
cc(119);down(92);const deletes=writes.filter(([k])=>k==='a_t1_clear').length;
down(92);assert.equal(writes.filter(([k])=>k==='a_t1_clear').length,deletes);up(92);cc(119,0);

// All overlapping pad presses survive either release order, including A–D.
for(const sequence of [[92,84,76,68],[68,76,84,92],[94,86,78,70],[95,87,79,71]]) {
 const start=writes.length;
 sequence.forEach(down);[...sequence].reverse().forEach(up);
 const launched=writes.slice(start).filter(([k])=>k.endsWith('_clip')).map(([k])=>k).sort();
 assert.deepEqual(launched,sequence.map(n=>`${'abcd'[(n-68)%8]}_t${4-Math.floor((n-68)/8)}_clip`).sort());
 assert.equal(claims.at(-1),0);
}
// Editing one of two held clips does not swallow the other clip's tap.
let start=writes.length;down(92);down(84);cc(71,1);up(92);up(84);
assert(writes.slice(start).some(([k])=>k==='a_t1_clip'));
assert(!writes.slice(start).some(([k])=>k==='a_t2_clip'));
// Twain master claims Volume only while Shift is held; unmodified Volume is untouched.
params.set('master_level','100');cc(49);assert.equal(claims.at(-1),1);cc(79,10);cc(79,5);cc(49,0);
assert.equal(params.get('master_level'),'115');assert.equal(claims.at(-1),0);
assert.deepEqual(writes.at(-1),['master_edit_end','1']);
start=writes.length;cc(79,3);assert.equal(writes.length,start);
// A mute chord never toggles master mute or launches the clips, in either order.
start=writes.length;cc(88);down(94);down(86);up(94);up(86);cc(88,0);
assert.equal(params.get('c_t1_mute'),'1');assert.equal(params.get('c_t2_mute'),'1');
assert(!writes.slice(start).some(([k])=>k==='master_mute'||k.endsWith('_clip')));
start=writes.length;down(95);cc(88);cc(88,0);up(95);
assert.equal(params.get('d_t1_mute'),'1');assert(!writes.slice(start).some(([k])=>k.endsWith('_clip')||k==='master_mute'));
// Mute alone toggles on release; repeated down packets cannot toggle twice.
start=writes.length;cc(88);cc(88);assert.equal(writes.length,start);cc(88,0);
assert.equal(params.get('master_mute'),'1');cc(88);cc(88,0);assert.equal(params.get('master_mute'),'0');
state.master_mute=1;state.muted[2]=1;context.onResume();assert.equal(buttons.get(88),124);assert.equal(leds.get(94),118);
assert(text.includes('TWAIN MUTED'));
// C and D keep independent lengths through the Loop gesture.
cc(58);down(94);down(20);up(20);down(95);down(30);up(30);cc(58,0);
assert.equal(params.get('c_scene_bars'),'5');assert.equal(params.get('d_scene_bars'),'15');
// Parking cancels stale physical gestures without a launch or a global-volume claim.
down(92);cc(49);context.overtakeParked=true;context.tick();assert.equal(claims.at(-1),0);
context.overtakeParked=false;context.onResume();
console.log('Twain UI: four-scene chords, independent edits, master volume, mute chords and parking passed');

// Screen timeline fills within the bar and remains inside the 128x64 display.
state.scene=0;state.bars[0]=4;state.phase=2.5;rects.length=0;context.onResume();
assert(rects.some(([x,y,w,h])=>x===65&&y===56&&w===14&&h===5));
assert(rects.every(([x,y,w,h])=>x>=0&&y>=0&&w>=0&&h>=0&&x+w<=128&&y+h<=64));
state.bars[0]=1;state.phase=0.5;rects.length=0;context.onResume();
assert(rects.some(([x,y,w,h])=>x===3&&y===56&&w===61&&h===5));
assert(!text.some(s=>s.includes('Tap clip:')||s.includes('Hold Loop:')||s.includes('Vol / FX')));
