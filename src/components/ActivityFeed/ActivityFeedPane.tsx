import { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

interface SwarmActivity {
  event: string;
  path: string;
}

export function ActivityFeedPane() {
  const [activities, setActivities] = useState<SwarmActivity[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen<SwarmActivity>('swarm-activity', (event) => {
      setActivities((prev) => [...prev, event.payload].slice(-100));
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activities]);

  return (
    <div className="flex flex-col h-full bg-bg-panel text-text-secondary p-4 overflow-hidden">
      <div className="text-text-muted mb-2 border-b border-border-panel pb-2 font-bold shrink-0">
        Swarm Activity
      </div>
      <div ref={scrollRef} className="flex-1 font-mono text-xs overflow-y-auto break-all">
        {activities.length === 0 && <p className="text-text-muted">Waiting for activity in .swarm/mailbox...</p>}
        {activities.map((a, i) => (
          <p key={i} className="mb-1 text-text-muted hover:text-text-primary transition-colors">
            <span className="text-green-500 mr-2">[{new Date().toLocaleTimeString()}]</span>
            <span className="text-blue-400 mr-2">{a.event}</span>
            {a.path}
          </p>
        ))}
      </div>
    </div>
  );
}
