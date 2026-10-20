import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const id='7f2402f6-dc58-43e5-b7aa-d93e16e52ab6';
let now=0,ready=true,frame=[];
const writes=[],claims=[],acknowledged=[];
const status={id,dirty:1,busy:0,result:0,serial:0};
const state={scene:0,pending:-1,bars:[1,1,1,1],phase:0,stopped:0,custom:[0,0,0,0],muted:[0,0,0,0],master:100,master_mute:0,undo:0,
 a:'4,0,0,0|0',b:'0,0,0,0|0',c:'0,0,0,0|0',d:'0,0,0,0|0',armed:Array.from({length:4},()=>[0,0,0,0])};
class Clock extends Date { static now(){return now;} }
const constants={MoveKnob1:71,MoveMaster:79,MoveRec:86,MoveDelete:119,MoveLeft:62,MoveRight:63,MoveLoop:58,MoveUndo:56,MoveMainKnob:14,MoveMainButton:3,MoveUp:55,MoveDown:54,MoveShift:49,MoveMute:88,Black:0,BrightRed:1,Green:126,White:120,LightGrey:118};
const context=vm.createContext({Date:Clock,host_move_model_state:()=>ready?[1,7,7]:[1,8,7],
 shadow_get_param:(slot,key)=>{assert.equal(slot,0);assert.equal(key,'active_set');return `${id}\nSet A\n7`;},
 host_module_get_param:key=>key==='project_status'?JSON.stringify(status):key==='twain_status'?JSON.stringify(state):key==='project_name'?'Set A':key==='master_level'?String(state.master):'0',
 host_module_set_param:(key,value)=>{writes.push([key,value]);if(key==='master_level')state.master=Number(value);if(key==='project_save'){status.busy=1;status.serial++;}},
 host_module_set_param_blocking:(key,value,timeout)=>{
  assert.equal(timeout,key.startsWith('project_')?500:100);acknowledged.push(key);
  writes.push([key,value]);if(key==='project_save'){status.busy=1;status.serial++;}return true;
 },
 shadow_set_overtake_suppress_master_volume:value=>claims.push(value),
 clear_screen:()=>{frame=[];},print:(x,y,text)=>frame.push(text),fill_rect(){}});
const cache=new Map();
async function link(spec) {
 if(spec.startsWith('./')) {
  if(!cache.has(spec))cache.set(spec,new vm.SourceTextModule(fs.readFileSync(`src/${spec.slice(2)}`,'utf8'),{context}));
  return cache.get(spec);
 }
 const values=spec.includes('constants')?constants:spec.includes('input_filter')?{setLED(){},setButtonLED(){},decodeDelta:v=>v<64?v:v-128}:{announce(){}};
 return new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});
}
const ui=new vm.SourceTextModule(fs.readFileSync('src/ui_twain.js','utf8'),{context});await ui.link(link);await ui.evaluate();
const midi=(type,n,v=127)=>context.onMidiMessageInternal([type,n,v]);
context.init();assert(frame.includes('*'));assert(frame.includes('Set A 1-4'));
midi(0xb0,3);assert(writes.some(([key])=>key==='project_save'));assert(frame.includes('Saving Twain...'));
let start=writes.length;midi(0x90,92);midi(0x80,92,0);assert(!writes.slice(start).some(([key])=>key.endsWith('_clip')));
status.busy=0;status.dirty=0;now+=600;context.tick();assert(!frame.includes('*'));
start=writes.length;midi(0x90,92);midi(0x80,92,0);assert(writes.slice(start).some(([key])=>key==='a_t1_clip'));
midi(0xb0,49);midi(0xb0,79,125);midi(0xb0,49,0);assert(frame.includes('Twain 97%'));assert(!frame.some(s=>s.startsWith('Twain volume:')));
ready=false;now+=600;context.tick();assert(frame.includes('Waiting for Move'));
start=writes.length;midi(0x90,92);midi(0x80,92,0);assert(!writes.slice(start).some(([key])=>key.endsWith('_clip')));
assert(writes.some(([key,value])=>key==='project_live'&&value===''));
assert(acknowledged.includes('project_live'));assert(acknowledged.includes('project_save'));
console.log('Twain project/UI integration: live gate, visible dirty star, jog Save, busy input protection and clean return passed');
