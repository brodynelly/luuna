// The failure explanations are shared with every client (packages/api-client/src/failures.ts):
// one source for the reason shown, the next allowed step and the failure class (R02, A33).
export { actionFailure, baselineStep, classifyFailure, describeFailure, explainFailure, FAILURE_CLASSES, nextStep, utf8Bytes } from "@luuna/api-client";
export type { AllowedActions, FailureClass, FailureExplanation } from "@luuna/api-client";
