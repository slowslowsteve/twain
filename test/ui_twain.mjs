import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let now=0,reads=0,failed=false;
const claims=[],rects=[];
const writes=[],leds=new Map(),buttons=new Map(),text=[],announcements=[];
const params=new Map(),critical=[];let failCritical=false;
const state={scene:0,pending:-1,bars:[1,4,2,8],phase:0,stopped:0,custom:[0,0,0,0],muted:[0,0,0,0],starts:[0,0,0,0],master:100,master_mute:0,undo:0,
 a:'0,1,2,4|0,0,0,0|0,0,0,0|0|0',b:'4,0,2,0|0,0,0,0|0,0,0,0|0|0',c:'0,0,0,0|0,0,0,0',d:'0,0,0,0|0,0,0,0',armed:Array.from({length:4},()=>[0,0,0,0])};
const constants={MoveKnob1:71,MovePlay:85,MoveMaster:79,MoveRec:86,MoveDelete:119,MoveLeft:62,MoveRight:63,
 MoveLoop:58,MoveUndo:56,MoveMainKnob:14,MoveMainButton:3,MoveUp:55,MoveDown:54,MoveShift:49,MoveMute:88,Black:0,BrightRed:1,Green:126,White:120,LightGrey:118};
class FakeDate extends Date {static now(){return now;}}
const context=vm.createContext({Date:FakeDate,shadow_set_overtake_suppress_master_volume:v=>claims.push(v),
 host_module_set_param(k,v){writes.push([k,v]);params.set(k,v);if(k==='scene')state.pending=Number(v)===state.scene?-1:Number(v);if(k.endsWith('scene_range')){const [a,b]=v.split(',').map(Number),i='abcd'.indexOf(k[0]);state.starts[i]=a-1;state.bars[i]=b;}if(k.endsWith('scene_bars'))state.bars['abcd'.indexOf(k[0])]=Number(v);},
 host_module_set_param_blocking(k,v,timeout){
  assert.equal(timeout,100);critical.push([k,v]);
  if(failCritical){failCritical=false;return false;}
  writes.push([k,v]);params.set(k,v);
  if(k==='prepare_start'){state.start_serial=(state.start_serial||0)+1;state.count_in=params.get('test_prepare_count')==='1'?4:0;state.start_ready=state.count_in?0:1;}
  if(k==='cancel_start'){state.count_in=state.start_ready=0;}
  if(k.endsWith('start_bar'))state.cursors['abcd'.indexOf(k[0])]=Number(v)-1;
  if(k.endsWith('scene_range')){const [a,b]=v.split(',').map(Number),i='abcd'.indexOf(k[0]);state.starts[i]=a-1;state.bars[i]=b;}return true;
 },
 host_module_get_param(k){reads++; if(failed)return null;return k==='twain_status'?JSON.stringify(state):params.get(k)??'0';},
 fill_rect(...v){rects.push(v);},clear_screen(){},print(x,y,s){text.push(s);}
});
const module=new vm.SourceTextModule(fs.readFileSync('src/ui_twain.js','utf8'),{context});
await module.link(async spec=>{
 const vals=spec.includes('twain_projects')?{createProjectController:()=>({tick(){},click(){},move(){},guard:()=>true,modal:false,dirty:false,name:'Test project'})}:spec.includes('constants')?constants:spec.includes('input_filter')?
 {setLED:(n,c)=>leds.set(n,c),setButtonLED:(n,c)=>buttons.set(n,c),decodeDelta:v=>v<64?v:v-128}:{announce(s){announcements.push(s);}};
 return new vm.SyntheticModule(Object.keys(vals),function(){for(const[k,v]of Object.entries(vals))this.setExport(k,v);},{context});
});
await module.evaluate();
const cc=(n,v=127)=>context.onMidiMessageInternal([0xb0,n,v]);
const down=n=>context.onMidiMessageInternal([0x90,n,127]);
const up=n=>context.onMidiMessageInternal([0x80,n,0]);
context.init();
assert.equal(leds.get(92),120);assert.equal(leds.get(85),119); // A1/B2 columns
assert.equal(leds.get(94),119);assert.equal(leds.get(99),0); // C is available; unused pads dark
assert.equal(buttons.get(58),16);
down(92);assert.deepEqual(writes.at(-1),['monitor_safe','0']);up(92);assert.deepEqual(writes.at(-1),['a_t1_clip','1']);
cc(86);down(85);up(85);cc(86,0);assert.deepEqual(writes.at(-1),['b_t2_record','1']);
cc(119);down(76);up(76);cc(119,0);assert.deepEqual(writes.at(-1),['a_t3_clear','1']);
cc(58);assert.equal(buttons.get(58),124);down(19);up(19);assert.deepEqual(writes.at(-1),['a_scene_range','1,4']);assert.equal(leds.get(16),120);assert.equal(leds.get(19),16);
cc(63);down(31);up(31);assert.deepEqual(writes.at(-1),['b_scene_range','1,16']);
cc(58,0);assert.equal(buttons.get(58),16);assert(text.includes('PLAY A'));
const before=writes.length;cc(71,5);assert(writes.some(([k,v])=>k==='a_t3_hp'&&v==='5')); // selected clip remains editable
params.set('a_t1_level','100');down(92);cc(79,5);up(92);assert(writes.some(([k,v])=>k==='a_t1_level'&&v==='105'));assert.deepEqual(writes.at(-1),['edit_end','1']);
assert(!writes.slice(before).some(([k])=>k==='scene'||k.endsWith('_clip')));
const fx=['hp','lp','comp','sat','chorus','reverb','delay'];
for(let i=0;i<7;i++){down(93);cc(71+i,7);up(93);assert(writes.some(([k,v])=>k===`b_t1_${fx[i]}`&&v==='7'));}
const beforeMaster=writes.length;cc(79,2);assert.equal(writes.length,beforeMaster);
assert(claims.includes(1));assert.equal(claims.at(-1),0);
cc(63);assert.equal(state.pending,1);cc(63);assert.equal(state.pending,2);cc(63);assert.equal(state.pending,3);cc(62);assert.equal(state.pending,2);cc(62);cc(62);assert.equal(state.pending,-1);
state.armed[0][0]=4;context.onResume();assert.equal(leds.get(92),1);now=250;context.tick();assert.equal(leds.get(92),0);
state.phase=2.2;context.onResume();assert(text.includes('PLAY A'));assert.equal(leds.get(18),120);
const r=reads;for(let i=0;i<12;i++)context.tick();assert.equal(reads-r,6);
failed=true;context.onResume();assert(text.includes('PLAY A'));failed=false;
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
assert.equal(writes.length,changes);assert(announcements.includes('A1 LP freq: 345 Hz'));
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
assert.equal(params.get('b_t1_delay_rate'),'6');assert(announcements.includes('B1 Delay time: 1/8T'));
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
up(92);assert.equal(params.get('a_t1_level'),'50');
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
state.master_mute=1;state.muted[2]=1;context.onResume();assert.equal(buttons.get(88),124);assert.equal(leds.get(94),Math.sin(now*2*Math.PI/3000)>-0.2?107:108);
assert(text.includes('MUTED'));
// C and D keep independent lengths through the Loop gesture.
cc(58);down(94);down(20);up(20);down(95);down(30);up(30);cc(58,0);
assert.equal(params.get('c_scene_range'),'1,5');assert.equal(params.get('d_scene_range'),'1,15');
// Parking cancels stale physical gestures without a launch or a global-volume claim.
down(92);cc(49);context.overtakeParked=true;context.tick();assert.equal(claims.at(-1),0);
context.overtakeParked=false;context.onResume();
console.log('Twain UI: four-scene chords, independent edits, master volume, mute chords and parking passed');

// Screen timeline fills within the bar and remains inside the 128x64 display.
state.scene=0;state.bars[0]=4;state.phase=2.5;rects.length=0;context.onResume();
assert(rects.some(([x,y,w,h])=>x===65&&y===57&&w===14&&h===4));
assert(rects.every(([x,y,w,h])=>x>=0&&y>=0&&w>=0&&h>=0&&x+w<=128&&y+h<=64));
state.bars[0]=1;state.phase=0.5;rects.length=0;context.onResume();
assert(rects.some(([x,y,w,h])=>x===3&&y===57&&w===61&&h===4));
assert(!text.some(s=>s.includes('Tap clip:')||s.includes('Hold Loop:')||s.includes('Vol / FX')));

// Twain master level updates only its persistent row, with no transient duplicate.
text.length=0;params.set('master_level','100');cc(49);cc(79,125);cc(49,0);
assert(!text.some(s=>s.startsWith('Twain volume:')));

// Bank changes address layers 5-8; selection edits without holding or playback.
for(const scene of 'abcd')state[scene]='0,0,0,0,0,0,0,0|0';
state.armed=Array.from({length:4},()=>Array(8).fill(0));state.master_mute=0;
cc(54);assert.equal(buttons.get(55),124);
start=writes.length;cc(49);down(77);up(77);cc(49,0);
assert(!writes.slice(start).some(([k])=>k.endsWith('_clip')));
cc(71,9);assert.equal(params.get('b_t7_hp'),'9');
now+=700;context.tick();assert.deepEqual(writes.at(-1),['edit_end','1']);
start=writes.length;cc(79,1);assert.equal(writes.length,start); // native master stays native
cc(55);down(77);up(77);assert.deepEqual(writes.at(-1),['b_t3_clip','1']);
cc(54);down(68);down(76);up(68);up(76);
assert(writes.some(([k])=>k==='a_t8_clip'));assert(writes.some(([k])=>k==='a_t7_clip'));
// Missing host safety bindings block monitoring; headphones enable it.
cc(49);cc(86);cc(86,0);cc(49,0);
assert.equal(params.get('input_monitor'),'1');assert.equal(params.get('monitor_safe'),'0');
context.host_speaker_active=()=>false;context.host_line_in_connected=()=>false;
context.tick();assert.equal(params.get('monitor_safe'),'1');
context.host_speaker_active=()=>true;context.tick();assert.equal(params.get('monitor_safe'),'0');
context.host_line_in_connected=()=>true;context.tick();assert.equal(params.get('monitor_safe'),'1');
console.log('Twain UI: eight-layer banks, persistent selection, native master and monitor feedback guard passed');

// Failed initial/resume safety writes retry rather than caching an undelivered value.
context.host_speaker_active=()=>false;context.host_line_in_connected=()=>false;
params.set('monitor_safe','0');failCritical=true;context.onResume();
assert.equal(params.get('monitor_safe'),'0');context.tick();assert.equal(params.get('monitor_safe'),'1');
assert(critical.some(([k])=>k==='input_monitor'));
const acknowledged=critical.length;now+=1100;context.tick();assert.equal(critical.length,acknowledged+1);
cc(54);assert.equal(buttons.get(55),124);assert.equal(buttons.get(54),16);
cc(55);assert.equal(buttons.get(54),124);assert.equal(buttons.get(55),16);
console.log('Twain UI: acknowledged monitor writes, failed-delivery retry, periodic repair and bank LEDs passed');

state.redo=5;context.onResume();cc(49);assert.equal(buttons.get(56),124);cc(56);cc(49,0);
assert.deepEqual(writes.at(-1),['redo','1']);
state.muted[0]=1;cc(54);cc(55);cc(49);down(92);up(92);cc(49,0);
assert.equal(leds.get(92),Math.sin(now*2*Math.PI/3000)>-0.2?107:108); // muted selection remains pale purple

// Normal Play reaches Move once; Shift+Play never sends native Play/Stop.
const native=[];context.move_midi_inject_to_move=packet=>{native.push(Array.from(packet));return true;};
cc(85);cc(85);cc(85,0);assert.deepEqual(native,[[11,176,85,127],[11,176,85,0]]);
let jumpStart=writes.length;cc(49);cc(85);cc(49,0);cc(85,0);
assert(writes.slice(jumpStart).some(([k])=>k==='advance_last'));assert.equal(native.length,2);
cc(85);cc(49);cc(85,0);cc(49,0);assert.equal(native.length,4); // modifier changes don't strand a held native button
state.count_in=4;text.length=0;context.onResume();assert(text.includes('COUNT-IN'));
state.count_in=0;state.advance=1;text.length=0;context.onResume();assert(text.includes('Last bar next'));

// Low-velocity touch packets and quick taps work on the selected clip without holding it.
state.advance=0;cc(49);down(93);up(93);cc(49,0);params.set('b_t1_lp','66');
now+=1000;context.onMidiMessageInternal([0x90,1,1]);context.onMidiMessageInternal([0x90,1,0]);
now+=80;context.onMidiMessageInternal([0x90,1,1]);context.onMidiMessageInternal([0x90,1,0]);
assert.equal(params.get('b_t1_lp'),'0');

// Shift controls the selected clip's secondary parameter and double touch resets its default.
state.advance=0;params.set('b_t1_hp_res','30');cc(49);cc(71,5);assert.equal(params.get('b_t1_hp_res'),'35');
now+=1000;context.onMidiMessageInternal([0x90,0,1]);context.onMidiMessageInternal([0x80,0,0]);now+=60;
context.onMidiMessageInternal([0x90,0,1]);context.onMidiMessageInternal([0x80,0,0]);assert.equal(params.get('b_t1_hp_res'),'0');cc(49,0);
cc(58);down(18);down(20);up(18);up(20);assert.equal(leds.get(18),120);assert.equal(leds.get(19),16);assert.equal(leds.get(20),16);cc(58,0);assert.equal(params.get('b_scene_range'),'3,5');
params.set('input_level','100');params.set('monitor_level','100');const priorMon=params.get('input_monitor');
cc(86);cc(79,5);cc(86,0);assert.equal(params.get('input_level'),'105');assert.equal(claims.at(-1),0);
cc(49);cc(86);cc(79,125);cc(86,0);cc(49,0);assert.equal(params.get('monitor_level'),'97');
assert.equal(params.get('input_monitor'),priorMon); // monitor adjustment doesn't toggle it
console.log('Twain UI: quick selected taps, Shift FX, scene range chord and independent input/monitor levels passed');

state.scene=0;state.starts[0]=2;state.bars[0]=5;state.phase=0.5;state.count_in=4;text.length=0;context.onResume();assert(text.includes('COUNT-IN'));

// Compressor secondary displays the implemented release time, not old attack units.
state.count_in=0;
cc(49);down(93);up(93);cc(49,0);params.set('b_t1_comp_release','99');
text.length=0;cc(49);cc(73,1);cc(49,0);
assert.equal(params.get('b_t1_comp_release'),'100');
assert(announcements.some(s=>s.includes('1200 ms')),JSON.stringify(text));

// Monitor OFF remains visually dark even when the independent input detector peaks.
state.monitor=0;state.monitor_blocked=0;state.input=1;state.clip=1;state.count_in=0;state.advance=0;
rects.length=0;text.length=0;context.onResume();
assert(text.includes('MON OFF'));assert(!text.includes('!'));
assert(!rects.some(([x,y])=>x>=93&&y>=45&&y<51));
state.monitor=1;rects.length=0;text.length=0;context.onResume();
assert(text.includes('MON ON'));assert(text.includes('!'));
assert(rects.some(([x,y,w])=>x===94&&y===46&&w===23));
state.monitor_blocked=1;rects.length=0;text.length=0;context.onResume();
assert(text.includes('MON X'));assert(!rects.some(([x,y])=>x>=93&&y>=45&&y<51));

// Playing and editing can name different scenes; Loop follows the edited clip.
state.scene=0;state.stopped=0;state.bars=[8,8,8,8];state.starts=[0,0,0,0];
cc(49);down(93);up(93);cc(49,0);text.length=0;context.tick();
assert(text.includes('PLAY A'));assert(text.includes('EDIT B1'));
cc(58);down(19);up(19);cc(58,0);assert.equal(params.get('b_scene_range'),'1,4');

// Simulate the DSP prepared-start handshake, including a local count-in.
state.stopped=1;state.count_in=0;state.start_ready=0;state.start_serial=0;state.cursors=[-1,-1,-1,-1];
// The fixture's original setter drives these response fields (configured below).
params.set('test_prepare_count','1');context.onResume();
const nativeBefore=native.length;
down(18);up(18);assert.equal(params.get('b_start_bar'),'3');
// Cursor writes must not change the chosen range.
assert.equal(params.get('b_scene_range'),'1,4');
cc(49);cc(85);cc(49,0);cc(85,0);
assert.equal(params.get('prepare_start'),'1,3');assert.equal(native.length,nativeBefore);
state.count_in=0;state.start_ready=1;
context.tick();context.tick();
assert.deepEqual(native.slice(nativeBefore),[[11,176,85,127],[11,176,85,0]]);
for(let i=0;i<8;i++)context.tick();assert.equal(native.length,nativeBefore+2);
state.stopped=0;state.start_ready=0;context.tick();context.tick();
// Normal Play from stop starts the playing scene at its range beginning.
state.stopped=1;params.set('test_prepare_count','0');context.onResume();cc(85);cc(85,0);
assert.equal(params.get('prepare_start'),'0,0');assert.equal(native.length,nativeBefore+4);
state.stopped=0;state.start_ready=0;context.tick();context.tick();
// A second Play during count-in cancels it without touching native transport.
state.stopped=1;params.set('test_prepare_count','1');context.onResume();cc(85);cc(85,0);
const beforeCancel=native.length;cc(85);cc(85,0);
assert.equal(params.get('cancel_start'),'1');assert.equal(native.length,beforeCancel);
// Parking cancels a pending countdown; later polls must never start Move.
cc(85);cc(85,0);context.overtakeParked=true;context.tick();
assert.equal(state.count_in,0);assert.equal(native.length,beforeCancel);
context.overtakeParked=false;context.onResume();
console.log('Twain UI: monitoring visibility, explicit off-scene editing, temporary cursor, count-in handshake and cancellation passed');
// A dropped native release retries only release, never the Play press.
params.set('test_prepare_count','0');state.stopped=1;state.start_ready=0;context.onResume();
let failRelease=true;
context.move_midi_inject_to_move=packet=>{native.push(Array.from(packet));if(packet[3]===0&&failRelease){failRelease=false;return false;}return true;};
let safetyStart=native.length;cc(85);cc(85,0);context.tick();
assert.deepEqual(native.slice(safetyStart),[[11,176,85,127],[11,176,85,0],[11,176,85,0]]);
state.stopped=0;state.start_ready=0;context.tick();context.tick();
// Missing native transport support cancels the prepared engine rather than freezing it.
state.stopped=1;context.onResume();context.move_midi_inject_to_move=undefined;
cc(85);cc(85,0);assert.equal(state.start_ready,0);assert.equal(params.get('cancel_start'),'1');
console.log('Twain UI: native release retry and unavailable transport recovery passed');
