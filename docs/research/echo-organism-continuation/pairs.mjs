// The placed copies at a 30% reserve, organism against the ECHO v3 control
// from the same placement: one row per placement, then totals.
import { readFileSync } from "node:fs";

const OUT = process.argv[2];
const read = (name) => JSON.parse(readFileSync(`${OUT}/${name}`, "utf8"));
const rows = [];
for (let n = 0; n <= 5; n++) {
  const at = n === 0 ? "" : `-placement${n}`;
  const o = read(`report-smell${at}-reserve0.3.json`),
    c = read(`report-smell-v3control${at}-reserve0.3.json`);
  if (o.placed.patch !== c.placed.patch || o.placed.p.join() !== c.placed.p.join())
    throw new Error(`placement ${n} differs between the pair`);
  const pick = (r) => ({
    minPatchM: r.smell.minPatchM,
    minAnyFoodM: r.smell.minAnyFoodM,
    firstMealS: r.smell.firstMealTick === null ? null : r.smell.firstMealTick / 10,
    fedJ: r.smell.fedJ,
    walkedM: r.smell.walkedM,
    flownM: r.smell.flownM,
    collisions: r.smell.collisions,
    meals: r.smell.meals,
    rejected: r.smell.rejectedCommands,
    failed: r.smell.failed,
  });
  rows.push({
    placement: n,
    patch: o.placed.patch,
    startM: o.placed.radiusM,
    odour: o.placed.odour,
    modulated: o.smell.modulatedDecisions,
    searchTurns: o.smell.searchTurns,
    maxOn: o.smell.maxOn,
    maxOff: o.smell.maxOff,
    organism: pick(o),
    control: pick(c),
  });
}
const sum = (side, k) => +rows.reduce((t, r) => t + r[side][k], 0).toFixed(2);
const total = {};
for (const side of ["organism", "control"])
  total[side] = Object.fromEntries(
    ["walkedM", "flownM", "collisions", "meals", "fedJ", "rejected"].map((k) => [k, sum(side, k)]),
  );
total.placementsWithMeals = Object.fromEntries(
  ["organism", "control"].map((side) => [
    side,
    rows.filter((r) => r[side].meals > 0).length,
  ]),
);
for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
process.stdout.write(`${JSON.stringify({ total })}\n`);
