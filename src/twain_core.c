/* Four retained scenes. Only the selected scene advances or records.
 * Compile with MARK_TRACKS=4 and MARK_REQUIRE_FULL_CAPACITY. */
#include "twain_core.h"
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#if MARK_TRACKS != 4 || MARK_MAX_SECONDS != 60 || !defined(MARK_REQUIRE_FULL_CAPACITY)
#error Twain requires four 60-second layers per scene
#endif
#define TW_HISTORY 5
#define TW_SCENES 4
static const char *clip_settings[10]={"level","hp","lp","comp","sat","chorus","reverb","delay","delay_rate","mute"};
typedef struct {
    int scene, clip, kind, bars; /* 0 settings, 1 audio+settings, 2 length, 3 master level, 4 master mute */
    mark_clip_snapshot_t saved;
} twain_edit_t;
struct twain { mark_t *scene[TW_SCENES]; int active; int pending; int bars[TW_SCENES]; double phase;
    int clock_running, clock_ticks, cycle_due, transport_stopped, bar_due;
    int armed[TW_SCENES][4];
    int master_level, master_mute, master_editing, master_saved; float master_gain;
    twain_edit_t history[TW_HISTORY];
    int history_head, history_count;
    int gesture_scene, gesture_clip, gesture_saved;
};
twain_t *twain_create(const host_api_v1_t *host, const char *dir) {
    twain_t *t = calloc(1, sizeof(*t));
    if (!t) return NULL;
    t->gesture_scene=t->gesture_clip=-1;
    t->pending = -1;
    t->master_level=100; t->master_gain=1;
    for (int i = 0; i < TW_SCENES; i++) {
        t->bars[i]=1;
        t->scene[i] = mark_create_in_dir(host, dir);
        if (!t->scene[i]) { twain_destroy(t); return NULL; }
        mark_set_param(t->scene[i], "monitor", "0");
        char path[96];
        snprintf(path,sizeof path,"/data/UserData/schwung/twain-sessions/%c",'A'+i);
        mark_set_param(t->scene[i], "session_dir", path);
    }
    for(int i=0;i<TW_HISTORY;i++) {
        t->history[i].saved.audio=calloc((size_t)MARK_SR*60*MARK_CH,sizeof(int16_t));
        if(!t->history[i].saved.audio) { twain_destroy(t); return NULL; }
    }
    return t;
}
void twain_destroy(twain_t *t) {
    if (!t) return;
    for (int i = 0; i < TW_SCENES; i++) if (t->scene[i]) mark_destroy(t->scene[i]);
    for(int i=0;i<TW_HISTORY;i++)free(t->history[i].saved.audio);
    free(t);
}
static int remember(twain_t *t,int scene,int clip,int kind) {
    twain_edit_t *edit=&t->history[t->history_head];
    if(kind<2 && !mark_clip_capture(t->scene[scene],clip,&edit->saved,kind==1))return 0;
    edit->scene=scene; edit->clip=clip; edit->kind=kind; edit->bars=kind==3?t->master_level:kind==4?t->master_mute:t->bars[scene];
    t->history_head=(t->history_head+1)%TW_HISTORY;
    if(t->history_count<TW_HISTORY)t->history_count++;
    return 1;
}
static int remember_settings(twain_t *t,int scene,int clip) {
    int grouped=t->gesture_scene==scene && t->gesture_clip==clip;
    if(grouped && t->gesture_saved)return 1;
    if(!remember(t,scene,clip,0))return 0;
    if(grouped)t->gesture_saved=1;
    return 1;
}
static void undo_edit(twain_t *t) {
    if(!t->history_count)return;
    int index=(t->history_head+TW_HISTORY-1)%TW_HISTORY;
    twain_edit_t *edit=&t->history[index];
    if(edit->kind==2)t->bars[edit->scene]=edit->bars;
    else if(edit->kind==3)t->master_level=edit->bars;
    else if(edit->kind==4)t->master_mute=edit->bars;
    else {
        if(!mark_clip_restore(t->scene[edit->scene],edit->clip,&edit->saved,edit->kind==1))return;
        if(edit->kind==1)t->armed[edit->scene][edit->clip]=0;
    }
    t->history_head=index; t->history_count--;
    t->gesture_scene=t->gesture_clip=-1; t->gesture_saved=0;
    t->master_editing=t->master_saved=0;
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
            if(!remember(t,scene,i,1))continue;
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
    float target=t->master_mute?0:t->master_level/100.0f;
    for(int i=0;i<n;i++) {
        t->master_gain+=(target-t->master_gain)*0.002f;
        for(int c=0;c<2;c++) {
            float value=out[i*2+c]*t->master_gain;
            out[i*2+c]=(int16_t)fmaxf(-32768,fminf(32767,value));
        }
    }
}
void twain_set_param(twain_t *t, const char *key, const char *val) {
    if(!strcmp(key,"master_level") || !strcmp(key,"master_mute")) {
        int mute=!strcmp(key,"master_mute"),max=mute?1:200;
        char *end;long value=strtol(val,&end,10);if(!*val || *end)return;
        if(value<0)value=0;
        if(value>max)value=max;
        int *current=mute?&t->master_mute:&t->master_level;
        if(*current!=value) {
            if(mute || !t->master_editing || !t->master_saved) {
                remember(t,t->active,0,mute?4:3);
                if(!mute && t->master_editing)t->master_saved=1;
            }
            *current=(int)value;
        }
        return;
    }
    if(!strcmp(key,"master_edit_begin")) { t->master_editing=1;t->master_saved=0;return; }
    if(!strcmp(key,"master_edit_end")) { t->master_editing=t->master_saved=0;return; }
    if(!strcmp(key,"undo")) {
        if(!strcmp(val,"1") || !strcmp(val,"trigger"))undo_edit(t);
        return;
    }
    if(!strcmp(key,"edit_end")) {
        t->gesture_scene=t->gesture_clip=-1; t->gesture_saved=0; return;
    }
    if(!strcmp(key,"edit_begin")) {
        if(strlen(val)==4 && (val[0]>='a' && val[0]<='d') && val[1]=='_' && val[2]=='t' && val[3]>='1' && val[3]<='4') {
            t->gesture_scene=val[0]-'a'; t->gesture_clip=val[3]-'1'; t->gesture_saved=0;
        }
        return;
    }
    if (!strcmp(key, "scene")) {
        int target = -1;
        if(strlen(val)==1) {
            if(val[0]>='A' && val[0]<='D')target=val[0]-'A';
            if(val[0]>='0' && val[0]<='3')target=val[0]-'0';
        }
        if (target >= 0) t->pending = target == t->active ? -1 : target;
        return;
    }
    int scene = t->active;
    if ((key[0] >= 'a' && key[0] <= 'd') && key[1] == '_') {
        scene = key[0]-'a'; key += 2;
    }
    if (key[0] == 't' && key[1] >= '1' && key[1] <= '4' && key[2] == '_') {
        int layer = key[1] - '1';
        if(!strcmp(key+3,"clear")) {
            if(strcmp(val,"1") && strcmp(val,"trigger"))return;
            if(mark_clip_has_audio(t->scene[scene],layer)) {
                if(!remember(t,scene,layer,1))return;
            } else if(mark_clip_custom(t->scene[scene],layer)) {
                if(!remember(t,scene,layer,0))return;
                for(int i=0;i<10;i++) {
                    char k[32],v[16]; snprintf(k,sizeof k,"t%d_%s",layer+1,clip_settings[i]);
                    snprintf(v,sizeof v,"%d",i==0?100:i==8?5:0);
                    mark_set_param(t->scene[scene],k,v);
                }
            }
            t->armed[scene][layer]=0;
            mark_set_param(t->scene[scene],key,val); return;
        }
        for(int i=0;i<10;i++)if(!strcmp(key+3,clip_settings[i])) {
            int max=i==0?200:i==8?11:i==9?1:100;
            char *end; long next=strtol(val,&end,10);
            if(!*val || *end)return;
            if(next<0)next=0;
            if(next>max)next=max;
            char old[24]; mark_get_param(t->scene[scene],key,old,sizeof old);
            if(atoi(old)==next)return;
            if(!remember_settings(t,scene,layer))return;
            char v[24];snprintf(v,sizeof v,"%ld",next);
            mark_set_param(t->scene[scene],key,v);return;
        }
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
        if (*val && !*end && bars >= 1 && bars <= 16 && t->bars[scene]!=bars) {
            remember(t,scene,0,2); t->bars[scene]=(int)bars;
        }
        return;
    }
    mark_set_param(t->scene[scene], key, val);
}
int twain_get_param(twain_t *t, const char *key, char *buf, int n) {
    if (!strcmp(key, "twain_status")) {
        char state[TW_SCENES][192]; int custom[TW_SCENES]={0},muted[TW_SCENES]={0};
        for(int scene=0;scene<TW_SCENES;scene++) {
            mark_get_param(t->scene[scene],"status",state[scene],sizeof state[scene]);
            for(int clip=0;clip<4;clip++) {
                if(mark_clip_custom(t->scene[scene],clip))custom[scene]|=1<<clip;
                char k[20],v[8];snprintf(k,sizeof k,"t%d_mute",clip+1);
                mark_get_param(t->scene[scene],k,v,sizeof v);
                if(atoi(v))muted[scene]|=1<<clip;
            }
        }
        double phase=t->clock_running?t->clock_ticks/96.0:t->phase;
        return snprintf(buf,n,
            "{\"scene\":%d,\"pending\":%d,\"bars\":[%d,%d,%d,%d],\"phase\":%.4f,\"stopped\":%d,"
            "\"custom\":[%d,%d,%d,%d],\"muted\":[%d,%d,%d,%d],\"master\":%d,\"master_mute\":%d,\"undo\":%d,"
            "\"a\":\"%s\",\"b\":\"%s\",\"c\":\"%s\",\"d\":\"%s\","
            "\"armed\":[[%d,%d,%d,%d],[%d,%d,%d,%d],[%d,%d,%d,%d],[%d,%d,%d,%d]]}",
            t->active,t->pending,t->bars[0],t->bars[1],t->bars[2],t->bars[3],phase,t->transport_stopped,
            custom[0],custom[1],custom[2],custom[3],muted[0],muted[1],muted[2],muted[3],
            t->master_level,t->master_mute,t->history_count,state[0],state[1],state[2],state[3],
            t->armed[0][0],t->armed[0][1],t->armed[0][2],t->armed[0][3],
            t->armed[1][0],t->armed[1][1],t->armed[1][2],t->armed[1][3],
            t->armed[2][0],t->armed[2][1],t->armed[2][2],t->armed[2][3],
            t->armed[3][0],t->armed[3][1],t->armed[3][2],t->armed[3][3]);
    }
    if(!strcmp(key,"master_level"))return snprintf(buf,n,"%d",t->master_level);
    if(!strcmp(key,"master_mute"))return snprintf(buf,n,"%d",t->master_mute);
    if(!strcmp(key,"undo_count"))return snprintf(buf,n,"%d",t->history_count);
    if (!strcmp(key, "module_id")) return snprintf(buf, n, "twain");
    if (!strcmp(key, "scene")) return snprintf(buf, n, "%d", t->active);
    if (!strcmp(key, "scene_pending")) return snprintf(buf, n, "%d", t->pending);
    int scene = t->active;
    if ((key[0] >= 'a' && key[0] <= 'd') && key[1] == '_') {
        scene = key[0]-'a'; key += 2;
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
    for(int i=0;i<TW_SCENES;i++)
        if(i==t->active || (n>0 && msg[0]>=0xf8))mark_on_midi(t->scene[i],msg,n,source);
}
