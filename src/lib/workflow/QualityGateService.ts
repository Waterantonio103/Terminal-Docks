/**
 * QualityGateService.ts — Final mission approval governance.
 *
 * This service evaluates completed mission runs against a set of quality
 * requirements (artifacts, test results, security risks) before allowing
 * a mission to be marked as 'approved'.
 *
 * Phase 11 — Quality Gate
 */

import type { WorkflowRun } from './WorkflowRun.js';
import { getNodeState } from './WorkflowRun.js';
import type { Artifact } from './WorkflowTypes.js';

export type QualityGateStatus =
  | 'waiting_for_inputs'
  | 'reviewing'
  | 'approved'
  | 'rejected'
  | 'retry_requested'
  | 'manual_review_required';

export interface QualityGateResult {
  status: QualityGateStatus;
  passed: boolean;
  reasons: string[];
  missingArtifacts: string[];
  unresolvedRisks: Artifact[];
}

export class QualityGateService {
  /**
   * Evaluates a workflow run against quality requirements.
   */
  evaluate(run: WorkflowRun): QualityGateResult {
    const reasons: string[] = [];
    const missingArtifacts: string[] = [];
    const unresolvedRisks: Artifact[] = [];

    // 1. Check if all required nodes are completed
    const requiredNodes = run.definition.nodes.filter(n => n.kind === 'agent');
    const incompleteNodes = requiredNodes.filter(n => {
      const state = getNodeState(run, n.id);
      return !state || (state.state !== 'completed' && state.state !== 'failed');
    });

    if (incompleteNodes.length > 0) {
      reasons.push(`Incomplete nodes: ${incompleteNodes.map(n => n.id).join(', ')}`);
      return { status: 'waiting_for_inputs', passed: false, reasons, missingArtifacts, unresolvedRisks };
    }

    // 2. Check for required artifacts by mission type
    const goal = (run.definition.nodes.find(n => n.kind === 'task') as any)?.config?.prompt || '';
    const taskType = this.inferTaskType(goal);
    
    const requiredArtifactKinds = this.getRequiredArtifactKinds(taskType);
    const allArtifacts = Object.values(run.nodeStates).flatMap(ns => 
        ns.attempts.flatMap(attempt => attempt.artifacts)
    );

    for (const kind of requiredArtifactKinds) {
      const exists = allArtifacts.some(a => a.kind === (kind as any));
      if (!kind.startsWith('optional_') && !exists) {
        missingArtifacts.push(kind);
      }
    }

    if (missingArtifacts.length > 0) {
      reasons.push(`Missing required artifacts: ${missingArtifacts.join(', ')}`);
    }

    // 3. Check for high-severity risks
    const risks = allArtifacts.filter(a => a.kind === 'risk_report' || a.kind === 'summary');
    for (const risk of risks) {
        const content = (risk.content || '').toUpperCase();
        if (content.includes('CRITICAL') || content.includes('HIGH SEVERITY')) {
            unresolvedRisks.push(risk);
        }
    }

    if (unresolvedRisks.length > 0) {
      reasons.push(`Unresolved high-severity risks found in artifacts.`);
    }

    // 4. Check test results
    const testResults = allArtifacts.filter(a => a.kind === 'test_result' || a.label.toLowerCase().includes('test result'));
    const failedTests = testResults.filter(t => (t.content || '').toUpperCase().includes('FAIL'));
    
    if (testResults.length === 0 && taskType !== 'docs') {
        reasons.push(`No test results found for technical task.`);
    }
    
    if (failedTests.length > 0) {
        reasons.push(`${failedTests.length} test failure(s) detected.`);
    }

    const passed = reasons.length === 0;
    const status: QualityGateStatus = passed ? 'approved' : 'rejected';

    return {
      status,
      passed,
      reasons,
      missingArtifacts,
      unresolvedRisks,
    };
  }

  private inferTaskType(goal: string): string {
    const low = goal.toLowerCase();
    if (low.includes('security') || low.includes('vulnerability')) return 'security';
    if (low.includes('fix') || low.includes('bug')) return 'bugfix';
    if (low.includes('doc') || low.includes('readme')) return 'docs';
    return 'generic';
  }

  private getRequiredArtifactKinds(taskType: string): string[] {
    switch (taskType) {
      case 'bugfix':
        return ['scout_context', 'patch', 'test_result'];
      case 'security':
        return ['scout_context', 'patch', 'risk_report', 'test_result'];
      case 'docs':
        return ['scout_context', 'patch'];
      default:
        return ['scout_context', 'patch', 'test_result'];
    }
  }
}

export const qualityGateService = new QualityGateService();
