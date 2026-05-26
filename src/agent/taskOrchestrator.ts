export interface TaskStep {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  dependencies: string[];
  result?: unknown;
  error?: string;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export class TaskOrchestrator {
  private plan: TaskPlan | null = null;
  private stepCounter = 0;

  createPlan(goal: string): TaskPlan {
    this.plan = {
      id: `task_${Date.now()}`,
      goal,
      steps: [],
      status: 'pending'
    };
    this.stepCounter = 0;
    return this.plan;
  }

  addStep(description: string, dependencies: string[] = []): TaskStep {
    if (!this.plan) throw new Error('No active plan');
    
    const step: TaskStep = {
      id: `step_${++this.stepCounter}`,
      description,
      status: 'pending',
      dependencies
    };
    
    this.plan.steps.push(step);
    return step;
  }

  getPendingSteps(): TaskStep[] {
    if (!this.plan) return [];
    return this.plan.steps.filter(s => s.status === 'pending');
  }

  getInProgressSteps(): TaskStep[] {
    if (!this.plan) return [];
    return this.plan.steps.filter(s => s.status === 'in_progress');
  }

  completeStep(stepId: string, result?: unknown): void {
    const step = this.plan?.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'completed';
      step.result = result;
    }
    this.updatePlanStatus();
  }

  failStep(stepId: string, error: string): void {
    const step = this.plan?.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      step.error = error;
    }
    this.updatePlanStatus();
  }

  startStep(stepId: string): void {
    const step = this.plan?.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'in_progress';
    }
    if (this.plan) this.plan.status = 'in_progress';
  }

  private updatePlanStatus(): void {
    if (!this.plan) return;
    
    if (this.plan.steps.every(s => s.status === 'completed')) {
      this.plan.status = 'completed';
    } else if (this.plan.steps.some(s => s.status === 'failed')) {
      this.plan.status = 'failed';
    }
  }

  getPlan(): TaskPlan | null {
    return this.plan;
  }

  reset(): void {
    this.plan = null;
    this.stepCounter = 0;
  }
}