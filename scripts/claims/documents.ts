/**
 * The documents whose numbers are held to records, and how each is cut into
 * the sections that bindings and coverage name.
 */
import type { DocumentProfile } from "./check.js";

export const REGISTER = "docs/RESEARCH_CLAIMS.md";
export const README = "README.md";

export const PROFILES: readonly DocumentProfile[] = [
  {
    path: REGISTER,
    name: "Claims register",
    // `### 3. The old physics…` is entry 3; the summary table is `summary`.
    keyFor: (heading) => {
      const entry = /^(\d+)\. (.*)$/.exec(heading);
      if (entry) return { key: entry[1]!, title: entry[2]! };
      return heading === "Summary" ? { key: "summary", title: "Summary" } : null;
    },
  },
  {
    path: README,
    name: "README",
    // `## 04. The test results…` is section 04.
    keyFor: (heading) => {
      const section = /^(\d\d)\. (.*)$/.exec(heading);
      return section ? { key: section[1]!, title: section[2]! } : null;
    },
  },
];
