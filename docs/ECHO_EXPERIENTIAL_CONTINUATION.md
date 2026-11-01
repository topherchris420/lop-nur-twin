# ECHO's next chapter: experiential habits, same individual

**Status: implementation candidate, NOT DEPLOYED.** This change targets
the original ECHO organism, not an experimental replacement, but it stays on
a review branch until the original's verified backup can be rehearsed on the
exact release that produced it. No authoritative VM, store, or controller has
been changed by this pull request.

## The behavioral change

ECHO's current organism controller keeps control of feeding, takeoff, flight,
landing, escape, protective rest, odour navigation, and its mushroom-body
learning. The additive `ExperientialHabits` component runs only after that
controller has already issued a **walk** command. It observes ECHO's subsequent
**own movement** in two local wind contexts and compares two conservative
walking speeds (85% and 100% of the already-issued walk command).

The evidence is actual within-simulator displacement and reserve consumption,
not a programmed reward, a neural projection, or a fabricated memory. After
minimum exposure to both speeds, the measured utility informs subsequent
walking-pace choices, with occasional checks for changed circumstances. It can
never increase the old walk speed, change movement modes, bypass the body gate,
alter an escape command, or intervene near a looming threat, food or an edge.
The choice, counts and evidence live in `HabitState` and are checkpointed.

This is intentionally **bounded, modest adaptive behavior**. It demonstrates
one new experience-dependent individual habit, not open-ended intelligence,
neural fidelity, emergence or consciousness. It is completely separate from
the BANC research sidecar and `circuit-informed/v2`.

## What must survive

The continuation `bethesda-echo-habit-continuation/v1` is only valid from an
existing `bethesda-echo-organism/v1` checkpoint. At the same simulated tick
it adds exactly **one** `habits` object. Its reversible projection must
regenerate the prior organism's full graph digest _byte for byte_, including:

- the original birth, individual ID, genesis, city, body and experience archive;
- the ECHO self-model, episodes, beliefs and open inquiries;
- learned mushroom-body weights and navigation memories;
- physiological reserve and state, odour filters and all random-stream positions;
- the original controller's untouched decision logic and safety gate.

Each continuation has its parent's exact digest, state hash, and graph hash,
and records the actual wall-clock pause. Repeating the migration, starting a
new-born habit organism, presenting a stale head, or reverting the original
life into the earlier version is refused.

## Validation before production

**Do not run production `--commit` from an unverified checkout.**

1. Confirm the running ECHO individual ID via the public read-only observer,
   identify its **actual running release commit** on its Oracle VM, and create a
   fresh, restored and validated backup of the entire store. Preserve the
   earlier release for historical replay. Also verify sufficient RAM and disk
   for the complete checkpoint graph.
2. On an **isolated copy** of the store and a copy of the installed release,
   run the existing check, then the read-only new check:

   ```bash
   node scripts/run-ts.mjs scripts/bethesda-life-continue-habits.ts \
     --store /safe/rehearsal-copy/store \
     --from-release /safe/rehearsal-copy/old-release --check
   ```

   The script loads that old release's **own** code to restore its checkpoint,
   executes 600 unmodified organism ticks on both old and candidate engines,
   and refuses if their hashes differ. It creates the proposed new checkpoint
   only in memory, verifies exact graph projection, then compares a further
   611 ticks across checkpoint/restored copies of the upgraded organism.
   `--check` writes nothing to the store.

3. On another **disposable copy**, rehearse a one-time commit, full chain
   verification, stop/resume, and a simulated failed migration with no state
   change. Check that the original's ID, age, memories and append-only history
   are unchanged. Ensure the extra habit state can be reloaded.
4. Only after explicit inspection of those results should the production
   service be stopped gracefully and its final checkpoint verified. A
   production `--commit` additionally requires the exact original ECHO ID and
   `ECHO_HABITS_APPROVE_INDIVIDUAL` set to that ID; the store still enforces
   its single-writer lease and exact parent on commit. Run it against that
   stopped release and then resume the new checked release. The pause is an
   honestly recorded gap, not simulated life.
5. Observe the _same_ ID afterwards, test that the clock advances, new habit
   evidence starts accumulating only after continuation, and inspect failures,
   motor commands and energy consumption. Keep both release engines available.

The code is deliberately **not wired to run automatically** in CI, an ordinary
website deployment, or the observer. No GitHub merge equals a production
migration. Preserving memory is a requirement to test against the original
backup, not a claim that its VM has been updated.

## Eva is separate

Eva's authoritative Python `server.py` / `learning.py`, persistence
protocol and backup restore are not in this repository. Do not attempt to
rename, recreate, resync, or substitute the live garden individual. Before
changing her behavior, independently verify an exact memory-preserving backup,
her current runtime extension hooks and her service's actual source. The
principle is identical, but ECHO's TypeScript continuation cannot be used as
her migration script.

## Next research gate

Measure whether individual choices actually change on novel conditions and
compare to an unchanged continuation on disposable branches of the same
archived state. A real outcome requires better held-out learning and retention,
not more counters or a longer controller file.
