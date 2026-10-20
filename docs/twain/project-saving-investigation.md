# Historical feasibility investigation (followed by Twain 0.5.0)

The read-only investigation below preceded implementation. Twain 0.5.0 now
imports the identity gate and includes worker-side saves plus explicit copy
confirmation; see ../../TWAIN.md for current behavior. In-module execution,
disk timing and power-cycle recovery remain hardware checks. No host patch
was made. The recorded disk tests confirmed temporary-to-permanent new-set
identity, repeatable reopening, and distinct copy identity without parentage.

## Evidence collected

- Installed host source exposes `host_move_model_state()` and
  `shadow_get_param(0, "active_set")`. The latter supplies UUID, name and the
  published document generation. Model readiness and generation alignment must
  be checked before and after that read; a UUID alone is insufficient.
- The native disk mapping is `settings/Settings.json`'s `currentSongIndex` plus
  the `user.song-index` extended attribute on `UserLibrary/Sets/<UUID>`. The pad
  index is distinct from the UUID, making identity-based loading promising.
- New unsaved projects can have temporary `__pending-*` identities. The host
  migrates those using document-generation evidence, not pad position alone.
- Duplication detection in the inspected host accepts an explicit
  `set_state/<UUID>/copy_source.txt` when available; its fallback uses the
  project name and Song.abl size. That fallback is heuristic and must not be
  treated as proof of parentage for Twain audio.
- Initial on-device disk snapshot found 27 project folders. The native mapping
  and Schwung's published marker agreed for the current project, "Set 23".
  No explicit copy-source markers were present in that snapshot.

The single baseline does not establish move/copy/new-project/restart behavior
or prove live-model alignment. Those remain hardware tests, not passed checks.
No Twain recordings or metadata were read or modified.

## Diagnostic tools

`python3 scripts/probe-twain-project.py --output build/twain-project-probe/LABEL.json`
runs standard-library Python via SSH stdin. It installs nothing, reads only
project metadata and Song.abl fingerprints, and writes the snapshot only on
the Mac. It does not read audio samples, touch the param mailbox, restart Move,
change settings, or activate modules. `python3 -B` prevents remote bytecode files.

The disk probe checks the current index and published marker again after the
scan. Agreement is only disk evidence; it cannot exclude a same-index document
reload or a transient index that changes and returns between reads.

`src/twain_project_identity.mjs` is a standalone, read-only live-API probe,
not imported by Twain. It refuses missing model support, unaligned/changing
model generations, unversioned or stale active-set responses, and temporary or
invalid UUIDs. Its behavior is tested offline; it has NOT executed inside the
installed Move host. No disk marker fallback is used to authorize saves.

## Hardware sequence, one action per snapshot

Use disposable Move projects. Leave Twain with Back rather than restarting.
Keep project names and actions in a test log alongside each snapshot.

1. Open an existing test project; compare selected identity and published marker.
2. Open a second one, then reopen the first; identities must be distinct and repeatable.
3. Move the first project to a different pad; its UUID should remain unchanged.
4. Duplicate it using Move, open the duplicate and check distinct identity and
   any explicit copy-parent marker. Identical Song.abl hashes/sizes are only
   supporting evidence, not a unique relationship.
5. Create a new project, inspect before/after Move materializes its project
   folder, and verify temporary-to-persistent identity behavior.
6. Only when no unsaved Twain performance is needed, restart manually and
   reopen the same test project; confirm persistent identity.

The operator should report project name/action after each step. Do not delete
or rearrange their existing music for testing. The assistant takes snapshots;
the user need not run commands or install a diagnostic.

## Next decision

A trustworthy live ID would support automatic selection of a Twain save and
manual Save with an unsaved-change star. Still required: worker-side audio
snapshots, an atomic all-scenes save format, safe failed-load behavior, dirty
work protection across project switches, and a verified duplication policy.
If parentage is ambiguous, refuse automatic copying rather than guess. An
explicit "Copy Twain from..." choice may be needed for duplicates if no
reliable origin is exposed; that decision belongs after the hardware test.
