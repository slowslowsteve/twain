/* Two vertical clip columns: A at column 1, B at column 2. */
import { setLED, setButtonLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveMaster, MoveRec, MoveDelete, MoveUndo, MoveLeft, MoveRight, MoveLoop,
    Black, BrightRed, Green, White, LightGrey } from '/data/UserData/schwung/shared/constants.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
const dspGet=host_module_get_param, dspSet=host_module_set_param;
const FX=['hp','lp','comp','sat','chorus','reverb','delay','delay_rate'];
const FX_NAMES=['HP filter','LP filter','Compression','Saturation','Chorus','Reverb','Delay','Delay rate'];
const RATES=['1/1','1/2','1/2T','1/4','1/4T','1/8','1/8T','1/16','1/16T','1/32','1/32T','1/64'];
let snapshot=null, held=null, rec=false, del=false, loop=false, editScene=0;
let ticks=0, lastForce=-10000, overlay='', overlayUntil=0;
function claimVolume(on) {
    if(typeof shadow_set_overtake_suppress_master_volume==='function')
        shadow_set_overtake_suppress_master_volume(on?1:0);
}
function prefix(s) { return s ? 'b_' : 'a_'; }
function key(clip,name) { return `${prefix(clip.scene)}t${clip.track+1}_${name}`; }
function clipAt(note) {
    if(note<68 || note>99 || (note-68)%8>1)return null;
    return {scene:(note-68)%8,track:3-Math.floor((note-68)/8),note,used:false,values:{},taps:{},touches:{},editing:false};
}
function poll() {
    const raw=dspGet('twain_status');
    if(!raw)return;
    try {
        const next=JSON.parse(raw);
        if(Array.isArray(next.bars) && typeof next.a==='string' && typeof next.b==='string')snapshot=next;
    } catch (_) {}
}
function paint() {
    const now=Date.now(), blink=Math.floor(now/250)%2===0;
    const force=now-lastForce>=1000;
    if(force)lastForce=now;
    setButtonLED(MoveLoop,loop?124:16,force);
    setButtonLED(MoveRec,rec?BrightRed:65,force);
    setButtonLED(MoveDelete,del?124:16,force);
    setButtonLED(MoveUndo,snapshot && snapshot.undo>0?124:16,force);
    clear_screen();
    if(!snapshot) { print(2,2,'TWAIN connecting...',1); return; }
    const s=loop?editScene:snapshot.scene, bars=snapshot.bars[s];
    const phase=Math.max(0,Math.min(snapshot.phase,snapshot.bars[snapshot.scene]-0.0001));
    const bar=Math.floor(phase)+1, beat=Math.floor((phase%1)*4)+1;
    print(2,2,loop?`Set ${s?'B':'A'}: ${bars} bars`:`${snapshot.scene?'B':'A'} Bar ${bar}/${snapshot.bars[snapshot.scene]}`,1);
    print(2,14,`A:${snapshot.bars[0]} bars B:${snapshot.bars[1]} bars`,1);
    if(now<overlayUntil) print(2,29,overlay,1);
    else if(loop) print(2,29,'Steps:1-16 Arrows:A/B',1);
    else if(snapshot.stopped) print(2,29,'Stopped: press Play',1);
    else if(snapshot.pending>=0) print(2,29,`Next ${snapshot.pending?'B':'A'} at end`,1);
    else print(2,29,`Beat ${beat}/4`,1);
    print(2,42,rec?'REC + clip: record':del?'DELETE + clip: clear':held?`Hold ${held.scene?'B':'A'}${held.track+1}: Vol / FX`:'Tap clip: play / stop',1);
    print(2,54,loop?'Release Loop to play':'Hold Loop: bars',1);
    for(let i=0;i<16;i++) {
        const current=snapshot.bars[snapshot.scene]===1?Math.floor((phase%1)*16):bar-1;
        const color=loop?(i===bars-1?White:i<bars?16:LightGrey)
            :i===current?White:i<snapshot.bars[snapshot.scene] || snapshot.bars[snapshot.scene]===1?33:Black;
        setLED(16+i,color,force);
    }
    const scenes=[snapshot.a,snapshot.b].map(v=>v.split('|').map(p=>p.split(',').map(Number)));
    for(let row=0;row<4;row++)for(let col=0;col<8;col++) {
        let color=Black;
        if(col<2) {
            const state=scenes[col][0][row], armed=snapshot.armed[col][row];
            const custom=snapshot.custom && (snapshot.custom[col] & (1<<row));
            color=[custom?(col?104:97):119,BrightRed,Green,Green,8][state] || 119;
            if(armed)color=blink?(armed===1||armed===4?BrightRed:armed===3?8:Green):Black;
            else if(snapshot.pending===col && !blink)color=Black;
            if(loop && col===editScene)color=White;
            if(held && held.scene===col && held.track===row)color=White;
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
    const label=param==='level'?'Volume':FX_NAMES[controller-MoveKnob1];
    const amount=param==='delay_rate'?RATES[value]:`${value}%`;
    notice(`${held.scene?'B':'A'}${held.track+1} ${label}: ${amount}`);
}
function beginEdit() {
    if(!held.editing) {
        dspSet('edit_begin',`${prefix(held.scene)}t${held.track+1}`);held.editing=true;
    }
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
    const count=previous && now-previous.at<450 ? previous.count+1 : 1;
    held.taps[param]={at:now,count};
    if(count===3) {
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
globalThis.init=refresh;
globalThis.onResume=function() { endEdit(); held=null; claimVolume(false); rec=del=loop=false; lastForce=-10000; refresh(); };
globalThis.tick=function() { if(++ticks%2===0)poll(); paint(); };
globalThis.onMidiMessageInternal=function(data) {
    const type=data[0]&0xf0, note=data[1], value=data[2];
    if((type===0x90 || type===0x80) && note<=8) {
        const down=type===0x90 && value>=64;
        if(held) {
            if(down && !held.touches[note])knobTouch(note===8?MoveMaster:MoveKnob1+note);
            held.touches[note]=down;
        }
        paint();return;
    }
    if(type===0xb0) {
        if(note===MoveUndo && value>0) {
            endEdit();
            if(held) { held.used=true;held.values={};held.taps={}; }
            const available=snapshot && snapshot.undo>0;
            dspSet('undo','1');poll();notice(available?`Undo: ${snapshot.undo} left`:'Nothing to undo');paint();return;
        }
        if(note===MoveLoop) { if(held)held.used=true;loop=value>0; if(loop)editScene=snapshot?snapshot.scene:0; paint(); return; }
        if(note===MoveRec) { rec=value>0; if(held)held.used=true; paint(); return; }
        if(note===MoveDelete) { del=value>0; if(held)held.used=true; paint(); return; }
        if((note===MoveLeft || note===MoveRight) && value>0) {
            const target=note===MoveRight?1:0;
            if(loop)editScene=target;
            else dspSet('scene',String(target));
            refresh(); return;
        }
        if(note===MoveMaster) {
            if(held) {
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
        if(held && held.note===note)return;
        if(loop) { editScene=clip.scene; paint(); return; }
        if(held) { held.used=true;endEdit(); }
        held=clip; claimVolume(true);
        if(del || rec) {
            held.used=true;
            let audio=false, custom=false;
            if(snapshot) {
                const states=(clip.scene?snapshot.b:snapshot.a).split('|')[0].split(',').map(Number);
                audio=states[clip.track]!==0;
                custom=!!(snapshot.custom && (snapshot.custom[clip.scene] & (1<<clip.track)));
            }
            dspSet(key(clip,del?'clear':'record'),'1');
            notice(del?`${clip.scene?'B':'A'}${clip.track+1} ${audio?'audio cleared':custom?'settings reset':'empty'}`:`${clip.scene?'B':'A'}${clip.track+1} REC next cycle`);
        }
        refresh(); return;
    }
    if(type===0x80 || (type===0x90 && value===0)) {
        if(held && held.note===note) {
            if(!held.used)dspSet(key(held,'clip'),'1');
            endEdit();held=null; claimVolume(false); refresh();
        }
    }
};
globalThis.onUnload=function() { endEdit();claimVolume(false); };
