import { ModelCapability, TaskDepth, cloneAiValue } from "../domain/ai-registry.js";
import { ModelTaskClass } from "../domain/execution.js";

export const MODEL_TASK_CAPABILITY_POLICY_VERSION = "2026-08-01";

const requirement = (capability, minimumScore) =>
  Object.freeze({ capability, minimumScore });

export const MODEL_TASK_CAPABILITY_POLICY = Object.freeze({
  [ModelTaskClass.PROJECT_UNDERSTANDING]: Object.freeze({
    defaultDepth: TaskDepth.ARCHITECTURE,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.SOFTWARE_ENGINEERING, 70),
      requirement(ModelCapability.ARCHITECTURE, 60),
      requirement(ModelCapability.STRUCTURED_OUTPUT, 80),
      requirement(ModelCapability.REASONING, 60),
    ]),
  }),
  [ModelTaskClass.FILE_GENERATION]: Object.freeze({
    defaultDepth: TaskDepth.MULTI_FILE_ENGINEERING,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.SOFTWARE_ENGINEERING, 70),
      requirement(ModelCapability.CODE_GENERATION, 70),
      requirement(ModelCapability.CODING, 70),
      requirement(ModelCapability.STRUCTURED_OUTPUT, 70),
      requirement(ModelCapability.REASONING, 40),
    ]),
  }),
  [ModelTaskClass.STRUCTURED_TRANSFORMATION]: Object.freeze({
    defaultDepth: TaskDepth.MECHANICAL,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.STRUCTURED_OUTPUT, 80),
    ]),
  }),
  [ModelTaskClass.WORK_DECOMPOSITION]: Object.freeze({
    defaultDepth: TaskDepth.ARCHITECTURE,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.SOFTWARE_ENGINEERING, 70),
      requirement(ModelCapability.PLANNING, 70),
      requirement(ModelCapability.STRUCTURED_OUTPUT, 70),
      requirement(ModelCapability.REASONING, 60),
    ]),
  }),
  [ModelTaskClass.REPAIR_DIAGNOSIS]: Object.freeze({
    defaultDepth: TaskDepth.MULTI_FILE_ENGINEERING,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.SOFTWARE_ENGINEERING, 70),
      requirement(ModelCapability.DEBUGGING, 75),
      requirement(ModelCapability.STRUCTURED_OUTPUT, 70),
      requirement(ModelCapability.REASONING, 60),
    ]),
  }),
  [ModelTaskClass.REPAIR_IMPLEMENTATION]: Object.freeze({
    defaultDepth: TaskDepth.STANDARD_CODING,
    requiredCapabilities: Object.freeze([
      requirement(ModelCapability.SOFTWARE_ENGINEERING, 70),
      requirement(ModelCapability.CODE_REPAIR, 75),
      requirement(ModelCapability.CODING, 70),
      requirement(ModelCapability.STRUCTURED_OUTPUT, 70),
      requirement(ModelCapability.REASONING, 40),
    ]),
  }),
});

export function modelTaskCapabilityContract(taskClass) {
  const contract = MODEL_TASK_CAPABILITY_POLICY[taskClass];
  return contract === undefined ? null : cloneAiValue({
    taskClass,
    policyVersion: MODEL_TASK_CAPABILITY_POLICY_VERSION,
    ...contract,
  });
}
