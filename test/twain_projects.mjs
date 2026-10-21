import assert from 'node:assert/strict';
import {createProjectController} from '../src/twain_projects.mjs';
const A='7f2402f6-dc58-43e5-b7aa-d93e16e52ab6',B='d8ad61b8-7078-4548-820c-f42a70bf987f';
let live={ready:true,id:A,name:'Set A',generation:1};
const status={id:'',dirty:0,busy:0,result:0,serial:0},writes=[];
let pending=null;
const ctl=createProjectController({probe:()=>live,get:k=>{
 if(k==='project_status')return JSON.stringify(status);
 if(k==='project_name')return status.id===A?'Set A':'Set B';
 if(k==='project_catalog_count')return '1';
 if(k==='project_catalog_0')return `${A}\tSet A`;
},set:(k,v)=>{
 writes.push([k,v]);if(k==='project_live')return;
 pending={key:k,value:v,target:live.id};status.busy=1;status.result=0;status.serial++;
}});
function complete(result=0) {
 status.busy=0;status.result=result;
 if(!result) {
  if(pending.key==='project_load'||pending.key==='project_new') {
   status.id=pending.target;status.dirty=pending.key==='project_new' || pending.value!==pending.target?1:0;
  }
  if(pending.key==='project_save')status.dirty=0;
 }
 ctl.tick(true);
}
ctl.tick(true);assert.equal(pending.key,'project_load');assert.equal(pending.value,A);
complete(1);assert.equal(pending.key,'project_new');complete();assert(ctl.guard());
status.dirty=1;ctl.tick(true);assert(ctl.dirty);ctl.click();assert.equal(pending.key,'project_save');
complete(3);assert.equal(ctl.view().mode,'error');assert(ctl.dirty);assert.equal(ctl.view().choice,'Retry save');
ctl.click();assert.equal(pending.key,'project_save');complete();assert(!ctl.dirty);
// A native project switch with dirty Twain waits for a choice.
status.dirty=1;live={ready:true,id:B,name:'Set A Copy',generation:2};ctl.tick(true);
assert.equal(ctl.view().mode,'unsaved');assert(!ctl.guard());
ctl.move(2); // each encoder event moves one choice
ctl.move(1);assert.equal(ctl.view().choice,'Cancel');ctl.click();assert.equal(ctl.view().mode,'kept');
assert.equal(status.id,A);ctl.click();assert.equal(ctl.view().mode,'unsaved');
// Save first targets the bound old project, then attempts the current project.
ctl.click();assert.equal(pending.key,'project_save');complete();assert.equal(pending.key,'project_load');assert.equal(pending.value,B);
complete(1);assert.equal(pending.key,'project_new');complete();assert(ctl.guard());
ctl.click(true);assert.equal(ctl.view().mode,'unsavedCopy');ctl.move(1);ctl.click();assert.equal(pending.key,'project_catalog');complete();assert.equal(ctl.view().mode,'source');
ctl.move(1);assert.equal(ctl.view().choice,'Set A');ctl.click();assert.equal(ctl.view().mode,'copy');
assert.equal(ctl.view().detail,'Set A');ctl.click();assert.equal(pending.value,A);assert.equal(pending.target,B);complete();
assert(ctl.guard());assert(ctl.dirty);assert.equal(status.id,B);ctl.click();complete();assert(!ctl.dirty);
// Unknown/pending IDs block edits and invalidate the native target.
live={ready:false,reason:'project has no persistent ID yet'};ctl.tick(true);assert(!ctl.guard());assert.equal(writes.at(-1)[1],'');
assert.equal(ctl.view().detail,'Save Move project first');
// Returning to the same live identity does not reload or lose the workspace.
const count=writes.length;live={ready:true,id:B,name:'Set A Copy',generation:2};ctl.tick(true);assert(ctl.guard());
assert.equal(writes.length,count+1); // only project_live re-established
// Discard is explicit, and a failed load keeps the old bound ID.
status.dirty=1;live={ready:true,id:A,name:'Set A',generation:3};ctl.tick(true);ctl.move(1);ctl.click();assert.equal(pending.key,'project_load');
complete(2);assert.equal(status.id,B);assert.equal(ctl.view().mode,'error');assert(ctl.dirty);
console.log('Twain project UI: first-open choice, Save retry, dirty switch protection, copy confirmation and pending identity gate passed');

// A dropped ID must not be cached; a stale result is not a new request's result.
{
 const s={id:'',dirty:0,busy:0,result:7,serial:10};
 let dropped=true,engineId='',deferred=null;
 const sent=[];
 const c=createProjectController({probe:()=>({ready:true,id:B,name:'Set 26',generation:26}),
  get:k=>k==='project_status'?JSON.stringify(s):'',
  set:(k,v)=>{
   sent.push([k,v]);
   if(k==='project_live') {if(dropped){dropped=false;return false;}engineId=v.split('\n')[0];return true;}
   // Accepted by the host mailbox; engine hasn't serviced it yet.
   deferred=k;return true;
  }});
 c.tick(true);assert.equal(c.view().mode,'identity');assert.equal(deferred,null);
 c.tick(true);assert.equal(engineId,B);assert.equal(deferred,'project_load');
 c.tick(true);assert.equal(c.view().mode,'busy'); // ignore the old result=7
 assert.equal(sent.filter(([k])=>k==='project_load').length,1);
 s.serial++;s.result=1;c.tick(true);assert.equal(deferred,'project_new');
 s.serial++;s.result=0;s.id=B;s.dirty=1;c.tick(true);assert(c.guard());
 // Rejected operation surfaces a communication error and keeps the old workspace.
 let reject=true;
 const r=createProjectController({probe:()=>({ready:true,id:A,name:'Set 26',generation:27}),
  get:k=>k==='project_status'?JSON.stringify({...s,dirty:0}):'',
  set:(k,v)=>{sent.push([k,v]);if(k==='project_live')return true;if(reject){reject=false;return false;}s.serial++;s.busy=1;return true;}});
 r.tick(true);assert.equal(r.view().mode,'error');assert.equal(s.id,B);
 const before=sent.length;r.click();assert.equal(r.view().mode,'busy');
 assert.equal(sent[before][0],'project_live');assert.equal(sent[before+1][0],'project_load');
}
console.log('Twain project UI: dropped identity retry, stale-result isolation, same-name IDs and acknowledged Retry passed');

// A host that accepts but never delivers a command gets a bounded retry screen.
{
 const savedNow=Date.now;let clock=1000;
 try {
  Date.now=()=>clock;
  const c=createProjectController({probe:()=>({ready:true,id:A,name:'Set 26',generation:1}),
   get:k=>k==='project_status'?JSON.stringify({id:'',dirty:0,busy:0,result:7,serial:0}):'',set:()=>true});
  c.tick(true);assert.equal(c.view().mode,'busy');clock+=5001;c.tick(true);
  assert.equal(c.view().mode,'error');assert.equal(c.view().detail,'Move link busy');
 } finally {Date.now=savedNow;}
}

// Cleanup is preview-only until a separate, default-to-keep confirmation.
{
 const s={id:A,dirty:0,busy:0,result:0,serial:1},sent=[];
 let job='',incomplete=false;
 const c=createProjectController({probe:()=>({ready:true,id:A,name:'Set A',generation:1}),
  get:k=>k==='project_status'?JSON.stringify(s):k==='project_catalog_count'?'0':
   k==='project_cleanup_summary'?'91\t1\t2097152\t1':
   k==='project_cleanup_entry_0'?(incomplete?'':`${B}\tDeleted project\t2097152`):'Set A',
  set:(k,v)=>{sent.push([k,v]);if(k==='project_live')return true;job=k;s.serial++;s.busy=1;return true;}});
 const finish=(result=0)=>{s.busy=0;s.result=result;c.tick(true);};
 c.tick(true);c.click(true);assert.equal(job,'project_catalog');finish();
 c.move(1);assert.equal(c.view().choice,'Clean up unused saves');c.click();
 assert.equal(job,'project_cleanup_preview');finish();assert.equal(c.view().choice,'Deleted project');
 assert.equal(c.view().detail,'2.0 MB total');
 assert(!sent.some(([k])=>k==='project_cleanup_delete'));
 c.move(1);c.click();assert.equal(c.view().choice,'Keep saves');c.click();
 assert(!sent.some(([k])=>k==='project_cleanup_delete'));
 c.click();c.move(1);assert.equal(c.view().choice,'Delete these saves');c.click();
 assert.deepEqual(sent.at(-1),['project_cleanup_delete','91']);finish(9);
 assert.equal(c.view().choice,'Scan unused saves');c.click();assert.equal(job,'project_cleanup_preview');
 finish(8);assert.equal(c.view().detail,'Move sets unavailable');
 c.click();incomplete=true;finish();assert.equal(c.view().mode,'error');
 assert.equal(c.view().detail,'Move link busy'); // incomplete names cannot authorize deletion
}
console.log('Twain cleanup UI: names and size preview, explicit default-to-keep confirmation and rescan recovery passed');
