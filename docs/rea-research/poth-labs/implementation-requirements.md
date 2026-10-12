# Original scientific knowledge graph acceptance specification

This specification translates public Poth Labs evidence navigation, competing
hypotheses, contradiction and evidence-gap demonstrations into independent R.A.I.N.
behavior. It does not assert access to Poth's private graph, retrieval engine or
backend implementation. No extracted implementation is reused.

1. Reconstruct the graph from the native research journal, pinned corpus and
   supplied registry research assessments. Stable identifiers bind source hashes
   and journal receipts. The graph writes no scientific records and changes no
   evaluator, approval or simulator state.
2. Represent papers, equations explicitly present in supplied excerpts, research
   questions, proposed hypotheses, assumptions, protocols, measurements,
   falsification conditions, contradictions, missing evidence and limitations.
   A paper's existence and quoted text are source context, never independently
   verified scientific findings.
3. Label every node and edge as source context, model suggestion, operator
   assessment, host observation or replay-verified simulator evidence. Model
   disagreement never becomes an established scientific contradiction.
4. A journal result is measurement evidence only when an earlier successful replay
   receipt and registry admission for that run exist in the same session. A
   self-asserted replay boolean cannot establish evidence. Missing receipts produce
   an inspectable gap. Registry assessment standing is copied, never re-scored.
5. Untested hypothesis queries return inspectable hypotheses without a verified
   test relation. Test connections require explicit journal design/perspective
   links, never text similarity. Shared-assumption queries distinguish explicit
   relationships from lexical matches. Contradiction queries distinguish model
   objections from registry-supported contrary runs.
6. Discriminating-experiment queries return recorded candidate protocols or an
   unresolved gap when no validated protocol explicitly connects both hypotheses.
   They never authorize or execute an experiment, invent predictions, or claim
   an optimal information gain.
7. Search is deterministic and bounded, with stable ordering and matched terms.
   Queries and graph inspection retain provenance paths and uncertainties. New
   journal receipts rebuild the graph; no separately mutable graph database exists.

Original acceptance tests cover deterministic reconstruction without input
mutation, pinned-corpus context labels, explicit equations, shared assumptions,
untested hypotheses, model objections, verified negative findings, withheld or
missing receipts, registry contrary evidence and discriminating-protocol gaps.
