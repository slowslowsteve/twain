/* Extracted host handler for isolated proposed-patch regression checks.
 * Regenerate from the patched upstream source when rebasing the patch. */
#include <assert.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#define SHADOW_UI_FLAG_SET_CHANGED 1
#define SCENE_NONE 255
struct control {unsigned set_doc_gen,ui_flags;int scene_edit,scene_unlock,move_ui_mode;};
static struct control control,*ctl=&control;
static struct {struct control **shadow_control_ptr;} host={&ctl};
static char sampler_current_set_name[128],sampler_current_set_uuid[64];
static uint32_t s_consume_gen,s_acked_gen;static _Atomic uint32_t s_published_gen;
static int s_consume_settled;
void shadow_handle_set_loaded(const char *set_name, const char *uuid) {
    if (!set_name || !set_name[0]) return;

    /* Avoid re-triggering for the same set */
    if (strcmp(sampler_current_set_name, set_name) == 0 &&
        (uuid == NULL || strcmp(sampler_current_set_uuid, uuid) == 0)) {
        /* Same set -- including Move RELOADING it, which is a new document with
         * the same name. Nothing for the UI to switch, so this read aligns us,
         * but only once it is known to postdate Move's Settings.json rewrite. */
        /* ...and only once the UI has ACKED the last change it was told
         * about. Otherwise a set loaded while the UI was still switching to
         * the previous one would be "the same set" here and align unhandled,
         * letting autosave write into the wrong folder. */
        if (s_consume_gen && s_consume_settled && *host.shadow_control_ptr &&
            s_acked_gen == s_published_gen &&
            !((*host.shadow_control_ptr)->ui_flags & SHADOW_UI_FLAG_SET_CHANGED)) {
            (*host.shadow_control_ptr)->set_doc_gen = s_consume_gen;
            /* The public active_set response must name the same generation
             * as the settled model, even for boot/reload of the same UUID.
             * No UI switch is pending; carry its acknowledgement forward. */
            s_published_gen = s_consume_gen;
            s_acked_gen = s_consume_gen;
        }
        return;
    }
    s_published_gen = s_consume_gen;

    /* Update in-memory state */
    snprintf(sampler_current_set_name, sizeof(sampler_current_set_name), "%s", set_name);
    if (uuid) {
        snprintf(sampler_current_set_uuid, sizeof(sampler_current_set_uuid), "%s", uuid);
    }

    /* Signal shadow UI to handle ALL file I/O (active_set.txt, config,
     * tempo read, etc.) — zero file ops on the audio thread. */
    if (*host.shadow_control_ptr) {
        /* DISARM an armed scene snapshot first. The UI is about to restore
         * the incoming set -- slot volumes and pans, Master FX params and LFOs,
         * send levels -- and armed, each of those writes is taken as a LOCK in
         * the OUTGOING bank (which the bank load then discards), so the new set
         * would play at the old set's levels. Here, at detection, as an
         * invariant: no write made after the set changed -- by the UI's
         * handler or by any other client -- can be taken as a lock. */
        (*host.shadow_control_ptr)->scene_edit = SCENE_NONE;
        (*host.shadow_control_ptr)->scene_unlock = 0;
        (*host.shadow_control_ptr)->ui_flags |= SHADOW_UI_FLAG_SET_CHANGED;
        /* A set loaded from Set Overview has LEFT it, and what Move announces
         * on the load is the set's name, not a view -- so a label of Set
         * Overview is now stale. Unknown is the honest answer until the next
         * view announcement or Track press (move_ui_mode_label.h). */
        if ((*host.shadow_control_ptr)->move_ui_mode == 3)
            (*host.shadow_control_ptr)->move_ui_mode = 0;
    }
}

static int model_active=1,model_misaligned;
static unsigned model_gen=1;
static int move_model_sync_active(void) {return model_active;}
static int move_model_sync_misaligned(void) {return model_misaligned;}
static unsigned move_model_sync_gen(void) {return model_gen;}
static int same_slot_can_skip(int song_index,int sampler_last_song_index,int sampler_pending_song_index) {
    return (song_index == sampler_last_song_index &&
        song_index != sampler_pending_song_index &&
        !move_model_sync_misaligned() &&
        (!move_model_sync_active() || s_published_gen == move_model_sync_gen()));
}
int main(void) {
 assert(!same_slot_can_skip(26,26,-1)); // boot public gen 0 / model gen 1
 s_published_gen=1;assert(same_slot_can_skip(26,26,-1));
 model_misaligned=1;assert(!same_slot_can_skip(26,26,-1));model_misaligned=0;
 assert(!same_slot_can_skip(25,26,-1));
 model_active=0;s_published_gen=0;assert(same_slot_can_skip(26,26,-1));model_active=1;

 strcpy(sampler_current_set_name,"Set 26");strcpy(sampler_current_set_uuid,"uuid");
 s_consume_gen=1;s_consume_settled=1;control.set_doc_gen=1;
 shadow_handle_set_loaded("Set 26","uuid");
 assert(s_published_gen==1 && s_acked_gen==1 && control.set_doc_gen==1);
 // Repeated same-set reloads carry the public reply forward too.
 s_consume_gen=2;shadow_handle_set_loaded("Set 26","uuid");
 assert(s_published_gen==2 && s_acked_gen==2 && control.set_doc_gen==2);
 // An unsettled, unacknowledged, or pending UI switch must stay blocked.
 s_consume_gen=3;s_consume_settled=0;shadow_handle_set_loaded("Set 26","uuid");assert(s_published_gen==2);
 s_consume_settled=1;s_acked_gen=1;shadow_handle_set_loaded("Set 26","uuid");assert(s_published_gen==2);
 s_acked_gen=2;control.ui_flags=1;shadow_handle_set_loaded("Set 26","uuid");assert(s_published_gen==2);
 control.ui_flags=0;shadow_handle_set_loaded("Other set","other");
 assert(s_published_gen==3 && s_acked_gen==2 && control.ui_flags==1);
 puts("Proposed Schwung startup patch: same-set generation refresh and pending-switch protections passed");
}
