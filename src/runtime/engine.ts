/**
 * PHASE 1: Minimal Viable Runtime - Main Runtime Engine
 * 
 * This is the core runtime that orchestrates all components:
 * - State Machine
 * - Task Orchestrator
 * - Context Builder
 * - Result Evaluator
 * - Tool Executor
 * - Verification Engine
 * 
 * The LLM is treated as a stateless function - the runtime controls everything.
 */

import { createStateMachine, type AgentState } from '../state/machine';
import { createOrchestrator, type TaskOrchestrator, type TaskResult, type ExecutionProgress } from '../orchestration/taskOrchestrator';
import { createContextBuilder, type ContextBuilder } from '../context/builder';
import { createEvaluator, type ResultEvaluator, type EvaluationResult } from './resultEvaluator';
import type { ConversationTurn } from '../agent/contextManager';
import type { ToolRegistry } from '../tools/registry';
import type { VerificationChain } from '../verification/chain';

export interface RuntimeConfig {
  maxTokens: number;
  systemPrompt: string;
  maxIterations: number;
  maxRetries: number;
  requireVerification: boolean;
  debug?: boolean;
}

export type RuntimeEvent =
  | { type: 'state_change'; from: AgentState; to: AgentState }
  | { type: 'task_start'; taskId: string; goal: string }
  | { type: 'task_complete'; taskId: string; result: TaskResult }
  | { type: 'task_fail'; taskId: string; error: string }
  | { type: 'tool_call'; name: string; params: Record<string, unknown> }
  | { type: 'tool_result'; name: string; success: boolean; output: string }
  | { type: 'verification_start'; checks: string[] }
  | { type: 'verification_complete'; passed: boolean; results: unknown[] }
  | { type: 'evaluation'; result: EvaluationResult }
  | { type: 'retry'; reason: string; count: number }
  | { type: 'error'; message: string }
  | { type: 'checkpoint'; data: string };

export type EventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface LLMReasoner {
  generateResponse(context: string): AsyncIterable<{ text?: string; reasoning?: string; done?: boolean }>;
}

export class RuntimeEngine {
  private readonly config: Required<RuntimeConfig>;
  private readonly stateMachine: ReturnType<typeof createStateMachine>;
  private readonly orchestrator: TaskOrchestrator;
  private readonly contextBuilder: ContextBuilder;
  private readonly evaluator: ResultEvaluator;
  private readonly eventHandlers: EventHandler[] = [];
  private llmReasoner?: LLMReasoner;
  private toolRegistry?: ToolRegistry;
  private verificationChain?: typeof VerificationChain;
  private isRunning: boolean = false;
  private iterationCount: number = 0;

  constructor(config: RuntimeConfig) {
    this.config = {
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
      maxIterations: config.maxIterations,
      maxRetries: config.maxRetries,
      requireVerification: config.requireVerification,
      debug: config.debug ?? false,
    };

    // Initialize state machine
    this.stateMachine = createStateMachine({
      initialState: 'IDLE',
      maxRetries: this.config.maxRetries,
      onTransition: (from, to, trigger) => {
        this.emit({ type: 'state_change', from, to });
      },
      onError: (state, error) => {
        this.emit({ type: 'error', message: `State machine error in ${state}: ${error.message}` });
      }
    });

    // Initialize orchestrator
    this.orchestrator = createOrchestrator({
      defaultMaxRetries: this.config.maxRetries,
      onTaskStart: (task) => {
        this.emit({ type: 'task_start', taskId: task.id, goal: task.goal });
      },
      onTaskComplete: (task, result) => {
        this.emit({ type: 'task_complete', taskId: task.id, result });
      },
      onTaskFail: (task, error) => {
        this.emit({ type: 'task_fail', taskId: task.id, error });
      },
      onStateChange: (from, to) => {
        this.emit({ type: 'state_change', from, to });
      }
    });

    // Initialize context builder
    this.contextBuilder = createContextBuilder({
      maxTokens: this.config.maxTokens,
      systemPrompt: this.config.systemPrompt,
    });

    // Initialize evaluator
    this.evaluator = createEvaluator({
      autoRetryOnSyntax: true,
      autoRetryOnType: true,
      escalateAfterRetries: this.config.maxRetries,
      requireVerificationForSuccess: this.config.requireVerification,
      onEvaluate: (result) => {
        this.emit({ type: 'evaluation', result });
      }
    });
  }

  /**
   * Attach an LLM reasoner implementation
   */
  attachLLM(reasoner: LLMReasoner): void {
    this.llmReasoner = reasoner;
  }

  /**
   * Attach tool registry
   */
  attachToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Attach verification chain
   */
  attachVerificationChain(verificationChain: typeof VerificationChain): void {
    this.verificationChain = verificationChain;
  }

  /**
   * Register an event handler
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private async emit(event: RuntimeEvent): Promise<void> {
    if (this.config.debug) {
      console.log(`[Runtime] Event: ${event.type}`, event);
    }
    
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error('[Runtime] Event handler error:', error);
      }
    }
  }

  /**
   * Execute a task
   */
  async execute(goal: string): Promise<TaskResult> {
    if (this.isRunning) {
      throw new Error('Runtime is already executing a task');
    }

    if (!this.llmReasoner) {
      throw new Error('No LLM reasoner attached');
    }

    this.isRunning = true;
    this.iterationCount = 0;

    try {
      // Create task
      const task = this.orchestrator.createTask(goal);
      await this.orchestrator.startTask(task.id);

      // Main execution loop
      while (this.iterationCount < this.config.maxIterations) {
        this.iterationCount++;
        
        const currentState = this.stateMachine.getState();
        
        if (this.config.debug) {
          console.log(`[Runtime] Iteration ${this.iterationCount}, State: ${currentState}`);
        }

        // Build context based on current state
        await this.buildContext(currentState, task);

        // Get LLM response
        const contextResult = this.contextBuilder.build();
        const llmResponse = await this.getLLMResponse(contextResult.fullContext);

        if (!llmResponse) {
          await this.orchestrator.markPhaseFailed('planning', 'Empty LLM response');
          continue;
        }

        // Process LLM response and execute actions
        const actionResult = await this.processLLMResponse(llmResponse);

        if (actionResult.done) {
          // Run verification if required
          if (this.config.requireVerification && actionResult.editsMade) {
            await this.runVerification();
          } else {
            await this.orchestrator.markPhaseComplete('verification');
          }

          // Evaluate final result
          const evaluation = this.evaluateResult(task);
          
          if (evaluation.decision === 'SUCCESS') {
            await this.orchestrator.completeTask({
              success: true,
              taskId: task.id,
              output: actionResult.output,
              verificationPassed: true,
            });
            
            this.isRunning = false;
            return {
              success: true,
              taskId: task.id,
              output: actionResult.output,
              verificationPassed: true,
            };
          } else if (evaluation.decision === 'RETRY') {
            this.emit({ type: 'retry', reason: evaluation.reason, count: this.orchestrator.getProgress().currentTask?.retryCount ?? 0 });
            continue;
          } else if (evaluation.decision === 'ESCALATE') {
            await this.orchestrator.failTask(evaluation.reason);
            this.isRunning = false;
            return {
              success: false,
              taskId: task.id,
              error: evaluation.reason,
            };
          }
        }

        // Check if we're stuck
        if (!actionResult.progressMade) {
          await this.orchestrator.markPhaseFailed('planning', 'No progress made');
        }
      }

      // Max iterations reached
      const error = `Max iterations (${this.config.maxIterations}) reached`;
      await this.orchestrator.failTask(error);
      this.isRunning = false;
      
      return {
        success: false,
        taskId: task.id,
        error,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({ type: 'error', message: errorMessage });
      
      if (this.orchestrator.getProgress().currentTask) {
        await this.orchestrator.failTask(errorMessage);
      }
      
      this.isRunning = false;
      
      return {
        success: false,
        taskId: '',
        error: errorMessage,
      };
    }
  }

  /**
   * Build context for the current state
   */
  private async buildContext(state: AgentState, task: { id: string; goal: string }): Promise<void> {
    this.contextBuilder.clear();

    // Add task context (high priority)
    this.contextBuilder.addLayer('task', `Goal: ${task.goal}`, 0, false);

    // Add state-specific context
    switch (state) {
      case 'PLANNING':
        this.contextBuilder.addLayer('state', 'Current phase: PLANNING - Create or refine the execution plan', 1, false);
        break;
      case 'INSPECTING':
        this.contextBuilder.addLayer('state', 'Current phase: INSPECTING - Read files and understand the codebase', 1, false);
        break;
      case 'EDITING':
        this.contextBuilder.addLayer('state', 'Current phase: EDITING - Make code changes', 1, false);
        break;
      case 'VERIFYING':
        this.contextBuilder.addLayer('state', 'Current phase: VERIFYING - Run tests and validation', 1, false);
        break;
      case 'RETRYING':
        const retryCount = this.orchestrator.getProgress().currentTask?.retryCount ?? 0;
        this.contextBuilder.addLayer('state', `Current phase: RETRYING (attempt ${retryCount + 1}) - Fix previous errors`, 1, false);
        break;
    }

    // Add recent history (compressible)
    const progress = this.orchestrator.getProgress();
    if (progress.completedTasks.length > 0) {
      const summary = progress.completedTasks.map(t => `✓ ${t.goal}`).join('\n');
      this.contextBuilder.addLayer('completed', summary, 2, true);
    }

    // Add working memory if available
    // (This would be populated by the existing agent loop's working memory)
  }

  /**
   * Get response from LLM
   */
  private async getLLMResponse(context: string): Promise<string> {
    if (!this.llmReasoner) {
      throw new Error('No LLM reasoner attached');
    }

    let fullResponse = '';
    
    for await (const chunk of this.llmReasoner.generateResponse(context)) {
      if (chunk.text) {
        fullResponse += chunk.text;
      }
      if (chunk.done) break;
    }

    return fullResponse;
  }

  /**
   * Process LLM response and execute actions
   */
  private async processLLMResponse(response: string): Promise<{
    done: boolean;
    editsMade: boolean;
    progressMade: boolean;
    output?: string;
  }> {
    // This would integrate with the existing tool parser and executor
    // For now, return a placeholder implementation
    
    const hasDone = /\[done\]|<done\/>/i.test(response);
    
    return {
      done: hasDone,
      editsMade: false,
      progressMade: !hasDone,
      output: response,
    };
  }

  /**
   * Run verification chain
   */
  private async runVerification(): Promise<void> {
    if (!this.verificationChain) {
      this.emit({ type: 'verification_complete', passed: true, results: [] });
      return;
    }

    this.emit({ type: 'verification_start', checks: ['typecheck', 'lint', 'test'] });

    try {
      const result = await this.verificationChain.run(false);
      
      this.emit({ 
        type: 'verification_complete', 
        passed: result.passed, 
        results: result.results 
      });

      if (!result.passed) {
        await this.stateMachine.transition('verification_failed');
      } else {
        await this.stateMachine.transition('verification_passed');
      }
    } catch (error) {
      this.emit({ 
        type: 'verification_complete', 
        passed: false, 
        results: [{ error: error instanceof Error ? error.message : String(error) }] 
      });
    }
  }

  /**
   * Evaluate the result of task execution
   */
  private evaluateResult(task: { id: string; goal: string }): EvaluationResult {
    const progress = this.orchestrator.getProgress();
    const currentTask = progress.currentTask;
    
    return this.evaluator.evaluate({
      taskGoal: task.goal,
      verificationResult: {
        passed: true, // Would be populated from actual verification
        checks: [],
      },
      toolOutputs: [],
      stateHistory: this.stateMachine.getHistory(),
      retryCount: currentTask?.retryCount ?? 0,
      maxRetries: this.config.maxRetries,
    });
  }

  /**
   * Get current runtime state
   */
  getState(): {
    agentState: AgentState;
    progress: ExecutionProgress;
    iteration: number;
    isRunning: boolean;
  } {
    return {
      agentState: this.stateMachine.getState(),
      progress: this.orchestrator.getProgress(),
      iteration: this.iterationCount,
      isRunning: this.isRunning,
    };
  }

  /**
   * Create a checkpoint for recovery
   */
  createCheckpoint(): string {
    const checkpoint = {
      timestamp: Date.now(),
      orchestrator: this.orchestrator.serialize(),
      stateMachine: this.stateMachine.serialize(),
      iterationCount: this.iterationCount,
    };
    
    this.emit({ type: 'checkpoint', data: JSON.stringify(checkpoint) });
    
    return JSON.stringify(checkpoint);
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Reset the runtime
   */
  reset(): void {
    this.stateMachine.reset();
    this.orchestrator.reset();
    this.contextBuilder.clear();
    this.iterationCount = 0;
    this.isRunning = false;
  }
}

export function createRuntime(config: RuntimeConfig): RuntimeEngine {
  return new RuntimeEngine(config);
}
