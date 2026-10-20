import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const writes = [];
let scene = '0';
let pending = '-1';
const text = [];
const params = new Map([['a_scene_bars','1'],['b_scene_bars','1']]);
const leds = new Map();
const context = vm.createContext({
    host_module_set_param(k,v) { writes.push([k,v]); params.set(k,v); if(k==='scene') pending=v===scene ? '-1' : v; },
    host_module_get_param(k) { return k==='scene' ? scene : k==='scene_pending' ? pending : k==='tstates' ? '0,1,2,3' : params.get(k) || '100'; },
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
assert.deepEqual(writes.at(-1),['b_t4_btn','1']);
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
assert.equal(leds.get(19),2); assert.equal(leds.get(20),0);
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
