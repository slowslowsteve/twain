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
