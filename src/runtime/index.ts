/**
 * Mela-Coder Professional Runtime Architecture
 * 
 * This module exports all components of the professional runtime system.
 * The LLM is NOT the agent - it's only a reasoner/next-action predictor.
 * The runtime controls execution, verification, retries, and state transitions.
 */

// State Machine
export {
  StateMachine,
  createStateMachine,
  type AgentState,
  type StateTransition,
  type StateMachineConfig,
  type StateMachineResult,
} from '../state/machine';

// Task Orchestrator
export {
  TaskOrchestrator,
  createOrchestrator,
  type TaskDefinition,
  type TaskResult,
  type OrchestratorConfig,
  type ExecutionProgress,
} from '../orchestration/taskOrchestrator';

// Context Builder
export {
  ContextBuilder,
  createContextBuilder,
  type ContextLayer,
  type ContextBuilderConfig,
  type ContextBuildResult,
  defaultTokenEstimator,
} from '../context/builder';

// Result Evaluator
export {
  ResultEvaluator,
  createEvaluator,
  type EvaluationResult,
  type FailureCategory,
  type VerificationResult,
  type EvaluationContext,
  type EvaluatorConfig,
} from './resultEvaluator';

// Runtime Engine
export {
  RuntimeEngine,
  createRuntime,
  type RuntimeConfig,
  type RuntimeEvent,
  type EventHandler,
  type LLMReasoner,
} from './engine';
