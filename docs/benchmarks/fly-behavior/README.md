# Digital fly behaviour experiments

Every digital-fly experiment the R.A.I.N. Lab compiled, ran or refused, written by
`npm run rain:fly`. Nothing here is edited by hand: refusals, failures,
inconclusive results and runs the registry would not admit stay beside the
successes, and every file in a record's folder is derived from its record.json.

All results are **simulated observations of the digital fly**, a reduced-order
behavioural controller on FlyBody's anatomy that simulates no neurons, in a
closed arena. They describe that simulator only and are not evidence about
Drosophila.

- **Records under digital-fly-behavior/v2** (rain-fly-record/v2) were
  preregistered before they ran, on seeds the host drew afterwards from the
  registry receipt and a random nonce, and decided by an exact one-sided sign
  test at alpha 0.05 with at least 6 untied seeds. `npm run rain:fly:verify`
  re-simulates each on the JavaScript engine that made it and checks every file
  of its folder.
- **Script-authorized records** were authorized by the demonstration script
  (Scripted.DemoOperator), not by a person: they demonstrate the pipeline on the
  host's own designs. Their reports say so.
- **Legacy records** (rain-fly-record/v1) were made under digital-fly/2 before
  these integrity rules: from an uncommitted tree, on seeds the designer chose,
  authorized by a script. They are kept because the archive keeps everything
  that ran, and they are **exploratory only, not evidence**. Verification checks
  their seal, summary and files, and neither fails nor passes them as evidence.
- Some protocols cannot discriminate as designed (obstacle avoidance and noisy
  sensing), visual threat only checks the implementation's expansion gate, and
  adaptation's interval depends on the fly's response; each report's caveat
  says so. They are to be redesigned, with pilots that size the thresholds.

| folder | protocol | outcome | standing | design by | question |
| :--- | :--- | :--- | :--- | :--- | :--- |
| [FLY-0118dde9b0fc3ea7af37a97d](FLY-0118dde9b0fc3ea7af37a97d/report.md) | noisy_sensing | failed (not_supported) | legacy: exploratory only | scripted | In the digital fly simulator, how does relative sensory noise of 0.4 change collision episodes per metre flown in pillar clutter, against noiseless sensing on matched seeds? |
| [FLY-3f2f1b7cbc14f0f27c52421a](FLY-3f2f1b7cbc14f0f27c52421a/report.md) | noisy_sensing | inconclusive (insufficient_evidence) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does relative sensory noise of 0.4 change collision episodes per metre flown in pillar clutter, against noiseless sensing on matched seeds? |
| [FLY-48841033da2f4615ca421ba4](FLY-48841033da2f4615ca421ba4/report.md) | visual_threat | passed (supported) | legacy: exploratory only | scripted | In the digital fly simulator, how does a 4 cm sphere approaching the standing fly at 1 m/s change fraction of single-stimulus trials answered by an escape takeoff, against the same sphere receding along the same line at the same speed on matched seeds? |
| [FLY-796670400e2762fd99801223](FLY-796670400e2762fd99801223/report.md) | controller_comparison | passed (supported) | legacy: exploratory only | scripted | In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds? |
| [FLY-86a2164db13ac720c8cda2c8](FLY-86a2164db13ac720c8cda2c8/report.md) | controller_comparison | passed (supported) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does controller configuration B (avoidTtcS = 0.3, phototaxisGain = 1.5) change mean horizontal distance from the fly to the point below the light position, against controller configuration A (the default parameters) on matched seeds? |
| [FLY-a9125081ec711c7917a769e5](FLY-a9125081ec711c7917a769e5/report.md) | obstacle_avoidance | inconclusive (insufficient_evidence) | legacy: exploratory only | scripted | In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds? |
| [FLY-ab53701da1edaf126ec182b6](FLY-ab53701da1edaf126ec182b6/report.md) | adaptation | inconclusive (insufficient_evidence) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does repeating a looming stimulus nominally every 4 s change fraction of the second half of repeated presentations answered by an escape, against the same stimulus nominally every 120 s on matched seeds? |
| [FLY-c436560158bdfdf4e462c5f6](FLY-c436560158bdfdf4e462c5f6/report.md) | light_preference | inconclusive (insufficient_evidence) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds? |
| [FLY-c7422d2505d7cb603ef8b720](FLY-c7422d2505d7cb603ef8b720/report.md) | obstacle_avoidance | inconclusive (insufficient_evidence) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does turning away from surfaces whose time to contact falls below 0.45 s change collision episodes that began in cruising flight (not during a landing approach) per metre flown in pillar clutter, against avoidance off (avoidTtcS = 0) on matched seeds? |
| [FLY-f51180d4bb06123a30f4c289](FLY-f51180d4bb06123a30f4c289/report.md) | adaptation | inconclusive (insufficient_evidence) | legacy: exploratory only | scripted | In the digital fly simulator, how does repeating a looming stimulus every 4 s change fraction of the second half of repeated presentations answered by an escape, against the same stimulus every 120 s on matched seeds? |
| [FLY-f6f39e7b576079212dbb5922](FLY-f6f39e7b576079212dbb5922/report.md) | visual_threat | inconclusive (insufficient_evidence) | admitted; script-authorized demonstration | scripted | In the digital fly simulator, how does a sphere of 4 cm radius approaching the standing fly at 1 m/s change fraction of single-stimulus trials answered by an escape takeoff, against the same sphere receding along the same line at the same speed on matched seeds? |
| [FLY-f8b1181f01439b08e02f53e6](FLY-f8b1181f01439b08e02f53e6/report.md) | light_preference | passed (supported) | legacy: exploratory only | scripted | In the digital fly simulator, how does a point light of relative intensity 2 above one quadrant of the arena change mean horizontal distance from the fly to the point below the light position, against no point light (ambient only) on matched seeds? |
| [refused-4e78f2171f71aba0](refused-4e78f2171f71aba0/summary.json) | — | refused by the host compiler | refused before preregistration | scripted | [scripted] Does a controller with stronger phototaxis and later avoidance stay closer to the light than the default? |
| [refused-6300a7d8ddc2f9dd](refused-6300a7d8ddc2f9dd/summary.json) | controller_comparison | refused by the host compiler | refused before preregistration | scripted | [scripted] Does a controller with stronger phototaxis and later avoidance stay closer to the light than the default? |
| [refused-71c214270d12f755](refused-71c214270d12f755/summary.json) | — | refused by the host compiler | refused before preregistration | scripted | [scripted] Does an approaching sphere make the simulated fly escape where the same sphere receding does not? |
| [refused-ebed4a4174fe9a85](refused-ebed4a4174fe9a85/summary.json) | visual_threat | refused by the host compiler | refused before preregistration | scripted | [scripted] Does an approaching sphere make the simulated fly escape where the same sphere receding does not? |
