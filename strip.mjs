import fs from 'fs';

const file = 'src/components/MissionControl/MissionControlPane.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Remove buildNewTaskSignal and RuntimeActivationPayload
code = code.replace(/  buildNewTaskSignal,\n/g, '');
code = code.replace(/  type RuntimeActivationPayload,\n/g, '');

// 2. Remove runtimeBootstrap import
code = code.replace(/import \{\n  buildRuntimeBootstrapRegistrationRequest,\n  getRuntimeBootstrapContract,\n  normalizeRuntimeCli,\n\} from '\.\.\/\.\.\/lib\/runtimeBootstrap';\n/g, '');

// 3. Remove runtimeDispatcher import
code = code.replace(/import \{ buildStartAgentRunRequest, isHeadlessExecutionMode \} from '\.\.\/\.\.\/lib\/runtimeDispatcher';\n/g, '');

// 4. Remove timeouts
code = code.replace(/const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;\n/g, '');
code = code.replace(/const TASK_ACK_TIMEOUT_MS = 30_000;\n/g, '');

// 5. Remove waitForRuntimeActivationState
const waitForIdx = code.indexOf('async function waitForRuntimeActivationState');
if (waitForIdx !== -1) {
  const endIdx = code.indexOf('}\n\nfunction formatTime', waitForIdx);
  if (endIdx !== -1) {
    code = code.slice(0, waitForIdx) + code.slice(endIdx + 2);
  }
}

// 6. Remove buildTerminalActivationInput
const buildTermIdx = code.indexOf('function buildTerminalActivationInput');
if (buildTermIdx !== -1) {
  const endIdx = code.indexOf('}\n\nfunction focusAgentTerminal', buildTermIdx);
  if (endIdx !== -1) {
    code = code.slice(0, buildTermIdx) + code.slice(endIdx + 2);
  }
}

// 7. Remove getTerminalRuntimeConfig
const getTermConfigIdx = code.indexOf('function getTerminalRuntimeConfig');
if (getTermConfigIdx !== -1) {
  const endIdx = code.indexOf('}\n\nfunction runtimeBootstrapLabel', getTermConfigIdx);
  if (endIdx !== -1) {
    code = code.slice(0, getTermConfigIdx) + code.slice(endIdx + 2);
  }
}

// 8. Remove processActivation logic and listeners from the big useEffect
const effectIdx = code.indexOf('// Mission Control drives the explicit runtime lifecycle');
if (effectIdx !== -1) {
  const endIdx = code.indexOf('  useEffect(() => {\n    const latestUrl', effectIdx);
  if (endIdx !== -1) {
    code = code.slice(0, effectIdx) + code.slice(endIdx);
  }
}

// 9. Remove inflightActivationsRef
code = code.replace(/  const inflightActivationsRef = useRef<Set<string>>\(new Set\(\)\);\n/g, '');

// 10. Remove sessionUnsubscribersRef (since it was used for the listeners we deleted)
// Wait, the cleanup in the first useEffect is also related to it
code = code.replace(/  const sessionUnsubscribersRef = useRef<Map<string, \(\) => void>>\(new Map\(\)\);\n/g, '');

const cleanupIdx = code.indexOf('  useEffect(() => {\n    return () => {\n      for (const unsubscribe of sessionUnsubscribersRef.current.values())');
if (cleanupIdx !== -1) {
  const endIdx = code.indexOf('  // Watch for PTY spawn events', cleanupIdx);
  if (endIdx !== -1) {
    code = code.slice(0, cleanupIdx) + code.slice(endIdx);
  }
}

// 11. Remove sessionUnsubscribersRef references from pty-exit / pty-spawn or node-update if any exist inside the remaining code.
// Actually, `workflow-node-update` was inside the big useEffect, which we deleted entirely!
// Wait! Does `MissionControlPane` still need to listen to `workflow-node-update` to update its `agents` array state??
// The prompt says: "Keep MissionControlPane.tsx only as: inspector, logs viewer, state visualizer, debug tool. Workflows must be able to run without this pane mounted."
// But it visualizes the state by reading from the workspace store! Oh, wait, the workspace store must be updated.
// Let's check where `updatePaneData` is used. 
// If `MissionControlPane` updates `pane.data.agents` in response to `workflow-node-update`, then removing the whole block will break visualization!

fs.writeFileSync(file, code);
console.log('done');
