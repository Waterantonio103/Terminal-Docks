export function ActivityFeedPane() {
  return (
    <div className="flex flex-col h-full bg-bg-panel text-text-secondary p-4">
      <div className="text-text-muted mb-2 border-b border-border-panel pb-2 font-bold">
        Swarm Activity
      </div>
      <div className="flex-1 font-mono text-sm">
        <p>[Coordinator]: Starting swarm session...</p>
        <p>[Builder]: Reading task context...</p>
      </div>
    </div>
  );
}
