import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, appendWorkflowEvent } from '../utils/index.mjs';
import { emitAgentEvent } from '../state.mjs';

export function registerQualityTools(server, getSessionId) {
  server.registerTool('submit_test_result', {
    title: 'Submit Test Result',
    description: 'Submit test results (pass/fail) as an artifact.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      testName: z.string(),
      passed: z.boolean(),
      details: z.string().optional(),
    }
  }, async (args) => {
    return server.callTool('write_artifact', {
      ...args,
      kind: 'test_result',
      title: `Test Result: ${args.testName} (${args.passed ? 'PASS' : 'FAIL'})`,
      contentText: args.details,
      metadataJson: { testName: args.testName, passed: args.passed }
    });
  });

  server.registerTool('submit_risk_report', {
    title: 'Submit Risk Report',
    description: 'Submit a risk assessment report.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      risk: z.string(),
      mitigation: z.string().optional(),
    }
  }, async (args) => {
    return server.callTool('write_artifact', {
      ...args,
      kind: 'risk_report',
      title: `Risk Report: ${args.severity.toUpperCase()}`,
      contentText: `${args.risk}${args.mitigation ? `\n\nMitigation: ${args.mitigation}` : ''}`,
      metadataJson: { severity: args.severity }
    });
  });

  server.registerTool('submit_quality_signal', {
    title: 'Submit Quality Signal',
    description: 'Submit a quality signal (score/metric) for a node or mission.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string().optional(),
      signalType: z.string().describe('e.g. "coverage", "complexity", "lint_errors"'),
      value: z.number(),
      threshold: z.number().optional(),
    }
  }, async ({ missionId, nodeId, signalType, value, threshold }) => {
    const sid = getSessionId() ?? 'unknown';
    appendWorkflowEvent({
      missionId,
      nodeId,
      sessionId: sid,
      type: 'quality_signal',
      message: `Quality signal ${signalType}: ${value}${threshold !== undefined ? ` (threshold ${threshold})` : ''}`,
      payload: { signalType, value, threshold }
    });
    return { content: [{ type: 'text', text: 'Quality signal submitted.' }] };
  });

  server.registerTool('request_quality_gate', {
    title: 'Request Quality Gate',
    description: 'Request a quality gate review for the current mission or node.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string().optional(),
      objective: z.string().optional().describe('What specifically needs to be checked'),
    }
  }, async ({ missionId, nodeId, objective }) => {
    const sid = getSessionId() ?? 'unknown';
    appendWorkflowEvent({
      missionId,
      nodeId,
      sessionId: sid,
      type: 'quality_gate_requested',
      message: `Quality gate requested${objective ? `: ${objective}` : ''}.`,
      payload: { objective }
    });
    return { content: [{ type: 'text', text: 'Quality gate requested. Mission Control will schedule a reviewer.' }] };
  });
}
