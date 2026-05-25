/**
 * PHASE 1: Minimal Viable Runtime - State Machine
 * 
 * This module implements a formal state machine for the agent runtime.
 * The LLM is NOT the agent - it's only a reasoner/next-action predictor.
 * The runtime controls execution, verification, retries, and state transitions.
 */

export type AgentState =
  | 'IDLE'
  | 'PLANNING'
  | 'INSPECTING'
  | 'EDITING'
  | 'VERIFYING'
  | 'RETRYING'
  | 'BLOCKED'
  | 'COMPLETED'
  | 'FAILED';

export type StateTransition = {
  from: AgentState;
  to: AgentState;
  trigger: string;
  guard?: () => boolean;
  action?: () => void | Promise<void>;
};

export interface StateMachineConfig {
  initialState: AgentState;
  maxRetries?: number;
  onTransition?: (from: AgentState, to: AgentState, trigger: string) => void;
  onError?: (state: AgentState, error: Error) => void;
}

export interface StateMachineResult {
  success: boolean;
  newState: AgentState;
  previousState: AgentState;
  transition?: StateTransition;
  error?: string;
}

export class StateMachine {
  private currentState: AgentState;
  private readonly transitions: Map<string, StateTransition[]>;
  private readonly config: Required<StateMachineConfig>;
  private retryCount: number = 0;
  private stateHistory: Array<{ state: AgentState; timestamp: number; trigger: string }> = [];

  constructor(config: StateMachineConfig) {
    this.currentState = config.initialState;
    this.config = {
      initialState: config.initialState,
      maxRetries: config.maxRetries ?? 3,
      onTransition: config.onTransition ?? (() => {}),
      onError: config.onError ?? (() => {}),
    };
    this.transitions = new Map();
    this.initializeDefaultTransitions();
  }

  private initializeDefaultTransitions(): void {
    // IDLE transitions
    this.addTransition({
      from: 'IDLE',
      to: 'PLANNING',
      trigger: 'start_task',
      action: () => { this.retryCount = 0; }
    });

    // PLANNING transitions
    this.addTransition({
      from: 'PLANNING',
      to: 'INSPECTING',
      trigger: 'plan_created'
    });
    this.addTransition({
      from: 'PLANNING',
      to: 'EDITING',
      trigger: 'direct_edit'
    });
    this.addTransition({
      from: 'PLANNING',
      to: 'BLOCKED',
      trigger: 'plan_blocked'
    });
    this.addTransition({
      from: 'PLANNING',
      to: 'FAILED',
      trigger: 'plan_failed'
    });

    // INSPECTING transitions
    this.addTransition({
      from: 'INSPECTING',
      to: 'EDITING',
      trigger: 'inspection_complete'
    });
    this.addTransition({
      from: 'INSPECTING',
      to: 'PLANNING',
      trigger: 'need_replan'
    });
    this.addTransition({
      from: 'INSPECTING',
      to: 'BLOCKED',
      trigger: 'inspection_blocked'
    });

    // EDITING transitions
    this.addTransition({
      from: 'EDITING',
      to: 'VERIFYING',
      trigger: 'edit_complete'
    });
    this.addTransition({
      from: 'EDITING',
      to: 'RETRYING',
      trigger: 'edit_failed',
      guard: () => this.retryCount < this.config.maxRetries
    });
    this.addTransition({
      from: 'EDITING',
      to: 'BLOCKED',
      trigger: 'edit_blocked'
    });

    // VERIFYING transitions
    this.addTransition({
      from: 'VERIFYING',
      to: 'COMPLETED',
      trigger: 'verification_passed'
    });
    this.addTransition({
      from: 'VERIFYING',
      to: 'RETRYING',
      trigger: 'verification_failed',
      guard: () => this.retryCount < this.config.maxRetries
    });
    this.addTransition({
      from: 'VERIFYING',
      to: 'EDITING',
      trigger: 'verification_fixable'
    });
    this.addTransition({
      from: 'VERIFYING',
      to: 'BLOCKED',
      trigger: 'verification_blocked'
    });

    // RETRYING transitions
    this.addTransition({
      from: 'RETRYING',
      to: 'PLANNING',
      trigger: 'retry_replan',
      action: () => { this.retryCount++; }
    });
    this.addTransition({
      from: 'RETRYING',
      to: 'EDITING',
      trigger: 'retry_edit',
      action: () => { this.retryCount++; }
    });
    this.addTransition({
      from: 'RETRYING',
      to: 'FAILED',
      trigger: 'retry_exhausted'
    });

    // BLOCKED transitions
    this.addTransition({
      from: 'BLOCKED',
      to: 'PLANNING',
      trigger: 'block_resolved'
    });
    this.addTransition({
      from: 'BLOCKED',
      to: 'FAILED',
      trigger: 'block_unresolvable'
    });

    // Recovery transitions
    this.addTransition({
      from: 'FAILED',
      to: 'IDLE',
      trigger: 'reset'
    });
    this.addTransition({
      from: 'COMPLETED',
      to: 'IDLE',
      trigger: 'reset'
    });
  }

  private addTransition(transition: StateTransition): void {
    const key = transition.from;
    if (!this.transitions.has(key)) {
      this.transitions.set(key, []);
    }
    this.transitions.get(key)!.push(transition);
  }

  getState(): AgentState {
    return this.currentState;
  }

  getHistory(): typeof this.stateHistory {
    return [...this.stateHistory];
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  async transition(trigger: string): Promise<StateMachineResult> {
    const previousState = this.currentState;
    const availableTransitions = this.transitions.get(this.currentState) ?? [];

    const matchingTransition = availableTransitions.find(t => {
      if (t.trigger !== trigger) return false;
      if (t.guard && !t.guard()) return false;
      return true;
    });

    if (!matchingTransition) {
      const availableTriggers = availableTransitions.map(t => t.trigger).join(', ');
      const error = `Invalid transition: cannot ${trigger} from ${this.currentState}. Available: ${availableTriggers || 'none'}`;
      this.config.onError(this.currentState, new Error(error));
      return {
        success: false,
        newState: this.currentState,
        previousState,
        error
      };
    }

    try {
      if (matchingTransition.action) {
        await matchingTransition.action();
      }

      this.currentState = matchingTransition.to;
      this.stateHistory.push({
        state: this.currentState,
        timestamp: Date.now(),
        trigger
      });

      this.config.onTransition(previousState, this.currentState, trigger);

      return {
        success: true,
        newState: this.currentState,
        previousState,
        transition: matchingTransition
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.config.onError(this.currentState, err);
      return {
        success: false,
        newState: this.currentState,
        previousState,
        error: err.message
      };
    }
  }

  async forceTransition(to: AgentState, trigger: string): Promise<StateMachineResult> {
    const previousState = this.currentState;
    this.currentState = to;
    this.stateHistory.push({
      state: this.currentState,
      timestamp: Date.now(),
      trigger
    });
    this.config.onTransition(previousState, this.currentState, trigger);
    
    return {
      success: true,
      newState: this.currentState,
      previousState
    };
  }

  isInTerminalState(): boolean {
    return this.currentState === 'COMPLETED' || this.currentState === 'FAILED';
  }

  canTransition(trigger: string): boolean {
    const availableTransitions = this.transitions.get(this.currentState) ?? [];
    return availableTransitions.some(t => 
      t.trigger === trigger && (!t.guard || t.guard())
    );
  }

  reset(): void {
    this.currentState = this.config.initialState;
    this.retryCount = 0;
    this.stateHistory.push({
      state: this.currentState,
      timestamp: Date.now(),
      trigger: 'manual_reset'
    });
  }

  serialize(): string {
    return JSON.stringify({
      currentState: this.currentState,
      retryCount: this.retryCount,
      historyLength: this.stateHistory.length,
      lastTransition: this.stateHistory[this.stateHistory.length - 1]
    });
  }
}

export function createStateMachine(config: StateMachineConfig): StateMachine {
  return new StateMachine(config);
}
