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
    assert(!fseek(x,204,SEEK_SET)&&!fseek(y,204,SEEK_SET));
    for(int clip=0;clip<32;clip++) {
        unsigned char hx[92],hy[92];assert(fread(hx,1,92,x)==92&&fread(hy,1,92,y)==92);
        assert(!memcmp(hx,hy,92));uint32_t frames;memcpy(&frames,hx+4,4);
        size_t bytes=(size_t)frames*4;unsigned char bx[4096],by[4096];
        while(bytes) { size_t n=bytes>sizeof bx?sizeof bx:bytes;
            assert(fread(bx,1,n,x)==n&&fread(by,1,n,y)==n);assert(!memcmp(bx,by,n));bytes-=n;
        }
    }
    fclose(x);fclose(y);
}
// Build a genuine pre-eight-layer layout, with an independently calculated CRC.
static void legacy_copy(const char *from,const char *to,int layers) {
    FILE *f=fopen(from,"rb");assert(f);assert(!fseek(f,0,SEEK_END));long size=ftell(f);rewind(f);
    unsigned char *src=malloc(size),*dst=malloc(size);assert(src&&dst);
    assert(fread(src,1,size,f)==(size_t)size);fclose(f);
    memcpy(dst,src,180);dst[8]=1;dst[9]=dst[10]=dst[11]=0;dst[20]=(unsigned char)layers;dst[21]=dst[22]=dst[23]=0;
    size_t at=204,out=180;
    for(int scene=0;scene<4;scene++)for(int clip=0;clip<8;clip++) {
        uint32_t frames=src[at+4]|(uint32_t)src[at+5]<<8|(uint32_t)src[at+6]<<16|(uint32_t)src[at+7]<<24;
        size_t bytes=92+(size_t)frames*4;assert(at+bytes<=(size_t)size-4);
        if(clip<layers) { memcpy(dst+out,src+at,56);out+=56;memcpy(dst+out,src+at+92,bytes-92);out+=bytes-92; }at+=bytes;
    }
    uint32_t crc=0xffffffffu;
    for(size_t i=0;i<out;i++) { crc^=dst[i];for(int b=0;b<8;b++)crc=(crc>>1)^(0xedb88320u&-(crc&1)); }
    crc^=0xffffffffu;for(int i=0;i<4;i++)dst[out++]=(unsigned char)(crc>>(8*i));
    f=fopen(to,"wb");assert(f);assert(fwrite(dst,1,out,f)==out);assert(!fclose(f));free(src);free(dst);
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
        for(int clip=1;clip<=8;clip++) { snprintf(key,sizeof key,"%c_t%d_record",'a'+scene,clip);twain_set_param(t,key,"1"); }
        twain_set_param(t,"project_save","1");wait_job(t,6); // armed or recording is never snapshotted
        clocks(t,96);clocks(t,96);
        for(int clip=1;clip<=8;clip++) {
            snprintf(key,sizeof key,"%c_t%d_lp",'a'+scene,clip);snprintf(value,sizeof value,"%d",scene*10+clip);twain_set_param(t,key,value);
            const char *fx[]={"hp","comp","sat","chorus","reverb","delay"};
            for(int effect=0;effect<6;effect++) { snprintf(key,sizeof key,"%c_t%d_%s",'a'+scene,clip,fx[effect]);twain_set_param(t,key,value); }
            const char *secondary[]={"hp_res","lp_res","comp_release","sat_dirt","chorus_rate","reverb_decay","delay_feedback","delay_wow"};
            for(int effect=0;effect<8;effect++) { snprintf(key,sizeof key,"%c_t%d_%s",'a'+scene,clip,secondary[effect]);twain_set_param(t,key,value); }
            snprintf(key,sizeof key,"%c_t%d_level",'a'+scene,clip);twain_set_param(t,key,"73");
            snprintf(key,sizeof key,"%c_t%d_delay_rate",'a'+scene,clip);twain_set_param(t,key,"6");
        }
    }
    twain_set_param(t,"b_t2_mute","1");twain_set_param(t,"master_level","81");twain_set_param(t,"master_mute","1");
    for(int i=0;i<4;i++) { char k[32],v[8];snprintf(k,sizeof k,"%c_scene_bars",'a'+i);snprintf(v,sizeof v,"%d",i+1);twain_set_param(t,k,v); }
    twain_set_param(t,"d_t8_origin","2");twain_set_param(t,"c_scene_range","2,3");twain_set_param(t,"input_level","150");twain_set_param(t,"monitor_level","37");
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
    for(int scene=0;scene<4;scene++)for(int clip=1;clip<=8;clip++) {
        char k[32],v[16];snprintf(k,sizeof k,"%c_t%d_lp",'a'+scene,clip);snprintf(v,sizeof v,"%d",scene*10+clip);expect(t,k,v);
        const char *fx[]={"hp","comp","sat","chorus","reverb","delay"};
        for(int effect=0;effect<6;effect++) { snprintf(k,sizeof k,"%c_t%d_%s",'a'+scene,clip,fx[effect]);expect(t,k,v); }
        const char *secondary[]={"hp_res","lp_res","comp_release","sat_dirt","chorus_rate","reverb_decay","delay_feedback","delay_wow"};
        for(int effect=0;effect<8;effect++) { snprintf(k,sizeof k,"%c_t%d_%s",'a'+scene,clip,secondary[effect]);expect(t,k,v); }
        snprintf(k,sizeof k,"%c_t%d_delay_rate",'a'+scene,clip);expect(t,k,"6");
        snprintf(k,sizeof k,"%c_t%d_level",'a'+scene,clip);expect(t,k,"73");
        snprintf(k,sizeof k,"%c_t%d_len",'a'+scene,clip);twain_get_param(t,k,v,sizeof v);assert(atoi(v)>0);
    }
    expect(t,"b_t2_mute","1");expect(t,"master_level","81");expect(t,"master_mute","1");expect(t,"scene","3");
    expect(t,"d_t8_origin","2");expect(t,"c_scene_start","2");expect(t,"input_level","150");expect(t,"monitor_level","37");expect(t,"c_scene_bars","3");expect(t,"d_scene_bars","4");expect(t,"tstates","4,4,4,4,4,4,4,4");expect(t,"undo_count","0");
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
    legacy_copy(fileA,fileB,4);twain_set_param(t,"input_monitor","1");
    twain_set_param(t,"project_load",B);wait_job(t,0);expect(t,"input_monitor","0");
    for(int scene=0;scene<4;scene++)for(int clip=1;clip<=8;clip++) {
        char k[32],v[32];snprintf(k,sizeof k,"%c_t%d_lp",'a'+scene,clip);
        snprintf(v,sizeof v,"%d",clip<=4?scene*10+clip:0);expect(t,k,v);
        snprintf(k,sizeof k,"%c_t%d_len",'a'+scene,clip);twain_get_param(t,k,v,sizeof v);
        assert(clip<=4?atoi(v)>0:atoi(v)==0);
    }
    expect(t,"d_t8_origin","0");expect(t,"c_scene_start","1");expect(t,"input_level","100");expect(t,"monitor_level","100");
    legacy_copy(fileA,fileB,8);twain_set_param(t,"project_load",B);wait_job(t,0);
    for(int scene=0;scene<4;scene++)for(int clip=1;clip<=8;clip++) {
        char k[32],v[16];snprintf(k,sizeof k,"%c_t%d_lp",'a'+scene,clip);snprintf(v,sizeof v,"%d",scene*10+clip);expect(t,k,v);
        snprintf(k,sizeof k,"%c_t%d_comp_release",'a'+scene,clip);expect(t,k,"35");
    }
    // Replacing an occupied workspace with a new project reuses buffers but
    // clears every clip, including the layers omitted by legacy saves.
    twain_set_param(t,"project_new","1");wait_job(t,0);
    for(int scene=0;scene<4;scene++)for(int clip=1;clip<=8;clip++) {
        char k[32];snprintf(k,sizeof k,"%c_t%d_len",'a'+scene,clip);expect(t,k,"0");
        snprintf(k,sizeof k,"%c_t%d_lp",'a'+scene,clip);expect(t,k,"0");
        snprintf(k,sizeof k,"%c_t%d_level",'a'+scene,clip);expect(t,k,"50");
    }
    // Cleanup requires a readable native inventory, a preview token and a
    // final recheck. Reappearing projects and changed files block deletion.
    char native[512],nativeA[600],nativeC[600],fileC[600],summary[256],token[32];
    const char *C="bb2402f6-dc58-43e5-b7aa-d93e16e52ab6";
    snprintf(native,sizeof native,"%s/native",root);assert(!mkdir(native,0755));
    snprintf(nativeA,sizeof nativeA,"%s/%s",native,A);assert(!mkdir(nativeA,0755));
    twain_set_param(t,"project_native_dir",native);
    snprintf(fileC,sizeof fileC,"%s/%s.twp",root,C);
    // Valid independent orphan fixture (copy then undo the corruption helper).
    copy_corrupt(fileA,fileC);FILE *fix=fopen(fileC,"r+b");assert(fix);
    assert(!fseek(fix,-1,SEEK_END));int byte=fgetc(fix);assert(!fseek(fix,-1,SEEK_END));fputc(byte^0xff,fix);fclose(fix);
    twain_set_param(t,"project_cleanup_delete","1");wait_job(t,9);assert(!access(fileC,F_OK));
    twain_set_param(t,"project_cleanup_preview","1");wait_job(t,0);
    twain_get_param(t,"project_cleanup_summary",summary,sizeof summary);
    unsigned serial;int count;assert(sscanf(summary,"%u\t%d",&serial,&count)==2 && count==1);
    snprintf(token,sizeof token,"%u",serial);
    snprintf(nativeC,sizeof nativeC,"%s/%s",native,C);assert(!mkdir(nativeC,0755));
    twain_set_param(t,"project_cleanup_delete",token);wait_job(t,9);assert(!access(fileC,F_OK));rmdir(nativeC);
    twain_set_param(t,"project_cleanup_preview","1");wait_job(t,0);
    twain_get_param(t,"project_cleanup_summary",summary,sizeof summary);sscanf(summary,"%u",&serial);snprintf(token,sizeof token,"%u",serial);
    fix=fopen(fileC,"ab");assert(fix);fputc(0,fix);fclose(fix);
    twain_set_param(t,"project_cleanup_delete",token);wait_job(t,9);assert(!access(fileC,F_OK));
    twain_set_param(t,"project_cleanup_preview","1");wait_job(t,0);
    twain_get_param(t,"project_cleanup_summary",summary,sizeof summary);sscanf(summary,"%u",&serial);snprintf(token,sizeof token,"%u",serial);
    twain_set_param(t,"project_cleanup_delete",token);wait_job(t,0);
    assert(access(fileC,F_OK) && !access(fileA,F_OK) && !access(fileB,F_OK));
    twain_set_param(t,"project_cleanup_delete",token);wait_job(t,9);
    rmdir(nativeA);rmdir(native);
    twain_set_param(t,"project_cleanup_preview","1");wait_job(t,8);
    twain_destroy(t);unlink(fileA);unlink(fileB);unlink(bad);rmdir(root);
    puts("Twain projects: all 32 clips round-trip, legacy 16-clip loading, CRC failure isolation, duplicate copy, late identity change and failed-save recovery passed");
}
