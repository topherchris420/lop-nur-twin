/**
 * DEMO: one prerecorded R.A.I.N. meeting, and a proposal written by hand.
 *
 * The meeting was recorded by `scripts/export-rain-demo.ts`, which ran the
 * runtime's offline engine (`src/rain/meeting/offline.ts`) at the commit in
 * `fixtures/demo-source.json`. It is validated here with the
 * validator every LIVE answer passes; if the recording or its manifest is
 * damaged, DEMO is unavailable rather than shown. It is always labelled
 * PRERECORDED, and its words are labelled SCRIPTED because the engine's are.
 *
 * The proposal is not R.A.I.N.'s. It is a fixture (`origin: "fixture"`)
 * written for this demo, and the lab says so wherever it appears.
 */
import meetingFixture from "./fixtures/demo-meeting.json" with { type: "json" };
import proposalFixture from "./fixtures/demo-proposal.json" with { type: "json" };
import source from "./fixtures/demo-source.json" with { type: "json" };
import type { ExperimentProposal, MeetingRecord } from "./contracts";
import { validateMeeting, validateProposalShape, type Checked } from "./validation";

export function demoMeeting(): Checked<MeetingRecord> {
  const checked = validateMeeting(meetingFixture);
  if (!checked.ok) return checked;
  const m = checked.value;
  const errors: string[] = [];
  if (m.meeting_id !== source.meetingId) {
    errors.push("recording and manifest disagree on the meeting");
  }
  if (m.question !== source.question) {
    errors.push("recording and manifest disagree on the question");
  }
  if (m.generation !== "scripted") {
    errors.push("DEMO meeting must be labelled scripted (no model runs)");
  }
  if (m.model !== null) {
    errors.push("DEMO meeting must not name a model");
  }
  if (m.source_artifact !== null) {
    errors.push(
      "DEMO meeting must be a recording-only artifact (no remote session reference)",
    );
  }
  if (m.rain.commit !== source.rain.commit) {
    errors.push("recording and manifest disagree on the R.A.I.N. commit");
  }
  return errors.length ? { ok: false, errors } : checked;
}

export function demoProposal(): Checked<ExperimentProposal> {
  const checked = validateProposalShape(proposalFixture);
  if (!checked.ok) return checked;
  const errors: string[] = [];
  if (checked.value.origin !== "fixture") {
    errors.push("DEMO proposal must be marked as a fixture (not rain or human)");
  }
  if (checked.value.rain_decision !== null) {
    errors.push("DEMO proposal must not claim a R.A.I.N. bounded decision");
  }
  return errors.length ? { ok: false, errors } : checked;
}

/** The raw proposal, for the Experiment Bay to put through ordinary validation. */
export const demoProposalInput = (): unknown => structuredClone(proposalFixture);
