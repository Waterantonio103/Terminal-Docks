const fs = require('fs');
let code = fs.readFileSync('src/components/MissionControl/MissionControlPane.tsx', 'utf-8');

// 1. buildNewTaskSignal, RuntimeActivationPayload
code = code.replace(/\s*buildNewTaskSignal,\n/g, '');
code = code.replace(/\s*type RuntimeActivationPayload,\n/g, '');

// 2 & 3: clean up any empty imports or imports of removed modules
code = code.replace(/import\s*\{\s*\}\s*from\s*'..\/..\/lib\/runtimeBootstrap';\n/g, '');
code = code.replace(/import\s*\{\s*\}\s*from\s*'..\/..\/lib\/runtimeDispatcher';\n/g, '');
code = code.replace(/import\s*\{\s*buildStartAgentRunRequest,\s*isHeadlessExecutionMode\s*\}\s*from\s*'..\/..\/lib\/runtimeDispatcher';\n/g, '');
code = code.replace(/import\s*\{\s*buildRuntimeBootstrapRegistrationRequest,\s*getRuntimeBootstrapContract,\s*normalizeRuntimeCli,\s*\}\s*from\s*'..\/..\/lib\/runtimeBootstrap';\n/g, '');


// 4. Timeouts
code = code.replace(/const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;\n/g, '');
code = code.replace(/const TASK_ACK_TIMEOUT_MS = 30_000;\n/g, '');

// 5. waitForRuntimeActivationState
function removeBlock(keyword) {
    const start = code.indexOf(keyword);
    if (start > -1) {
        let depth = 0;
        let end = -1;
        let foundBrace = false;
        for (let i = start; i < code.length; i++) {
            if (code[i] === '{') {
                depth++;
                foundBrace = true;
            } else if (code[i] === '}') {
                depth--;
                if (foundBrace && depth === 0) {
                    end = i + 1;
                    break;
                }
            }
        }
        if (end > -1) {
            code = code.substring(0, start) + code.substring(end);
        }
    }
}

removeBlock('async function waitForRuntimeActivationState');
removeBlock('function buildTerminalActivationInput');
removeBlock('function getTerminalRuntimeConfig');
removeBlock('const ensureSessionSubscription');

// 8. inflightActivationsRef
code = code.replace(/\s*const inflightActivationsRef = useRef<Set<string>>\(new Set\(\)\);\n/g, '');

// Write it back
fs.writeFileSync('src/components/MissionControl/MissionControlPane.tsx', code);
console.log('done');
