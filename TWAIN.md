# Twain 0.8.0 prototype

Twain is a separate overtake module on `twain-prototype`. Mark's module,
UI, catalog release and build remain separate. Twain uses the hardware input
and occupies none of Move's four native sound-generator track slots. It does
not modify Schwung or its shortcuts.

## Make music

The first four pad columns are scenes A, B, C and D. Each contains eight clips,
shown four at a time from top to bottom; the other four columns are dark.
Use − for layers 5–8 and + for layers 1–4. Both banks play together; changing
the bank changes only which clips are visible. Only the active scene
advances. Each clip retains independent audio and settings, with 60 seconds
of stereo capacity at 44.1 kHz.

- Tap recorded clips to queue play/stop at the next bar. Several overlapping
  pad presses register independently and launch together at the boundary if
  released before it. A second tap cancels a pending action. Empty taps do
  nothing; taps never overdub.
- Hold Record and press clips to queue replacement recording at their scene's
  next cycle start. Captures use that scene's length, up to 60 seconds. A queued
  inactive-scene recording waits until its scene is launched.
- From stop, arm clips with Record+pad, then press Play. Twain waits one bar
  with a visible 4–3–2–1 and four short clicks before capturing a full take.
  Monitoring remains available. Count-in clicks are not mixed into recordings.
  This is Twain’s fixed count-in; Move’s project count-in setting is not read.
  Starting ordinary playback without armed recordings has no extra count-in.
  Native tracks follow Move’s own transport and are not held for Twain’s count-in.
- While playing, Shift+Play queues a jump to the start of the last scene bar at
  the next bar boundary. Existing clips seek to that position and keep playing.
  The remaining final bar leads into any recording armed for the next cycle;
  takes still last the full scene length. Another press cancels a queued jump.
  One-bar scenes/already-last-bar requests do nothing. Active takes block jumps.
  This shortcut changes only Twain’s playheads, not native track positions.
- Hold Delete and press a clip to clear audio while keeping its settings.
  If already empty, Delete+pad resets volume, FX, delay rate and mute. Another
  delete on a default empty clip does nothing. Both stages are undoable.
- Hold a clip and turn Volume for its level (0–200%). New clips start at 50%
  on the original gain curve; existing saved levels are kept. With several pads held,
  knob edits address the last pressed clip; other unused pads retain their taps.
- Volume alone always controls Move's master. Shift+Volume controls Twain's
  master (0–200%) using the existing host volume-ownership binding. This needs
  no Schwung patch. Release Shift to return Volume to Move's master. The
  existing Shift+Volume+jog-click host exit shortcut remains available.
- Mute alone toggles Twain master mute on release. Mute+clip toggles only that
  clip's mute; either press order works, and a multi-clip mute chord works too.
  Neither mute stops transport, changes clip volume, or launches clips.
- Tap a clip to select it and queue play/stop. Shift+pad selects without
  changing playback. Knobs stay assigned to this selection after release.
  Holding a different pad and turning a knob selects and edits without launching.
- Turn knobs 1–7 for HP filter, LP filter, compression,
  Drive, chorus, reverb and delay. Knob 8 chooses a quantized delay rate.
  Touch a knob to see the selected clip’s
  value; two separate touches within 600 ms reset it. Turns cancel the tap
  sequence. Main effect amounts reset to zero, clip volume to 50%, delay rate to 1/8;
  Shift parameters reset to their musical defaults. Low-velocity touch notes
  are accepted, including fast double taps with the pad released.
- Hold Loop and hold two bottom steps to select inclusive start/end bars
  (hold 3, press 5 for bars 3–5). A single step still selects bars 1–N. While Loop is
  held, a clip column selects the scene to edit, or use Left/Right. Release
  Loop to return to normal performance. All four scene lengths are independent.
- Left/Right in performance moves the requested scene through A–D. Further
  presses move the queued destination; returning to the active scene cancels
  the switch. Stops at A/D rather than wrapping. Clip taps do not switch scenes.

The current scene finishes its full cycle before switching; the destination
starts from bar 1 with clip playheads reset. Short clips repeat within a scene.
MIDI clock uses 96 ticks/bar; without it, host tempo drives sample-accurate
boundaries. Stop pauses transport; Start/Continue restart at bar 1.

## Screen and pads

The top shows the active scene and Bar 3/8, followed by the project name and visible layer bank.
The middle shows recording, queued recording/scene, or the parameter being
adjusted. Twain master volume or a persistent TWN MUTED indicator appears
above a bottom progress strip. Each outlined segment is one bar, filling
through that bar's beats; even a one-bar scene has visible beat progress.
There are no permanent instruction rows. Bottom hardware steps still follow
the bar/beat and select length while Loop is held.

Empty pads are dim neutral; empty clips with retained settings have a subtle
scene tint. Recording is red, playing green, stopped amber, and muted clips
use dim, saturated purple with a slow pulse between the two dark purple palette
shades, including when selected. Queued actions blink; the queued scene pulses. Held pads turn
white; the selected clip stays white and its state appears on screen. Loop, Record, Delete, Undo and Mute indicate their availability/state.
Ordinary Play is forwarded once through the installed host’s
`move_midi_inject_to_move` binding; the manifest no longer passes Play through
directly, so Shift+Play cannot also stop Move. Twain drives its Play LED.
A periodic LED refresh repairs native feedback overwrites. Parked Twain skips
screen work and releases stale held-pad/volume gestures.

Volume gestures require `shadow_set_overtake_suppress_master_volume`, present
in the inspected installed host. Without it, Twain reports that the volume
edit is unavailable. Physical Volume ownership, pad chords, the new screen
and LED reliability still require a hardware pass.

## Input and recording character

Shift+Record toggles monitoring, off by default and reset off on project load.
The input meter remains visible beside Twain’s volume, including while stopped.
MON means audible monitoring; X means monitoring is requested but blocked.
A ! holds briefly when the incoming signal clips. Use headphones for the mic.
The guard requires the installed speaker/line-input host bindings; it blocks
mic monitoring through the speaker, and permits line input or headphones.
It keeps checking while Twain is parked. Safety changes and monitor toggles use
the host’s acknowledged parameter path; failed safety writes retry and a
periodic refresh repairs lost state after reconnecting. Monitor audio follows Twain master
volume/mute and is not a second recording path.

Hold Record and turn Volume for digital recording-input trim (0–400%).
Hold Shift+Record and turn Volume for monitor level (0–200%). These gestures
claim Volume only while held; Volume alone remains Move’s master. Tapping
Shift+Record without turning Volume toggles monitoring on release. The levels
save with the project and are undoable. Monitor level never changes recorded
samples. Input trim affects both capture and monitoring, and the meter warns
about source clipping or clipping introduced by digital gain. It cannot repair
clipping in the physical mic preamp; no preamp-gain host API was found.

Every new take has a fixed subtle preamp character: light rounding and softened
highs, baked in once before capture. There is no clean/warm switch or flutter.
Existing recordings are unchanged and loading never reapplies the colour.

## Effects and undo

The main knobs and Shift layer are always assigned to the selected clip:

| Knob | Normal turn | Shift + turn |
|---|---|---|
| 1 | HP cutoff (bypass at zero) | HP resonance |
| 2 | LP cutoff (bypass at zero) | LP resonance |
| 3 | Compression amount + automatic makeup | Release, 25 ms–1.2 s |
| 4 | Drive wet amount | Dirt / drive intensity |
| 5 | Chorus wet amount | Rate, 0.05–8.05 Hz |
| 6 | Reverb send | Decay, 0.2–20 seconds |
| 7 | Delay send | Feedback, 0–99.5% |
| 8 | Quantized delay time | Delay wow/flutter |

HP and LP are nonlinear, twice-oversampled two-pole (12 dB/octave) filters inspired by the
requested MS-20 character; they are not a circuit-exact MS-20 emulation.
Drive keeps four-times interpolated soft clipping, DC removal and RMS
compensation. Dirt is independent of wet amount. Compression retains its
12:1 curve and up to 18 dB makeup; a fixed 0.3 ms attack catches peaks and Shift controls release (25 ms–1.2 s).
Reverb uses eight damped combs and four allpass diffusers per channel.
Delay feedback is independent of send and stays below unity, with damping
and gentle limiting inside the feedback loop. Wow/flutter modulates only
the delay repeats. Quantized rate changes still crossfade over 20 ms.
Sound quality and CPU with eight effected clips need listening on Move.

Knob 8 rates, shortest to longest counterclockwise:
1/64, 1/32T, 1/32, 1/16T, 1/16, 1/8T, 1/8 (default), 1/4T, 1/4,
1/2T, 1/2, 1/1. T means triplet (1/8T is 1/12 of a bar). Rate changes
crossfade over 20 ms. The delay buffer supports a full bar down to 20 BPM.

Undo reverses five edits across all four scenes: audio replacement/deletion,
settings reset, volume/FX edits, mutes, master controls and scene lengths.
A held-pad editing gesture is one step; unheld knob edits group until 600 ms idle; Shift-held master-volume turns are
one step too. Playback/scene/jump requests do not fill history. Shift+Undo redoes up to five
undone edits. A new edit clears the redo branch. Undo and redo exchange the
same five spare buffers; redo does not reserve more audio memory.
Undo restores audio and control values, not FX tail memory. Five preallocated
60-second spare buffers swap ownership instead of copying audio on render.

## Move projects: automatic load, manual Save

Twain now selects a save by Move's persistent project UUID, using the installed
host's live model generation before and after the `active_set` query. It does
not use pad position, project-name guesses or active_set.txt as a save target.
Project-ID handoffs and save/load/new requests use acknowledged host writes.
Retry resends the live ID, and completion requires the engine request serial
to advance; a dropped write cannot reuse an old operation result.
A missing, pending, unaligned or stale identity blocks edits and loads instead
of associating recordings with the wrong set. This live API integration still
requires an on-Move pass; the read-only hardware tests confirmed disk IDs for
Set 23, a new Set 24 and its copy, not the execution of the in-module gate.

- On opening a known project, its Twain save loads automatically.
- On a project with no Twain save, Twain starts empty automatically. Outgoing
  audio is held silent whenever the live identity is unknown or differs from
  the loaded workspace, including while parked in the background. Old data
  remains intact until loading/creating the new workspace succeeds.
- **Shift + press the main jog knob** opens the copy/source menu when needed.
  Turn the jog to choose a save and press to select; confirm copying. Dirty
  current work gets Save/Discard/Cancel protection before opening that menu.
  Copies are independent and do not overwrite their source.
- **Press the main jog knob to Save.** An ASCII star `*` at the top right
  indicates unsaved changes. A completed save clears it; failed saves keep
  the workspace dirty. Newly started empty projects and copied projects also
  need their first save. Turning/clicking the jog chooses dialog options.
- A native project switch with unsaved Twain edits offers **Save then switch**,
  **Discard and switch**, or **Cancel**. Cancel keeps the old Twain workspace;
  it cannot undo the native Move switch. Reopen that Move project or click
  the jog again to revisit switching. A choice from an obsolete project's
  dialog is not applied to a newly opened project.
- All four scenes, 32 clips' raw stereo audio, main and Shift FX parameters, delay rates,
  clip volume/mute, scene ranges, recording origins, input/monitor levels, selected scene and master volume/mute save
  together. Playback reloads stopped at bar 1; FX tails, undo/redo history and transport/count-in state are
  not saved. Press native Play and launch clips to continue.
- Save waits for completed recordings: if a take is still armed/recording,
  the screen asks to finish it first and offers Retry save. During file work,
  editing is locked while playback can continue. Save failure and load failure
  do not clear clips. A load whose target ID/generation changed is discarded.
- An untouched new Move project has no persistent ID. Make/save a native
  sketch first (as in the Set 24 test); Twain will wait rather than guess.

Files are separate from exported `.ablbundle` files, at
`/data/UserData/schwung/twain-projects/<UUID>.twp`. Deleting a native project
leaves its Twain save recoverable as a copy source. Nothing auto-deletes saves.
Twain master volume is shown only in its persistent row, without a second
transient volume overlay. The source list shows up to 64 saved workspaces. An exported/imported Move
bundle does NOT currently carry Twain audio; keep these files when backing up.
No Schwung files or shortcuts are modified.

The worker writes a versioned, capacity/range-checked, little-endian format
with CRC32 over metadata and PCM, then fsyncs the temporary file and atomically
renames it before syncing the directory. The previous file remains in place
until rename; a directory-sync error is reported even if rename succeeded.
Loading stages only saved PCM and metadata, checks the complete CRC, then
copies it into existing full-capacity buffers on the worker under an exclusive
engine handoff. Dirty work remains intact on any parse/CRC/allocation/read
failure. Generation checks reject a changed target before committing the staged
project.

No file I/O, buffer copying or allocation occurs on render. A persistent worker
is created with Twain. Saves borrow stable audio buffers while mutation is
locked; loads temporarily reserve only actual saved PCM, above the approximately
561 MiB normal audio/FX/undo budget. Empty project creation needs no duplicate
audio bank. Allocation fails safely rather than reducing 60-second capacity.
Version-1 four- and eight-layer saves load with their original audio and
levels intact, default Shift FX settings and start bar 1. Version-2 saves
include ranges, per-clip recording origins, Shift FX and input/monitor levels;
older Twain versions cannot open those new saves. Save before upgrading
and keep backups of important .twp files. Empty calloc pages need not occupy
physical RAM until touched; the full reserved budget is still higher. Four native generators
remain available. Sound, CPU/disk timing and real power-cycle recovery still
need hardware verification. No time stretch or scene crossfade.

## Build and install

- `make test`: Mark regressions, Twain engine and UI gesture tests.
- `make twain-sanitize`: Twain simulator under ASan/UBSan.
- `make twain`: native-host build, not a Move binary.
- `make twain-arm`: separate ARM64 `build/twain-module.tar.gz`.

Pushes to `twain-prototype` run **Twain test package** on GitHub. Download
**Twain-Move-test-package**, unzip it and keep `twain-module.tar.gz` intact.
In Schwung Manager at http://move.local:7700 choose **Install Custom Module**
and upload that tar.gz. Save Twain before a later restart; only completed Twain saves survive.
When first upgrading from 0.4, existing RAM-only recordings cannot be migrated
by this package and will be lost on restart.
Launch through the existing Tools/overtake menu. Builds never deploy to Move.

## 0.9.0: sound and unused-save cleanup

Shift + compressor knob controls **Release**, with a fixed 0.3 ms attack.
The stored secondary percentage remains in the same file slot; existing attack
percentages become release percentages. `comp_attack` remains a protocol alias
for old controllers, but now means release. Older Twain versions interpret that
slot as attack; downgrading changes its meaning.

HP/LP resonance now reaches bounded self-oscillation. LP passband gain is not
reduced as resonance rises; HP still removes bass below cutoff by design.
These are MS-20-inspired nonlinear filters, not a circuit-exact MS-20 model.
Drive uses smoother rounded clipping and controlled RMS level, from warmth to
strong distortion. Reverb diffuses the initial attack before its longer,
irregular resonators, with a stronger room return. Musical quality and maximum
FX CPU load still need listening/performance checks on Move.

**Shift + main jog → Clean up unused saves** scans without deleting anything.
Scroll through names and total size, select **Review deletion**, then explicitly
choose **Delete these saves** (the default is **Keep saves**). At most 64 saves
are included per batch. The current workspace and current Move project are
excluded. Existing native UUID folders protect their saves, even if incomplete.
An unavailable/empty native inventory blocks cleanup. Deleted/changed files or
returning native projects invalidate the deletion preview; rescan before trying
again. No save is removed automatically. Cleanup does not touch native projects
or unsaved clips, and does not create a trash backup of confirmed deletions.

The startup generation fix is a **separate proposed Schwung host patch** under
`patches/schwung/`. It is not bundled in the Twain module and has not been
installed on hardware. Twain retains its identity gate and displays **Reopen
Move project** for the observed boot generation-zero mismatch. Until the host
patch is integrated/tested, switch to another Move project and back to refresh.
