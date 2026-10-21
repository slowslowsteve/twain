# Next refinements

User feedback, 2026-10-21. Implemented in Twain 0.9.0 unless noted;
no hardware changes.

- Startup: fix the permanent “Waiting for Move” condition without weakening
  project identity checks. Observed host model generations [1,1,1] while the
  active_set response named the current UUID with generation 0. Switching
  away to another native project and back refreshed it and unblocked Twain.
  Resetting the in-memory workspace alone cannot repair that host mismatch.
  Preserve saved projects and unsaved-switch protection; do not alter Schwung
  without revisiting the user's constraint.
- Input controls: keep recording gain and monitoring level accessible from
  Twain. Already implemented as Record + Volume and Shift + Record + Volume;
  confirm usability on hardware before adding or replacing controls.
- Reverb: improve the sound; current result is unsatisfactory.
- Drive: musical progression from subtle warmth to pronounced drive, avoiding
  the unpleasant saturation character. Keep loudness controlled.
- Compressor: fixed very short attack; replace Shift/secondary attack control
  with a more musically useful parameter. Release selected and implemented (25 ms–1.2 s).

Persistence facts: unsaved recording PCM and undo history live in RAM; ordinary
recording does not create audio files. Saving replaces the project's UUID-keyed
.twp file. Old saved states survive discarding later unsaved edits. Saved files
for deleted native Move projects remain recoverable and are not auto-deleted.
Leaving the Twain UI can park its live engine; a complete restart loses RAM
state and should reload the selected project's last successful save.

Startup remains a separate proposed host patch; see patches/schwung/README.md.
