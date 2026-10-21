/* Project selection and confirmations; no file I/O and no audio ownership here. */
import {probeProjectIdentity} from './twain_project_identity.mjs';
const errors=['','No Twain save yet','Save damaged or unsupported','Disk operation failed','Not enough memory','Move project changed','Finish recording first','Move ID not received','Move sets unavailable','Saves changed; scan again'];
export function createProjectController({get,set,probe=probeProjectIdentity,notice=()=>{}}) {
    let status=null,live=null,mode='identity',action=null,choices=[],selection=0;
    let cleanup=[],cleanupToken=0,cleanupBytes=0;
    let message='Waiting for Move',copy=null,failedAction=null,seenLive=null,replace='',kept='',lastCheck=-Infinity;
    const readStatus=()=>{
        try { const s=JSON.parse(get('project_status'));if(s && typeof s.id==='string')status=s; }
        catch (_) {}
        return status;
    };
    function syncLive(force=false) {
        const signature=live?`${live.id}\n${live.generation}\n${live.name}`:'';
        if(force || signature!==seenLive) {
            // Never remember a project handoff that the host refused to deliver.
            if(set('project_live',signature)===false) { seenLive=null;return false; }
            seenLive=signature;
        }
        return true;
    }
    function request(key,value,kind) {
        const done={kind,target:live?.id || '',source:value,serial:readStatus()?.serial,at:Date.now()};
        // Resend on every operation, including Retry: a previous UI may have cached a lost ID.
        if(!syncLive(true) || set(key,value)===false) {
            failedAction=done;mode='error';message='Move link busy';selection=0;return;
        }
        action=done;mode='busy';message=kind.startsWith('save')?'Saving Twain...':kind==='catalog'?'Reading saves...':'Loading Twain...';
        readStatus();
    }
    function load() { request('project_load',live.id,'load'); }
    function keep() { kept=live?.id || '';mode='kept';action=null;replace=''; }
    function chooseSource() {
        choices=[{name:'Start empty',id:null}];
        const count=Math.min(64,Number(get('project_catalog_count')) || 0);
        for(let i=0;i<count;i++) {
            const [id,name]=String(get(`project_catalog_${i}`) || '').split('\t');
            if(id && id!==live?.id)choices.push({id,name:name || id.slice(0,8)});
        }
        choices.push({name:'Clean up unused saves',id:'cleanup'});
        choices.push({name:'Cancel',id:'cancel'});selection=0;mode='source';
    }
    function evaluate() {
        if(!status || !live || action)return;
        if(status.busy) { mode='identity';message='Finishing Twain task';return; }
        if(status.id===live.id) { kept='';replace='';mode='performance';return; }
        if(kept===live.id) { mode='kept';return; }
        if(status.dirty && replace!==live.id) { mode='unsaved';selection=0;return; }
        load();
    }
    function finish() {
        const done=action;action=null;
        if(status.result) {
            if(done.kind==='load' && status.result===1) { request('project_new','1','new');return; }
            if(status.result===5) { mode='identity';return; }
            failedAction=done;mode='error';message=errors[status.result] || 'Project operation failed';selection=0;return;
        }
        if(done.kind==='cleanupPreview') {
            const fields=String(get('project_cleanup_summary') || '').split('\t');
            cleanupToken=Number(fields[0]);const count=Number(fields[1]);cleanupBytes=Number(fields[2]);
            cleanup=[];let complete=fields.length===4 && Number.isSafeInteger(cleanupToken) && cleanupToken>=0 &&
                Number.isSafeInteger(count) && count>=0 && count<=64 && Number.isSafeInteger(cleanupBytes) && cleanupBytes>=0 && (!count || cleanupToken>0);
            if(complete)for(let i=0;i<count;i++) {
                const [id,name,rawBytes]=String(get(`project_cleanup_entry_${i}`) || '').split('\t');
                const bytes=Number(rawBytes);
                if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id || '') ||
                   !Number.isSafeInteger(bytes) || bytes<0 || cleanup.some(e=>e.id===id)) { complete=false;break; }
                cleanup.push({id,name:name || id.slice(0,8),bytes});
            }
            if(!complete || cleanup.reduce((sum,e)=>sum+e.bytes,0)!==cleanupBytes) {
                cleanupToken=0;failedAction=done;mode='error';message='Move link busy';selection=0;return;
            }
            mode='cleanupList';selection=0;return;
        }
        if(done.kind==='cleanupDelete') {
            const removed=Number(String(get('project_cleanup_summary') || '').split('\t')[3]) || 0;
            notice(`${removed} unused saves deleted`);mode='performance';return;
        }
        if(done.kind==='catalog') { chooseSource();return; }
        if(done.kind==='save' || done.kind==='saveSwitch' || done.kind==='saveCopy') {
            notice(status.dirty?'Changed during save':'Twain saved');
            if(done.kind==='saveCopy' && !status.dirty) { request('project_catalog','1','catalog');return; }
            if(done.kind==='saveSwitch' && live && !status.dirty) { replace=live.id;load();return; }
        }
        mode='performance';replace='';evaluate();
    }
    function tick(force=false) {
        if(!force && Date.now()-lastCheck<500)return;
        lastCheck=Date.now();readStatus();
        const current=probe();
        if(current.ready) {
            live=current;
            if(!syncLive()) { mode='identity';message='Connecting to Move';return; }
        } else {
            live=null;
            syncLive();
            if(!action) { mode='identity';message=current.reason?.includes('persistent')?'Save Move project first':current.reason?.includes('startup')?'Reopen Move project':'Waiting for Move'; }
        }
        if(action && status && !status.busy) {
            if(status.serial!==action.serial)finish();
            else if(Date.now()-action.at>5000) {
                failedAction=action;action=null;mode='error';message='Move link busy';selection=0;
            }
        }
        if(!action && live && (mode==='identity'||mode==='performance'||mode==='kept'))evaluate();
        // A native switch also invalidates source/confirmation menus for the previous target.
        if(live && ['source','copy','unsaved','unsavedCopy','error','cleanupList','cleanupConfirm'].includes(mode) && targetId && targetId!==live.id) {
            replace='';kept='';mode='identity';evaluate();
        }
        if(live)targetId=live.id;
    }
    let targetId='';
    function click(copyMenu=false) {
        const previousTarget=targetId;
        tick(true);if(!status || !live || status.busy || (previousTarget && previousTarget!==targetId))return;
        if(mode==='performance') {
            if(copyMenu) {
                if(status.dirty) { mode='unsavedCopy';selection=0; }
                else request('project_catalog','1','catalog');
            } else if(status.dirty)request('project_save','1','save');else notice('Twain saved');
        } else if(mode==='unsavedCopy') {
            if(selection===0)request('project_save','1','saveCopy');
            else if(selection===1)request('project_catalog','1','catalog');
            else mode='performance';
        } else if(mode==='unsaved') {
            if(selection===0)request('project_save','1','saveSwitch');
            else if(selection===1) { replace=live.id;load(); }
            else keep();
        } else if(mode==='source') {
            copy=choices[selection];
            if(copy.id==='cleanup')request('project_cleanup_preview','1','cleanupPreview');
            else if(copy.id==='cancel')keep();
            else if(copy.id===null)request('project_new','1','new');
            else { mode='copy';selection=0; }
        } else if(mode==='copy') {
            if(selection===0)request('project_load',copy.id,'copy');
            else { mode='source';selection=0; }
        } else if(mode==='cleanupList') {
            if(selection===cleanup.length && cleanup.length) { mode='cleanupConfirm';selection=0; }
            else if(selection===cleanup.length+1 || !cleanup.length)mode='performance';
        } else if(mode==='cleanupConfirm') {
            if(selection===1)request('project_cleanup_delete',String(cleanupToken),'cleanupDelete');
            else {mode='cleanupList';selection=cleanup.length;}
        } else if(mode==='error') {
            if(selection===0) {
                if(failedAction?.kind.startsWith('cleanup'))request('project_cleanup_preview','1','cleanupPreview');
                else if(failedAction?.kind.startsWith('save'))request('project_save','1',failedAction.kind);
                else if(failedAction?.kind==='copy')request('project_load',failedAction.source,'copy');
                else { replace=live.id;load(); }
            }else keep();
        } else if(mode==='kept') { kept='';mode='identity';evaluate(); }
    }
    function move(delta) {
        if(!delta)return;
        const count=(mode==='unsaved'||mode==='unsavedCopy')?3:mode==='source'?choices.length:mode==='cleanupList'?cleanup.length+2:mode==='copy'||mode==='error'||mode==='cleanupConfirm'?2:0;
        if(count)selection=Math.max(0,Math.min(count-1,selection+(delta>0?1:-1)));
    }
    function view() {
        const currentName=live?.name || get('project_name') || 'Twain';
        let title=currentName,detail='',choice='';
        if(mode==='unsaved') { title='Unsaved Twain';detail=get('project_name') || 'Previous project';choice=['Save then switch','Discard and switch','Cancel'][selection]; }
        else if(mode==='unsavedCopy') { title='Unsaved Twain';detail='Before copying';choice=['Save then copy','Discard then copy','Cancel'][selection]; }
        else if(mode==='source') { detail='Twain projects:';choice=choices[selection]?.name || ''; }
        else if(mode==='copy') { title='Copy Twain from';detail=copy.name;choice=['Copy into this set','Cancel'][selection]; }
        else if(mode==='cleanupList') {
            title=`${cleanup.length} unused saves`;
            detail=cleanup.length?`${(cleanupBytes/1048576).toFixed(1)} MB total`:'Nothing to clean up';
            choice=selection<cleanup.length?cleanup[selection].name:selection===cleanup.length&&cleanup.length?'Review deletion':'Back';
        }
        else if(mode==='cleanupConfirm') {title='Delete unused saves?';detail=`${cleanup.length} saves / ${(cleanupBytes/1048576).toFixed(1)} MB`;choice=['Keep saves','Delete these saves'][selection];}
        else if(mode==='busy'||mode==='identity')detail=message;
        else if(mode==='error') { title='Twain kept intact';detail=message;choice=[failedAction?.kind.startsWith('cleanup')?'Scan unused saves':failedAction?.kind.startsWith('save')?'Retry save':'Retry project load','Cancel'][selection]; }
        else if(mode==='kept') { title='Previous Twain kept';detail='Reopen its Move set';choice='Click to switch'; }
        return {title,detail,choice,mode};
    }
    return {tick,click,move,view,
        guard(){tick(true);return mode==='performance' && !!live && status?.id===live.id && !status.busy;},
        get modal(){return mode!=='performance';},get busy(){return mode==='busy';},
        get dirty(){return !!status?.dirty;},get id(){return status?.id || '';},get name(){return live?.name || 'Twain';}};
}
