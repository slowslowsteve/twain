#include "../src/twain_core.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static void expect(twain_t *t, const char *key, const char *want) {
    char buf[256]; twain_get_param(t, key, buf, sizeof buf);
    assert(!strcmp(buf, want));
}
static int signal = 1000;
static void render(twain_t *t, int blocks) {
    int16_t in[256], out[256];
    for (int i=0;i<256;i++) in[i]=signal;
    while (blocks--) twain_process(t,in,out,128);
}
static void select_scene(twain_t *t, int scene) {
    twain_set_param(t,"scene",scene ? "B":"A");
    char buf[32];
    for (int i=0;i<2000;i++) {
        twain_get_param(t,"scene",buf,sizeof buf);
        if (buf[0] == '0' + scene) return;
        render(t,1);
    }
    assert(!"scene did not switch");
}
static void frames(twain_t *t, int n) {
    int16_t in[256], out[256];
    for (int i=0;i<256;i++) in[i]=1000;
    while(n) { int block=n>128?128:n; twain_process(t,in,out,block); n-=block; }
}
static void test_scene_grid(void) {
    for (int bars=1;bars<=16;bars*=4) {
        twain_t *t=twain_create(NULL,NULL); assert(t);
        char value[16]; snprintf(value,sizeof value,"%d",bars);
        twain_set_param(t,"a_scene_bars",value);
        twain_set_param(t,"b_scene_bars","2");
        uint8_t start=0xfa,tick=0xf8;
        twain_on_midi(t,&start,1,3); render(t,1);
        twain_set_param(t,"scene","B");
        for(int i=0;i<bars*96-1;i++) {
            twain_on_midi(t,&tick,1,3); render(t,1);
            expect(t,"scene","0");
        }
        twain_on_midi(t,&tick,1,3); render(t,1);
        expect(t,"scene","1"); expect(t,"scene_bar","1");
        expect(t,"scene_pending","-1");
        twain_set_param(t,"scene","A");
        uint8_t stop=0xfc;
        twain_on_midi(t,&stop,1,3); frames(t,88200*3);
        expect(t,"scene","1"); expect(t,"scene_pending","0");
        twain_on_midi(t,&start,1,3); render(t,1);
        for(int i=0;i<192;i++) { twain_on_midi(t,&tick,1,3); render(t,1); }
        expect(t,"scene","0"); expect(t,"scene_bar","1");
        twain_set_param(t,"scene","B");
        twain_set_param(t,"scene","A"); expect(t,"scene_pending","-1");
        twain_destroy(t);
    }
    twain_t *t=twain_create(NULL,NULL); assert(t);
    twain_set_param(t,"a_scene_bars","4");
    twain_set_param(t,"a_scene_bars","17"); expect(t,"a_scene_bars","4");
    twain_set_param(t,"a_scene_bars","0"); expect(t,"a_scene_bars","4");
    twain_set_param(t,"a_scene_bars","4x"); expect(t,"a_scene_bars","4");
    twain_set_param(t,"quantize","0");
    twain_set_param(t,"t1_btn","1"); frames(t,1024);
    twain_set_param(t,"t1_btn","1");
    frames(t,88200-1024); expect(t,"scene_bar","2");
    twain_set_param(t,"scene","B");
    frames(t,88200*3-28); expect(t,"scene","0");
    int16_t in[256]={0},out[256];
    twain_process(t,in,out,128); expect(t,"scene","1");
    assert(out[54]>0); assert(out[56]==0); // exact scene-end sample
    expect(t,"scene_bar","1");
    /* B retains audio but launches from zero, including on return. */
    twain_set_param(t,"quantize","0");
    twain_set_param(t,"t1_btn","1"); frames(t,1024);
    twain_set_param(t,"t1_btn","1"); frames(t,256);
    twain_set_param(t,"scene","A"); frames(t,88200-100-1024-256);
    expect(t,"scene","0"); expect(t,"b_tpos","0,0,0,0");
    twain_set_param(t,"scene","B"); frames(t,4*88200);
    expect(t,"scene","1"); expect(t,"tpos","0,0,0,0");
    /* An unclosed recording ends automatically with its scene cycle. */
    twain_set_param(t,"t2_btn","1"); frames(t,88200);
    expect(t,"tstates","2,2,0,0");
    twain_destroy(t);
}
int main(void) {
    test_scene_grid();
    twain_t *t=twain_create(NULL,NULL); assert(t);
    expect(t,"module_id","twain"); expect(t,"track_seconds","60");
    for (int scene=0;scene<2;scene++) {
        signal = scene ? 2000 : 1000;
        select_scene(t,scene);
        expect(t,"tstates","0,0,0,0");
        twain_set_param(t,"quantize","0");
        for (int i=1;i<=4;i++) {
            char key[32]; snprintf(key,sizeof key,"t%d_btn",i);
            twain_set_param(t,key,"1"); render(t,40+i);
            twain_set_param(t,key,"1");
        }
        expect(t,"tstates","2,2,2,2");
        twain_set_param(t,"t1_level",scene ? "73":"137");
    }
    select_scene(t,0); expect(t,"t1_level","137");
    twain_set_param(t,"t2_clear","1"); expect(t,"tstates","2,0,2,2");
    select_scene(t,1); expect(t,"t1_level","73");
    expect(t,"tstates","2,2,2,2"); expect(t,"track_seconds","60");
    /* Distinct stored audio survives switching; monitor is disabled. */
    int16_t silence[256] = {0}, a[256], b[256];
    select_scene(t,0);
    twain_process(t,silence,a,128);
    select_scene(t,1);
    twain_process(t,silence,b,128);
    assert(a[254] > 0 && b[254] > a[254]);
    render(t,200); twain_set_param(t,"scene","invalid"); expect(t,"scene","1");
    twain_destroy(t); puts("Twain: two scenes / eight independent layers passed");
}
