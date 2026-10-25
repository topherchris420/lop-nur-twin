# Digital fly behaviour experiments

Every digital-fly experiment the R.A.I.N. Lab compiled, ran or refused, written by
`npm run rain:fly`. Nothing here is edited by hand: refusals, failures,
inconclusive results and runs the registry would not admit stay beside the
successes, and every file in a record's folder is derived from its record.json.

All results are **simulated observations of the digital fly**, a reduced-order
behavioural controller on FlyBody's anatomy that simulates no neurons, in a
closed arena. They describe that simulator only and are not evidence about
Drosophila.

- **Records** (rain-fly-record/v2) were preregistered before they ran, on
  seeds the host drew afterwards from the registry receipt and a random nonce,
  never on a pilot seed, and decided by an exact one-sided sign test at alpha
  0.05 with at least 6 untied seeds. `npm run rain:fly:verify` re-simulates
  each record of the current fly on the JavaScript engine that made it and
  checks every file of its folder. A record of other code (another fly
  version, parameters or source; the fly column gives its version) is not
  re-simulated: its seal, its JSON files, its registry run and the facts its
  summary and report state are checked, and its summary and report byte for
  byte against their pins.
- **Pins.** renderings.json holds the SHA-256 of every record's report and
  summary, pinned by `npm run rain:fly` when it writes the folder. Later code
  renders those two files otherwise, so a record of other code is checked
  against its pins. Folders archived before renderings.json existed were
  pinned as committed: those of digital-fly/3 and /4 after the code that wrote
  them had reproduced every file, the legacy ones as they stand. A pin is
  never changed or removed.
- **Script-authorized records** were authorized by the demonstration script
  (Scripted.DemoOperator), not by a person: they demonstrate the pipeline on the
  host's own designs. Their reports say so.
- **Legacy records** (rain-fly-record/v1) were made under digital-fly/2 before
  these integrity rules: from an uncommitted tree, on seeds the designer chose,
  authorized by a script. They are kept because the archive keeps everything
  that ran, and they are **exploratory only, not evidence**. Verification checks
  their seal and files, their report and summary against their pins, and
  neither fails nor passes them as evidence.
- **Protocols.** digital-fly-behavior/v3 (digital-fly/4 on) redesigned four
  protocols so that each can discriminate: obstacle avoidance in clutter dense
  enough, and flown long enough, that collisions happen; visual threat as a
  looming dose series (l/v), measured by the time to collision at the escape;
  noisy sensing measured by that escape timing; adaptation on a fixed schedule
  whose stimuli keep the control below its ceiling. Their demonstrations take
  seed counts and minimum effects from pilots (docs/benchmarks/fly-pilots/),
  which are exploratory and never evidence. Records of earlier code ran the
  earlier designs, some of which could not discriminate; each report's caveat
  says what its design could show.

| folder | protocol | fly | outcome | standing | design by | question |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| [FLY-197fc7fc0f87c5fce87b46b7](FLY-197fc7fc0f87c5fce87b46b7/report.md) | echo_causation | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_memory) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-2bb84f207338d226b7d6bbe6](FLY-2bb84f207338d226b7d6bbe6/report.md) | echo_memory | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_learning) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds? |
| [FLY-3903d7750c9219b9682cba34](FLY-3903d7750c9219b9682cba34/report.md) | echo_memory | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds? |
| [FLY-3920e819007546cd014b23c6](FLY-3920e819007546cd014b23c6/report.md) | echo_impairment | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-50a5a3909ff0d2049a50efe0](FLY-50a5a3909ff0d2049a50efe0/report.md) | echo_memory | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (full) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds? |
| [FLY-5b39598d8379490a0479222e](FLY-5b39598d8379490a0479222e/report.md) | echo_impairment | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_memory) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-7f388e66ef215b708823ee62](FLY-7f388e66ef215b708823ee62/report.md) | echo_causation | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_learning) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-a024d61ac13192a8f3f7b9fe](FLY-a024d61ac13192a8f3f7b9fe/report.md) | echo_causation | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_uncertainty) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-a1e90fba74191fc20d2b25ba](FLY-a1e90fba74191fc20d2b25ba/report.md) | echo_impairment | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_learning) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-b08a681cf57732307c4b013c](FLY-b08a681cf57732307c4b013c/report.md) | echo_impairment | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (full) change mean absolute target movement error after adaptation, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-cf572962f725c7775f12c374](FLY-cf572962f725c7775f12c374/report.md) | echo_causation | digital-fly/8 | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (full) change fraction of correct causal hypotheses after adaptation; ambiguous counts incorrect, against the same motor probe with its self-model disabled on matched seeds? |
| [FLY-de3fff8bd8f36e1d2ced4bb0](FLY-de3fff8bd8f36e1d2ced4bb0/report.md) | echo_memory | digital-fly/8 | failed (not_supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does experimental ECHO self-model (no_memory) change early movement error on re-exposure, with retained versus reset self-model, against self-model reset at re-exposure on matched seeds? |
