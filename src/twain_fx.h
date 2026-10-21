/* Twain-only seven-effect insert chain. Storage is allocated with the engine,
 * never on render. Values are 0..100; zero bypasses each effect. */
#ifndef TWAIN_FX_H
#define TWAIN_FX_H
#include <math.h>
#define TW_FX_COUNT 7
#define TW_DELAY (MARK_SR * 12 + 1)
#define TW_RATE_DEFAULT 5
#define TW_RATE_COUNT 12
#define TW_REV 4096
#define TW_CHORUS 2048
typedef struct {
    int value[7], secondary[8], dirty, delay_rate, previous_rate;
    float rate_mix;
    float alt[8], svf[2][2][2], filter_g[2], filter_current[2], filter_previous[2][2], attack, release, rev_gain[2][8], wow_phase, flutter_phase;
    float amount[7], hp_a, lp_a, hp_z[2], lp_z[2];
    float env, dry_power, sat_power, phase, echo_damping[2];
    float drive_previous[2], drive_tone[2], drive_dc_x[2], drive_dc_y[2];
    float delay[2][TW_DELAY], chorus[2][TW_CHORUS];
    float reverb[2][8][TW_REV], damping[2][8];
    float diffuser[2][4][1024];
    unsigned dw, cw, rw;
} twain_fx_t;
static int twain_fx_index(const char *key) {
    static const char *names[] = {"hp","lp","comp","sat","chorus","reverb","delay"};
    for (int i=0;i<7;i++) if (!strcmp(key,names[i])) return i;
    return -1;
}
static int twain_secondary_index(const char *key) {
    static const char *names[]={"hp_res","lp_res","comp_release","sat_dirt","chorus_rate","reverb_decay","delay_feedback","delay_wow"};
    if(!strcmp(key,"comp_attack"))return 2; /* legacy parameter alias */
    for(int i=0;i<8;i++)if(!strcmp(key,names[i]))return i;
    return -1;
}
static void twain_fx_prepare(twain_fx_t *f) {
    if (!f->dirty) return;
    /* Fully counterclockwise bypasses; clockwise removes progressively more. */
    float hp=25.0f*powf(400.0f,f->value[0]/100.0f);
    float lp=18000.0f*powf(80.0f/18000.0f,f->value[1]/100.0f);
    f->hp_a=1.0f-expf(-6.2831853f*hp/MARK_SR);
    f->lp_a=1.0f-expf(-6.2831853f*lp/MARK_SR);
    f->filter_g[0]=tanf(3.14159265f*hp/(MARK_SR*2));
    f->filter_g[1]=tanf(3.14159265f*lp/(MARK_SR*2));
    f->attack=1-expf(-1/(MARK_SR*0.0003f));
    /* 25 ms to 1.2 s: short punch/pump through relaxed recovery. */
    f->release=1-expf(-1/(MARK_SR*0.025f*powf(48,f->secondary[2]/100.0f)));
    static const unsigned lengths[8]={1559,1867,2243,2671,3001,3253,3539,3907};
    float seconds=0.2f*powf(100,f->secondary[5]/100.0f);
    for(int c=0;c<2;c++)for(int j=0;j<8;j++)f->rev_gain[c][j]=powf(0.001f,(lengths[j]+c*23)/(MARK_SR*seconds));
    f->dirty=0;
}
static float twain_interp(const float *buf, unsigned write, float distance, unsigned size) {
    float p=(float)write-distance;
    while(p<0) p+=(float)size;
    unsigned a=(unsigned)p % size, b=(a+1)%size;
    return buf[a]+(buf[b]-buf[a])*(p-floorf(p));
}
static unsigned twain_delay_frames(float bar_frames, int rate) {
    static const unsigned denominator[TW_RATE_COUNT]={1,2,3,4,6,8,12,16,24,32,48,64};
    if(rate<0)rate=0;
    if(rate>=TW_RATE_COUNT)rate=TW_RATE_COUNT-1;
    unsigned frames=(unsigned)(bar_frames/denominator[rate]+0.5f);
    if(frames<1)frames=1;
    if(frames>=TW_DELAY)frames=TW_DELAY-1;
    return frames;
}
static void twain_fx_run(twain_fx_t *f, float *left, float *right, float bar_frames) {
    float x[2]={*left/32768.0f,*right/32768.0f};
    float enabled=0;
    for(int j=0;j<7;j++) { f->amount[j]+=(f->value[j]/100.0f-f->amount[j])*0.002f; enabled+=f->amount[j]; }
    if(enabled<0.00001f)return;
    for(int i=0;i<8;i++)f->alt[i]+=(f->secondary[i]/100.0f-f->alt[i])*0.002f;
    for(int j=0;j<2;j++)f->filter_current[j]+=(f->filter_g[j]-f->filter_current[j])*0.004f;
    /* Nonlinear two-pole SVF, run at 2x rate. Negative damping at the
     * resonance extreme sustains oscillation; soft integrator limiting bounds
     * it without resonance-dependent input attenuation (LP bass remains).
     * MS-20-inspired behaviour, not a component-level circuit emulation. */
    for(int c=0;c<2;c++)for(int j=0;j<2;j++) {
        if(f->amount[j]<0.00001f)continue;
        float input=x[c],out=0,g=f->filter_current[j];
        float resonance=f->alt[j],k=2.0f-2.35f*resonance*resonance;
        float *z=f->svf[j][c];
        for(int os=1;os<=2;os++) {
            float v=f->filter_previous[j][c]+(input-f->filter_previous[j][c])*(os*0.5f);
            if(resonance>0.95f)v+=1e-7f; /* deterministic thermal-noise seed */
            float v1=(z[0]+g*(v-z[1]))/(1+g*(g+k)),v2=z[1]+g*v1;
            float a=2*v1-z[0],b=2*v2-z[1];
            z[0]=a/sqrtf(1+0.025f*a*a);z[1]=b/sqrtf(1+0.025f*b*b);
            out+=(j?v2:v-k*v1-v2)*0.5f;
        }
        f->filter_previous[j][c]=input;
        x[c]+=(out-x[c])*fminf(1.0f,f->amount[j]*20);
    }
    float peak=fmaxf(fabsf(x[0]),fabsf(x[1]));
    f->env+=(peak-f->env)*(peak>f->env ? f->attack : f->release);
    /* One-knob parallel 12:1 compression with up to 18 dB makeup. */
    float threshold=0.35f*powf(0.05f/0.35f,f->amount[2]);
    float gain=f->env>threshold ? powf(threshold/f->env,11.0f/12.0f) : 1.0f;
    for(int c=0;c<2;c++) x[c]*=(1.0f+(gain-1.0f)*f->amount[2])*powf(10.0f,0.9f*f->amount[2]);
    /* Four-times interpolated soft drive: gentle odd/even harmonics, with
     * an internal tone low-pass and DC blocker instead of 50x hard flattening. */
    float drive=1.0f+23.0f*f->alt[3]*f->alt[3], bias=0.06f*f->alt[3];
    float sat[2];
    for(int c=0;c<2;c++) {
        float sum=0;
        for(int k=1;k<=4;k++) {
            float input=f->drive_previous[c]+(x[c]-f->drive_previous[c])*(k*0.25f);
            float z=input*drive+bias;
            float shaped=tanhf(z)-tanhf(bias);
            f->drive_tone[c]+=(shaped-f->drive_tone[c])*0.45f;
            sum+=f->drive_tone[c]*0.25f;
        }
        f->drive_previous[c]=x[c];
        sat[c]=sum-f->drive_dc_x[c]+0.9995f*f->drive_dc_y[c];
        f->drive_dc_x[c]=sum;f->drive_dc_y[c]=sat[c];
    }
    float dry=(x[0]*x[0]+x[1]*x[1])*0.5f;
    float wet=(sat[0]*sat[0]+sat[1]*sat[1])*0.5f;
    f->dry_power+=(dry-f->dry_power)*0.0005f;
    f->sat_power+=(wet-f->sat_power)*0.0005f;
    float norm=sqrtf((f->dry_power+1e-12f)/(f->sat_power+1e-12f));
    if(norm>1.0f)norm=1.0f;
    for(int c=0;c<2;c++)x[c]+=(sat[c]*norm-x[c])*f->amount[3];
    f->phase+=(0.05f+8*f->alt[4]*f->alt[4])/MARK_SR;
    f->wow_phase+=0.25f/MARK_SR;f->flutter_phase+=5.3f/MARK_SR;
    if(f->wow_phase>=1)f->wow_phase-=1;if(f->flutter_phase>=1)f->flutter_phase-=1;
    if(f->phase>=1) f->phase-=1;
    /* Dense, damped parallel combs followed by four serial allpasses. */
    static const unsigned lengths[8]={1559,1867,2243,2671,3001,3253,3539,3907};
    static const unsigned diffusion[4]={556,441,341,225};
    unsigned delay=twain_delay_frames(bar_frames,f->delay_rate);
    unsigned old_delay=twain_delay_frames(bar_frames,f->previous_rate);
    float echo[2];
    if(f->rate_mix<1)f->rate_mix=fminf(1,f->rate_mix+1.0f/(MARK_SR*0.02f));
    float modulation=MARK_SR*0.0012f*f->alt[7]*(0.75f*sinf(6.2831853f*f->wow_phase)+0.25f*sinf(6.2831853f*f->flutter_phase));
    for(int c=0;c<2;c++) {
        float old=twain_interp(f->delay[c],f->dw,fmaxf(1,fminf(TW_DELAY-1,old_delay+modulation)),TW_DELAY);
        float next=twain_interp(f->delay[c],f->dw,fmaxf(1,fminf(TW_DELAY-1,delay+modulation)),TW_DELAY);
        echo[c]=old+(next-old)*f->rate_mix;
    }
    for(int c=0;c<2;c++) {
        float dist=MARK_SR*(0.016f+0.003f*sinf(6.2831853f*(f->phase+c*0.25f)));
        float chorus=twain_interp(f->chorus[c],f->cw,dist,TW_CHORUS);
        f->chorus[c][f->cw]=x[c];
        x[c]+=(chorus-x[c])*f->amount[4]*0.5f;
        float rev=0,excitation=x[c];
        /* Diffuse the attack BEFORE the resonators: percussion no longer
         * hits eight bare combs as a set of metallic discrete echoes. */
        for(int j=0;j<2;j++) {
            unsigned pos=f->rw % (diffusion[j]+c*23);
            float old=f->diffuser[c][j][pos],diffused=old-0.65f*excitation;
            f->diffuser[c][j][pos]=excitation+0.65f*diffused;excitation=diffused;
        }
        for(int j=0;j<8;j++) {
            unsigned pos=f->rw % (lengths[j]+c*23);
            float old=f->reverb[c][j][pos];
            f->damping[c][j]+=(old-f->damping[c][j])*0.35f;
            f->reverb[c][j][pos]=excitation*0.16f+f->damping[c][j]*f->rev_gain[c][j];
            rev+=old*0.25f;
        }
        for(int j=2;j<4;j++) {
            unsigned pos=f->rw % (diffusion[j]+c*23);
            float old=f->diffuser[c][j][pos];
            float output=old-0.5f*rev;
            f->diffuser[c][j][pos]=rev+0.5f*output;
            rev=output;
        }
        /* Increasing send also lengthens the tail; feedback stays below unity.
         * A low-pass in the loop makes later repeats softer and darker. */
        float send=f->amount[6], feedback=0.995f*f->alt[6];
        f->echo_damping[c]+=(echo[1-c]-f->echo_damping[c])*0.45f;
        float repeat=x[c]*send+f->echo_damping[c]*feedback;
        f->delay[c][f->dw]=repeat/(1+0.03f*fabsf(repeat));
        /* Stronger room return and a little dry reduction, same decay time. */
        float room=f->amount[5];
        x[c]=x[c]*(1.0f-0.2f*room)+rev*(2.2f*room)+echo[c]*send*0.8f;
        if(!isfinite(x[c]))x[c]=0;
        if(x[c]>1)x[c]=1;
        if(x[c]<-1)x[c]=-1;
    }
    f->dw=(f->dw+1)%TW_DELAY; f->cw=(f->cw+1)%TW_CHORUS; f->rw++;
    *left=x[0]*32768.0f; *right=x[1]*32768.0f;
}
#endif
