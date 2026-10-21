/* Four vertical clip columns: scenes A–D, eight layers each, in two banks of four. */
import { setLED, setButtonLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveMaster, MoveRec, MoveDelete, MoveUndo, MoveLeft, MoveRight, MoveLoop, MoveShift, MoveMute, MoveMainKnob, MoveMainButton, MoveUp, MoveDown, MovePlay,
    Black, BrightRed, Green, White, LightGrey } from '/data/UserData/schwung/shared/constants.mjs';
import { createProjectController } from './twain_projects.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
const dspGet=host_module_get_param, dspSet=host_module_set_param;
// Critical monitor switches must survive the host's busy fire-and-forget mailbox.
const dspCritical=typeof host_module_set_param_blocking==='function'?host_module_set_param_blocking:dspSet;
const projects=createProjectController({get:dspGet,set:(key,value)=>dspCritical(key,value,500),notice:text=>notice(text)});
const FX=['hp','lp','comp','sat','chorus','reverb','delay','delay_rate'];
const ALT=['hp_res','lp_res','comp_release','sat_dirt','chorus_rate','reverb_decay','delay_feedback','delay_wow'];
const ALT_NAMES=['HP res','LP res','Release','Dirt','Ch rate','Rev decay','Feedback','Wow/flutter'];
const ALT_DEFAULT=[0,0,35,50,28,35,50,0];
const FX_NAMES=['HP freq','LP freq','Comp','Drive','Chorus','Reverb','Delay','Delay time'];
const RATES=['1/1','1/2','1/2T','1/4','1/4T','1/8','1/8T','1/16','1/16T','1/32','1/32T','1/64'];
let bank=0, selected=null, editingClip=null, lastEditAt=0, lastProject=null, lastSafety=-1, lastSafetyAt=-10000;
let snapshot=null, held=null, rec=false, del=false, loop=false, editScene=0;
let pressed=new Map(), shift=false, mute=false, muteUsed=false;
let masterEditing=false, playRoute=null, monitorChord=false, monitorUsed=false;
let requestedStart=false, startProject=null, sentStart=-1, nativeRelease=false, startAt=0;
let rangeSteps=new Set(),rangeAnchor=null,rangeSent=false,rangeScene=0;
let ticks=0, lastForce=-10000, overlay='', overlayUntil=0, parameterReadout=null;
function claimVolume(on) {
    if(typeof shadow_set_overtake_suppress_master_volume==='function')
        shadow_set_overtake_suppress_master_volume(on?1:0);
}
function label(s) { return 'ABCD'[s]; }
function prefix(s) { return 'abcd'[s]+'_'; }
function nativePlay(value) {
    if(typeof move_midi_inject_to_move==='function')return move_midi_inject_to_move([0x0b,0xb0,MovePlay,value]);
    notice('Host: Play unavailable');return false;
}
function releasePlay() { if(playRoute==='native')nativePlay(0);playRoute=null; }
function cancelStart() {
    if(requestedStart)dspCritical('cancel_start','1',100);
    requestedStart=false;
}
function deliverStart() {
    if(nativeRelease && nativePlay(0)!==false)nativeRelease=false;
    if(!requestedStart)return;
    if(globalThis.overtakeParked || projects.modal || projects.id!==startProject) {cancelStart();return;}
    if(snapshot && (!snapshot.stopped || (!snapshot.start_ready && !snapshot.count_in))) {requestedStart=false;return;}
    if(snapshot && snapshot.start_ready && snapshot.start_serial!==sentStart) {
        if(!projects.guard()) {cancelStart();return;}
        sentStart=snapshot.start_serial;
        if(nativePlay(127)===false) {cancelStart();return;}
        nativeRelease=true;startAt=Date.now();
        if(nativePlay(0)!==false)nativeRelease=false;
    }
    if(snapshot && snapshot.start_serial===sentStart && Date.now()-startAt>2500) {
        cancelStart();notice('Check MIDI Clock Out');
    }
}
const POCKET_FONT={
' ':['00000','00000','00000','00000','00000','00000','00000'],
'A':['01110','10001','10001','11111','10001','10001','10001'],
'B':['11110','10001','10001','11110','10001','10001','11110'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'D':['11110','10001','10001','10001','10001','10001','11110'],
'E':['11111','10000','10000','11110','10000','10000','11111'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'G':['01111','10000','10000','10111','10001','10001','01111'],
'H':['10001','10001','10001','11111','10001','10001','10001'],
'I':['11111','00100','00100','00100','00100','00100','11111'],
'J':['00111','00010','00010','00010','10010','10010','01100'],
'K':['10001','10010','10100','11000','10100','10010','10001'],
'L':['10000','10000','10000','10000','10000','10000','11111'],
'M':['10001','11011','10101','10101','10001','10001','10001'],
'N':['10001','11001','10101','10011','10001','10001','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'P':['11110','10001','10001','11110','10000','10000','10000'],
'Q':['01110','10001','10001','10001','10101','10010','01101'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'S':['01111','10000','10000','01110','00001','00001','11110'],
'T':['11111','00100','00100','00100','00100','00100','00100'],
'U':['10001','10001','10001','10001','10001','10001','01110'],
'V':['10001','10001','10001','10001','10001','01010','00100'],
'W':['10001','10001','10001','10101','10101','10101','01010'],
'X':['10001','10001','01010','00100','01010','10001','10001'],
'Y':['10001','10001','01010','00100','00100','00100','00100'],
'Z':['11111','00001','00010','00100','01000','10000','11111'],
'0':['01110','10001','10011','10101','11001','10001','01110'],
'1':['00100','01100','00100','00100','00100','00100','01110'],
'2':['01110','10001','00001','00010','00100','01000','11111'],
'3':['11110','00001','00001','01110','00001','00001','11110'],
'4':['00010','00110','01010','10010','11111','00010','00010'],
'5':['11111','10000','10000','11110','00001','00001','11110'],
'6':['01110','10000','10000','11110','10001','10001','01110'],
'7':['11111','00001','00010','00100','01000','01000','01000'],
'8':['01110','10001','10001','01110','10001','10001','01110'],
'9':['01110','10001','10001','01111','00001','00001','01110'],
'/':['00001','00001','00010','00100','01000','10000','10000'],
'%':['11001','11010','00010','00100','01000','01011','10011'],
'*':['00000','10101','01110','11111','01110','10101','00000'],
'-':['00000','00000','00000','11111','00000','00000','00000'],
'h':['10000','10000','10110','11001','10001','10001','10001'],
'z':['00000','00000','11111','00010','00100','01000','11111'],
'm':['00000','00000','11010','10101','10101','10101','10101'],
's':['00000','00000','01111','10000','01110','00001','11110']};
Object.assign(POCKET_FONT,{
'.':['00000','00000','00000','00000','00000','00110','00110'],
'k':['10000','10000','10010','10100','11000','10100','10010'],
'a':['00000','00000','01110','00001','01111','10001','01111'],
'b':['10000','10000','10110','11001','10001','10001','11110'],
'c':['00000','00000','01111','10000','10000','10000','01111'],
'd':['00001','00001','01101','10011','10001','10001','01111'],
'e':['00000','00000','01110','10001','11111','10000','01110'],
'f':['00110','01001','01000','11100','01000','01000','01000'],
'g':['00000','01111','10001','10001','01111','00001','01110'],
'i':['00100','00000','01100','00100','00100','00100','01110'],
'l':['01100','00100','00100','00100','00100','00100','01110'],
'n':['00000','00000','11110','10001','10001','10001','10001'],
'o':['00000','00000','01110','10001','10001','10001','01110'],
'p':['00000','00000','11110','10001','11110','10000','10000'],
'r':['00000','00000','10110','11001','10000','10000','10000'],
't':['01000','01000','11100','01000','01000','01001','00110'],
'u':['00000','00000','10001','10001','10001','10011','01101'],
'v':['00000','00000','10001','10001','10001','01010','00100'],
'y':['00000','00000','10001','10001','01111','00001','01110']});
// Fixed bitmap glyphs keep the complete value and unit at the same size.
function valueWidth(value,scale=2) {
    let width=0;
    for(const char of value)width+=(char===' '?3:6)*scale;
    return Math.max(0,width-scale);
}
function pocketText(value,x,y,scale=2,color=1) {
    for(const char of String(value)) {
        const glyph=POCKET_FONT[char] || POCKET_FONT[char.toUpperCase()] || POCKET_FONT[' '];
        for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(glyph[row][col]==='1')fill_rect(x+col*scale,y+row*scale,scale,scale,color);
        x+=(char===' '?3:6)*scale;
    }
}
function pocketValue(amount,y=36) { pocketText(amount,126-valueWidth(amount),y); }
function centralMessage(message) {
    print(2,29,message.slice(0,21),1);
    if(message.length>21)print(2,42,message.slice(21,42),1);
}
function volumeClaim() { claimVolume(shift || rec || monitorChord || pressed.size>0); }
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
                endEdit();bank=0;selected=clipAt(92+next.scene);lastProject=projects.id;parameterReadout=null;overlayUntil=0;
            }
        }
    } catch (_) {}
}
function paint() {
    if(globalThis.overtakeParked)return;
    const now=Date.now(), blink=Math.floor(now/250)%2===0;
    const force=now-lastForce>=1000;
    if(force)lastForce=now;
    setButtonLED(MovePlay,snapshot && !snapshot.stopped?Green:16,force);
    setButtonLED(MoveLoop,loop?124:16,force);
    setButtonLED(MoveRec,rec?BrightRed:shift?(snapshot && snapshot.monitor?Green:16):65,force);
    setButtonLED(MoveUp,bank===1?124:16,force);setButtonLED(MoveDown,bank===0?124:16,force);
    setButtonLED(MoveDelete,del?124:16,force);
    setButtonLED(MoveMute,snapshot && snapshot.master_mute?124:mute?White:16,force);
    setButtonLED(MoveUndo,snapshot && (shift?snapshot.redo:snapshot.undo)>0?124:16,force);
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
    if(projects.dirty)print(120,1,'*',1);
    const target=selected || {scene:snapshot.scene,track:0};
    const s=loop?editScene:snapshot.scene, bars=snapshot.bars[s],start=snapshot.starts?.[s] || 0;
    const activeStart=snapshot.starts?.[snapshot.scene] || 0;
    const phase=Math.max(activeStart,Math.min(snapshot.phase,snapshot.bars[snapshot.scene]-0.0001));
    const cursor=snapshot.cursors?.[target.scene];
    const validCursor=Number.isInteger(cursor) && cursor>=(snapshot.starts?.[target.scene] || 0) && cursor<snapshot.bars[target.scene];
    const bar=Math.floor(phase)+1,beat=snapshot.count_in?5-snapshot.count_in:Math.floor((phase%1)*4)+1;
    print(2,1,`${snapshot.stopped?'STOP':'PLAY'} ${label(snapshot.scene)}`,1);
    print(65,1,`EDIT ${label(target.scene)}${target.track+1}`,1);
    fill_rect(92,0,18,9,1);pocketText(`${label(target.scene)}${target.track+1}`,95,1,1,0);
    fill_rect(2,11,124,1,1);
    // Timing has a permanent home, outside the replaceable editing area.
    print(2,15,`BAR ${bar}/${snapshot.bars[snapshot.scene]}`,1);
    print(79,15,`BEAT ${beat}/4`,1);
    for(let i=0;i<4;i++)fill_rect(56+i*5,i+1===beat?16:18,3,i+1===beat?5:1,1);
    fill_rect(2,25,124,1,1);
    const readout=parameterReadout && parameterReadout.scene===target.scene && parameterReadout.track===target.track && now<overlayUntil;
    const hasNotice=now<overlayUntil && !parameterReadout && !/^Monitor (on|off)$/.test(overlay);
    if(snapshot.count_in) {
        print(2,29,'COUNT-IN',1);pocketValue(String(snapshot.count_in));
    } else if(loop) {
        print(2,28,`scene ${label(s)}`,1);print(2,42,'RANGE',1);pocketValue(`${start+1}-${bars}`);
    } else if(readout) {
        print(2,28,parameterReadout.effect,1);print(2,42,parameterReadout.parameter,1);
        pocketValue(parameterReadout.amount);
    } else if(snapshot.advance)centralMessage('Last bar next');
    else if(hasNotice)centralMessage(overlay);
    else if(snapshot.stopped && validCursor)centralMessage(`Start ${label(target.scene)} bar ${cursor+1}`);
    else if(snapshot.pending>=0)centralMessage(`Next ${label(snapshot.pending)} at end`);
    else {
        const states=snapshot['abcd'[snapshot.scene]].split('|')[0].split(',').map(Number);
        const recording=states.map((v,i)=>v===1?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        const armed=snapshot.armed[snapshot.scene].map((v,i)=>v===4?`${label(snapshot.scene)}${i+1}`:'').filter(Boolean);
        const clipState=Number(snapshot['abcd'[target.scene]].split('|')[0].split(',')[target.track]) || 0;
        const clipMuted=snapshot.muted && (snapshot.muted[target.scene] & (1<<target.track));
        const selectedState=snapshot.armed[target.scene][target.track]?'QUEUE':clipMuted?'MUTE':['EMPTY','REC','PLAY','PLAY','STOP'][clipState];
        print(2,28,`clip ${label(target.scene)}${target.track+1}`,1);print(2,42,selectedState,1);
        if(recording.length)print(44,28,`REC ${recording.join(' ')}`.slice(0,13),1);
        else if(armed.length)print(44,28,`ARM ${armed.join(' ')}`.slice(0,13),1);
    }
    print(2,53,snapshot.master_mute?'MUTED':`T${snapshot.master===undefined?100:snapshot.master}%`,1);
    const monitoring=!!snapshot.monitor && !snapshot.monitor_blocked;
    const monitorLabel=snapshot.monitor_blocked?'MON X':monitoring?'MON ON':'MON OFF';
    print(126-(monitorLabel.length*6-1),53,monitorLabel,1);
    if(monitoring) {
        fill_rect(39,58,34,1,1);
        const meter=Math.max(0,Math.min(9,Math.round(9*Math.sqrt(snapshot.input || 0))));
        for(let i=0;i<meter;i++)fill_rect(39+i*4,54,2,4,1);
        if(snapshot.clip)print(77,53,'!',1);
    }
    const timelineScene=loop?s:snapshot.stopped?target.scene:snapshot.scene;
    const timelineStart=snapshot.starts?.[timelineScene] || 0;
    const timelineEnd=snapshot.bars[timelineScene],total=timelineEnd-timelineStart,width=124/total;
    for(let i=0;i<total;i++) {
        const x=2+Math.floor(i*width),w=Math.max(2,Math.floor((i+1)*width)-Math.floor(i*width)-1);
        fill_rect(x,62,w,1,1);
        const progress=loop?0:snapshot.stopped?(validCursor && cursor===timelineStart+i?1:0):Math.max(0,Math.min(1,phase-timelineStart-i));
        if(progress>0)fill_rect(x,61,Math.round(w*progress),1,1);
    }
    for(let i=0;i<16;i++) {
        const current=snapshot.stopped?(validCursor?cursor:timelineStart):snapshot.bars[snapshot.scene]===1?Math.floor((phase%1)*16):bar-1;
        const color=loop?(i===start?White:i>=start && i<bars?16:LightGrey)
            :i===current?White:i>=timelineStart && i<timelineEnd?33:Black;
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
            if(snapshot.muted && (snapshot.muted[col] & (1<<layer)))color=Math.sin(now*2*Math.PI/3000)>-0.2?107:108;
            if(selected && selected.scene===col && selected.track===layer && state!==1 && !(snapshot.muted && (snapshot.muted[col] & (1<<layer))))color=White;
            if(armed)color=blink?(armed===1||armed===4?BrightRed:armed===3?8:Green):Black;
            else if(snapshot.pending===col && !blink)color=Black;
            if(loop && col===editScene)color=White;
            if(pressed.has(92-row*8+col))color=White;
        }
        setLED(92-row*8+col,color,force);
    }
}
function refresh() { poll(); paint(); }
function notice(text) { parameterReadout=null;overlay=text; overlayUntil=Date.now()+1800; announce(text); }
function paramFor(controller) { return controller===MoveMaster?'level':(shift?ALT:FX)[controller-MoveKnob1]; }
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
    const name=param==='level'?'Volume':ALT.includes(param)?ALT_NAMES[ALT.indexOf(param)]:FX_NAMES[controller-MoveKnob1];
    let amount=param==='delay_rate'?RATES[value]:`${value}%`;
    if(param==='hp')amount=value===0?'Bypass':`${Math.round(25*Math.pow(400,value/100))} Hz`;
    if(param==='lp')amount=value===0?'Bypass':`${Math.round(18000*Math.pow(80/18000,value/100))} Hz`;
    if(param==='comp_release')amount=`${Math.round(25*Math.pow(48,value/100))} ms`;
    if(param==='chorus_rate')amount=`${(0.05+8*(value/100)**2).toFixed(2)} Hz`;
    if(param==='reverb_decay')amount=`${(0.2*Math.pow(100,value/100)).toFixed(1)} s`;
    if(param==='delay_feedback')amount=`${(value*0.995).toFixed(1)}%`;
    notice(`${label(target.scene)}${target.track+1} ${name}: ${amount}`);
    const index=controller-MoveKnob1;
    const effect=param==='level'?'clip':['high pass','low pass','compressor','drive','chorus','reverb','delay','delay'][index];
    const parameter=param==='level'?'LEVEL':ALT.includes(param)?['RESONANCE','RESONANCE','RELEASE','DIRT','RATE','DECAY','FEEDBACK','WOW/FLUTTER'][index]:['FREQ','FREQ','AMOUNT','SEND','SEND','SEND','SEND','TIME'][index];
    // Compact frequency units allow full-size units even at the filters' maxima.
    if((param==='hp' || param==='lp') && value!==0) {
        const hz=Number(amount.split(' ')[0]);
        if(hz>=1000)amount=`${Number((hz/1000).toFixed(1))}kHz`;
    }
    parameterReadout={effect,parameter,amount,scene:target.scene,track:target.track};
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
        const reset=param==='level'?50:param==='delay_rate'?5:ALT.includes(param)?ALT_DEFAULT[ALT.indexOf(param)]:0;
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
globalThis.onResume=function() { cancelStart();releasePlay(); monitorSafety(true);endEdit();endMasterEdit(); pressed.clear();held=null;shift=mute=muteUsed=false; claimVolume(false); rec=del=loop=monitorChord=monitorUsed=false;rangeSteps.clear();rangeAnchor=null; lastForce=-10000;projects.tick(true); refresh(); };
globalThis.tick=function() {
    monitorSafety();
    if(editingClip && !held && Date.now()-lastEditAt>600)endEdit();
    if(globalThis.overtakeParked && (pressed.size || shift || mute || rec || monitorChord)) {
        endEdit();endMasterEdit();pressed.clear();held=null;shift=mute=muteUsed=rec=monitorChord=false;claimVolume(false);
    }
    projects.tick();
    if(projects.modal && (held || shift || rec || monitorChord)) { endEdit();endMasterEdit();pressed.clear();held=null;shift=false;claimVolume(false); }
    if(++ticks%2===0)poll();deliverStart();paint();
};
globalThis.onMidiMessageInternal=function(data) {
    const type=data[0]&0xf0, note=data[1], value=data[2];
    if(type!==0x90 && type!==0x80 && type!==0xb0)return;
    if(type===0xb0 && note===MovePlay) {
        if(value>0 && playRoute===null) {
            poll();if(snapshot && !snapshot.stopped)requestedStart=false;
            playRoute=shift?'advance':'native';
            if(requestedStart) {cancelStart();playRoute='cancel';notice('Start cancelled');}
            else if(snapshot && snapshot.stopped) {
                playRoute='prepared';
                if(projects.guard()) {
                    const scene=shift && selected?selected.scene:snapshot.scene;
                    const cursor=snapshot.cursors?.[scene];
                    const bar=shift && Number.isInteger(cursor) && cursor>=(snapshot.starts?.[scene] || 0) && cursor<snapshot.bars[scene]?cursor+1:0;
                    if(dspCritical('prepare_start',`${scene},${bar}`,100)!==false) {
                        requestedStart=true;startProject=projects.id;poll();deliverStart();
                    }
                }
            }
            else if(playRoute==='native')nativePlay(value);
            else if(projects.guard()) {
                const wasQueued=snapshot && snapshot.advance;
                dspCritical('advance_last','1',100);poll();
                const recording=snapshot && snapshot['abcd'[snapshot.scene]].split('|')[0].split(',').some(v=>v==='1'||v==='3');
                notice(snapshot && snapshot.advance?'Last bar next':snapshot && snapshot.stopped?'Start Play first':snapshot && snapshot.count_in?'Count-in running':recording?'Finish take first':wasQueued?'Jump cancelled':'Already last bar');
            }
        } else if(value===0)releasePlay();
        paint();return;
    }
    if(type===0xb0 && note===MoveMainKnob) { projects.move(decodeDelta(value));paint();return; }
    if(type===0xb0 && note===MoveMainButton && value>0) {
        endEdit();endMasterEdit();for(const clip of pressed.values())clip.used=true;
        projects.click(shift);refresh();return;
    }
    const release=type===0x80 || (type===0x90 && value===0) || (type===0xb0 && value===0);
    const nativeVolume=type===0xb0 && note===MoveMaster && !held && !shift && !rec && !monitorChord;
    if(!release && !nativeVolume && !projects.guard()) {
        endEdit();endMasterEdit();pressed.clear();held=null;shift=rec=monitorChord=false;claimVolume(false);paint();return;
    }
    if((type===0x90 || type===0x80) && note<=8) {
        const down=type===0x90 && value>0;
        if(note===8 && (rec || monitorChord) && down) {
            const param=shift||monitorChord?'monitor_level':'input_level';monitorUsed=true;notice(`${param==='input_level'?'Input gain':'Monitor'}: ${dspGet(param)}%`);
        }
        else if(note===8 && shift && down) {
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
            shift=value>0;if(!shift || rec)endMasterEdit();volumeClaim();paint();return;
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
            const operation=shift?'redo':'undo',available=snapshot && snapshot[operation]>0;
            dspCritical(operation,'1',100);poll();notice(available?`${shift?'Redo':'Undo'}: ${snapshot[operation]} left`:`Nothing to ${operation}`);paint();return;
        }
        if(note===MoveLoop) { for(const clip of pressed.values())clip.used=true;loop=value>0;if(!loop){if(rangeAnchor!==null && !rangeSent)dspCritical(prefix(rangeScene)+'scene_range',`1,${rangeAnchor-15}`,100);rangeSteps.clear();rangeAnchor=null;rangeSent=false;} if(loop)editScene=selected?selected.scene:snapshot?snapshot.scene:0; paint(); return; }
        if((note===MoveUp || note===MoveDown) && value>0) {
            endEdit();for(const clip of pressed.values())clip.used=true;
            pressed.clear();held=null;bank=note===MoveDown?1:0;
            const row=selected?selected.track%4:0,scene=selected?selected.scene:(snapshot?snapshot.scene:0);
            selected=clipAt(92-row*8+scene);parameterReadout=null;overlayUntil=0;volumeClaim();refresh();return;
        }
        if(note===MoveRec) {
            if(value>0) { endMasterEdit();monitorChord=shift;monitorUsed=false;rec=!monitorChord; }
            else {
                if(monitorChord && !monitorUsed) {
                    monitorSafety(true);dspCritical('input_monitor',dspGet('input_monitor')==='1'?'0':'1',100);
                    poll();notice(snapshot && snapshot.monitor_blocked?'Monitor: headphones':snapshot && snapshot.monitor?'Monitor on':'Monitor off');
                }
                rec=false;monitorChord=false;endMasterEdit();
            }
            for(const clip of pressed.values())clip.used=true;
            volumeClaim();paint();return;
        }
        if(note===MoveDelete) { del=value>0; for(const clip of pressed.values())clip.used=true; paint(); return; }
        if((note===MoveLeft || note===MoveRight) && value>0) {
            const base=loop?editScene:snapshot && snapshot.pending>=0?snapshot.pending:snapshot?snapshot.scene:0;
            const target=Math.max(0,Math.min(3,base+(note===MoveRight?1:-1)));
            if(loop)editScene=target;
            else dspSet('scene',String(target));
            refresh(); return;
        }
        if(note===MoveMaster) {
            if(rec || monitorChord) {
                monitorUsed=true;for(const clip of pressed.values())clip.used=true;
                const param=shift||monitorChord?'monitor_level':'input_level',delta=decodeDelta(value);
                if(typeof shadow_set_overtake_suppress_master_volume==='function' && delta) {
                    if(!masterEditing) { dspCritical('master_edit_begin','1',100);masterEditing=true; }
                    const next=Math.max(0,Math.min(param==='input_level'?400:200,Number(dspGet(param))+delta));
                    dspCritical(param,String(next),100);notice(`${param==='input_level'?'Input gain':'Monitor'}: ${next}%`);
                }
            } else if(shift) {
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
    if(loop && note>=16 && note<=31 && (type===0x90 || type===0x80)) {
        if(type===0x90 && value>0) {
            if(rangeAnchor===null) { rangeAnchor=note;rangeSent=false;rangeScene=editScene; }
            rangeSteps.add(note);
            if(rangeSteps.size>1) {
                dspCritical(prefix(rangeScene)+'scene_range',`${Math.min(rangeAnchor,note)-15},${Math.max(rangeAnchor,note)-15}`,100);rangeSent=true;
            }
        } else {
            if(!rangeSent && rangeAnchor!==null)dspCritical(prefix(rangeScene)+'scene_range',`1,${rangeAnchor-15}`,100);
            rangeSteps.delete(note);if(!rangeSteps.size){rangeAnchor=null;rangeSent=false;}
        }
        refresh();return;
    }
    if(!loop && snapshot && snapshot.stopped && note>=16 && note<=31 && type===0x90 && value>0) {
        const scene=selected?selected.scene:snapshot.scene;
        dspCritical(prefix(scene)+'start_bar',String(note-15),100);refresh();return;
    }
    if(type===0x90 && value>0) {
        const clip=clipAt(note); if(!clip)return;
        if(pressed.has(note))return;
        if(loop) { editScene=clip.scene; paint(); return; }
        endEdit();
        if(!selected || selected.scene!==clip.scene || selected.track!==clip.track){parameterReadout=null;overlayUntil=0;}
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
globalThis.onUnload=function() { cancelStart();releasePlay();if(nativeRelease)nativePlay(0); endEdit();endMasterEdit();pressed.clear();held=null;shift=false;claimVolume(false); };
