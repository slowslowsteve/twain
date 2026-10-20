/* Included by twain_core.c: persistent low-priority file worker. */
#include <unistd.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <dirent.h>
#include <errno.h>
#include <time.h>
#include <sched.h>
/* Results: 0 success, 1 missing, 2 invalid/corrupt, 3 disk error,
 * 4 memory, 5 project changed, 6 recording/busy, 7 no project identity. */
static int tw_uuid(const char *s) {
    if(strlen(s)!=36)return 0;
    for(int i=0;i<36;i++) {
        if(i==8||i==13||i==18||i==23) { if(s[i]!='-')return 0; }
        else if(!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f')))return 0;
    }
    return 1;
}
static void tw_name(char *out,const char *name) {
    snprintf(out,128,"%s",name);
    for(char *p=out;*p;p++)if((unsigned char)*p<32)*p=' ';
}
#if __BYTE_ORDER__ != __ORDER_LITTLE_ENDIAN__
#error Twain project PCM format requires a little-endian build
#endif
static uint32_t tw_crc(uint32_t crc,const unsigned char *p,size_t n) {
    static const uint32_t table[16]={0,0x1db71064,0x3b6e20c8,0x26d930ac,
        0x76dc4190,0x6b6b51f4,0x4db26158,0x5005713c,0xedb88320,0xf00f9344,
        0xd6d6a3e8,0xcb61b38c,0x9b64c2b0,0x86d3d2d4,0xa00ae278,0xbdbdf21c};
    while(n--) { crc^=*p++;crc=(crc>>4)^table[crc&15];crc=(crc>>4)^table[crc&15]; }
    return crc;
}
typedef struct { FILE *f;uint32_t crc;int writing,failed; } tw_stream;
static void tw_bytes(tw_stream *s,void *data,size_t n) {
    if(s->failed)return;
    size_t got=s->writing?fwrite(data,1,n,s->f):fread(data,1,n,s->f);
    if(got!=n) { s->failed=1;return; }
    s->crc=tw_crc(s->crc,data,n);
}
static uint32_t tw_u32(tw_stream *s,uint32_t value) {
    unsigned char b[4];for(int i=0;i<4;i++)b[i]=(unsigned char)(value>>(i*8));
    tw_bytes(s,b,4);return (uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24;
}
static double tw_double(tw_stream *s,double value) {
    uint64_t bits=0;memcpy(&bits,&value,8);
    uint32_t lo=tw_u32(s,(uint32_t)bits),hi=tw_u32(s,(uint32_t)(bits>>32));
    bits=(uint64_t)lo|((uint64_t)hi<<32);memcpy(&value,&bits,8);return value;
}
static int tw_header(tw_stream *s,tw_project_io *io,int read_name) {
    char magic[8]="TWAIN01\n";tw_bytes(s,magic,8);
    if(memcmp(magic,"TWAIN01\n",8))return 0;
    if(tw_u32(s,1)!=1 || tw_u32(s,MARK_SR)!=MARK_SR || tw_u32(s,4)!=4)return 0;
    io->file_layers=(int)tw_u32(s,MARK_TRACKS);
    if(io->file_layers!=4 && io->file_layers!=MARK_TRACKS)return 0;
    io->active=(int)tw_u32(s,(uint32_t)io->active);
    io->master=(int)tw_u32(s,(uint32_t)io->master);io->mute=(int)tw_u32(s,(uint32_t)io->mute);
    for(int i=0;i<4;i++)io->bars[i]=(int)tw_u32(s,(uint32_t)io->bars[i]);
    char name[128]={0};if(s->writing)memcpy(name,io->job_name,128);tw_bytes(s,name,128);
    if(!memchr(name,0,128))return 0;
    if(read_name)tw_name(io->job_name,name);
    if(io->active<0||io->active>3||io->master<0||io->master>200||io->mute<0||io->mute>1)return 0;
    for(int i=0;i<4;i++)if(io->bars[i]<1||io->bars[i]>16)return 0;
    return !s->failed;
}
static int tw_mkdirs(const char *root) {
    char path[400];snprintf(path,sizeof path,"%s",root);
    for(char *p=path+1;;p++)if(*p=='/' || !*p) {
        char c=*p;*p=0;
        if(mkdir(path,0755) && errno!=EEXIST)return 0;
        *p=c;if(!c)break;
    }
    return 1;
}
static void tw_release_staged(tw_project_io *io) {
    for(int i=0;i<4;i++)if(io->staged[i]) { mark_destroy(io->staged[i]);io->staged[i]=NULL; }
}
static int tw_file(twain_t *t,int writing) {
    tw_project_io *io=&t->io;char path[480],temp[480];
    snprintf(path,sizeof path,"%s/%s.twp",io->root,writing?io->target:io->source);
    snprintf(temp,sizeof temp,"%s/%s.tmp",io->root,io->target);
    if(writing && !tw_mkdirs(io->root))return 3;
    FILE *f=fopen(writing?temp:path,writing?"wb":"rb");
    if(!f)return !writing && errno==ENOENT?1:3;
    struct stat st;
    if(!writing && (fstat(fileno(f),&st)||!S_ISREG(st.st_mode)||st.st_size>340000000||st.st_size<184)) { fclose(f);return 2; }
    tw_stream s={f,0xffffffffu,writing,0};int result=2;
    if(!tw_header(&s,io,!writing))goto finish;
    for(int scene=0;scene<4;scene++) {
        if(!writing) {
            io->staged[scene]=mark_create_in_dir(t->host,t->module_dir[0]?t->module_dir:NULL);
            if(!io->staged[scene]) { result=4;goto finish; }
            mark_set_param(io->staged[scene],"monitor","0");
        }
        for(int clip=0;clip<io->file_layers;clip++) {
            mark_clip_snapshot_t *c=&io->clips[scene][clip];
            c->len=tw_u32(&s,c->len);c->full_len=tw_u32(&s,c->full_len);
            c->grid=tw_double(&s,c->grid);
            for(int i=0;i<10;i++) {
                c->settings[i]=(int)tw_u32(&s,(uint32_t)c->settings[i]);
                int max=i==0?200:i==8?11:i==9?1:100;
                if(c->settings[i]<0 || c->settings[i]>max)goto finish;
            }
            if(c->len>c->full_len || c->full_len>(uint32_t)MARK_SR*60 ||
               !isfinite(c->grid)||c->grid<0||c->grid>MARK_SR*60.0)goto finish;
            /* Twain is deployed only to little-endian ARM64; host tests are LE.
             * Format fields are explicitly LE, PCM is interleaved signed 16-bit LE. */
            if(!writing)c->audio=mark_project_buffer(io->staged[scene],clip);
            tw_bytes(&s,c->audio,(size_t)c->full_len*MARK_CH*sizeof(int16_t));
            if(s.failed)goto finish;
            if(!writing && !mark_project_import(io->staged[scene],clip,c))goto finish;
        }
    }
    {
        uint32_t crc=s.crc^0xffffffffu;
        if(writing) { tw_u32(&s,crc);if(s.failed) { result=3;goto finish; } }
        else {
            uint32_t stored=tw_u32(&s,0);
            if(s.failed || stored!=crc || fgetc(f)!=EOF)goto finish;
        }
    }
    result=0;
finish:
    if(writing) {
        if(fflush(f)||fsync(fileno(f)))result=3;
        if(fclose(f))result=3;
        if(!result && rename(temp,path))result=3;
        if(!result) {
            int fd=open(io->root,O_RDONLY);
            if(fd<0 || fsync(fd))result=3;
            if(fd>=0)close(fd);
        }
        if(result)unlink(temp);
    } else if(fclose(f))result=3;
    return result;
}
static int tw_catalog_compare(const void *a,const void *b) {
    return strcmp(((const tw_project_entry *)a)->name,((const tw_project_entry *)b)->name);
}
static int tw_catalog(tw_project_io *io) {
    io->catalog_count=0;DIR *dir=opendir(io->root);
    if(!dir)return errno==ENOENT?0:3;
    struct dirent *entry;
    while((entry=readdir(dir)) && io->catalog_count<TW_CATALOG) {
        if(strlen(entry->d_name)!=40 || strcmp(entry->d_name+36,".twp"))continue;
        char id[37];memcpy(id,entry->d_name,36);id[36]=0;if(!tw_uuid(id))continue;
        char path[480];snprintf(path,sizeof path,"%s/%s.twp",io->root,id);
        FILE *f=fopen(path,"rb");if(!f)continue;
        tw_project_io header={0};tw_stream s={f,0xffffffffu,0,0};
        int valid=tw_header(&s,&header,1);fclose(f);if(!valid)continue;
        tw_project_entry *out=&io->catalog[io->catalog_count++];
        memcpy(out->id,id,37);tw_name(out->name,header.job_name);
    }
    closedir(dir);qsort(io->catalog,(size_t)io->catalog_count,sizeof io->catalog[0],tw_catalog_compare);return 0;
}
static void *tw_worker(void *arg) {
    twain_t *t=arg;tw_project_io *io=&t->io;
    struct sched_param normal={0};(void)pthread_setschedparam(pthread_self(),SCHED_OTHER,&normal);
    const struct timespec delay={0,10000000};
    while(!atomic_load(&io->stop)) {
        int state=atomic_load_explicit(&io->state,memory_order_acquire);
        if(state==1) {
            atomic_store(&io->state,2);
            if(io->op==1)io->result=tw_file(t,1);
            else if(io->op==2)io->result=tw_file(t,0);
            else if(io->op==3)io->result=tw_catalog(io);
            else {
                io->result=0;
                for(int i=0;i<4;i++) {
                    io->staged[i]=mark_create_in_dir(t->host,t->module_dir[0]?t->module_dir:NULL);
                    if(!io->staged[i]) { io->result=4;break; }
                    mark_set_param(io->staged[i],"monitor","0");io->bars[i]=1;
                }
                io->active=0;io->master=100;io->mute=0;
            }
            atomic_store_explicit(&io->state,3,memory_order_release);
        } else if(state==4) {
            tw_release_staged(io);
            atomic_store_explicit(&io->state,0,memory_order_release);
        } else nanosleep(&delay,NULL);
    }
    tw_release_staged(io);return NULL;
}
static int tw_io_init(twain_t *t) {
    tw_project_io *io=&t->io;
    snprintf(io->root,sizeof io->root,"/data/UserData/schwung/twain-projects");
    if(pthread_create(&io->thread,NULL,tw_worker,t))return 0;
    io->started=1;return 1;
}
static void tw_io_destroy(twain_t *t) {
    if(t->io.started) { atomic_store(&t->io.stop,1);pthread_join(t->io.thread,NULL); }
}
static void tw_io_poll(twain_t *t) {
    tw_project_io *io=&t->io;
    if(atomic_load_explicit(&io->state,memory_order_acquire)!=3)return;
    if(!io->result && (io->op==2 || io->op==4)) {
        if(strcmp(io->live,io->target) || io->live_gen!=io->job_gen)io->result=5;
        else {
            for(int i=0;i<4;i++) { mark_t *old=t->scene[i];t->scene[i]=io->staged[i];io->staged[i]=old;t->bars[i]=io->bars[i]; }
            t->active=io->active;t->master_level=io->master;t->master_mute=io->mute;t->master_gain=0;
            t->pending=-1;t->phase=0;t->clock_running=t->clock_ticks=t->cycle_due=t->bar_due=0;
            t->transport_stopped=1;t->input_monitor=0;memset(t->armed,0,sizeof t->armed);
            t->history_head=t->history_count=0;t->gesture_scene=t->gesture_clip=-1;t->gesture_saved=0;
            t->master_editing=t->master_saved=0;
            memcpy(io->loaded,io->target,37);tw_name(io->name,io->live_name);
            io->revision++;io->saved_revision=io->revision;
            if(io->op==4 || (io->op==2 && strcmp(io->source,io->target)))io->saved_revision--;
        }
    } else if(!io->result && io->op==1 && io->revision==io->job_revision)io->saved_revision=io->revision;
    atomic_store_explicit(&io->state,4,memory_order_release);
}
static int tw_io_param(twain_t *t,const char *key,const char *val) {
    tw_project_io *io=&t->io;
    if(!strcmp(key,"project_live")) {
        io->identity_enabled=1;
        char id[37];unsigned generation=0;int used=0;
        if(sscanf(val,"%36[^\n]\n%u%n",id,&generation,&used)==2 && tw_uuid(id) && generation && val[used]=='\n') {
            memcpy(io->live,id,37);io->live_gen=generation;tw_name(io->live_name,val+used+1);
        } else { io->live[0]=0;io->live_gen=0; }
        return 1;
    }
    if(!strcmp(key,"project_dir")) {
        if(!atomic_load(&io->state) && val[0]=='/' && strlen(val)<sizeof io->root-1)snprintf(io->root,sizeof io->root,"%s",val);
        return 1;
    }
    int op=!strcmp(key,"project_save")?1:!strcmp(key,"project_load")?2:!strcmp(key,"project_catalog")?3:!strcmp(key,"project_new")?4:0;
    if(!op)return !strncmp(key,"project_",8); /* no inherited session fallback */
    if(atomic_load(&io->state))return 1;
    io->serial++;io->result=0;
    if(op!=3 && (!tw_uuid(io->live) || (op==1 && !tw_uuid(io->loaded)))) { io->result=7;return 1; }
    if(op==2 && !tw_uuid(val)) { io->result=7;return 1; }
    for(int i=0;i<4;i++) {
        if(op==1 && !mark_project_safe(t->scene[i])) { io->result=6;return 1; }
        if(op==1)for(int j=0;j<MARK_TRACKS;j++) {
            if(t->armed[i][j]==4 || !mark_project_export(t->scene[i],j,&io->clips[i][j])) { io->result=6;return 1; }
        }
    }
    io->op=op;io->active=t->active;io->master=t->master_level;io->mute=t->master_mute;
    for(int i=0;i<4;i++)io->bars[i]=t->bars[i];
    memcpy(io->target,op==1?io->loaded:io->live,37);
    snprintf(io->source,sizeof io->source,"%s",op==2?val:"");
    tw_name(io->job_name,op==1?io->name:io->live_name);
    io->job_gen=io->live_gen;io->job_revision=io->revision;
    atomic_store_explicit(&io->state,1,memory_order_release);return 1;
}
static int tw_io_get(twain_t *t,const char *key,char *buf,int n) {
    tw_project_io *io=&t->io;int busy=atomic_load_explicit(&io->state,memory_order_acquire)!=0;
    if(!strcmp(key,"project_status"))return snprintf(buf,n,
        "{\"id\":\"%s\",\"dirty\":%d,\"busy\":%d,\"result\":%d,\"serial\":%u}",
        io->loaded,io->revision!=io->saved_revision,busy,busy?0:io->result,io->serial);
    if(!strcmp(key,"project_name"))return snprintf(buf,n,"%s",io->name);
    if(!strcmp(key,"project_catalog_count"))return snprintf(buf,n,"%d",busy?0:io->catalog_count);
    if(!strncmp(key,"project_catalog_",16)) {
        char *end;long index=strtol(key+16,&end,10);
        if(!busy && !*end && index>=0 && index<io->catalog_count)
            return snprintf(buf,n,"%s\t%s",io->catalog[index].id,io->catalog[index].name);
        return snprintf(buf,n,"");
    }
    return -1;
}
