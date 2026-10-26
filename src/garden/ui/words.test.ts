import { describe, expect, it } from "vitest";
import { observations, raw, SEQUENCES } from "../core/fixtures/index.js";
import {
  parseObservation,
  type Learning,
  type Observation,
} from "../core/observation.js";
import {
  BODY_NOTE,
  establishedFor,
  labelOf,
  learnedOf,
  lifeOf,
  memoriesOf,
  sceneDescription,
  statusOf,
  weatherOf,
  type Connection,
} from "./words.js";

const recorded: Observation[] = (
  Object.keys(SEQUENCES) as (keyof typeof SEQUENCES)[]
).flatMap((k) => observations(k));
const live: Connection = {
  paused: false,
  failures: 0,
  sinceAnswer: 1,
  newestAge: 4,
  late: 0,
};

describe("the label", () => {
  it("names the server's place and passes its activity through unchanged", () => {
    for (const o of recorded) {
      const l = labelOf(o);
      expect(l.activity).toBe(o.activity);
      if (o.travel) expect(l.place).toMatch(/^Crossing the garden, toward the /);
      else expect(l.place).toBe(o.placeName);
    }
  });

  it("does not invent a behaviour it has no words for", () => {
    const o = { ...recorded[0]!, activity: "stridulating" };
    expect(labelOf(o)).toMatchObject({
      activity: "stridulating",
      kicker: "A small life, in progress",
    });
  });
});

describe("this life", () => {
  it("shows only the numbers the server reported", () => {
    for (const o of recorded) {
      const v = lifeOf(o, o.serverTime);
      expect(v.identity).toBe(o.lifeId.slice(0, 8));
      expect(v.journeys).toBe(o.journeys.toLocaleString("en-US"));
      expect(v.places).toBe(`${o.placesVisited} of 7`);
      expect(v.memories).toBe(
        o.momentsCount === null ? "—" : o.momentsCount.toLocaleString("en-US"),
      );
      expect(v.born).toBe("October 25, 2026");
    }
  });

  it("quotes memories as the server wrote them, newest first", () => {
    for (const o of recorded) {
      expect(memoriesOf(o.moments, 5).map((m) => m.text)).toEqual(
        o.moments.slice(0, 5).map((m) => m.text),
      );
      expect(memoriesOf(o.moments, 5).map((m) => m.key)).toEqual(
        o.moments.slice(0, 5).map((m) => String(m.id)),
      );
    }
  });
});

describe("what it has learned", () => {
  it("reports the server's counts", () => {
    for (const o of recorded) {
      const v = learnedOf(o.learning);
      if (!o.learning) {
        expect(v).toBeNull();
        continue;
      }
      expect(v?.trials).toBe(o.learning.trials.toLocaleString("en-US"));
      if (o.learning.fly)
        expect(v?.movement[0]).toContain(
          `${o.learning.fly.samples.toLocaleString("en-US")} attempts`,
        );
    }
  });

  it("says a measurement was not reported rather than filling one in", () => {
    const l: Learning = {
      ...recorded.find((o) => o.learning)!.learning!,
      wingIntegrity: null,
      legIntegrity: null,
      wetness: null,
      condition: null,
    };
    const v = learnedOf({ ...l, predictionError: null, surprises: null, fly: null });
    expect(v?.body).toBe("Wings not reported · legs not reported · wetness not reported");
    expect(v?.condition).toBe("not reported");
    expect(v?.error).toBe("—");
    expect(v?.surprises).toBe("—");
    expect(v?.movement[0]).toBe("Flying: untried in these conditions");
  });
});

describe("published biology", () => {
  it("is kept apart from the model, each note with its source", () => {
    for (const activity of [
      "resting",
      "feeding",
      "drinking",
      "grooming",
      "flying",
      "walking",
      "sleeping",
    ])
      for (const note of establishedFor(activity))
        expect(note.source.href).toMatch(/^https:\/\/doi\.org\/10\./);
    expect(establishedFor("feeding")).toEqual([BODY_NOTE]);
    const [grooming] = establishedFor("grooming");
    expect(grooming?.text).toMatch(
      /This fly's grooming is modelled; these are measurements of real flies/,
    );
    expect(BODY_NOTE.text).toMatch(/an artist's rendering/);
  });
});

describe("the connection", () => {
  it("is live only while states arrive", () => {
    expect(statusOf(live).state).toBe("live");
    expect(statusOf({ ...live, newestAge: 60 }).state).toBe("waiting");
    expect(statusOf({ ...live, failures: 2, sinceAnswer: 20 }).state).toBe(
      "reconnecting",
    );
    expect(statusOf({ ...live, failures: 9, sinceAnswer: 300 })).toMatchObject({
      state: "offline",
      text: "Disconnected",
    });
    expect(statusOf({ ...live, sinceAnswer: null }).state).toBe("connecting");
  });

  it("says a paused view is the visitor's, not the fly's", () => {
    const s = statusOf({ ...live, paused: true });
    expect(s.state).toBe("paused");
    expect(s.detail).toMatch(/carries on on the server/);
    expect(sceneDescription(recorded[0]!, true)).toMatch(/continues on the server/);
  });
});

describe("the weather", () => {
  it("is the server's report, and says when it is a seasonal estimate", () => {
    const r = raw(SEQUENCES.drinking[0]!);
    const reported = parseObservation(r);
    expect(weatherOf(reported)).not.toMatch(/seasonal/);
    (r.weather as Record<string, unknown>).source = "seasonal";
    expect(weatherOf(parseObservation(r))).toMatch(/\(seasonal estimate\)$/);
  });
});
