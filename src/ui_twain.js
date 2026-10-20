/* Twain: left/right four pad columns are scenes A/B. Rows: cycle,
 * stop, undo, clear. Track buttons and transport remain with Move. */
import { setLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { MoveKnob1, MoveLeft, MoveRight, MoveLoop, Black, BrightRed, Green, White, LightGrey, YellowGreen } from '/data/UserData/schwung/shared/constants.mjs';
import { announce } from '/data/UserData/schwung/shared/screen_reader.mjs';
let scene = 0;
let ticks = 0;
let loopView = false;
let lengthScene = 0;
function select(s) {
    scene = s;
    host_module_set_param('scene', String(s));
}
function paint() {
    scene = Number(host_module_get_param('scene')) || 0;
    const pending = Number(host_module_get_param('scene_pending'));
    const states = String(host_module_get_param('tstates')).split(',').map(Number);
    clear_screen();
    const editScene = loopView ? lengthScene : scene;
    const bars = Number(host_module_get_param(`${editScene ? 'b' : 'a'}_scene_bars`)) || 1;
    print(2, 2, loopView ? `Scene ${editScene ? 'B' : 'A'}: ${bars} bars` : `TWAIN Scene ${scene ? 'B' : 'A'}`, 1);
    print(2, 15, loopView ? 'Steps: 1-16 bars' : pending >= 0 ? `Next: ${pending ? 'B' : 'A'} at end` : `Length: ${bars} bars`, 1);
    for (let i = 0; i < 4; i++)
        print(2 + (i % 2) * 64, 28 + Math.floor(i / 2) * 10,
              `${i + 1}:${['-','REC','PLAY','DUB','STOP'][states[i]] || '-'}`, 1);
    print(2, 51, loopView ? 'Arrows: A/B Loop: exit' : 'Cycle Stop Undo Clear', 1);
    for (let i = 0; i < 16; i++) setLED(16 + i, loopView && i < bars ? Green : Black);
    for (let s = 0; s < 2; s++) for (let i = 0; i < 4; i++) {
        const color = s === scene ? [LightGrey, BrightRed, Green, YellowGreen, White][states[i]] : LightGrey;
        setLED(92 + s * 4 + i, color || LightGrey);
        for (let row = 1; row < 4; row++) setLED(92 - row * 8 + s * 4 + i, s === scene ? White : LightGrey);
    }
}
globalThis.init = paint;
globalThis.onResume = paint;
globalThis.tick = function() { if (++ticks % 6 === 0) paint(); };
globalThis.onMidiMessageInternal = function(data) {
    const status = data[0] & 0xf0, note = data[1], value = data[2];
    if (status === 0xb0 && note === MoveLoop) {
        if (value > 0) {
            loopView = !loopView;
            if (loopView) lengthScene = scene;
            paint();
        }
        return;
    }
    if (loopView && status === 0x90 && value > 0 && note >= 16 && note <= 31) {
        host_module_set_param(`${lengthScene ? 'b' : 'a'}_scene_bars`, String(note - 15));
        announce(`Scene ${lengthScene ? 'B' : 'A'}, ${note - 15} bars`);
        paint();
        return;
    }
    if (status === 0xb0 && value > 0 && (note === MoveLeft || note === MoveRight)) {
        if (loopView) lengthScene = note === MoveLeft ? 0 : 1;
        else select(note === MoveLeft ? 0 : 1);
        announce(`Scene ${scene ? 'B' : 'A'}`);
        paint();
    } else if (status === 0x90 && value > 0 && note >= 68 && note <= 99) {
        const col = (note - 68) % 8, row = 3 - Math.floor((note - 68) / 8);
        if (loopView) { lengthScene = col < 4 ? 0 : 1; paint(); return; }
        select(col < 4 ? 0 : 1);
        const layer = col % 4 + 1;
        const prefix = col < 4 ? 'a_' : 'b_';
        if (row === 2) host_module_set_param(prefix + 'undo', '1');
        else host_module_set_param(`${prefix}t${layer}_${['btn','stop','undo','clear'][row]}`, '1');
        announce(`Scene ${scene ? 'B' : 'A'}, layer ${layer}`);
        paint();
    } else if (status === 0xb0 && note >= MoveKnob1 && note < MoveKnob1 + 8) {
        const col = note - MoveKnob1;
        select(col < 4 ? 0 : 1);
        const key = `${col < 4 ? 'a' : 'b'}_t${col % 4 + 1}_level`;
        const level = Number(host_module_get_param(key)) || 0;
        host_module_set_param(key, String(Math.max(0, Math.min(200, level + decodeDelta(value)))));
    }
};
globalThis.onUnload = function() {};
