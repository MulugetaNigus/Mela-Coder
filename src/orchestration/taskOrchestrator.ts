/**
 * PHASE 1: Minimal Viable Runtime - Task Orchestrator
 * 
 * The orchestrator receives user goals, decomposes tasks, manages execution loops,
 * coordinates retries and subagents, and tracks progress.
 * 
 * This is the "brain" of the runtime system - it controls the LLM, not vice versa.
 */

import { createStateMachine, type AgentState, type StateMachine } from '../state/machine';
import type { ConversationTurn } from '../agent/contextManager';

export interface TaskDefinition {
  id: string;
  goal: string;
  parentTaskId?: string;
  subtasks: TaskDefinition[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  maxRetries: number;
  metadata: Record<string, unknown>;
}

export interface TaskResult {
  success: boolean;
  taskId: string;
  output?: string;
  error?: string;
  verificationPassed?: boolean;
  artifacts?: string[];
}

export interface OrchestratorConfig {
  maxConcurrentSubtasks?: number;
  defaultMaxRetries?: number;
  onTaskStart?: (task: TaskDefinition) => void;
  onTaskComplete?: (task: TaskDefinition, result: TaskResult) => void;
  onTaskFail?: (task: TaskDefinition, error: string) => void;
  onStateChange?: (oldState: AgentState, newState: AgentState) => void;
}

export interface ExecutionProgress {
  currentTask?: TaskDefinition;
  completedTasks: TaskDefinition[];
  failedTasks: TaskDefinition[];
  blockedTasks: TaskDefinition[];
  overallProgress: number; // 0-100
  state: AgentState;
  iteration: number;
}

export class TaskOrchestrator {
  private readonly config: Required<OrchestratorConfig>;
  private readonly stateMachine: StateMachine;
  private tasks: Map<string, TaskDefinition> = new Map();
  private taskResults: Map<string, TaskResult> = new Map();
  private currentTaskId?: string;
  private iterationCount: number = 0;
  private isRunning: boolean = false;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      maxConcurrentSubtasks: config.maxConcurrentSubtasks ?? 1,
      defaultMaxRetries: config.defaultMaxRetries ?? 3,
      onTaskStart: config.onTaskStart ?? (() => {}),
      onTaskComplete: config.onTaskComplete ?? (() => {}),
      onTaskFail: config.onTaskFail ?? (() => {}),
      onStateChange: config.onStateChange ?? (() => {}),
    };

    this.stateMachine = createStateMachine({
      initialState: 'IDLE',
      maxRetries: this.config.defaultMaxRetries,
      onTransition: (from, to) => {
        this.config.onStateChange(from, to);
      },
      onError: (state, error) => {
        console.error(`[Orchestrator] State machine error in ${state}:`, error.message);
      }
    });
  }

  /**
   * Create a new task from a user goal
   */
  createTask(goal: string, parentTaskId?: string): TaskDefinition {
    const task: TaskDefinition = {
      id: this.generateTaskId(),
      goal,
      parentTaskId,
      subtasks: [],
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: this.config.defaultMaxRetries,
      metadata: {}
    };

    this.tasks.set(task.id, task);

    if (parentTaskId) {
      const parent = this.tasks.get(parentTaskId);
      if (parent) {
        parent.subtasks.push(task);
      }
    }

    return task;
  }

  /**
   * Decompose a task into subtasks
   */
  decomposeTask(taskId: string, subtasks: Omit<TaskDefinition, 'id' | 'createdAt' | 'retryCount' | 'maxRetries' | 'subtasks'>[]): TaskDefinition[] {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    const createdSubtasks = subtasks.map(sub => {
      const newTask: TaskDefinition = {
        ...sub,
        id: this.generateTaskId(),
        parentTaskId: taskId,
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: this.config.defaultMaxRetries,
        subtasks: []
      };
      this.tasks.set(newTask.id, newTask);
      return newTask;
    });

    task.subtasks.push(...createdSubtasks);
    return createdSubtasks;
  }

  /**
   * Start executing a task
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (this.isRunning) {
      throw new Error('Orchestrator is already running a task');
    }

    this.currentTaskId = taskId;
    this.isRunning = true;
    task.status = 'in_progress';
    task.startedAt = Date.now();
    this.iterationCount = 0;

    await this.stateMachine.transition('start_task');
    this.config.onTaskStart(task);
  }

  /**
   * Mark current phase as complete (e.g., planning done, inspection done)
   */
  async markPhaseComplete(phase: 'planning' | 'inspection' | 'editing' | 'verification'): Promise<void> {
    const currentState = this.stateMachine.getState();
    
    switch (phase) {
      case 'planning':
        if (currentState === 'PLANNING') {
          await this.stateMachine.transition('plan_created');
        }
        break;
      case 'inspection':
        if (currentState === 'INSPECTING') {
          await this.stateMachine.transition('inspection_complete');
        }
        break;
      case 'editing':
        if (currentState === 'EDITING') {
          await this.stateMachine.transition('edit_complete');
        }
        break;
      case 'verification':
        if (currentState === 'VERIFYING') {
          await this.stateMachine.transition('verification_passed');
        }
        break;
    }

    this.iterationCount++;
  }

  /**
   * Mark current phase as failed
   */
  async markPhaseFailed(phase: 'planning' | 'inspection' | 'editing' | 'verification', error: string): Promise<void> {
    const currentState = this.stateMachine.getState();
    const task = this.currentTaskId ? this.tasks.get(this.currentTaskId) : undefined;

    switch (phase) {
      case 'planning':
        if (currentState === 'PLANNING') {
          const canRetry = task && task.retryCount < task.maxRetries;
          if (canRetry) {
            await this.stateMachine.transition('edit_failed'); // Will go to RETRYING
            if (task) task.retryCount++;
          } else {
            await this.stateMachine.transition('plan_failed');
          }
        }
        break;
      case 'inspection':
        if (currentState === 'INSPECTING') {
          await this.stateMachine.transition('inspection_blocked');
        }
        break;
      case 'editing':
        if (currentState === 'EDITING') {
          const canRetry = task && task.retryCount < task.maxRetries;
          if (canRetry) {
            await this.stateMachine.transition('edit_failed');
            if (task) task.retryCount++;
          } else {
            await this.stateMachine.transition('edit_blocked');
          }
        }
        break;
      case 'verification':
        if (currentState === 'VERIFYING') {
          const canRetry = task && task.retryCount < task.maxRetries;
          if (canRetry) {
            await this.stateMachine.transition('verification_failed');
            if (task) task.retryCount++;
          } else {
            await this.stateMachine.transition('verification_blocked');
          }
        }
        break;
    }

    this.iterationCount++;
  }

  /**
   * Complete a task successfully
   */
  async completeTask(result: TaskResult): Promise<void> {
    const task = this.currentTaskId ? this.tasks.get(this.currentTaskId) : undefined;
    if (!task) {
      throw new Error('No active task to complete');
    }

    task.status = 'completed';
    task.completedAt = Date.now();
    this.taskResults.set(task.id, result);

    await this.stateMachine.transition('verification_passed');
    this.config.onTaskComplete(task, result);
    this.isRunning = false;
    this.currentTaskId = undefined;
  }

  /**
   * Fail a task
   */
  async failTask(error: string): Promise<void> {
    const task = this.currentTaskId ? this.tasks.get(this.currentTaskId) : undefined;
    if (!task) {
      throw new Error('No active task to fail');
    }

    task.status = 'failed';
    task.completedAt = Date.now();
    this.taskResults.set(task.id, {
      success: false,
      taskId: task.id,
      error
    });

    const currentState = this.stateMachine.getState();
    if (currentState !== 'FAILED') {
      await this.stateMachine.forceTransition('FAILED', 'task_failed');
    }

    this.config.onTaskFail(task, error);
    this.isRunning = false;
    this.currentTaskId = undefined;
  }

  /**
   * Get current execution progress
   */
  getProgress(): ExecutionProgress {
    const allTasks = Array.from(this.tasks.values());
    const completed = allTasks.filter(t => t.status === 'completed');
    const failed = allTasks.filter(t => t.status === 'failed');
    const blocked = allTasks.filter(t => t.status === 'blocked');
    const current = this.currentTaskId ? this.tasks.get(this.currentTaskId) : undefined;

    const totalTasks = allTasks.length || 1;
    const progress = Math.round((completed.length / totalTasks) * 100);

    return {
      currentTask: current,
      completedTasks: completed,
      failedTasks: failed,
      blockedTasks: blocked,
      overallProgress: progress,
      state: this.stateMachine.getState(),
      iteration: this.iterationCount
    };
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get task result
   */
  getTaskResult(taskId: string): TaskResult | undefined {
    return this.taskResults.get(taskId);
  }

  /**
   * Check if orchestrator is currently running
   */
  isBusy(): boolean {
    return this.isRunning;
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return this.stateMachine.getState();
  }

  /**
   * Reset the orchestrator
   */
  reset(): void {
    this.stateMachine.reset();
    this.isRunning = false;
    this.currentTaskId = undefined;
    this.iterationCount = 0;
  }

  /**
   * Serialize state for checkpointing
   */
  serialize(): string {
    return JSON.stringify({
      tasks: Array.from(this.tasks.entries()),
      results: Array.from(this.taskResults.entries()),
      currentTaskId: this.currentTaskId,
      iterationCount: this.iterationCount,
      isRunning: this.isRunning,
      stateMachine: this.stateMachine.serialize()
    });
  }

  /**
   * Deserialize state from checkpoint
   */
  static deserialize(data: string, config: OrchestratorConfig = {}): TaskOrchestrator {
    const orchestrator = new TaskOrchestrator(config);
    const parsed = JSON.parse(data);

    parsed.tasks.forEach(([id, task]: [string, TaskDefinition]) => {
      orchestrator.tasks.set(id, task);
    });

    parsed.results.forEach(([id, result]: [string, TaskResult]) => {
      orchestrator.taskResults.set(id, result);
    });

    orchestrator.currentTaskId = parsed.currentTaskId;
    orchestrator.iterationCount = parsed.iterationCount;
    orchestrator.isRunning = parsed.isRunning;

    return orchestrator;
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export function createOrchestrator(config?: OrchestratorConfig): TaskOrchestrator {
  return new TaskOrchestrator(config);
}
