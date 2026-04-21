import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
  Edge,
  Node,
  Panel,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { WorkflowGraph } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import { Plus, Play, Save, Trash2, Database } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Custom node component with Blender/ComfyUI aesthetic
const CustomNode = ({ data, selected }: { data: { label: string; status: string; roleId: string }; selected: boolean }) => {
  const role = agentsConfig.agents.find(a => a.id === data.roleId);
  
  let statusColor = 'border-border-panel bg-bg-panel text-text-muted';
  let glow = '';
  
  if (data.status === 'running') {
    statusColor = 'border-accent-primary bg-accent-primary/5 text-accent-primary';
    glow = 'shadow-[0_0_15px_rgba(112,89,245,0.3)]';
  } else if (data.status === 'completed') {
    statusColor = 'border-green-500/50 bg-green-500/5 text-green-400';
  } else if (data.status === 'failed') {
    statusColor = 'border-red-500/50 bg-red-500/5 text-red-400';
  } else if (data.status === 'waiting') {
    statusColor = 'border-yellow-500/50 bg-yellow-500/5 text-yellow-400';
  }

  if (selected) {
    statusColor = `${statusColor.split(' ')[0]} border-accent-primary bg-bg-surface text-text-primary ring-1 ring-accent-primary/50`;
  }

  return (
    <div className={`min-w-[150px] rounded-lg border-2 overflow-hidden transition-all duration-300 backdrop-blur-sm ${statusColor} ${glow}`}>
      {/* Node Header */}
      <div className="px-3 py-1.5 bg-bg-titlebar border-b border-border-panel flex items-center justify-between gap-4">
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">{role?.name ?? data.roleId}</span>
        <div className={`w-1.5 h-1.5 rounded-full ${
          data.status === 'running' ? 'bg-accent-primary animate-pulse' :
          data.status === 'completed' ? 'bg-green-500' :
          data.status === 'failed' ? 'bg-red-500' :
          'bg-text-muted'
        }`} />
      </div>

      <div className="p-3 flex flex-col gap-1 relative">
        <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-accent-primary !border-2 !border-bg-panel -top-1.5" />
        
        <div className="flex flex-col">
          <span className="text-[11px] font-medium text-text-primary leading-tight">{role?.role ?? 'Agent'}</span>
          <span className="text-[9px] text-text-muted mt-1 uppercase tracking-tighter">{data.status}</span>
        </div>

        <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-accent-primary !border-2 !border-bg-panel -bottom-1.5" />
      </div>
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export function NodeTreePane({ graph, onGraphChange, missionId }: { graph: WorkflowGraph; onGraphChange?: (g: WorkflowGraph) => void; missionId?: string }) {
  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Load graph on mount or when graph prop changes
  useEffect(() => {
    if (graph) {
      const flowNodes: Node[] = graph.nodes.map(n => ({
        id: n.id,
        type: 'custom',
        position: n.config?.position ?? { x: Math.random() * 400, y: Math.random() * 400 },
        data: { label: n.id, roleId: n.roleId, status: n.status },
      }));
      const flowEdges: Edge[] = graph.edges.map((e, idx) => ({
        id: `e${idx}-${e.fromNodeId}-${e.toNodeId}`,
        source: e.fromNodeId,
        target: e.toNodeId,
        animated: true,
        style: { stroke: e.condition === 'on_failure' ? '#f87171' : '#7059f5', strokeWidth: 2 },
        label: e.condition === 'on_failure' ? 'Retry' : undefined,
        labelStyle: { fill: '#a1a1aa', fontSize: 10, fontWeight: 700 },
        labelBgStyle: { fill: '#181825', fillOpacity: 0.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: e.condition === 'on_failure' ? '#f87171' : '#7059f5' },
      }));
      setNodes(flowNodes);
      setEdges(flowEdges);
    }
  }, [graph.id]);

  // Persist changes back
  const saveGraph = useCallback(() => {
    const updatedGraph: WorkflowGraph = {
      id: graph.id,
      nodes: nodes.map(n => ({
        id: n.id,
        roleId: n.data.roleId as string,
        status: n.data.status as any,
        config: { position: n.position }
      })),
      edges: edges.map(e => ({
        fromNodeId: e.source,
        toNodeId: e.target,
        condition: (e.label === 'Retry' || (e as any).data?.condition === 'on_failure') ? 'on_failure' : 'always'
      })),
    };
    onGraphChange?.(updatedGraph);
  }, [nodes, edges, graph.id, onGraphChange]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => setEdges((eds: Edge[]) => addEdge({ 
      ...params, 
      animated: true, 
      style: { stroke: '#7059f5', strokeWidth: 2 }, 
      markerEnd: { type: MarkerType.ArrowClosed, color: '#7059f5' } 
    }, eds)),
    [setEdges]
  );

  const addAgentNode = (roleId: string) => {
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    const newNode: Node = {
      id,
      type: 'custom',
      position: { x: 100, y: 100 },
      data: { label: id, roleId, status: 'idle' },
    };
    setNodes((nds: Node[]) => [...nds, newNode]);
  };

  const runWorkflow = async () => {
    const mId = missionId ?? crypto.randomUUID();
    const workflowGraph: WorkflowGraph = {
      id: mId,
      nodes: nodes.map(n => ({
        id: n.id,
        roleId: n.data.roleId as string,
        status: 'idle',
        config: { position: n.position }
      })),
      edges: edges.map(e => ({
        fromNodeId: e.source,
        toNodeId: e.target,
        condition: (e.label === 'Retry' || (e as any).data?.condition === 'on_failure') ? 'on_failure' : 'always'
      })),
    };
    
    await invoke('start_mission_graph', { missionId: mId, graph: workflowGraph });
  };

  // Listen for live updates
  useEffect(() => {
    const unlistenUpdate = listen<any>('workflow-node-update', (event) => {
      const { id, status } = event.payload;
      setNodes((nds: Node[]) => nds.map((n: Node) => {
        if (n.id === id) {
          return { ...n, data: { ...n.data, status } };
        }
        return n;
      }));
    });
    return () => { unlistenUpdate.then(f => f()); };
  }, [setNodes]);

  return (
    <div className="w-full h-full bg-bg-app relative group">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as OnNodesChange<Node>}
        onEdgesChange={onEdgesChange as OnEdgesChange<Edge>}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="xyflow-dark"
      >
        <Background color="#27273a" gap={16} size={1} />
        <Controls showInteractive={false} showZoom={false} showFitView={false} className="bg-bg-panel border-border-panel fill-text-primary" />
        
        <Panel position="top-right" className="flex flex-col gap-2">
          <div className="bg-bg-panel/80 backdrop-blur-md border border-border-panel p-2 rounded-lg shadow-xl flex flex-col gap-2">
             <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1">Add Agent</div>
             <div className="grid grid-cols-2 gap-1">
               {agentsConfig.agents.map(a => (
                 <button
                   key={a.id}
                   onClick={() => addAgentNode(a.id)}
                   className="flex items-center gap-1.5 px-2 py-1 bg-bg-surface border border-border-panel rounded hover:border-accent-primary transition-colors text-[10px] text-text-primary"
                 >
                   <Plus size={10} className="text-accent-primary" />
                   {a.name}
                 </button>
               ))}
             </div>
             
             <div className="h-px bg-border-panel my-1" />
             
             <div className="flex items-center gap-2">
               <button
                 onClick={runWorkflow}
                 className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-accent-primary text-accent-text rounded font-bold text-[10px] hover:bg-accent-primary/80 transition-colors shadow-lg shadow-accent-primary/20"
               >
                 <Play size={10} fill="currentColor" />
                 Run Graph
               </button>
               <button
                 onClick={saveGraph}
                 title="Save Graph State"
                 className="p-1.5 bg-bg-surface border border-border-panel rounded hover:border-accent-primary transition-colors text-text-muted hover:text-text-primary"
               >
                 <Save size={12} />
               </button>
               <button
                 onClick={() => { setNodes([]); setEdges([]); }}
                 title="Clear Canvas"
                 className="p-1.5 bg-bg-surface border border-border-panel rounded hover:border-red-500 transition-colors text-text-muted hover:text-red-500"
               >
                 <Trash2 size={12} />
               </button>
             </div>
          </div>
        </Panel>

        <Panel position="bottom-left" className="bg-bg-panel/50 backdrop-blur px-2 py-1 rounded border border-border-panel text-[9px] text-text-muted flex items-center gap-2">
           <Database size={10} />
           <span>MISSION: {missionId?.slice(0,8) ?? 'NONE'}</span>
        </Panel>
      </ReactFlow>
    </div>
  );
}