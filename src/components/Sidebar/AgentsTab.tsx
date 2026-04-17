import { useState } from 'react';
import defaultAgents from '../../config/agents.json';

export function AgentsTab() {
  const [agents, setAgents] = useState(defaultAgents.agents);

  return (
    <div className="p-4 flex flex-col gap-4 overflow-y-auto h-full">
      {agents.map((agent, i) => (
        <div key={agent.id} className="bg-bg-surface p-3 rounded border border-border-panel">
          <div className="font-bold text-text-primary mb-1">{agent.name}</div>
          <div className="text-xs text-text-muted mb-2">ID: {agent.id}</div>
          <textarea
            className="w-full bg-bg-app border border-border-panel text-text-secondary p-2 text-xs rounded"
            rows={3}
            value={agent.promptTemplate}
            onChange={(e) => {
              const newAgents = [...agents];
              newAgents[i].promptTemplate = e.target.value;
              setAgents(newAgents);
            }}
          />
        </div>
      ))}
    </div>
  );
}
