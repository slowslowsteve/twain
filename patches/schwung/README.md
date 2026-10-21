# Proposed startup project-generation correction

Prepared separately from Twain; **not applied to Schwung or Move**. Twain's
module archive does not contain a replacement shim or host binary.

Base: `charlesvestal/schwung`, `src/host/shadow_set_pages.c`, Git blob
`eeff1e5db0b9487310e5ff8f31d5b356e6ddf3a9` (retrieved 2026-10-21).
The patch applies cleanly to that source. Recheck the base before integration.

Observed on Move: `host_move_model_state()` counters represented [1,1,1], but
`active_set` returned the same live UUID with generation 0. The same-set handler
advanced `set_doc_gen` without advancing the published/acknowledged generations.
Once aligned, the worker skipped resampling the unchanged native slot, leaving
Twain's correct identity gate permanently blocked. Switching away/back repaired
it on hardware.

The patch:

- Re-reads the native identity while the public generation lags the live model,
  including when internal counters already appear aligned.
- Carries public generation and acknowledgement forward only after a settled
  same-UUID/name read and with no unacknowledged/pending UI switch.
- Makes the published generation atomic because the worker now reads it too.
- Keeps generation age, settlement, UUID/name, and pending UI safeguards.

`test/schwung_startup_generation.c` compiles the patched handler in an isolated
fixture. It covers boot generation 0, repeated same-set reloads, unsettled reads,
unacknowledged changes, pending UI changes and a genuinely different project.
This is not a full Schwung build or a hardware verification. Before installing:
apply to a matching upstream checkout, run its host tests/build, then verify
cold boot, same-project reopen, rapid project changes, new sets and duplication
with backed-up native/Twain saves. No automatic save deletion is part of it.
