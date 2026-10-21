/* Laptop-only offline renderer. Uses the unmodified Twain effect implementation. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <errno.h>
#define MARK_SR 44100
#include "../../src/twain_fx.h"
static void u16(FILE *f,unsigned n) {fputc(n&255,f);fputc((n>>8)&255,f);}
static void u32(FILE *f,uint32_t n) {u16(f,n);u16(f,n>>16);}
static int wav(FILE *f,uint32_t frames,int floating) {
    uint32_t bytes=frames*2*(floating?4:2);
    fwrite("RIFF",1,4,f);u32(f,(floating?48:36)+bytes);fwrite("WAVEfmt ",1,8,f);
    u32(f,16);u16(f,floating?3:1);u16(f,2);u32(f,MARK_SR);
    u32(f,MARK_SR*2*(floating?4:2));u16(f,2*(floating?4:2));u16(f,floating?32:16);
    if(floating){fwrite("fact",1,4,f);u32(f,4);u32(f,frames);}
    fwrite("data",1,4,f);u32(f,bytes);return !ferror(f);
}
static long long number(const char *s) {char *end;errno=0;long long v=strtoll(s,&end,10);if(errno||!*s||*end||v<0){fprintf(stderr,"Invalid render argument\n");exit(2);}return v;}
static uint32_t frames_arg(const char *s) {long long n=number(s);if(n>UINT32_MAX)exit(2);return (uint32_t)n;}
int main(int argc,char **argv) {
    /* file, PCM byte offset, playable/full frames, loop frames, bar frames,
     * starting read position, tail frames, wet path, tail path, 19 settings */
    if(argc!=30)return 2;
    (void)twain_fx_index;(void)twain_secondary_index;
    uint64_t offset=number(argv[2]);uint32_t len=frames_arg(argv[3]),full=frames_arg(argv[4]);
    uint32_t loop=frames_arg(argv[5]),bar=frames_arg(argv[6]),pos=frames_arg(argv[7]),tail=frames_arg(argv[8]);
    if(!len||len>full||full>MARK_SR*60u||loop>MARK_SR*240u||!loop||!bar||pos>=len||tail>MARK_SR*30u)return 2;
    int settings[19];for(int i=0;i<19;i++){long long v=number(argv[11+i]);int max=i==0?200:i==8?11:i==9?1:i==18?15:100;if(v>max)return 2;settings[i]=(int)v;}
    FILE *input=fopen(argv[1],"rb");if(!input)return 3;
    if(fseeko(input,0,SEEK_END)||offset>(uint64_t)ftello(input)||(uint64_t)full*4>(uint64_t)ftello(input)-offset||fseeko(input,(off_t)offset,SEEK_SET)){fclose(input);return 2;}
    int16_t *pcm=malloc((size_t)full*4);twain_fx_t *fx=calloc(1,sizeof *fx);
    if(!pcm||!fx){free(pcm);free(fx);fclose(input);return 4;}
    if(fread(pcm,4,full,input)!=full){fclose(input);free(pcm);free(fx);return 3;}fclose(input);
    for(int i=0;i<7;i++){fx->value[i]=settings[i+1];fx->amount[i]=settings[i+1]/100.f;}
    for(int i=0;i<8;i++){fx->secondary[i]=settings[i+10];fx->alt[i]=settings[i+10]/100.f;}
    fx->delay_rate=fx->previous_rate=settings[8];fx->rate_mix=1;fx->dirty=1;twain_fx_prepare(fx);
    memcpy(fx->filter_current,fx->filter_g,sizeof fx->filter_g);
    FILE *wet=fopen(argv[9],"wb"),*tails=fopen(argv[10],"wb");
    if(!wet||!tails){if(wet)fclose(wet);if(tails)fclose(tails);free(pcm);free(fx);return 3;}
    wav(wet,loop,1);wav(tails,tail,1);
    float gain=settings[0]/100.f;
    for(uint32_t n=0;n<loop+tail;n++) {
        float l=0,r=0;
        if(n<loop){l=pcm[pos*2];r=pcm[pos*2+1];if(++pos==len)pos=0;}
        twain_fx_run(fx,&l,&r,(float)bar);
        /* Float WAV preserves clip-fader headroom up to 200%, ignores mutes
         * and master gain, and never applies input character a second time. */
        float out[2]={l/32768.f*gain,r/32768.f*gain};
        if(n>=loop && tail && n-loop>tail-MARK_SR/10u) {
            float fade=(loop+tail-n-1)/(MARK_SR/10.f);out[0]*=fade;out[1]*=fade;
        }
        if(!isfinite(out[0])||!isfinite(out[1])){fclose(wet);fclose(tails);free(pcm);free(fx);return 5;}
        if(fwrite(out,sizeof(float),2,n<loop?wet:tails)!=2){fclose(wet);fclose(tails);free(pcm);free(fx);return 3;}
    }
    int result=ferror(wet)||ferror(tails);if(fclose(wet))result=1;if(fclose(tails))result=1;
    free(pcm);free(fx);return result?3:0;
}
