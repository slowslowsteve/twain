/* Four vertical clip columns: scenes A–D, eight layers each, in two banks of four. */
import { setLED, setButtonLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveMaster, MoveRec, MoveDelete, MoveUndo, MoveLeft, MoveRight, MoveLoop, MoveShift, MoveMute, MoveMainKnob, MoveMainButton, MoveUp, MoveDown,
    Black, BrightRed, Green, White, LightGrey } from '/data/UserData/schwung/shared/constants.mjs';
import { createProjectController } from './twain_projects.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
const dspGet=host_module_get_param, dspSet=host_module_set_param;
// Critical monitor switches must survive the host's busy fire-and-forget mailbox.
const dspCritical=typeof host_module_set_param_blocking==='function'?host_module_set_param_blocking:dspSet;
const projects=createProjectController({get:dspGet,set:dspSet,notice:text=>notice(text)});
const FX=['hp','lp','comp','sat','chorus','reverb','delay','delay_rate'];
const FX_NAMES=['HP filter','LP filter','Compression','Drive','Chorus','Reverb','Delay','Delay rate'];
const RATES=['1/1','1/2','1/2T','1/4','1/4T','1/8','1/8T','1/16','1/16T','1/32','1/32T','1/64'];
let bank=0, selected=null, editingClip=null, lastEditAt=0, lastProject=null, lastSafety=-1, lastSafetyAt=-10000;
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
    return {scene:(note-68)%8,track:bank*4+3-Math.floor((note-68)/8),note,used:false,values:{},taps:{},touches:{},editing:false};
}
function monitorSafety(force=false) {
    const safe=typeof host_speaker_active==='function' && typeof host_line_in_connected==='function' &&
        (!host_speaker_active() || host_line_in_connected())?1:0;
    if(force || safe!==lastSafety || Date.now()-lastSafetyAt>=1000) {
        if(dspCritical('monitor_safe',String(safe),100)!==false) {
            lastSafety=safe;lastSafetyAt=Date.now();
        } else lastSafety=-1;
    }
}
function editTarget() { return held || selected; }
function poll() {
    const raw=dspGet('twain_status');
    if(!raw)return;
    try {
        const next=JSON.parse(raw);
        if(Array.isArray(next.bars) && typeof next.a==='string' && typeof next.b==='string' && typeof next.c==='string' && typeof next.d==='string') {
            snapshot=next;
            if(!selected || lastProject!==projects.id) {
                endEdit();bank=0;selected=clipAt(92+next.scene);lastProject=projects.id;
            }
        }
    } catch (_) {}
}
function paint() {
    if(globalThis.overtakeParked)return;
    const now=Date.now(), blink=Math.floor(now/250)%2===0;
    const force=now-lastForce>=1000;
    if(force)lastForce=now;
    setButtonLED(MoveLoop,loop?124:16,force);
    setButtonLED(MoveRec,rec?BrightRed:shift?(snapshot && snapshot.monitor?Green:16):65,force);
    setButtonLED(MoveUp,bank===1?124:16,force);setButtonLED(MoveDown,bank===0?124:16,force);
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
    print(2,14,`${projects.name.slice(0,13)} ${bank?'5-8':'1-4'}`,1);
    if(now<overlayUntil) print(2,28,overlay,1);
    else if(snapshot.stopped) print(2,28,'Stopped',1);
    else if(snapshot.pending>=0) print(2,28,`Next ${label(snapshot.pending)} at end`,1);
    else {
        const states=snapshot['abcd'[snapshot.scene]].split('|')[0].split(',').map(Number);
        const recording=states.map((v,i)=>v===1?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        const armed=snapshot.armed[snapshot.scene].map((v,i)=>v===4?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        if(recording.length)print(2,28,`REC ${recording.join(' ')}`.slice(0,20),1);
        else if(armed.length)print(2,28,`REC next: ${armed.join(' ')}`.slice(0,20),1);
        else if(selected) {
            const clipState=snapshot['abcd'[selected.scene]].split('|')[0].split(',').map(Number)[selected.track] || 0;
            print(2,28,`${label(selected.scene)}${selected.track+1} ${snapshot.muted && (snapshot.muted[selected.scene] & (1<<selected.track))?'MUTE':['EMPTY','REC','PLAY','PLAY','STOP'][clipState]}  Beat ${beat}`,1);
        }
    }
    print(2,41,snapshot.master_mute?'TWN MUTED':`Twain ${snapshot.master===undefined?100:snapshot.master}%`,1);
    print(64,41,snapshot.monitor_blocked?'X':snapshot.monitor?'MON':'IN',1);
    fill_rect(86,43,32,6,1);fill_rect(87,44,30,4,0);
    const meter=Math.max(0,Math.min(30,Math.round(30*Math.sqrt(snapshot.input || 0))));
    if(meter)fill_rect(87,44,meter,4,1);
    if(snapshot.clip)print(121,41,'!',1);
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
            const layer=row+bank*4;
            const state=scenes[col][0][layer], armed=snapshot.armed[col][layer];
            const custom=snapshot.custom && (snapshot.custom[col] & (1<<layer));
            color=[custom?[97,104,16,33][col]:119,BrightRed,Green,Green,8][state] || 119;
            if(snapshot.muted && (snapshot.muted[col] & (1<<layer)))color=LightGrey;
            if(selected && selected.scene===col && selected.track===layer && state!==1)color=White;
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
    const target=editTarget();
    if(fresh || target.values[param]===undefined) {
        const raw=dspGet(key(target,param));
        if(raw===null || raw===undefined || raw==='')return null;
        const number=Number(raw);if(!Number.isFinite(number))return null;
        target.values[param]=number;
    }
    return target.values[param];
}
function showValue(controller,param,value) {
    const target=editTarget();
    const name=param==='level'?'Volume':FX_NAMES[controller-MoveKnob1];
    const amount=param==='delay_rate'?RATES[value]:`${value}%`;
    notice(`${label(target.scene)}${target.track+1} ${name}: ${amount}`);
}
function beginEdit() {
    const target=editTarget();
    if(editingClip && editingClip!==target)endEdit();
    if(!target.editing) {
        dspSet('edit_begin',`${prefix(target.scene)}t${target.track+1}`);target.editing=true;editingClip=target;
    }
    lastEditAt=Date.now();
}
function endMasterEdit() {
    if(masterEditing) { dspSet('master_edit_end','1');masterEditing=false; }
}
function endEdit() {
    if(editingClip) { dspSet('edit_end','1');editingClip.editing=false;editingClip.values={};editingClip=null; }
}
function knobTouch(controller) {
    const target=editTarget();
    if(!target)return;
    const param=paramFor(controller); if(!param)return;
    target.used=true;
    const value=readValue(param,true); if(value===null)return;
    const now=Date.now(), previous=target.taps[param];
    const count=previous && now-previous.at<600 ? previous.count+1 : 1;
    target.taps[param]={at:now,count};
    if(count===2) {
        const reset=param==='level'?100:param==='delay_rate'?5:0;
        if(value!==reset) { beginEdit();dspSet(key(target,param),String(reset));target.values[param]=reset; }
        target.taps[param]=null;
        showValue(controller,param,reset);
    } else showValue(controller,param,value);
}
function adjust(controller,value) {
    const target=editTarget();
    if(!target)return;
    const delta=decodeDelta(value); if(!delta)return;
    target.used=true;
    const param=paramFor(controller); if(!param)return;
    target.taps[param]=null; // an encoder turn isn't a tap in the reset gesture
    const current=readValue(param); if(current===null)return;
    const max=param==='level'?200:param==='delay_rate'?RATES.length-1:100;
    const next=Math.max(0,Math.min(max,current+delta));
    if(next!==current) { beginEdit();target.values[param]=next;dspSet(key(target,param),String(next)); }
    showValue(controller,param,next);
}
function muteClip(clip) {
    clip.used=true;muteUsed=true;
    const next=dspGet(key(clip,'mute'))==='1'?'0':'1';
    dspSet(key(clip,'mute'),next);
    notice(`${label(clip.scene)}${clip.track+1} ${next==='1'?'muted':'unmuted'}`);
}
globalThis.init=function(){monitorSafety();projects.tick(true);refresh();};
globalThis.onResume=function() { monitorSafety(true);endEdit();endMasterEdit(); pressed.clear();held=null;shift=mute=muteUsed=false; claimVolume(false); rec=del=loop=false; lastForce=-10000;projects.tick(true); refresh(); };
globalThis.tick=function() {
    monitorSafety();
    if(editingClip && !held && Date.now()-lastEditAt>600)endEdit();
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
        else {
            const target=editTarget();
            if(target && (note<8 || held)) {
                if(down && !target.touches[note])knobTouch(note===8?MoveMaster:MoveKnob1+note);
                target.touches[note]=down;
            }
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
            if(selected) { selected.values={};selected.taps={}; }
            const available=snapshot && snapshot.undo>0;
            dspSet('undo','1');poll();notice(available?`Undo: ${snapshot.undo} left`:'Nothing to undo');paint();return;
        }
        if(note===MoveLoop) { for(const clip of pressed.values())clip.used=true;loop=value>0; if(loop)editScene=snapshot?snapshot.scene:0; paint(); return; }
        if((note===MoveUp || note===MoveDown) && value>0) {
            endEdit();for(const clip of pressed.values())clip.used=true;
            pressed.clear();held=null;bank=note===MoveDown?1:0;
            const row=selected?selected.track%4:0,scene=selected?selected.scene:(snapshot?snapshot.scene:0);
            selected=clipAt(92-row*8+scene);volumeClaim();refresh();return;
        }
        if(note===MoveRec && shift) {
            if(value>0) {
                monitorSafety(true);dspCritical('input_monitor',dspGet('input_monitor')==='1'?'0':'1',100);
                poll();notice(snapshot && snapshot.monitor_blocked?'Monitor: headphones':snapshot && snapshot.monitor?'Monitor on':'Monitor off');
            }
            rec=false;paint();return;
        }
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
        endEdit();
        held=clip;selected=clip;pressed.set(note,clip);volumeClaim();
        if(shift && !mute && !del && !rec)clip.used=true;
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
