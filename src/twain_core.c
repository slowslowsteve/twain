/* Two retained scenes. Only the selected scene advances or records.
 * Compile with MARK_TRACKS=4 and MARK_REQUIRE_FULL_CAPACITY. */
#include "twain_core.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#if MARK_TRACKS != 4 || MARK_MAX_SECONDS != 60 || !defined(MARK_REQUIRE_FULL_CAPACITY)
#error Twain requires four 60-second layers per scene
#endif
struct twain { mark_t *scene[2]; int active; int pending; int bars[2]; double phase;
    int clock_running, clock_ticks, cycle_due, transport_stopped, bar_due;
    int armed[2][4]; };
twain_t *twain_create(const host_api_v1_t *host, const char *dir) {
    twain_t *t = calloc(1, sizeof(*t));
    if (!t) return NULL;
    t->pending = -1;
    t->bars[0] = t->bars[1] = 1;
    for (int i = 0; i < 2; i++) {
        t->scene[i] = mark_create_in_dir(host, dir);
        if (!t->scene[i]) { twain_destroy(t); return NULL; }
        mark_set_param(t->scene[i], "monitor", "0");
        mark_set_param(t->scene[i], "session_dir", i ?
            "/data/UserData/schwung/twain-sessions/B" :
            "/data/UserData/schwung/twain-sessions/A");
    }
    return t;
}
void twain_destroy(twain_t *t) {
    if (!t) return;
    for (int i = 0; i < 2; i++) if (t->scene[i]) mark_destroy(t->scene[i]);
    free(t);
}
static void launch_armed(twain_t *t, int scene_start) {
    int scene = t->active;
    char quantize[8];
    mark_get_param(t->scene[scene], "quantize", quantize, sizeof quantize);
    for (int i = 0; i < 4; i++) if (t->armed[scene][i]) {
        int action=t->armed[scene][i];
        if (action==4 && !scene_start) continue;
        char key[24];
        mark_set_param(t->scene[scene], "quantize", "0");
        if(action==4) {
            /* Received clock boundaries, not the initial tempo estimate, close
             * a clocked take. Capacity remains the hard recording limit. */
            double length=t->clock_running ? MARK_SR*60.0 :
                mark_scene_bar_frames(t->scene[scene])*t->bars[scene];
            if(length>MARK_SR*60.0)length=MARK_SR*60.0;
            mark_clip_record(t->scene[scene],i,(uint32_t)(length+0.5));
        } else {
            snprintf(key,sizeof key,"t%d_%s",i+1,action==3 ? "stop":"btn");
            mark_set_param(t->scene[scene], key, "1");
        }
        t->armed[scene][i] = 0;
    }
    mark_set_param(t->scene[scene], "quantize", quantize);
}
static void cycle(twain_t *t) {
    mark_scene_cycle(t->scene[t->active]);
    if (t->pending >= 0) {
        t->active = t->pending;
        t->pending = -1;
        mark_scene_cycle(t->scene[t->active]);
    }
    t->phase = 0.0;
    t->clock_ticks = 0;
    t->cycle_due = 0;
    t->bar_due = 0;
    launch_armed(t, 1);
}
void twain_process(twain_t *t, const int16_t *in, int16_t *out, int n) {
    if (n <= 0) return;
    if (n > 128) n = 128;
    if (t->transport_stopped) { memset(out, 0, (size_t)n * 2 * sizeof(*out)); return; }
    if (t->cycle_due) cycle(t);
    else if (t->bar_due) { launch_armed(t, t->clock_ticks==0); t->bar_due = 0; }
    int done = 0;
    while (done < n) {
        double bar = mark_scene_bar_frames(t->scene[t->active]);
        if (bar < 1.0) bar = 88200.0;
        int count = n - done;
        double next_bar = floor(t->phase + 1e-9) + 1.0;
        if (next_bar > t->bars[t->active]) next_bar = t->bars[t->active];
        if (!t->clock_running) {
            double left = (next_bar - t->phase) * bar;
            if (left <= 0.000001) { cycle(t); continue; }
            if (left < count) count = (int)ceil(left - 0.000001);
        }
        mark_process(t->scene[t->active], in ? in + done * 2 : NULL,
                     out + done * 2, count);
        done += count;
        if (!t->clock_running) {
            t->phase += count / bar;
            if (t->phase + 1e-9 >= t->bars[t->active]) cycle(t);
            else if (t->phase + 1e-9 >= next_bar) launch_armed(t, 0);
        }
    }
}
void twain_set_param(twain_t *t, const char *key, const char *val) {
    if (!strcmp(key, "scene")) {
        int target = -1;
        if (!strcmp(val, "A") || !strcmp(val, "0")) target = 0;
        if (!strcmp(val, "B") || !strcmp(val, "1")) target = 1;
        if (target >= 0) t->pending = target == t->active ? -1 : target;
        return;
    }
    int scene = t->active;
    if ((key[0] == 'a' || key[0] == 'b') && key[1] == '_') {
        scene = key[0] == 'b'; key += 2;
    }
    if (key[0] == 't' && key[1] >= '1' && key[1] <= '4' && key[2] == '_') {
        int layer = key[1] - '1';
        if (!strcmp(key+3,"clip") || !strcmp(key+3,"record")) {
            if(strcmp(val,"1") && strcmp(val,"trigger"))return;
            if(t->armed[scene][layer]) { t->armed[scene][layer]=0; return; }
            char states[32]; mark_get_param(t->scene[scene],"tstates",states,sizeof states);
            int state=states[layer*2]-'0';
            if(!strcmp(key+3,"record")) t->armed[scene][layer]=4;
            else if(state==MK_PLAY || state==MK_DUB || state==MK_REC) t->armed[scene][layer]=3;
            else if(state==MK_STOP) t->armed[scene][layer]=2;
            return; // empty clip tap never records
        }
        if (!strcmp(key + 3, "launch")) {
            if (strcmp(val, "1") && strcmp(val, "trigger")) return;
            if (t->armed[scene][layer]) { t->armed[scene][layer] = 0; return; }
            char states[32]; mark_get_param(t->scene[scene], "tstates", states, sizeof states);
            int state = states[layer * 2] - '0';
            if (state == MK_EMPTY || state == MK_STOP) t->armed[scene][layer] = state == MK_EMPTY ? 1 : 2;
            else {
                char button[16]; snprintf(button, sizeof button, "t%d_btn", layer + 1);
                mark_set_param(t->scene[scene], button, val);
            }
            return;
        }
        if ((!strcmp(key + 3, "clear") || !strcmp(key + 3, "stop")) &&
            (!strcmp(val, "1") || !strcmp(val, "trigger"))) {
            int armed = t->armed[scene][layer];
            t->armed[scene][layer] = 0;
            if (armed && !strcmp(key + 3, "stop")) return;
        }
    }
    if (!strcmp(key, "scene_bars")) {
        char *end; long bars = strtol(val, &end, 10);
        if (*val && !*end && bars >= 1 && bars <= 16) t->bars[scene] = (int)bars;
        return;
    }
    mark_set_param(t->scene[scene], key, val);
}
int twain_get_param(twain_t *t, const char *key, char *buf, int n) {
    if (!strcmp(key, "twain_status")) {
        char a[192], b[192];
        mark_get_param(t->scene[0], "status", a, sizeof a);
        mark_get_param(t->scene[1], "status", b, sizeof b);
        double phase = t->clock_running ? t->clock_ticks / 96.0 : t->phase;
        return snprintf(buf, n,
            "{\"scene\":%d,\"pending\":%d,\"bars\":[%d,%d],\"phase\":%.4f,\"stopped\":%d,"
            "\"a\":\"%s\",\"b\":\"%s\",\"armed\":[[%d,%d,%d,%d],[%d,%d,%d,%d]]}",
            t->active, t->pending, t->bars[0], t->bars[1], phase, t->transport_stopped,
            a, b, t->armed[0][0], t->armed[0][1], t->armed[0][2], t->armed[0][3],
            t->armed[1][0], t->armed[1][1], t->armed[1][2], t->armed[1][3]);
    }
    if (!strcmp(key, "module_id")) return snprintf(buf, n, "twain");
    if (!strcmp(key, "scene")) return snprintf(buf, n, "%d", t->active);
    if (!strcmp(key, "scene_pending")) return snprintf(buf, n, "%d", t->pending);
    int scene = t->active;
    if ((key[0] == 'a' || key[0] == 'b') && key[1] == '_') {
        scene = key[0] == 'b'; key += 2;
    }
    if (!strcmp(key, "scene_bars")) return snprintf(buf, n, "%d", t->bars[scene]);
    if (!strcmp(key, "scene_bar")) {
        int bar = t->clock_running ? t->clock_ticks / 96 : (int)floor(t->phase + 1e-9);
        return snprintf(buf, n, "%d", bar + 1);
    }
    return mark_get_param(t->scene[scene], key, buf, n);
}
void twain_on_midi(twain_t *t, const uint8_t *msg, int n, int source) {
    if (n > 0) {
        if (msg[0] == 0xfa || msg[0] == 0xfb) {
            t->clock_running = 1;
            t->transport_stopped = 0;
            t->clock_ticks = 0;
            t->phase = 0.0;
            /* Transport restart starts the current scene from bar 1. */
            mark_scene_cycle(t->scene[t->active]);
            t->cycle_due = 0;
            t->bar_due = 1;
        } else if (msg[0] == 0xfc) {
            t->phase = (double)t->clock_ticks / 96.0;
            t->clock_running = 0;
            t->transport_stopped = 1;
        } else if (msg[0] == 0xf8 && t->clock_running) {
            if (++t->clock_ticks >= t->bars[t->active] * 96) t->cycle_due = 1;
            else if (t->clock_ticks % 96 == 0) t->bar_due = 1;
        }
    }
    /* Clock is shared, performance CCs address only the active scene. */
    mark_on_midi(t->scene[t->active], msg, n, source);
    if (n > 0 && msg[0] >= 0xf8)
        mark_on_midi(t->scene[1 - t->active], msg, n, source);
}
