#include "../src/twain_core.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
static int test_input=1000;
static const char *A="7f2402f6-dc58-43e5-b7aa-d93e16e52ab6";
static const char *B="d8ad61b8-7078-4548-820c-f42a70bf987f";
static void expect(twain_t *t,const char *key,const char *want) {
    char buf[512];twain_get_param(t,key,buf,sizeof buf);
    if(strcmp(buf,want))fprintf(stderr,"%s: expected %s, got %s\n",key,want,buf);
    assert(!strcmp(buf,want));
}
static void wait_job(twain_t *t,int result) {
    char buf[512],needle[32];snprintf(needle,sizeof needle,"\"result\":%d",result);
    for(int i=0;i<5000;i++) {
        twain_get_param(t,"project_status",buf,sizeof buf);
        if(strstr(buf,"\"busy\":0")) { if(!strstr(buf,needle))fprintf(stderr,"%s\n",buf);assert(strstr(buf,needle));return; }
        struct timespec d={0,2000000};nanosleep(&d,NULL);
    }
    assert(!"worker timeout");
}
static void live(twain_t *t,const char *id,int gen,const char *name) {
    char val[256];snprintf(val,sizeof val,"%s\n%d\n%s",id,gen,name);twain_set_param(t,"project_live",val);
}
static void clocks(twain_t *t,int ticks) {
    uint8_t tick=0xf8;int16_t in[256],out[256];for(int i=0;i<256;i++)in[i]=test_input+i;
    while(ticks--) { twain_on_midi(t,&tick,1,3);twain_process(t,in,out,128); }
}
static void copy_corrupt(const char *from,const char *to) {
    FILE *in=fopen(from,"rb"),*out=fopen(to,"wb");assert(in&&out);
    unsigned char buf[4096];size_t n;
    while((n=fread(buf,1,sizeof buf,in)))assert(fwrite(buf,1,n,out)==n);
    assert(!fclose(in));assert(!fclose(out));
    out=fopen(to,"r+b");assert(out);assert(!fseek(out,-1,SEEK_END));int c=fgetc(out);assert(!fseek(out,-1,SEEK_END));fputc(c^0xff,out);assert(!fclose(out));
}
static void compare_saved_clips(const char *a,const char *b) {
    FILE *x=fopen(a,"rb"),*y=fopen(b,"rb");assert(x&&y);
    assert(!fseek(x,180,SEEK_SET)&&!fseek(y,180,SEEK_SET));
    for(int clip=0;clip<16;clip++) {
        unsigned char hx[56],hy[56];assert(fread(hx,1,56,x)==56&&fread(hy,1,56,y)==56);
        assert(!memcmp(hx,hy,56));uint32_t frames;memcpy(&frames,hx+4,4);
        size_t bytes=(size_t)frames*4;unsigned char bx[4096],by[4096];
        while(bytes) { size_t n=bytes>sizeof bx?sizeof bx:bytes;
            assert(fread(bx,1,n,x)==n&&fread(by,1,n,y)==n);assert(!memcmp(bx,by,n));bytes-=n;
        }
    }
    fclose(x);fclose(y);
}
int main(void) {
    char root[]="/tmp/twain-project-test-XXXXXX";assert(mkdtemp(root));
    twain_t *t=twain_create(NULL,NULL);assert(t);
    twain_set_param(t,"project_dir",root);
    twain_set_param(t,"project_save","1");wait_job(t,7);
    live(t,A,1,"Set A");twain_set_param(t,"project_new","1");wait_job(t,0);
    uint8_t start=0xfa;twain_on_midi(t,&start,1,3);
    for(int scene=0;scene<4;scene++) {
        test_input=1000+scene*2000;
        char value[16],key[32];snprintf(value,sizeof value,"%d",scene);twain_set_param(t,"scene",value);
        for(int clip=1;clip<=4;clip++) { snprintf(key,sizeof key,"%c_t%d_record",'a'+scene,clip);twain_set_param(t,key,"1"); }
        twain_set_param(t,"project_save","1");wait_job(t,6); // armed or recording is never snapshotted
        clocks(t,96);clocks(t,96);
        for(int clip=1;clip<=4;clip++) {
            snprintf(key,sizeof key,"%c_t%d_lp",'a'+scene,clip);snprintf(value,sizeof value,"%d",scene*10+clip);twain_set_param(t,key,value);
            const char *fx[]={"hp","comp","sat","chorus","reverb","delay"};
            for(int effect=0;effect<6;effect++) { snprintf(key,sizeof key,"%c_t%d_%s",'a'+scene,clip,fx[effect]);twain_set_param(t,key,value); }
            snprintf(key,sizeof key,"%c_t%d_level",'a'+scene,clip);twain_set_param(t,key,"73");
            snprintf(key,sizeof key,"%c_t%d_delay_rate",'a'+scene,clip);twain_set_param(t,key,"6");
        }
    }
    twain_set_param(t,"b_t2_mute","1");twain_set_param(t,"master_level","81");twain_set_param(t,"master_mute","1");
    for(int i=0;i<4;i++) { char k[32],v[8];snprintf(k,sizeof k,"%c_scene_bars",'a'+i);snprintf(v,sizeof v,"%d",i+1);twain_set_param(t,k,v); }
    // The outgoing audio must be silent as soon as the live identity changes.
    twain_set_param(t,"master_mute","0");
    { int16_t in[256]={0},out[256];
      for(int n=0;n<40;n++)twain_process(t,in,out,128);
      live(t,B,2,"Other project");twain_process(t,in,out,128);
      for(int n=0;n<256;n++)assert(out[n]==0);
      twain_set_param(t,"project_live","");twain_process(t,in,out,128);
      for(int n=0;n<256;n++)assert(out[n]==0);
      live(t,A,1,"Set A");
    }
    twain_set_param(t,"master_mute","1");
    twain_set_param(t,"project_save","1");wait_job(t,0);
    char status[512];twain_get_param(t,"project_status",status,sizeof status);assert(strstr(status,"\"dirty\":0"));
    char fileA[512],fileB[512];snprintf(fileA,sizeof fileA,"%s/%s.twp",root,A);snprintf(fileB,sizeof fileB,"%s/%s.twp",root,B);
    struct stat st;assert(!stat(fileA,&st)&&st.st_size>1000);
    twain_set_param(t,"d_t1_clear","1");twain_set_param(t,"d_t1_lp","99");expect(t,"d_t1_len","0");
    twain_set_param(t,"project_load",B);wait_job(t,1);expect(t,"d_t1_lp","99");
    copy_corrupt(fileA,fileB);twain_set_param(t,"project_load",B);wait_job(t,2);
    expect(t,"d_t1_lp","99");expect(t,"d_t1_len","0");
    twain_set_param(t,"project_load",A);wait_job(t,0);
    for(int scene=0;scene<4;scene++)for(int clip=1;clip<=4;clip++) {
        char k[32],v[16];snprintf(k,sizeof k,"%c_t%d_lp",'a'+scene,clip);snprintf(v,sizeof v,"%d",scene*10+clip);expect(t,k,v);
        const char *fx[]={"hp","comp","sat","chorus","reverb","delay"};
        for(int effect=0;effect<6;effect++) { snprintf(k,sizeof k,"%c_t%d_%s",'a'+scene,clip,fx[effect]);expect(t,k,v); }
        snprintf(k,sizeof k,"%c_t%d_delay_rate",'a'+scene,clip);expect(t,k,"6");
        snprintf(k,sizeof k,"%c_t%d_level",'a'+scene,clip);expect(t,k,"73");
        snprintf(k,sizeof k,"%c_t%d_len",'a'+scene,clip);twain_get_param(t,k,v,sizeof v);assert(atoi(v)>0);
    }
    expect(t,"b_t2_mute","1");expect(t,"master_level","81");expect(t,"master_mute","1");expect(t,"scene","3");
    expect(t,"c_scene_bars","3");expect(t,"d_scene_bars","4");expect(t,"tstates","4,4,4,4");expect(t,"undo_count","0");
    // A duplicate loads the chosen source into B and remains dirty until saved.
    live(t,B,2,"Set B Copy");twain_set_param(t,"project_load",A);wait_job(t,0);
    twain_get_param(t,"project_status",status,sizeof status);assert(strstr(status,B)&&strstr(status,"\"dirty\":1"));
    twain_set_param(t,"project_save","1");wait_job(t,0);
    compare_saved_clips(fileA,fileB); // all PCM and all clip settings survive load/copy/save byte-for-byte
    twain_set_param(t,"project_catalog","1");wait_job(t,0);expect(t,"project_catalog_count","2");
    // Project changes during a load must invalidate it without replacing B.
    live(t,A,3,"Set A");twain_set_param(t,"project_load",A);live(t,B,4,"Set B Copy");wait_job(t,5);
    twain_get_param(t,"project_status",status,sizeof status);assert(strstr(status,B));
    // A failed save keeps memory dirty and the previous on-disk save intact.
    char bad[512];snprintf(bad,sizeof bad,"%s/not-a-directory",root);FILE *f=fopen(bad,"wb");assert(f);fclose(f);
    twain_set_param(t,"d_t1_lp","55");twain_set_param(t,"project_dir",bad);twain_set_param(t,"project_save","1");wait_job(t,3);
    expect(t,"d_t1_lp","55");twain_get_param(t,"project_status",status,sizeof status);assert(strstr(status,"\"dirty\":1"));
    twain_set_param(t,"project_dir",root);twain_set_param(t,"project_load",B);wait_job(t,0);expect(t,"d_t1_lp","31");
    twain_destroy(t);unlink(fileA);unlink(fileB);unlink(bad);rmdir(root);
    puts("Twain projects: all 16 clips round-trip, CRC failure isolation, duplicate copy, late identity change and failed-save recovery passed");
}
