import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { missionRepository } from '../lib/missionRepository.js';
import type { WorkflowEventRecord } from './useMissionSnapshot.js';

export function useWorkflowEvents(missionId: string | null, limit = 100) {
  const [events, setEvents] = useState<WorkflowEventRecord[]>([]);

  useEffect(() => {
    if (!missionId) {
      setEvents([]);
      return;
    }

    let mounted = true;
    let unlistenUpdate: (() => void) | undefined;

    const fetchEvents = async () => {
      try {
        const data = await missionRepository.getWorkflowEvents(missionId, limit);
        if (mounted) setEvents(data);
      } catch (err) {
        console.error('Failed to fetch workflow events:', err);
      }
    };

    fetchEvents();

    // Listen for new events
    listen('workflow-event-appended', (event: any) => {
      if (event.payload?.missionId === missionId || !event.payload?.missionId) {
        fetchEvents();
      }
    }).then(fn => {
      if (!mounted) fn();
      else unlistenUpdate = fn;
    });

    return () => {
      mounted = false;
      if (unlistenUpdate) unlistenUpdate();
    };
  }, [missionId, limit]);

  return events;
}
