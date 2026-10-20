#include "../src/twain_core.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
static void expect(twain_t *t, const char *key, const char *want) {
    char buf[256]; twain_get_param(t, key, buf, sizeof buf);
    assert(!strcmp(buf, want));
}
static int test_signal = 1000;
static void render(twain_t *t, int blocks) {
    int16_t in[256], out[256];
    for (int i=0;i<256;i++) in[i]=test_signal;
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
static void test_armed_record(void) {
    twain_t *t=twain_create(NULL,NULL); assert(t);
    twain_set_param(t,"scene_bars","4");
    frames(t,128);
    twain_set_param(t,"a_t1_launch","1");
    expect(t,"tstates","0,0,0,0");
    char status[768]; twain_get_param(t,"twain_status",status,sizeof status);
    assert(strstr(status,"\"armed\":[[1,0,0,0]"));
    frames(t,88200-128); expect(t,"tstates","1,0,0,0");
    frames(t,128); expect(t,"tstates","1,0,0,0");
    twain_set_param(t,"a_t2_launch","1");
    twain_set_param(t,"a_t2_launch","1"); // second press cancels
    frames(t,88200); expect(t,"tstates","1,0,0,0");
    twain_set_param(t,"a_t3_launch","1");
    twain_set_param(t,"a_t3_stop","1"); // stop cancels countdown
    frames(t,88200); expect(t,"tstates","1,0,0,0");
    twain_set_param(t,"b_t1_launch","1"); // inactive scene waits for launch
    expect(t,"b_tstates","0,0,0,0");
    twain_set_param(t,"scene","B"); frames(t,88200-128);
    expect(t,"scene","1"); expect(t,"tstates","1,0,0,0");
    twain_destroy(t);
    t=twain_create(NULL,NULL); assert(t);
    twain_set_param(t,"scene_bars","4");
    uint8_t start=0xfa,tick=0xf8;
    twain_on_midi(t,&start,1,3); render(t,1);
    twain_set_param(t,"a_t1_launch","1");
    for(int i=0;i<95;i++) { twain_on_midi(t,&tick,1,3); render(t,1); }
    expect(t,"tstates","0,0,0,0");
    twain_on_midi(t,&tick,1,3); render(t,1);
    expect(t,"tstates","1,0,0,0");
    twain_destroy(t);
}
static void test_clip_workflow(void) {
    twain_t *t=twain_create(NULL,NULL); assert(t);
    twain_set_param(t,"a_t1_clip","1"); expect(t,"tstates","0,0,0,0");
    frames(t,128);
    twain_set_param(t,"a_t1_record","1");
    frames(t,88200-128); expect(t,"tstates","1,0,0,0");
    frames(t,88200); expect(t,"tstates","2,0,0,0");
    frames(t,128); twain_set_param(t,"a_t1_clip","1");
    frames(t,88200-129); expect(t,"tstates","2,0,0,0");
    frames(t,1); expect(t,"tstates","4,0,0,0"); // quantized stop
    twain_set_param(t,"a_t1_clip","1"); frames(t,88200);
    expect(t,"tstates","2,0,0,0"); // start, never overdub
    twain_set_param(t,"a_t1_clip","1");twain_set_param(t,"a_t1_clip","1");
    frames(t,88200); expect(t,"tstates","2,0,0,0"); // cancel pending stop
    const char *fx[]={"hp","lp","comp","sat","chorus","reverb","delay"};
    for(int i=0;i<7;i++) {
        char k[40];snprintf(k,sizeof k,"a_t1_%s",fx[i]);
        twain_set_param(t,k,"73"); expect(t,k,"73");
        snprintf(k,sizeof k,"b_t1_%s",fx[i]); expect(t,k,"0");
    }
    twain_set_param(t,"a_t1_clear","1"); expect(t,"tstates","0,0,0,0");
    twain_destroy(t);
    t=twain_create(NULL,NULL); assert(t);
    twain_set_param(t,"a_t1_record","1");
    uint8_t start=0xfa,tick=0xf8;
    twain_on_midi(t,&start,1,3);render(t,1);
    expect(t,"tstates","1,0,0,0");
    for(int i=0;i<95;i++){twain_on_midi(t,&tick,1,3);render(t,1);}
    expect(t,"tstates","1,0,0,0");
    twain_on_midi(t,&tick,1,3);render(t,1);
    expect(t,"tstates","2,0,0,0"); // closes on received scene end despite tempo estimate
    twain_destroy(t);
}
#ifdef MARK_TWAIN
#include "../src/twain_fx.h"
static void test_clip_fx(void) {
    assert(twain_delay_frames(88200,2)==29400); // 1/2-note triplet = one third of bar
    assert(twain_delay_frames(88200,6)==7350); // eighth-note triplet
    assert(twain_delay_frames(88200,5)==11025);
    assert(twain_delay_frames(88200,11)==1378);
    assert(twain_delay_frames(529200,0)==529200); // full bar at 20 BPM, no truncation
    assert(twain_fx_index("reverb")==5 && twain_fx_index("invalid")==-1);
    for(int effect=0;effect<7;effect++) {
        twain_fx_t *f=calloc(1,sizeof(*f)); assert(f);
        f->delay_rate=TW_RATE_DEFAULT; f->previous_rate=TW_RATE_DEFAULT; f->rate_mix=1;
        f->value[effect]=100; f->dirty=1; twain_fx_prepare(f);
        double before=0,after=0,difference=0,tail=0;
        for(int n=0;n<44100;n++) {
            float input=effect>=5 ? (n==0?12000.0f:0.0f) : 8000.0f*sinf(6.2831853f*1000*n/MARK_SR);
            float l=input,r=input;twain_fx_run(f,&l,&r,88200);
            assert(isfinite(l) && isfinite(r) && fabsf(l)<=32768 && fabsf(r)<=32768);
            if(n>22050) { before+=input*input;after+=l*l;difference+=(l-input)*(l-input); }
            if(n>100)tail+=fabsf(l)+fabsf(r);
        }
        if(effect<3)assert(after<before*0.3);
        if(effect==3)assert(after>before*0.8 && after<before*1.05);
        if(effect==4)assert(difference>before*0.01);
        if(effect>=5)assert(tail>100);
        free(f);
    }
    twain_fx_t *f=calloc(1,sizeof(*f)); assert(f); f->dirty=1;twain_fx_prepare(f);
    float l=2345,r=-2345;twain_fx_run(f,&l,&r,88200);assert(l==2345 && r==-2345);free(f);
}
#endif
static int output_sample(twain_t *t) {
    int16_t in[256]={0},out[256];twain_process(t,in,out,128);return out[254];
}
static void test_history(void) {
    twain_t *t=twain_create(NULL,NULL);assert(t);
    expect(t,"undo_count","0");
    twain_set_param(t,"edit_begin","a_t1");
    for(int v=1;v<=9;v++) { char amount[8];snprintf(amount,sizeof amount,"%d",v);twain_set_param(t,"a_t1_hp",amount); }
    twain_set_param(t,"a_t1_lp","23");twain_set_param(t,"edit_end","1");
    expect(t,"undo_count","1");
    twain_set_param(t,"undo","1");expect(t,"a_t1_hp","0");expect(t,"a_t1_lp","0");
    for(int v=1;v<=7;v++) { char amount[8];snprintf(amount,sizeof amount,"%d",v);twain_set_param(t,"a_t1_hp",amount); }
    expect(t,"undo_count","5");
    for(int i=0;i<5;i++)twain_set_param(t,"undo","1");
    expect(t,"a_t1_hp","2");expect(t,"undo_count","0"); // oldest two edits fell out
    twain_set_param(t,"a_t1_hp","0");
    twain_set_param(t,"a_t1_delay_rate","6");
    twain_set_param(t,"quantize","0");twain_set_param(t,"a_t1_btn","1");
    frames(t,512);twain_set_param(t,"a_t1_btn","1");
    int before=output_sample(t);assert(before>0);
    twain_set_param(t,"a_t1_clear","1");expect(t,"a_t1_delay_rate","6");
    expect(t,"tstates","0,0,0,0");assert(output_sample(t)==0);
    twain_set_param(t,"a_t1_clear","1");expect(t,"a_t1_delay_rate","5");
    char json[768];twain_get_param(t,"twain_status",json,sizeof json);assert(strstr(json,"\"custom\":[0,0]"));
    char count[8];twain_get_param(t,"undo_count",count,sizeof count);
    twain_set_param(t,"a_t1_clear","1");expect(t,"undo_count",count); // no-op doesn't consume history
    twain_set_param(t,"undo","1");expect(t,"a_t1_delay_rate","6");expect(t,"tstates","0,0,0,0");
    twain_set_param(t,"undo","1");expect(t,"tstates","2,0,0,0");assert(output_sample(t)==before);
    twain_destroy(t);
    /* Five audio deletions across both scenes restore five distinct buffers. */
    t=twain_create(NULL,NULL);assert(t);twain_set_param(t,"quantize","0");
    for(int i=1;i<=4;i++) { char key[24];snprintf(key,sizeof key,"a_t%d_btn",i);twain_set_param(t,key,"1");frames(t,512);twain_set_param(t,key,"1"); }
    select_scene(t,1);twain_set_param(t,"quantize","0");
    twain_set_param(t,"b_t1_btn","1");frames(t,512);twain_set_param(t,"b_t1_btn","1");
    for(int i=1;i<=4;i++) {char key[24];snprintf(key,sizeof key,"a_t%d_clear",i);twain_set_param(t,key,"1");}
    twain_set_param(t,"b_t1_clear","1");expect(t,"undo_count","5");
    for(int i=0;i<5;i++)twain_set_param(t,"undo","1");
    expect(t,"a_tstates","2,2,2,2");expect(t,"b_tstates","2,0,0,0");
    expect(t,"undo_count","0");assert(output_sample(t)>0);
    select_scene(t,0);assert(output_sample(t)>0);twain_destroy(t);
    /* Undo an active replacement restores the previous recorded waveform. */
    t=twain_create(NULL,NULL);assert(t);twain_set_param(t,"a_t1_record","1");
    frames(t,88200);frames(t,88200);before=output_sample(t);assert(before>0);
    twain_set_param(t,"a_t1_record","1");frames(t,88200-128);expect(t,"tstates","1,0,0,0");
    test_signal=5000;render(t,10);twain_set_param(t,"undo","1");
    expect(t,"tstates","2,0,0,0");assert(output_sample(t)==before);
    twain_destroy(t);test_signal=1000;
    puts("Twain: grouped edits, five audio undos, staged delete and replacement recovery passed");
}
int main(void) {
    test_scene_grid();
    test_history();
    test_clip_workflow();
#ifdef MARK_TWAIN
    test_clip_fx();
#endif
    test_armed_record();
    twain_t *t=twain_create(NULL,NULL); assert(t);
    expect(t,"module_id","twain"); expect(t,"track_seconds","60");
    for (int scene=0;scene<2;scene++) {
        test_signal = scene ? 2000 : 1000;
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
