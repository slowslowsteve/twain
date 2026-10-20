import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const writes = [];
let scene = '0';
let pending = '-1';
const text = [];
const params = new Map([['a_scene_bars','1'],['b_scene_bars','1']]);
const leds = new Map();
let now = 0, reads = 0, failReads = false;
let phase = 0;
const armed = [[0,0,0,0],[0,0,0,0]];
class FakeDate extends Date { static now() { return now; } }
function status() { return JSON.stringify({scene:Number(scene),pending:Number(pending),
    bars:[Number(params.get('a_scene_bars')),Number(params.get('b_scene_bars'))],phase,stopped:0,
    a:'0,1,2,3|0,0,0,0|0,0,0,0|1|0',b:'4,0,2,0|0,0,0,0|0,0,0,0|0|0',armed}); }

const context = vm.createContext({Date:FakeDate,
    host_module_set_param(k,v) { writes.push([k,v]); params.set(k,v); if(k==='scene') pending=v===scene ? '-1' : v; },
    host_module_get_param(k) { reads++; if(failReads) return null; if(k==='twain_status') return status(); return k==='scene' ? scene : k==='scene_pending' ? pending : k==='tstates' ? '0,1,2,3' : params.get(k) || '100'; },
    clear_screen(){}, print(x,y,s){text.push(s);}
});
const module = new vm.SourceTextModule(fs.readFileSync('src/ui_twain.js','utf8'),{context});
await module.link(async spec => {
    const vals = spec.includes('constants') ? {MoveLoop:58,Black:0,MoveKnob1:71,MoveLeft:62,MoveRight:63,BrightRed:1,Green:2,White:3,LightGrey:4,YellowGreen:5} : spec.includes('input_filter') ? {setLED:(n,c)=>leds.set(n,c),decodeDelta:v=>v<64?v:v-128} : {announce(){}};
    const stub = new vm.SyntheticModule(Object.keys(vals),function(){for(const [k,v] of Object.entries(vals))this.setExport(k,v);},{context});
    return stub;
});
await module.evaluate();
context.init();
context.onMidiMessageInternal([0xb0,63,127]);
assert.equal(scene,'0');
assert.equal(pending,'1');
assert(text.includes('Next: B at end'));
context.onMidiMessageInternal([0x90,99,127]);
assert.deepEqual(writes.at(-1),['b_t4_launch','1']);
context.onMidiMessageInternal([0x90,84,127]);
assert.equal(scene,'0');
assert.deepEqual(writes.at(-1),['a_t1_stop','1']);
const count=writes.length;
context.onMidiMessageInternal([0x90,84,0]);
context.onMidiMessageInternal([0xb0,85,127]);
assert.equal(writes.length,count);
console.log('Twain UI: scene selection, layer mapping, release and native control isolation passed');

context.onMidiMessageInternal([0xb0,58,127]);
context.onMidiMessageInternal([0xb0,58,0]);
context.onMidiMessageInternal([0x90,19,127]);
assert.deepEqual(writes.at(-1),['a_scene_bars','4']);
assert.equal(leds.get(19),3); assert.equal(leds.get(20),4);
const before = writes.length;
context.onMidiMessageInternal([0xb0,63,127]); // choose B length, no launch
assert.equal(writes.length,before);
context.onMidiMessageInternal([0x90,31,127]);
assert.deepEqual(writes.at(-1),['b_scene_bars','16']);
context.onMidiMessageInternal([0x90,16,127]);
assert.deepEqual(writes.at(-1),['b_scene_bars','1']);
context.onMidiMessageInternal([0xb0,58,127]);
const after = writes.length;
context.onMidiMessageInternal([0x90,20,127]);
assert.equal(writes.length,after);
console.log('Twain UI: Loop view, 1/4/16 bars, scene targeting, LEDs and release passed');

params.set('a_scene_bars','1');
context.onResume();
assert.equal(leds.get(92),33); // A empty pads blue
assert.equal(leds.get(97),22); // B empty pads purple, own state displayed
assert.equal(leds.get(93),1); // recording red
assert.equal(leds.get(94),2); // playing green
assert.equal(leds.get(84),79); // pause distinct from undo/delete
assert.equal(leds.get(76),22);
assert.equal(leds.get(68),66);
assert.equal(leds.get(16),3); // one-bar chase starts at step 1
phase=0.5; context.onResume();
assert.equal(leds.get(24),3); // step 9 halfway through one bar
armed[0][0]=1; context.onResume(); assert.equal(leds.get(92),1);
now=250; context.tick(); assert.equal(leds.get(92),0); // armed red blink
const r=reads;
for(let i=0;i<12;i++) context.tick();
assert.equal(reads-r,6); // one DSP read every two ticks
failReads=true; context.onResume();
assert(text.includes('TWAIN A Bar 1/1')); // retains valid state on timeout
failReads=false; params.set('a_scene_bars','4'); phase=2.3; context.onResume();
assert(text.includes('TWAIN A Bar 3/4'));
assert.equal(leds.get(18),3);
console.log('Twain UI: scene colors, pending blink, bar chase and bounded polling passed');
