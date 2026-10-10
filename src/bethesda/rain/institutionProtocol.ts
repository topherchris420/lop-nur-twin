import { closed } from "./discoveryProtocol.js";
export interface InstitutionAssessment {
  schema: "rain-institution-assessment/v1";
  run_id: string;
  question_resolved: boolean;
  useful_cross_domain_connection: boolean;
  quality: number;
  rationale: string;
  reviewer: string;
}
export const ASSESSMENT_SCHEMA = closed({
  schema: { const: "rain-institution-assessment/v1" },
  run_id: { type: "string", minLength: 1, maxLength: 120 },
  question_resolved: { type: "boolean" },
  useful_cross_domain_connection: { type: "boolean" },
  quality: { type: "integer", minimum: 0, maximum: 5 },
  rationale: { type: "string", minLength: 1, maxLength: 1200 },
  reviewer: { type: "string", minLength: 1, maxLength: 100 },
});
