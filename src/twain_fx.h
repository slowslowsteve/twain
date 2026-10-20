/* Twain-only seven-effect insert chain. Storage is allocated with the engine,
 * never on render. Values are 0..100; zero bypasses each effect. */
#ifndef TWAIN_FX_H
#define TWAIN_FX_H
#include <math.h>
#define TW_FX_COUNT 7
#define TW_DELAY (MARK_SR * 2)
#define TW_REV 4096
#define TW_CHORUS 2048
typedef struct {
    int value[7], dirty;
    float amount[7], hp_a, lp_a, hp_z[2], lp_z[2];
    float env, dry_power, sat_power, phase;
    float delay[2][TW_DELAY], chorus[2][TW_CHORUS];
    float reverb[2][4][TW_REV];
    unsigned dw, cw, rw;
} twain_fx_t;
static int twain_fx_index(const char *key) {
    static const char *names[] = {"hp","lp","comp","sat","chorus","reverb","delay"};
    for (int i=0;i<7;i++) if (!strcmp(key,names[i])) return i;
    return -1;
}
static void twain_fx_prepare(twain_fx_t *f) {
    if (!f->dirty) return;
    /* Fully counterclockwise bypasses; clockwise removes progressively more. */
    float hp=25.0f*powf(400.0f,f->value[0]/100.0f);
    float lp=18000.0f*powf(80.0f/18000.0f,f->value[1]/100.0f);
    f->hp_a=1.0f-expf(-6.2831853f*hp/MARK_SR);
    f->lp_a=1.0f-expf(-6.2831853f*lp/MARK_SR);
    f->dirty=0;
}
static float twain_interp(const float *buf, unsigned write, float distance, unsigned size) {
    float p=(float)write-distance;
    while(p<0) p+=(float)size;
    unsigned a=(unsigned)p % size, b=(a+1)%size;
    return buf[a]+(buf[b]-buf[a])*(p-floorf(p));
}
static void twain_fx_run(twain_fx_t *f, float *left, float *right, float bar_frames) {
    float x[2]={*left/32768.0f,*right/32768.0f};
    float enabled=0;
    for(int j=0;j<7;j++) { f->amount[j]+=(f->value[j]/100.0f-f->amount[j])*0.002f; enabled+=f->amount[j]; }
    if(enabled<0.00001f)return;
    for(int c=0;c<2;c++) {
        f->hp_z[c]+=(x[c]-f->hp_z[c])*f->hp_a;
        if(f->amount[0]>0.0001f) x[c]-=f->hp_z[c]*fminf(1.0f,f->amount[0]*20.0f);
        f->lp_z[c]+=(x[c]-f->lp_z[c])*f->lp_a;
        x[c]+=(f->lp_z[c]-x[c])*fminf(1.0f,f->amount[1]*20.0f);
    }
    float peak=fmaxf(fabsf(x[0]),fabsf(x[1]));
    f->env+=(peak-f->env)*(peak>f->env ? 0.02f : 0.0003f);
    /* Hard-knee 12:1 compressor; blend to taste, no automatic makeup gain. */
    float threshold=0.35f*powf(0.05f/0.35f,f->amount[2]);
    float gain=f->env>threshold ? powf(threshold/f->env,11.0f/12.0f) : 1.0f;
    for(int c=0;c<2;c++) x[c]*=1.0f+(gain-1.0f)*f->amount[2];
    float drive=1.0f+49.0f*f->amount[3];
    float sat[2]={tanhf(x[0]*drive),tanhf(x[1]*drive)};
    float dry=(x[0]*x[0]+x[1]*x[1])*0.5f;
    float wet=(sat[0]*sat[0]+sat[1]*sat[1])*0.5f;
    f->dry_power+=(dry-f->dry_power)*0.002f;
    f->sat_power+=(wet-f->sat_power)*0.002f;
    /* RMS compensation tracks the drive, and cannot add makeup gain. */
    float norm=sqrtf((f->dry_power+1e-12f)/(f->sat_power+1e-12f));
    if(norm>1.0f) norm=1.0f;
    for(int c=0;c<2;c++) x[c]+=(sat[c]*norm-x[c])*f->amount[3];
    f->phase+=0.000015f;
    if(f->phase>=1) f->phase-=1;
    static const unsigned lengths[4]={1557,1867,2111,2539};
    unsigned delay=(unsigned)(bar_frames/8.0f); // eighth-note, stereo ping-pong
    if(delay<1)delay=1;
    if(delay>=TW_DELAY)delay=TW_DELAY-1;
    float echo[2]={f->delay[0][(f->dw+TW_DELAY-delay)%TW_DELAY],
                   f->delay[1][(f->dw+TW_DELAY-delay)%TW_DELAY]};
    for(int c=0;c<2;c++) {
        float dist=MARK_SR*(0.016f+0.003f*sinf(6.2831853f*(f->phase+c*0.25f)));
        float chorus=twain_interp(f->chorus[c],f->cw,dist,TW_CHORUS);
        f->chorus[c][f->cw]=x[c];
        x[c]+=(chorus-x[c])*f->amount[4]*0.5f;
        float rev=0;
        for(int j=0;j<4;j++) {
            unsigned pos=f->rw % (lengths[j]+c*23);
            float old=f->reverb[c][j][pos];
            f->reverb[c][j][pos]=x[c]+old*0.73f;
            rev+=old*0.16f;
        }
        f->delay[c][f->dw]=x[c]+echo[1-c]*0.45f;
        x[c]+=rev*f->amount[5]+echo[c]*f->amount[6]*0.65f;
        if(!isfinite(x[c]))x[c]=0;
        if(x[c]>1)x[c]=1;
        if(x[c]<-1)x[c]=-1;
    }
    f->dw=(f->dw+1)%TW_DELAY; f->cw=(f->cw+1)%TW_CHORUS; f->rw++;
    *left=x[0]*32768.0f; *right=x[1]*32768.0f;
}
#endif
