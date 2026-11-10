/**
 * The README's own sentence about how much is recomputed.
 *
 * It states two numbers, so it is held like any other: they are the claims
 * register's coverage under every other binding. The sentence is in the
 * README, which the register's count does not read, so it cannot move the
 * numbers it states.
 */
import { check, type Binding } from "../check.js";
import { PROFILES, README, REGISTER } from "../documents.js";
import { says } from "../statement.js";

export function coverage(others: readonly Binding[]): Binding[] {
  return [
    {
      id: "readme.04.recomputed",
      doc: README,
      section: "04",
      model: "scripts/claims/check.ts",
      statement: () => {
        const register = check(others, PROFILES).documents.find(
          (d) => d.path === REGISTER,
        )!;
        return says`**${register.recomputed} of the ${register.quantities} quantities**`;
      },
    },
  ];
}
