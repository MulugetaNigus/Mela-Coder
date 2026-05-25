/**
 * PHASE 3: Enhanced Verification Engine
 * 
 * Advanced verification with:
 * - Failure classification
 * - Auto-repair loops
 * - Targeted verification
 * - Regression detection
 */

export { VerificationChain, VerificationStepResult } from './chain.js';
export { FailureClassifier, createFailureClassifier, type FailureDetails, type FailureCategory, type FailureSeverity } from './failureClassifier.js';
export { AutoRepairLoop, createAutoRepairLoop, type RepairAttempt, type AutoRepairConfig } from './autoRepair.js';
export { TargetedVerifier, createTargetedVerifier, type VerificationTarget, type TargetedVerificationConfig, type TargetedVerificationResult } from './targetedVerifier.js';
