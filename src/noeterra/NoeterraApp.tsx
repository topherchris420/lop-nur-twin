import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BrowserEngine } from "./engine";
import { Game } from "./Game";
import { Lobby } from "./Lobby";
import type { ScenarioCard } from "./types";

export interface NoeterraAppProps {
  scenario?: string;
  play?: string;
  seed?: number;
}

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  | { kind: "lobby" }
  | { kind: "game"; session: number; you: number | null; notice?: string };

export function NoeterraApp({ scenario, play, seed }: NoeterraAppProps) {
  const [engine, setEngine] = useState<BrowserEngine | null>(null);
  const [cards, setCards] = useState<ScenarioCard[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const begin = (
    eng: BrowserEngine,
    list: ScenarioCard[],
    id: string,
    civKey: string | null,
    s: number,
  ) => {
    const card = list.find((c) => c.id === id);
    if (!card) return;
    const seats: Record<string, string> = {};
    if (civKey && card.civs.some((c) => c.key === civKey)) seats[civKey] = "human";
    let session: number;
    try {
      session = eng.start(id, s, seats);
    } catch (e) {
      // A refusal, or an engine that stopped and has not restarted (engine.ts).
      setPhase({
        kind: "unavailable",
        reason: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const you = civKey ? card.civs.findIndex((c) => c.key === civKey) : -1;
    setPhase({ kind: "game", session, you: you >= 0 ? you : null });
  };

  useEffect(() => {
    let live = true;
    BrowserEngine.load()
      .then((eng) => {
        if (!live) return;
        const list = eng.scenarios();
        setEngine(eng);
        setCards(list);
        if (scenario && list.some((c) => c.id === scenario) && play !== undefined) {
          begin(eng, list, scenario, play === "observe" ? null : play, seed ?? 1);
        } else {
          setPhase({ kind: "lobby" });
        }
      })
      .catch((e: unknown) => {
        if (live)
          setPhase({
            kind: "unavailable",
            reason: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      live = false;
    };
    // The engine loads once per visit; search changes inside the page are handled by the lobby.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase.kind === "loading")
    return (
      <div
        className="grid h-full place-items-center bg-black text-white/80"
        role="status"
      >
        Loading the Noeterra engine…
      </div>
    );
  if (phase.kind === "unavailable" || !engine)
    return (
      <div
        className="grid h-full place-items-center bg-black p-6 text-center text-white"
        role="alert"
      >
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-bold">Noeterra is not available here</h1>
          <p className="text-sm text-white/75">
            {phase.kind === "unavailable" ? phase.reason : "The engine did not start."}
          </p>
          <p className="text-sm text-white/60">
            The archived civilization experiments remain readable in the repository, and
            the twin is{" "}
            <Link to="/" className="underline">
              one step back
            </Link>
            .
          </p>
        </div>
      </div>
    );
  if (phase.kind === "lobby")
    return (
      <Lobby
        cards={cards}
        engineVersion={engine.version}
        initialScenario={scenario}
        initialSeed={seed}
        onBegin={(id, civ, s) => begin(engine, cards, id, civ, s)}
      />
    );
  return (
    <Game
      key={`${engine.instance}:${phase.session}`}
      engine={engine}
      session={phase.session}
      you={phase.you}
      notice={phase.notice}
      onExit={() => setPhase({ kind: "lobby" })}
      onReplace={(session, you, notice) =>
        setPhase({ kind: "game", session, you, notice })
      }
    />
  );
}
