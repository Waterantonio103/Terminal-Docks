import { Bot } from 'lucide-react';
import defaultAgents from '../../config/agents';
import { useWorkspaceStore } from '../../store/workspace';

export function AgentsTab() {
  const agentInstructions = useWorkspaceStore(s => s.agentInstructions);
  const setAgentInstruction = useWorkspaceStore(s => s.setAgentInstruction);

  return (
    <div className="flex flex-col gap-3 p-2 overflow-y-auto h-full">
      {defaultAgents.agents.map((agent) => (
        <div key={agent.id} className="bg-bg-surface rounded-lg border border-border-panel p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Bot size={14} className="text-accent-primary shrink-0" />
            <span className="text-xs font-semibold text-text-primary truncate">{agent.name}</span>
          </div>
          <div className="text-xs text-text-muted font-mono truncate opacity-60">{agent.id}</div>
          <textarea
            className="w-full bg-bg-app border border-border-panel text-text-secondary p-2 text-xs rounded-md resize-none focus:outline-none focus:border-accent-primary transition-colors leading-relaxed"
            rows={3}
            value={agentInstructions[agent.id] ?? agent.coreInstructions}
            onChange={(e) => setAgentInstruction(agent.id, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
