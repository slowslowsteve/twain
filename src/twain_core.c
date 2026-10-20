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
    int clock_running, clock_ticks, cycle_due, transport_stopped; };
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
}
void twain_process(twain_t *t, const int16_t *in, int16_t *out, int n) {
    if (n <= 0) return;
    if (n > 128) n = 128;
    if (t->transport_stopped) { memset(out, 0, (size_t)n * 2 * sizeof(*out)); return; }
    if (t->cycle_due) cycle(t);
    int done = 0;
    while (done < n) {
        double bar = mark_scene_bar_frames(t->scene[t->active]);
        if (bar < 1.0) bar = 88200.0;
        int count = n - done;
        if (!t->clock_running) {
            double left = (t->bars[t->active] - t->phase) * bar;
            if (left <= 0.000001) { cycle(t); continue; }
            if (left < count) count = (int)ceil(left - 0.000001);
        }
        mark_process(t->scene[t->active], in ? in + done * 2 : NULL,
                     out + done * 2, count);
        done += count;
        if (!t->clock_running) {
            t->phase += count / bar;
            if (t->phase + 0.000000001 >= t->bars[t->active]) cycle(t);
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
    if (!strcmp(key, "scene_bars")) {
        char *end; long bars = strtol(val, &end, 10);
        if (*val && !*end && bars >= 1 && bars <= 16) t->bars[scene] = (int)bars;
        return;
    }
    mark_set_param(t->scene[scene], key, val);
}
int twain_get_param(twain_t *t, const char *key, char *buf, int n) {
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
        } else if (msg[0] == 0xfc) {
            t->phase = (double)t->clock_ticks / 96.0;
            t->clock_running = 0;
            t->transport_stopped = 1;
        } else if (msg[0] == 0xf8 && t->clock_running) {
            if (++t->clock_ticks >= t->bars[t->active] * 96) t->cycle_due = 1;
        }
    }
    /* Clock is shared, performance CCs address only the active scene. */
    mark_on_midi(t->scene[t->active], msg, n, source);
    if (n > 0 && msg[0] >= 0xf8)
        mark_on_midi(t->scene[1 - t->active], msg, n, source);
}
