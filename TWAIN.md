# Twain 0.4.0 prototype

Twain is a separate overtake module on `twain-prototype`. Mark's module,
UI, catalog release and build remain separate. Twain uses the hardware input
and occupies none of Move's four native sound-generator track slots. It does
not modify Schwung or its shortcuts.

## Make music

The first four pad columns are scenes A, B, C and D. Each contains four clips
from top to bottom; the other four columns are dark. Only the active scene
advances. Each clip retains independent audio and settings, with 60 seconds
of stereo capacity at 44.1 kHz.

- Tap recorded clips to queue play/stop at the next bar. Several overlapping
  pad presses register independently and launch together at the boundary if
  released before it. A second tap cancels a pending action. Empty taps do
  nothing; taps never overdub.
- Hold Record and press clips to queue replacement recording at their scene's
  next cycle start. Captures use that scene's length, up to 60 seconds. A queued
  inactive-scene recording waits until its scene is launched.
- Hold Delete and press a clip to clear audio while keeping its settings.
  If already empty, Delete+pad resets volume, FX, delay rate and mute. Another
  delete on a default empty clip does nothing. Both stages are undoable.
- Hold a clip and turn Volume for its level (0–200%). With several pads held,
  knob edits address the last pressed clip; other unused pads retain their taps.
- Volume alone always controls Move's master. Shift+Volume controls Twain's
  master (0–200%) using the existing host volume-ownership binding. This needs
  no Schwung patch. Release Shift to return Volume to Move's master. The
  existing Shift+Volume+jog-click host exit shortcut remains available.
- Mute alone toggles Twain master mute on release. Mute+clip toggles only that
  clip's mute; either press order works, and a multi-clip mute chord works too.
  Neither mute stops transport, changes clip volume, or launches clips.
- Hold a clip and turn knobs 1–7 for HP filter, LP filter, compression,
  saturation, chorus, reverb and delay. Knob 8 chooses a quantized delay rate.
  Unheld FX knobs do nothing. Touch a knob while holding a clip to see its
  value; two separate touches within 600 ms reset it. Turns cancel the tap
  sequence. Effects reset to zero, volume to 100%, delay rate to 1/8.
- Hold Loop and press bottom step 1–16 to select scene length. While Loop is
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

The top shows the active scene and Bar 3/8, followed by all four scene lengths.
The middle shows recording, queued recording/scene, or the parameter being
adjusted. Twain master volume or a persistent TWAIN MUTED indicator appears
above a bottom progress strip. Each outlined segment is one bar, filling
through that bar's beats; even a one-bar scene has visible beat progress.
There are no permanent instruction rows. Bottom hardware steps still follow
the bar/beat and select length while Loop is held.

Empty pads are dim neutral; empty clips with retained settings have a subtle
scene tint. Recording is red, playing green, stopped amber, and muted clips
are light grey. Queued actions blink; the queued scene pulses. Held pads turn
white. Loop, Record, Delete, Undo and Mute indicate their availability/state.
A periodic LED refresh repairs native feedback overwrites. Parked Twain skips
screen work and releases stale held-pad/volume gestures.

Volume gestures require `shadow_set_overtake_suppress_master_volume`, present
in the inspected installed host. Without it, Twain reports that the volume
edit is unavailable. Physical Volume ownership, pad chords, the new screen
and LED reliability still require a hardware pass.

## Effects and undo

Reverb uses eight damped parallel combs and four serial allpass diffusers per
channel for a denser tail on percussion. Delay amount increases both send and
feedback, capped at 72%; the feedback loop is damped and all repeats decay.
Compression blends hard-knee 12:1 compression with up to 18 dB automatic makeup.
Saturation has RMS compensation without makeup gain. All effects are per clip;
sound quality and CPU with four fully effected clips need listening on Move.

Knob 8 rates, shortest to longest counterclockwise:
1/64, 1/32T, 1/32, 1/16T, 1/16, 1/8T, 1/8 (default), 1/4T, 1/4,
1/2T, 1/2, 1/1. T means triplet (1/8T is 1/12 of a bar). Rate changes
crossfade over 20 ms. The delay buffer supports a full bar down to 20 BPM.

Undo reverses five edits across all four scenes: audio replacement/deletion,
settings reset, volume/FX edits, mutes, master controls and scene lengths.
A held-pad editing gesture is one step; Shift-held master-volume turns are
one step too. Playback/scene requests do not fill history. There is no redo.
Undo restores audio and control values, not FX tail memory. Five preallocated
60-second spare buffers swap ownership instead of copying audio on render.

## Saving investigation and limits

**Twain does not yet save or restore with Move projects. Restart loses its
recordings, scene lengths, FX, volumes and mutes.** Undo is also RAM-only.
No separate global workspace or manual project/slot workflow was substituted.

The installed Schwung source exposes project identity (`active_set` and model
generations) and host-owned `set_state/<uuid>` handling. Its slot autosave and
shutdown/set-change saves do not include this overtake module's audio.
Twain's inherited Mark session endpoints are not an integrated Twain save
format. A reliable implementation would need worker-side audio snapshots,
atomic whole-project commits/restores, and verified handling of changing,
unsaved and duplicated Move projects. Those have not been established by this
investigation, so automatic project saving is not claimed or enabled. Schwung
has not been patched. The abandoned shortcut-patch preparation script was removed.

All audio, FX and undo storage reserves about 326 MiB (341,741,280 bytes in
the measured native build), excluding host/runtime overhead. Allocation fails
rather than shortening the 60-second capacity. Four native generators remain
available. Only four Twain clips render at once; inactive scenes retain audio.
Render performs no allocation or file I/O. No time stretch or scene crossfade.

## Build and install

- `make test`: Mark regressions, Twain engine and UI gesture tests.
- `make twain-sanitize`: Twain simulator under ASan/UBSan.
- `make twain`: native-host build, not a Move binary.
- `make twain-arm`: separate ARM64 `build/twain-module.tar.gz`.

Pushes to `twain-prototype` run **Twain test package** on GitHub. Download
**Twain-Move-test-package**, unzip it and keep `twain-module.tar.gz` intact.
In Schwung Manager at http://move.local:7700 choose **Install Custom Module**
and upload that tar.gz. Restart when requested; this discards unsaved audio.
Launch through the existing Tools/overtake menu. Builds never deploy to Move.
