# Twain prototype

Separate `twain` overtake module on `twain-prototype`. Mark retains its
module identity, UI, sessions, build and release metadata. Twain reuses the
engine implementation, compiled with four layers and mandatory full capacity.
It uses the hardware audio input and does not occupy any of Move's four native
sound-generator track slots. Native audio routing and coexistence still need
hardware verification; no hardware deployment has been performed.

Two scenes, A and B, each retain four independent stereo loops with 60 seconds
per layer at 44.1 kHz. Initialization fails rather than shortening capacity.
Loop and undo storage alone uses about 106 MB, plus FX and engine overhead.
Each scene has an explicit length of 1–16 bars (default 1), independent of
its four layer lengths. A scene repeats its assigned cycle; shorter layers
repeat within it. At each scene-cycle boundary, playing layer positions reset
to zero and open record/overdub gestures finish. A recording still has a hard
60-second capacity even if a slow, long scene takes longer than 60 seconds.

Scene requests wait until the current scene finishes its full assigned cycle.
The destination starts at bar 1 with its layers at the beginning. Selecting the
active scene cancels a queued request. This scene quantization is always on,
independently of layer quantization. With running MIDI clock, a bar is 96 ticks
and the switch takes effect in the render block receiving the final tick.
Without MIDI clock, the host tempo (or tempo override) drives a continuous scene
phase and the render block splits at the exact scene-end sample. Phase belongs
to the scene transport, not to whichever layer is playing. It continues through
empty scenes. MIDI Stop pauses this transport; Start/Continue restart the
current scene at bar 1, retaining any queued destination.

Undo/redo follows the last recording gesture within each scene, as in Mark.

Click Loop to open the scene-length view. Press a bottom step button 1–16 to
set that many bars; the step LEDs show the length. Left/right arrows (or the
left/right pad halves) choose A/B for length editing without launching it.
Click Loop again to return to performance. Loop's CC 58 and the step-note map
follow [Schwung's shared constants](https://github.com/charlesvestal/schwung/blob/main/src/shared/constants.mjs).

In performance view, the left four pad columns address A and the right four
address B. Rows from the top: record/play/overdub, stop, scene undo/redo, clear
layer. Left/right arrows request A/B without changing a layer. Knobs 1–4 change
A's levels; 5–8 change B's levels and request that scene. Layer edits explicitly
address their A/B scene while a switch is pending. The screen shows scene length
and queued destination. Monitor defaults off; Play passes through to Move.
Twain's UI does not modify native track settings.

Sessions use separate A/B directories under `twain-sessions`; this prototype
UI exposes loop performance controls, not session management or a browser mixer.
Scene lengths currently live in memory; the inherited per-scene session files
do not yet persist these Twain transport settings.

- `make test`: Mark regression suite and Twain scene/layer and UI checks.
- `make twain`: native host DSP and staged Twain UI/manifest (not an ARM build).
- `make twain-sanitize`: Twain simulator with AddressSanitizer and UBSan.
- `make twain-arm`: Docker ARM build and separate `build/twain-module.tar.gz`.

No deployment step is included in Twain's build. Docker must be installed to
produce the ARM package. Mark's catalog release file remains unchanged.

## Download a test build from GitHub

Every push to `twain-prototype` runs **Twain test package** in GitHub Actions.
It tests the code, checks Twain with sanitizers, then builds and validates the
ARM module on GitHub's computer. Docker is not needed on your own computer.

Open the repository's Actions tab, select **Twain test package**, then open
the newest successful run. Under Artifacts, download **Twain-Move-test-package**.
Unzip that download to obtain **twain-module.tar.gz**; leave the tar.gz intact.
When ready to install on Move, open Schwung Manager at `http://move.local:7700`,
choose **Install Custom Module**, and upload that tar.gz file. Rescan modules
if needed and launch **Twain** from the overtake menu. Fully exit an already
running Twain before relaunching so the new code loads.

These are prototype builds, not Mark releases. Publishing a GitHub build does
not install anything on your Move. Scene lengths currently reset on reload.
