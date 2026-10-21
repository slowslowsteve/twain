# Twain Export — laptop prototype

This runs on the laptop, not on Move. It reads the last saved native Move Set
through Move Manager's own authenticated download API, reads its UUID-matched
Twain `.twp` over the existing SSH connection, and renders offline with the
unchanged `src/twain_fx.h` implementation from Twain 0.9.0/0.9.1.

Build on this Mac with `scripts/build-twain-export.sh`, unzip
`build/Twain-Export-Mac.zip`, and double-click **Open Twain Export.command**.
Keep the Terminal window open while using the page. Choose **Show pairing code
on Move**, enter the code directly in the page, select a project, then prepare
and download the ZIP. Pairing cookies remain only in the local server's memory.
The page listens on 127.0.0.1 only and is not a remotely hosted service.

Requires macOS with Python 3 and the existing key-based SSH access to Move.
It uses the existing SSH host-key configuration without changing it.
The prebuilt renderer is for the Mac architecture used to build it. The current
package is Apple Silicon; it is not a universal/signed/notarized Mac app.
An alternate file-upload route accepts a downloaded `.ablbundle` and saved
`.twp` without connecting to Move. Select a matching pair: offline files lack
an authoritative common project UUID, so their identity cannot be checked.

Save BOTH Move and Twain first. The download contains the original native Set
bundle and Twain save unchanged, rendered stereo 32-bit float scene loops,
separate 20-second FX tails, a settings/timing manifest, and optional original
16-bit dry recordings. It does not create a Live `.als`, arrange audio tracks,
or put Twain inside the native `.ablbundle`. The user imports the WAVs into
Live alongside the native Set. Native Move export contents remain unchanged.

Each non-empty clip renders for its selected scene range at the native Set's
saved tempo, looping the captured PCM with its saved origin offset. Muted clips
are included audibly; clip volume is printed, master volume/mute is not. Audio
FX tail memory starts clear. Tails are limited to 20 seconds with a 100 ms final
fade, including self-oscillation and near-unity repeats. Raw originals preserve
full recorded length without repeating or applying clip playback FX/faders;
recording gain and baked input warmth cannot be undone. 4/4 only in this build.

Exports and pairing state are temporary until the local server exits. Download
ZIPs before closing its Terminal window. No project/audio/module files are
written or deleted on Move. No SSH command is built from project names; only
validated UUIDs are accepted. The server proxies only fixed Move Manager
pairing/list/download endpoints. Pairing and downloads use Move Manager's normal
HTTP Wi-Fi connection; keep the normal trusted-local-network assumptions.

Tests: `python3 -B test/twain_export.py` after building the renderer. The HTTP
fixture needs permission to bind a loopback port. `make test` and sanitizers
cover Twain DSP and project/UI changes separately. Wi-Fi pairing and desktop
Live import remain hardware/application checks until explicitly exercised.
