export enum AgentState {
  ANY = 'any',
  IDLE = 'idle',
  PLANNING = 'planning',
  EXECUTING = 'executing',
  VERIFYING = 'verifying',
  SUCCESS = 'success',
  FAILURE = 'failure',
  BLOCKED = 'blocked',
  RETRY = 'retry'
}

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: string;
}

const TRANSITIONS: StateTransition[] = [
  // Any state can start a new task (required for REPL multi-turn)
  { from: AgentState.ANY, to: AgentState.PLANNING, trigger: 'start_task' },
  { from: AgentState.IDLE, to: AgentState.PLANNING, trigger: 'start_task' },
  { from: AgentState.PLANNING, to: AgentState.EXECUTING, trigger: 'tool_calls_received' },
  { from: AgentState.EXECUTING, to: AgentState.EXECUTING, trigger: 'tool_calls_received' },
  { from: AgentState.EXECUTING, to: AgentState.VERIFYING, trigger: 'tool_executed' },
  { from: AgentState.EXECUTING, to: AgentState.SUCCESS, trigger: 'verification_passed' },
  { from: AgentState.VERIFYING, to: AgentState.EXECUTING, trigger: 'retry_needed' },
  { from: AgentState.VERIFYING, to: AgentState.SUCCESS, trigger: 'verification_passed' },
  { from: AgentState.VERIFYING, to: AgentState.RETRY, trigger: 'verification_failed' },
  { from: AgentState.RETRY, to: AgentState.EXECUTING, trigger: 'tool_calls_received' },
  { from: AgentState.EXECUTING, to: AgentState.FAILURE, trigger: 'max_retries_exceeded' },
  { from: AgentState.EXECUTING, to: AgentState.BLOCKED, trigger: 'user_intervention_needed' },
  { from: AgentState.BLOCKED, to: AgentState.EXECUTING, trigger: 'tool_calls_received' },
  { from: AgentState.SUCCESS, to: AgentState.EXECUTING, trigger: 'tool_calls_received' },
  { from: AgentState.ANY, to: AgentState.BLOCKED, trigger: 'interrupted' },
];

export class StateMachine {
  private state: AgentState = AgentState.IDLE;
  private stateHistory: AgentState[] = [];

  getCurrent(): AgentState {
    return this.state;
  }

  canTransition(to: AgentState): boolean {
    const validDirect = TRANSITIONS.some(t => t.from === this.state && t.to === to);
    const validWildcard = TRANSITIONS.some(t => t.from === AgentState.ANY && t.to === to);
    return validDirect || validWildcard;
  }

  transition(to: AgentState, trigger: string, metadata?: Record<string, unknown>): boolean {
    const valid = this.canTransition(to) || 
                  TRANSITIONS.some(t => t.from === AgentState.ANY && t.to === to && t.trigger === trigger);
    
    if (!valid) {
      console.warn(`Invalid state transition: ${this.state} -> ${to} via ${trigger}`);
      return false;
    }

    this.stateHistory.push(this.state);
    this.state = to;
    
    return true;
  }

  reset(): void {
    this.state = AgentState.IDLE;
    this.stateHistory = [];
  }

  getHistory(): AgentState[] {
    return [...this.stateHistory];
  }
}