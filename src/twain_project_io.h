/* Twain-owned worker protocol. All fields cross through state release/acquire. */
#ifndef TWAIN_PROJECT_IO_H
#define TWAIN_PROJECT_IO_H
#include <pthread.h>
#include <stdatomic.h>
#define TW_CATALOG 64
typedef struct {
    char id[37], name[128];
} tw_project_entry;
typedef struct {
    tw_project_entry entry;
    unsigned long long bytes, device, inode;
    long long modified, modified_ns;
} tw_orphan_entry;
typedef struct {
    pthread_t thread; int started;
    atomic_int stop, state; /* 0 idle, 1 request, 2 working, 3 ready, 4 cleanup, 5 commit, 6 committed */
    int op, result, identity_enabled; unsigned serial;
    char root[400], live[37], loaded[37], name[128], live_name[128];
    unsigned live_gen, job_gen;
    char target[37], source[37], job_name[128], target_name[128];
    unsigned long long revision, saved_revision, job_revision;
    int active, bars[4], starts[4], master, mute, input_level, monitor_level, file_layers, file_version;
    mark_clip_snapshot_t clips[4][MARK_TRACKS];
    int16_t *staged[4][MARK_TRACKS];
    tw_project_entry catalog[TW_CATALOG]; int catalog_count;
    char native_root[400];
    tw_orphan_entry orphans[TW_CATALOG];
    int orphan_count, removed_count; unsigned cleanup_serial;
    unsigned long long orphan_bytes;
} tw_project_io;
static int tw_io_init(twain_t *);
static void tw_io_destroy(twain_t *);
static void tw_io_poll(twain_t *);
static int tw_io_param(twain_t *,const char *,const char *);
static int tw_io_get(twain_t *,const char *,char *,int);
#endif
