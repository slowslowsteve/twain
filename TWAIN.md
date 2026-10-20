# Twain 0.2.0 prototype

Twain is a separate overtake module on `twain-prototype`. Mark's module,
UI, catalog release and build remain separate. Twain uses the hardware input
and occupies none of Move's four native sound-generator track slots.

## Make music

The first two pad columns are scenes A and B. Each contains four clips from
top to bottom. The other six columns are deliberately dark.

- Tap a recorded clip to request play/stop on the next bar. Tap again before
  the boundary to cancel. Empty clip taps do nothing; taps never overdub.
- Hold Record and press a clip to arm recording. It starts at that scene's
  next cycle start and captures its selected length (up to 60 seconds).
  Recording an existing clip replaces it when the queued recording starts.
  A queued inactive-scene recording waits until that scene is launched.
- Hold Delete and press a clip to clear it immediately, including queued actions.
- Hold a clip and turn Volume to adjust that clip's level (0–200%). Release
  the pad without launching/stopping it. Volume alone remains Move's master.
- Hold a clip and turn knobs 1–7 for its HP filter, LP filter, hard compression,
  saturation, chorus, reverb and tempo-synced eighth-note delay. Zero bypasses
  an effect; amounts are independent per clip and effects can run together.
  Knob 8 and unheld FX knobs do nothing. Saturation uses RMS output compensation
  with no makeup boost; it is not a guarantee of equal perceived loudness for
  every signal. Reverb/delay in this prototype are per-clip wet amounts.
- Hold Loop and press bottom step 1–16 to choose that many bars. Left/right
  (or an A/B clip column) chooses which scene's length to edit. Release Loop
  to return to playback progress. A and B have independent lengths.
- Left/right in performance requests scene A/B. Repeating a queued request
  leaves it queued; choosing the active scene cancels it. Volume and FX never
  request scene changes. Clip pads address their scene without launching it.

The current scene finishes its full cycle before switching; the destination
starts from bar 1 with clip playheads at the beginning. Short clips repeat
within the scene. MIDI clock uses 96 ticks/bar and changes at the render block
receiving the boundary. Without clock, the host tempo drives sample-accurate
bar boundaries. Stop pauses transport; Start/Continue restart at bar 1.

## Visible controls

Empty A clips are blue; B clips purple. Recording is red, playing green,
stopped amber. Queued recording blinks red, queued start green and queued stop
amber. Only the queued scene pulses. Held clips turn white for volume/FX edits.
The screen shows clip/effect/value while editing, scene lengths A/B and the
current Bar 1/16, 2/16, etc. The bottom steps travel within a one-bar scene,
or mark the current bar for longer scenes. Loop glows dimly when available,
bright while held; Record and Delete show their modifier state. A periodic
LED refresh repairs a surface overwritten by native Move feedback.

Volume gestures require Schwung's `shadow_set_overtake_suppress_master_volume`
binding. If unavailable, Twain displays "Host: no clip Volume" and refuses
the clip-volume edit; master volume is never reinjected or doubled. The bridge
is described in Schwung's official `src/shadow/shadow_ui.c` bindings. Hardware
verification is still required for Volume ownership and LED reliability.

## Current limits

Two scenes, four independent stereo clips each, 60 seconds/clip at 44.1 kHz.
Initialization fails rather than shortening storage. Buffers allocate at
creation; the render path performs no allocation or file I/O. FX memory adds
roughly 7 MB to the approximately 106 MB loop/undo storage budget. Four active
clips with all seven effects still need CPU and listening checks on Move.

Audio and Twain scene-length/FX settings currently live in memory and are lost
on restart. Inherited Mark session endpoints are not exposed as a Twain save
workflow; do not rely on them to persist this new clip/FX state. There is no
crossfade or time stretch. Longer, slower scenes can exceed 60 seconds: a clip
recording then stops at the capacity limit. Direct resume via Shift+hold step
13 depends on Schwung's host shortcut handling; this package doesn't modify it.

## Build and install

- `make test`: Mark regressions, Twain transport/clip/audio-FX and gesture tests.
- `make twain`: native-host DSP and staged UI/manifest, not a Move binary.
- `make twain-sanitize`: Twain simulator under ASan and UBSan.
- `make twain-arm`: Docker ARM build, separate `build/twain-module.tar.gz`.

Every push to `twain-prototype` runs **Twain test package** in GitHub Actions.
Download **Twain-Move-test-package** from a successful run and unzip the download
to obtain `twain-module.tar.gz`; keep that tar.gz intact. In Schwung Manager
at `http://move.local:7700`, choose **Install Custom Module** and upload it.
Restart Move when the manager requests it; restart discards unsaved Twain audio.
Launch Twain via Tools or the overtake menu. No build step deploys to Move.
