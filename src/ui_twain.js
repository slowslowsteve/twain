/* Twain: left/right four pad columns are scenes A/B. Rows: cycle,
 * stop, undo, clear. Track buttons and transport remain with Move. */
import { setLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveLeft, MoveRight, MoveLoop, Black, BrightRed, Green, White, LightGrey, YellowGreen } from '/data/UserData/schwung/shared/constants.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
let scene = 0;
let ticks = 0;
let loopView = false;
let lengthScene = 0;
let snapshot = null;
let forcePaints = 3;
const BLUE = 33, PURPLE = 22, CYAN = 16, AMBER = 8;
function select(s) {
    host_module_set_param('scene', String(s));
}
function poll() {
    const raw = host_module_get_param('twain_status');
    if (!raw) return;
    try {
        const next = JSON.parse(raw);
        if (!Array.isArray(next.bars) || typeof next.a !== 'string' || typeof next.b !== 'string') return;
        snapshot = next;
        scene = next.scene;
    } catch (_) { /* Preserve the last valid snapshot on a busy param channel. */ }
}
function paint() {
    clear_screen();
    if (!snapshot) { print(2, 2, 'TWAIN connecting...', 1); return; }
    const editScene = loopView ? lengthScene : scene;
    const bars = snapshot.bars[editScene];
    const phase = Math.min(snapshot.phase, snapshot.bars[scene] - 0.0001);
    const bar = Math.floor(phase) + 1;
    const beat = Math.floor((phase % 1) * 4) + 1;
    const blink = Math.floor(Date.now() / 250) % 2 === 0;
    const force = forcePaints > 0;
    if (force) forcePaints--;
    print(2, 2, loopView ? `Scene ${editScene ? 'B' : 'A'}: ${bars} bars`
          : `TWAIN ${scene ? 'B' : 'A'} Bar ${bar}/${snapshot.bars[scene]}`, 1);
    print(2, 14, loopView ? 'Press step 1-16' : snapshot.stopped ? 'Stopped - press Play'
          : snapshot.pending >= 0 ? `Next: ${snapshot.pending ? 'B' : 'A'} at end`
          : snapshot.armed[scene].some(value => value === 1) ? `REC in ${5 - beat} beats` : `Beat ${beat} of 4`, 1);
    const scenes = [snapshot.a, snapshot.b].map(value => value.split('|').map(part => part.split(',').map(Number)));
    const states = scenes[editScene][0];
    for (let i = 0; i < 4; i++) {
        const armed = snapshot.armed[editScene][i];
        print(2 + i * 31, 29, `L${i + 1}`, 1);
        print(2 + i * 31, 39, armed ? 'WAIT' : ['-','REC','PLAY','DUB','STOP'][states[i]] || '-', 1);
    }
    print(2, 53, loopView ? 'Arrows:A/B Loop:exit' : 'Loop: set 1-16 bars', 1);
    for (let i = 0; i < 16; i++) {
        let color = Black;
        if (loopView) color = i === bars - 1 ? White : i < bars ? CYAN : LightGrey;
        else if (snapshot.bars[scene] === 1) {
            const step = Math.min(15, Math.floor((phase % 1) * 16));
            color = i === step ? White : (i % 4 === 0 ? BLUE : LightGrey);
        } else {
            color = i === bar - 1 ? White : i < snapshot.bars[scene] ? BLUE : Black;
        }
        setLED(16 + i, color, force);
    }
    for (let s = 0; s < 2; s++) for (let i = 0; i < 4; i++) {
        const state = scenes[s][0][i];
        const armed = snapshot.armed[s][i] || scenes[s][1][i];
        const sceneColor = s ? PURPLE : BLUE;
        const queued = snapshot.pending === s;
        let top = [sceneColor, BrightRed, Green, YellowGreen, AMBER][state] || sceneColor;
        if (armed) top = blink ? (armed === 1 ? BrightRed : Green) : Black;
        else if (queued && !blink) top = Black;
        setLED(92 + s * 4 + i, top, force);
        setLED(84 + s * 4 + i, state === 4 ? AMBER : 79, force); // pause, dim amber
        setLED(76 + s * 4 + i, scenes[s][3][0] ? PURPLE : 104, force); // undo
        setLED(68 + s * 4 + i, state || armed ? 65 : 66, force); // delete, dim red
    }
}
function refresh() { poll(); paint(); }
globalThis.init = refresh;
globalThis.onResume = function() { forcePaints = 3; refresh(); };
globalThis.tick = function() {
    if (++ticks % 2 === 0) poll();
    paint();
};
globalThis.onMidiMessageInternal = function(data) {
    const status = data[0] & 0xf0, note = data[1], value = data[2];
    if (status === 0xb0 && note === MoveLoop) {
        if (value > 0) {
            loopView = !loopView;
            if (loopView) lengthScene = scene;
            refresh();
        }
        return;
    }
    if (loopView && status === 0x90 && value > 0 && note >= 16 && note <= 31) {
        host_module_set_param(`${lengthScene ? 'b' : 'a'}_scene_bars`, String(note - 15));
        announce(`Scene ${lengthScene ? 'B' : 'A'}, ${note - 15} bars`);
        refresh();
        return;
    }
    if (status === 0xb0 && value > 0 && (note === MoveLeft || note === MoveRight)) {
        if (loopView) lengthScene = note === MoveLeft ? 0 : 1;
        else select(note === MoveLeft ? 0 : 1);
        announce(`Scene ${scene ? 'B' : 'A'}`);
        refresh();
    } else if (status === 0x90 && value > 0 && note >= 68 && note <= 99) {
        const col = (note - 68) % 8, row = 3 - Math.floor((note - 68) / 8);
        if (loopView) { lengthScene = col < 4 ? 0 : 1; refresh(); return; }
        select(col < 4 ? 0 : 1);
        const layer = col % 4 + 1;
        const prefix = col < 4 ? 'a_' : 'b_';
        if (row === 2) host_module_set_param(prefix + 'undo', '1');
        else host_module_set_param(`${prefix}t${layer}_${['launch','stop','undo','clear'][row]}`, '1');
        announce(`Scene ${scene ? 'B' : 'A'}, layer ${layer}`);
        refresh();
    } else if (status === 0xb0 && note >= MoveKnob1 && note < MoveKnob1 + 8) {
        const col = note - MoveKnob1;
        select(col < 4 ? 0 : 1);
        const key = `${col < 4 ? 'a' : 'b'}_t${col % 4 + 1}_level`;
        const level = Number(host_module_get_param(key)) || 0;
        host_module_set_param(key, String(Math.max(0, Math.min(200, level + decodeDelta(value)))));
    }
};
globalThis.onUnload = function() {};
