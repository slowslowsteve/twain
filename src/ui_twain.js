/* Four vertical clip columns: scenes A–D, four layers each. */
import { setLED, setButtonLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveMaster, MoveRec, MoveDelete, MoveUndo, MoveLeft, MoveRight, MoveLoop, MoveShift, MoveMute, MoveMainKnob, MoveMainButton,
    Black, BrightRed, Green, White, LightGrey } from '/data/UserData/schwung/shared/constants.mjs';
import { createProjectController } from './twain_projects.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
const dspGet=host_module_get_param, dspSet=host_module_set_param;
const projects=createProjectController({get:dspGet,set:dspSet,notice:text=>notice(text)});
const FX=['hp','lp','comp','sat','chorus','reverb','delay','delay_rate'];
const FX_NAMES=['HP filter','LP filter','Compression','Drive','Chorus','Reverb','Delay','Delay rate'];
const RATES=['1/1','1/2','1/2T','1/4','1/4T','1/8','1/8T','1/16','1/16T','1/32','1/32T','1/64'];
let snapshot=null, held=null, rec=false, del=false, loop=false, editScene=0;
let pressed=new Map(), shift=false, mute=false, muteUsed=false;
let masterEditing=false;
let ticks=0, lastForce=-10000, overlay='', overlayUntil=0;
function claimVolume(on) {
    if(typeof shadow_set_overtake_suppress_master_volume==='function')
        shadow_set_overtake_suppress_master_volume(on?1:0);
}
function label(s) { return 'ABCD'[s]; }
function prefix(s) { return 'abcd'[s]+'_'; }
function volumeClaim() { claimVolume(shift || pressed.size>0); }
function key(clip,name) { return `${prefix(clip.scene)}t${clip.track+1}_${name}`; }
function clipAt(note) {
    if(note<68 || note>99 || (note-68)%8>3)return null;
    return {scene:(note-68)%8,track:3-Math.floor((note-68)/8),note,used:false,values:{},taps:{},touches:{},editing:false};
}
function poll() {
    const raw=dspGet('twain_status');
    if(!raw)return;
    try {
        const next=JSON.parse(raw);
        if(Array.isArray(next.bars) && typeof next.a==='string' && typeof next.b==='string' && typeof next.c==='string' && typeof next.d==='string')snapshot=next;
    } catch (_) {}
}
function paint() {
    if(globalThis.overtakeParked)return;
    const now=Date.now(), blink=Math.floor(now/250)%2===0;
    const force=now-lastForce>=1000;
    if(force)lastForce=now;
    setButtonLED(MoveLoop,loop?124:16,force);
    setButtonLED(MoveRec,rec?BrightRed:65,force);
    setButtonLED(MoveDelete,del?124:16,force);
    setButtonLED(MoveMute,snapshot && snapshot.master_mute?124:mute?White:16,force);
    setButtonLED(MoveUndo,snapshot && snapshot.undo>0?124:16,force);
    clear_screen();
    if(!snapshot) { print(2,2,'TWAIN connecting...',1); return; }
    if(projects.modal) {
        for(let i=68;i<=99;i++)setLED(i,Black,force);
        for(let i=16;i<=31;i++)setLED(i,Black,force);
        const v=projects.view();
        print(2,2,v.title.slice(0,20),1);print(2,20,v.detail.slice(0,20),1);
        if(v.choice) { print(2,37,`< ${v.choice.slice(0,17)} >`,1);print(2,54,'Press main knob',1); }
        return;
    }
    if(projects.dirty)print(118,2,'*',1);
    const s=loop?editScene:snapshot.scene, bars=snapshot.bars[s];
    const phase=Math.max(0,Math.min(snapshot.phase,snapshot.bars[snapshot.scene]-0.0001));
    const bar=Math.floor(phase)+1, beat=Math.floor((phase%1)*4)+1;
    print(2,2,loop?`Set ${label(s)}: ${bars} bars`:`${label(snapshot.scene)} Bar ${bar}/${snapshot.bars[snapshot.scene]}`,1);
    print(2,14,projects.name.slice(0,20),1);
    if(now<overlayUntil) print(2,28,overlay,1);
    else if(snapshot.stopped) print(2,28,'Stopped',1);
    else if(snapshot.pending>=0) print(2,28,`Next ${label(snapshot.pending)} at end`,1);
    else {
        const states=snapshot['abcd'[snapshot.scene]].split('|')[0].split(',').map(Number);
        const recording=states.map((v,i)=>v===1?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        const armed=snapshot.armed[snapshot.scene].map((v,i)=>v===4?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        if(recording.length)print(2,28,`REC ${recording.join(' ')}`,1);
        else if(armed.length)print(2,28,`REC next: ${armed.join(' ')}`,1);
        else print(2,28,`Beat ${beat}/4`,1);
    }
    print(2,41,snapshot.master_mute?'TWAIN MUTED':`Twain ${snapshot.master===undefined?100:snapshot.master}%`,1);
    // Persistent segmented timeline: the current bar fills through its beats.
    const total=snapshot.bars[snapshot.scene], width=124/total;
    for(let i=0;i<total;i++) {
        const x=2+Math.floor(i*width), w=Math.max(2,Math.floor((i+1)*width)-Math.floor(i*width)-1);
        fill_rect(x,54,w,1,1);fill_rect(x,62,w,1,1);
        fill_rect(x,54,1,9,1);fill_rect(x+w-1,54,1,9,1);
        const progress=Math.max(0,Math.min(1,phase-i));
        if(progress>0)fill_rect(x+1,56,Math.round((w-2)*progress),5,1);
    }
    for(let i=0;i<16;i++) {
        const current=snapshot.bars[snapshot.scene]===1?Math.floor((phase%1)*16):bar-1;
        const color=loop?(i===bars-1?White:i<bars?16:LightGrey)
            :i===current?White:i<snapshot.bars[snapshot.scene] || snapshot.bars[snapshot.scene]===1?33:Black;
        setLED(16+i,color,force);
    }
    const scenes=[snapshot.a,snapshot.b,snapshot.c,snapshot.d].map(v=>v.split('|').map(p=>p.split(',').map(Number)));
    for(let row=0;row<4;row++)for(let col=0;col<8;col++) {
        let color=Black;
        if(col<4) {
            const state=scenes[col][0][row], armed=snapshot.armed[col][row];
            const custom=snapshot.custom && (snapshot.custom[col] & (1<<row));
            color=[custom?[97,104,16,33][col]:119,BrightRed,Green,Green,8][state] || 119;
            if(snapshot.muted && (snapshot.muted[col] & (1<<row)))color=LightGrey;
            if(armed)color=blink?(armed===1||armed===4?BrightRed:armed===3?8:Green):Black;
            else if(snapshot.pending===col && !blink)color=Black;
            if(loop && col===editScene)color=White;
            if(pressed.has(92-row*8+col))color=White;
        }
        setLED(92-row*8+col,color,force);
    }
}
function refresh() { poll(); paint(); }
function notice(text) { overlay=text; overlayUntil=Date.now()+1800; announce(text); }
function paramFor(controller) { return controller===MoveMaster?'level':FX[controller-MoveKnob1]; }
function readValue(param,fresh=false) {
    if(fresh || held.values[param]===undefined) {
        const raw=dspGet(key(held,param));
        if(raw===null || raw===undefined || raw==='')return null;
        const number=Number(raw);if(!Number.isFinite(number))return null;
        held.values[param]=number;
    }
    return held.values[param];
}
function showValue(controller,param,value) {
    const name=param==='level'?'Volume':FX_NAMES[controller-MoveKnob1];
    const amount=param==='delay_rate'?RATES[value]:`${value}%`;
    notice(`${label(held.scene)}${held.track+1} ${name}: ${amount}`);
}
function beginEdit() {
    if(!held.editing) {
        dspSet('edit_begin',`${prefix(held.scene)}t${held.track+1}`);held.editing=true;
    }
}
function endMasterEdit() {
    if(masterEditing) { dspSet('master_edit_end','1');masterEditing=false; }
}
function endEdit() {
    if(held && held.editing) { dspSet('edit_end','1'); held.editing=false; }
}
function knobTouch(controller) {
    if(!held)return;
    const param=paramFor(controller); if(!param)return;
    held.used=true;
    const value=readValue(param,true); if(value===null)return;
    const now=Date.now(), previous=held.taps[param];
    const count=previous && now-previous.at<600 ? previous.count+1 : 1;
    held.taps[param]={at:now,count};
    if(count===2) {
        const reset=param==='level'?100:param==='delay_rate'?5:0;
        if(value!==reset) { beginEdit();dspSet(key(held,param),String(reset));held.values[param]=reset; }
        held.taps[param]=null;
        showValue(controller,param,reset);
    } else showValue(controller,param,value);
}
function adjust(controller,value) {
    if(!held)return;
    const delta=decodeDelta(value); if(!delta)return;
    held.used=true;
    const param=paramFor(controller); if(!param)return;
    held.taps[param]=null; // an encoder turn isn't a tap in the reset gesture
    const current=readValue(param); if(current===null)return;
    const max=param==='level'?200:param==='delay_rate'?RATES.length-1:100;
    const next=Math.max(0,Math.min(max,current+delta));
    if(next!==current) { beginEdit();held.values[param]=next;dspSet(key(held,param),String(next)); }
    showValue(controller,param,next);
}
function muteClip(clip) {
    clip.used=true;muteUsed=true;
    const next=dspGet(key(clip,'mute'))==='1'?'0':'1';
    dspSet(key(clip,'mute'),next);
    notice(`${label(clip.scene)}${clip.track+1} ${next==='1'?'muted':'unmuted'}`);
}
globalThis.init=function(){projects.tick(true);refresh();};
globalThis.onResume=function() { endEdit();endMasterEdit(); pressed.clear();held=null;shift=mute=muteUsed=false; claimVolume(false); rec=del=loop=false; lastForce=-10000;projects.tick(true); refresh(); };
globalThis.tick=function() {
    if(globalThis.overtakeParked && (pressed.size || shift || mute)) {
        endEdit();endMasterEdit();pressed.clear();held=null;shift=mute=muteUsed=false;claimVolume(false);
    }
    projects.tick();
    if(projects.modal && (held || shift)) { endEdit();endMasterEdit();pressed.clear();held=null;shift=false;claimVolume(false); }
    if(++ticks%2===0)poll();paint();
};
globalThis.onMidiMessageInternal=function(data) {
    const type=data[0]&0xf0, note=data[1], value=data[2];
    if(type!==0x90 && type!==0x80 && type!==0xb0)return;
    if(type===0xb0 && note===MoveMainKnob) { projects.move(decodeDelta(value));paint();return; }
    if(type===0xb0 && note===MoveMainButton && value>0) {
        endEdit();endMasterEdit();for(const clip of pressed.values())clip.used=true;
        projects.click(shift);refresh();return;
    }
    const release=type===0x80 || (type===0x90 && value===0) || (type===0xb0 && value===0);
    const nativeVolume=type===0xb0 && note===MoveMaster && !held && !shift;
    if(!release && !nativeVolume && !projects.guard()) {
        endEdit();endMasterEdit();pressed.clear();held=null;shift=false;claimVolume(false);paint();return;
    }
    if((type===0x90 || type===0x80) && note<=8) {
        const down=type===0x90 && value>=64;
        if(note===8 && shift && down) {
            for(const clip of pressed.values())clip.used=true;
            poll();
        }
        else if(held) {
            if(down && !held.touches[note])knobTouch(note===8?MoveMaster:MoveKnob1+note);
            held.touches[note]=down;
        }
        paint();return;
    }
    if(type===0xb0) {
        if(note===MoveShift) {
            shift=value>0;if(!shift)endMasterEdit();volumeClaim();paint();return;
        }
        if(note===MoveMute) {
            if(value>0 && !mute) {
                mute=true;muteUsed=false;
                for(const clip of pressed.values())muteClip(clip);
            } else if(!value && mute) {
                if(!muteUsed) {
                    const next=dspGet('master_mute')==='1'?'0':'1';
                    dspSet('master_mute',next);notice(next==='1'?'Twain muted':'Twain unmuted');
                }
                mute=false;muteUsed=false;
            }
            refresh();return;
        }
        if(note===MoveUndo && value>0) {
            endEdit();endMasterEdit();
            for(const clip of pressed.values()) { clip.used=true;clip.values={};clip.taps={}; }
            const available=snapshot && snapshot.undo>0;
            dspSet('undo','1');poll();notice(available?`Undo: ${snapshot.undo} left`:'Nothing to undo');paint();return;
        }
        if(note===MoveLoop) { for(const clip of pressed.values())clip.used=true;loop=value>0; if(loop)editScene=snapshot?snapshot.scene:0; paint(); return; }
        if(note===MoveRec) { rec=value>0; for(const clip of pressed.values())clip.used=true; paint(); return; }
        if(note===MoveDelete) { del=value>0; for(const clip of pressed.values())clip.used=true; paint(); return; }
        if((note===MoveLeft || note===MoveRight) && value>0) {
            const base=loop?editScene:snapshot && snapshot.pending>=0?snapshot.pending:snapshot?snapshot.scene:0;
            const target=Math.max(0,Math.min(3,base+(note===MoveRight?1:-1)));
            if(loop)editScene=target;
            else dspSet('scene',String(target));
            refresh(); return;
        }
        if(note===MoveMaster) {
            if(shift) {
                for(const clip of pressed.values())clip.used=true;
                const delta=decodeDelta(value);
                if(typeof shadow_set_overtake_suppress_master_volume==='function' && delta) {
                    const next=Math.max(0,Math.min(200,Number(dspGet('master_level'))+delta));
                    if(!masterEditing) { dspSet('master_edit_begin','1');masterEditing=true; }
                    dspSet('master_level',String(next));poll();
                } else if(typeof shadow_set_overtake_suppress_master_volume!=='function')notice('Host: no Twain volume');
            } else if(held) {
                held.used=true;
                if(typeof shadow_set_overtake_suppress_master_volume==='function')adjust(note,value);
                else notice('Host: no clip Volume');
            }
            paint(); return;
        }
        if(note>=MoveKnob1 && note<MoveKnob1+8) { adjust(note,value); paint(); return; }
    }
    if(type===0x90 && value>0) {
        if(loop && note>=16 && note<=31) {
            dspSet(prefix(editScene)+'scene_bars',String(note-15)); refresh(); return;
        }
        const clip=clipAt(note); if(!clip)return;
        if(pressed.has(note))return;
        if(loop) { editScene=clip.scene; paint(); return; }
        if(held)endEdit();
        held=clip;pressed.set(note,clip);volumeClaim();
        if(mute)muteClip(clip);
        else if(del || rec) {
            held.used=true;
            let audio=false, custom=false;
            if(snapshot) {
                const states=snapshot['abcd'[clip.scene]].split('|')[0].split(',').map(Number);
                audio=states[clip.track]!==0;
                custom=!!(snapshot.custom && (snapshot.custom[clip.scene] & (1<<clip.track)));
            }
            dspSet(key(clip,del?'clear':'record'),'1');
            notice(del?`${label(clip.scene)}${clip.track+1} ${audio?'audio cleared':custom?'settings reset':'empty'}`:`${label(clip.scene)}${clip.track+1} REC next cycle`);
        }
        refresh(); return;
    }
    if(type===0x80 || (type===0x90 && value===0)) {
        const clip=pressed.get(note);
        if(clip) {
            if(!clip.used)dspSet(key(clip,'clip'),'1');
            if(held===clip)endEdit();
            pressed.delete(note);
            if(held===clip)held=Array.from(pressed.values()).pop() || null;
            volumeClaim();refresh();
        }
    }
};
globalThis.onUnload=function() { endEdit();endMasterEdit();pressed.clear();held=null;shift=false;claimVolume(false); };
