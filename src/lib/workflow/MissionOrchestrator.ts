/**
 * MissionOrchestrator.ts — Top-level mission progression controller.
 *
 * This class formalizes the mission lifecycle: creation from goals,
 * progression via the tick loop, and persistence via missionRepository.
 *
 * It delegates the heavy lifting of state transitions and runtime
 * management to WorkflowOrchestrator.
 *
 * Phase 6 — Mission Orchestrator
 */

import { workflowOrchestrator } from './WorkflowOrchestrator.js';
import type { WorkflowDefinition } from './WorkflowDefinition.js';
import { compiledMissionToDefinition } from './WorkflowDefinition.js';
import { missionRepository } from '../missionRepository.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import type { CompiledMission } from '../../store/workspace.js';
import { qualityGateService } from './QualityGateService.js';

export interface MissionOptions {
  missionId?: string;
  workspaceDir?: string | null;
  definition?: WorkflowDefinition;
}

export class MissionOrchestrator {
  constructor() {
    // Automatically tick when nodes complete or fail
    workflowOrchestrator.subscribe(async (event) => {
      const run = workflowOrchestrator.getRun(event.runId);
      const nodeState = (event as any).nodeId ? run?.nodeStates[(event as any).nodeId] : undefined;

      if (event.type === 'node_completed' || event.type === 'node_failed') {
        await missionRepository.appendWorkflowEvent({
          missionId: event.runId,
          nodeId: event.nodeId,
          sessionId: nodeState?.runtimeSession?.sessionId,
          eventType: event.type === 'node_completed' ? 'node_completed' : 'node_failed',
          severity: event.type === 'node_completed' ? 'info' : 'error',
          message: event.type === 'node_completed' 
            ? `Node ${event.nodeId} completed successfully.` 
            : `Node ${event.nodeId} failed: ${event.error || 'Unknown error'}`,
          payloadJson: JSON.stringify({ 
            outcome: (event as any).outcome, 
            attempt: (event as any).attempt,
            error: (event as any).error 
          }),
        }).catch(console.error);

        this.tick(event.runId).catch(console.error);
      } else if (event.type === 'node_state_changed') {
        await missionRepository.appendWorkflowEvent({
          missionId: event.runId,
          nodeId: event.nodeId,
          sessionId: nodeState?.runtimeSession?.sessionId,
          eventType: 'node_updated',
          severity: 'info',
          message: `Node ${event.nodeId} state changed from ${event.from} to ${event.to}.`,
          payloadJson: JSON.stringify({ from: event.from, to: event.to }),
        }).catch(console.error);
      } else if (event.type === 'artifact_published') {
        await missionRepository.appendWorkflowEvent({
          missionId: event.runId,
          nodeId: event.nodeId,
          sessionId: nodeState?.runtimeSession?.sessionId,
          eventType: 'artifact_written',
          severity: 'info',
          message: `Artifact written for node ${event.nodeId}: ${event.artifact.label} (${event.artifact.kind})`,
          payloadJson: JSON.stringify(event.artifact),
        }).catch(console.error);
      }
    });
  }

  /**
   * Starts a new mission from an IDE goal.
   */
  async startMission(goal: string, options: MissionOptions = {}): Promise<string> {
    const missionId = options.missionId ?? `mission-${Date.now()}`;
    const workspaceDir = options.workspaceDir ?? useWorkspaceStore.getState().workspaceDir;
    
    // 1. Persist mission record
    await missionRepository.upsertMission({
      missionId,
      goal,
      status: 'active',
      workspaceDir,
    });

    // 2. Resolve definition (use global graph if not provided)
    const definition = options.definition ?? this.getGlobalDefinition();

    // 3. Start the workflow run
    workflowOrchestrator.startRun(definition, {
      runId: missionId,
      missionId,
      workspaceDir,
    });

    // 4. Record initial event
    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'mission_created',
      severity: 'info',
      message: `Mission created with goal: ${goal}`,
      payloadJson: JSON.stringify({ goal, workspaceDir }),
    });

    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'dag_planned',
      severity: 'info',
      message: `DAG planned with ${definition.nodes.length} nodes and ${definition.edges.length} edges.`,
      payloadJson: JSON.stringify({ 
        nodeCount: definition.nodes.length,
        edgeCount: definition.edges.length,
        nodes: definition.nodes.map(n => ({ id: n.id, kind: n.kind, roleId: n.roleId }))
      }),
    });

    for (const node of definition.nodes) {
      await missionRepository.appendWorkflowEvent({
        missionId,
        nodeId: node.id,
        eventType: 'node_created',
        severity: 'info',
        message: `Node ${node.id} (${node.kind}) created in workflow.`,
        payloadJson: JSON.stringify(node),
      }).catch(console.error);
    }

    return missionId;
  }

  /**
   * Launches a pre-compiled mission.
   */
  async launchMission(mission: CompiledMission): Promise<void> {
    const missionId = mission.missionId;
    const workspaceDir = mission.task.workspaceDir;

    // 1. Persist mission record
    await missionRepository.upsertMission({
      missionId,
      goal: mission.task.prompt,
      status: 'active',
      workspaceDir,
    });

    // 2. Start the workflow run
    const definition = compiledMissionToDefinition(mission);
    workflowOrchestrator.startRun(definition, {
      runId: missionId,
      missionId,
      workspaceDir,
    });

    // 3. Record event
    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'mission_created',
      severity: 'info',
      message: `Mission launched via Launcher: ${mission.task.prompt.slice(0, 50)}...`,
    });

    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'dag_planned',
      severity: 'info',
      message: `DAG planned from compiled mission with ${definition.nodes.length} nodes.`,
      payloadJson: JSON.stringify({
        nodeCount: definition.nodes.length,
        nodes: definition.nodes.map(n => ({ id: n.id, kind: n.kind, roleId: n.roleId }))
      }),
    });
  }

  /**
   * Runs the entire mission DAG.
   */
  async runMission(missionId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found in orchestrator.`);

    await missionRepository.updateMissionStatus({
      missionId,
      status: 'running',
    });

    await this.tick(missionId);
  }

  /**
   * Runs a specific node in the DAG.
   */
  async runNode(missionId: string, nodeId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    workflowOrchestrator.activateNodeInternal(run, nodeId);
    await this.tick(missionId);
  }

  /**
   * Runs a node and its downstream dependents.
   */
  async runSubtree(missionId: string, nodeId: string): Promise<void> {
    // This is essentially starting from a node and letting tick handle the rest
    await this.runNode(missionId, nodeId);
  }

  /**
   * Manually triggers a retry for a specific node.
   */
  async retryNode(missionId: string, nodeId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    workflowOrchestrator.activateNodeInternal(run, nodeId);
    await this.tick(missionId);
  }

  /**
   * Cancels a specific node and stops its runtime.
   */
  async cancelNode(missionId: string, nodeId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    const nodeState = run.nodeStates[nodeId];
    if (nodeState && nodeState.runtimeSession?.sessionId) {
      await workflowOrchestrator.getRuntimeManager()?.stopRuntime({ sessionId: nodeState.runtimeSession.sessionId });
    }

    workflowOrchestrator.failNode(missionId, nodeId, 'Cancelled by user');
  }

  /**
   * Pauses mission progression.
   */
  async pauseMission(missionId: string): Promise<void> {
    await missionRepository.updateMissionStatus({
      missionId,
      status: 'paused',
    });
    
    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'mission_paused',
      severity: 'info',
      message: 'Mission paused by user.',
    });
  }

  /**
   * Resumes mission progression.
   */
  async resumeMission(missionId: string): Promise<void> {
    await missionRepository.updateMissionStatus({
      missionId,
      status: 'active',
    });

    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'mission_resumed',
      severity: 'info',
      message: 'Mission resumed by user.',
    });

    await this.tick(missionId);
  }

  /**
   * Cancels the mission and stops all runtimes.
   */
  async cancelMission(missionId: string): Promise<void> {
    workflowOrchestrator.cancelRun(missionId);

    await missionRepository.updateMissionStatus({
      missionId,
      status: 'cancelled',
    });

    await missionRepository.appendWorkflowEvent({
      missionId,
      eventType: 'mission_cancelled',
      severity: 'warning',
      message: 'Mission cancelled by user.',
    });
  }
/**
 * Approves a delegated task from the inbox.
 * If it's a new node, it's added to the mission DAG.
 */
async approveDelegation(missionId: string, itemId: number): Promise<void> {
  // 1. Mark as approved in MCP database
  await missionRepository.invokeMcp('approve_inbox_item', { itemId });

  // 2. Trigger tick to process approved item
  await this.tick(missionId);
}

/**
 * Rejects a delegated task.
 */
async rejectDelegation(_missionId: string, itemId: number, reason: string): Promise<void> {
  await missionRepository.invokeMcp('reject_inbox_item', { itemId, reason });
}
  /**
   * Resumes a node from manual takeover, allowing the agent to continue.
   */
  async resumeNode(missionId: string, nodeId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    const nodeState = run.nodeStates[nodeId];
    if (!nodeState || nodeState.state !== 'manual_takeover') {
      throw new Error(`Node ${nodeId} is not in manual takeover state.`);
    }

    // Transition to injecting_task to let the orchestrator try to continue
    workflowOrchestrator.transitionNodeState(run, nodeId, 'injecting_task');
    
    // We might need to tell RuntimeManager to actually perform the injection now
    if (nodeState.runtimeSession?.sessionId) {
      const rm = workflowOrchestrator.getRuntimeManager();
      if (rm) {
        // We reuse the existing session and try to reinject the task
        await rm.reinjectTask(nodeState.runtimeSession.sessionId);
      }
    }
  }

  /**
   * Manually completes a node with a given outcome and summary.
   */
  async forceCompleteNode(missionId: string, nodeId: string, outcome: 'success' | 'failure', summary: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    workflowOrchestrator.completeNode({
      nodeId,
      attempt: run.nodeStates[nodeId]?.attempt || 1,
      outcome,
      summary,
    });

    await this.tick(missionId);
  }

  /**
   * Manually fails a node with a given error.
   */
  async forceFailNode(missionId: string, nodeId: string, error: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run) throw new Error(`Mission ${missionId} not found.`);

    workflowOrchestrator.failNode(missionId, nodeId, error);
    await this.tick(missionId);
  }

  /**
   * The core progression loop.
   * Checks for eligible nodes and starts them.
   */
  async tick(missionId: string): Promise<void> {
    const run = workflowOrchestrator.getRun(missionId);
    if (!run || (run.status as any) !== 'running') return;

    // 1. Check for normal node eligibility and activation
    const eligibleNodes = this.findEligibleNodes(run);
    for (const nodeId of eligibleNodes) {
      await missionRepository.appendWorkflowEvent({
        missionId,
        nodeId,
        eventType: 'node_eligible',
        severity: 'info',
        message: `Node ${nodeId} is eligible for execution.`,
      }).catch(console.error);

      workflowOrchestrator.activateNodeInternal(run, nodeId);
    }
    
    workflowOrchestrator.checkRunCompletion(run);

    // 2. Phase 11: Quality Gate Check
    if (run.status === 'completed') {
      await this.evaluateQualityGate(missionId, run);
    }
  }

  private async evaluateQualityGate(missionId: string, run: any): Promise<void> {
    const qgResult = qualityGateService.evaluate(run);
    
    if (qgResult.status === 'approved') {
      await missionRepository.updateMissionStatus({
        missionId,
        status: 'approved',
      });

      await missionRepository.appendWorkflowEvent({
        missionId,
        eventType: 'quality_approved',
        severity: 'info',
        message: 'Mission passed quality gate and is approved.',
        payloadJson: JSON.stringify(qgResult),
      });

      // Produce final IDE result summary
      const allArtifacts = Object.values(run.nodeStates).flatMap((ns: any) => ns.artifacts);
      const summary = allArtifacts.find((a: any) => a.kind === 'summary' || a.kind === 'review_verdict')?.content || 'No summary available.';
      
      await missionRepository.updateMissionStatus({
          missionId,
          status: 'completed',
          finalSummary: `Quality Gate PASSED.\n\n${summary}`,
      });
    } else if (qgResult.status === 'rejected') {
      await missionRepository.appendWorkflowEvent({
        missionId,
        eventType: 'quality_rejected',
        severity: 'error',
        message: `Quality gate rejected: ${qgResult.reasons.join('; ')}`,
        payloadJson: JSON.stringify(qgResult),
      });

      // Phase 12 will handle formal retry logic.
      console.warn(`[MissionOrchestrator] Mission ${missionId} rejected by Quality Gate:`, qgResult.reasons);
    }
  }

  private findEligibleNodes(run: any): string[] {
    const eligible: string[] = [];
    let runningCount = 0;
    
    // Count currently running nodes
    for (const node of run.definition.nodes) {
      const state = run.nodeStates[node.id];
      if (state && (state.state === 'running' || state.state === 'injecting_task' || state.state === 'awaiting_mcp_ready')) {
        runningCount++;
      }
    }

    const MAX_CONCURRENT_NODES = 5;

    for (const node of run.definition.nodes) {
      if (node.kind !== 'agent') continue;
      
      const state = run.nodeStates[node.id];
      if (state && state.state !== 'idle') continue;

      // Check fan-in
      const incomingEdges = run.definition.edges.filter((e: any) => e.toNodeId === node.id);
      const allParentsMet = incomingEdges.length === 0 || incomingEdges.every((edge: any) => {
        const parentState = run.nodeStates[edge.fromNodeId];
        if (!parentState) return false;
        if (parentState.state === 'completed') return true;
        if (edge.condition === 'on_failure' && parentState.state === 'failed') return true;
        return false;
      });

      if (allParentsMet) {
        if (runningCount + eligible.length < MAX_CONCURRENT_NODES) {
          eligible.push(node.id);
        }
      }
    }
    return eligible;
  }

  private getGlobalDefinition(): WorkflowDefinition {
    const graph = useWorkspaceStore.getState().globalGraph;
    const now = new Date().toISOString();

    return {
      id: graph.id,
      name: graph.id,
      createdAt: now,
      updatedAt: now,
      nodes: graph.nodes.map(n => ({
        id: n.id,
        kind: (n.roleId === 'task' ? 'task' : 'agent') as any,
        roleId: n.roleId,
        config: n.config ?? {},
      })),
      edges: graph.edges.map(e => ({
        fromNodeId: e.fromNodeId,
        toNodeId: e.toNodeId,
        condition: (e.condition ?? 'always') as any,
      })),
    };
  }
}

export const missionOrchestrator = new MissionOrchestrator();
