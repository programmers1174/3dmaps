import React, { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  Handle,
  Position,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGameLabFlowContext } from './GameLabFlowContext';

function GameStartNode(_props: NodeProps) {
  void _props;
  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'linear-gradient(145deg, #311b92, #5e35b1)',
        borderRadius: 10,
        color: '#fff',
        minWidth: 172,
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.85 }}>Event</div>
      <div style={{ fontWeight: 700, marginTop: 4, fontSize: 14 }}>When game plays</div>
      <div style={{ fontSize: 11, opacity: 0.78, marginTop: 4 }}>Connect blocks below this.</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ToastNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const message = String((data as { message?: string } | undefined)?.message ?? '');
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as object), message: v } } : n))
    );
  };
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#263238',
        borderRadius: 10,
        color: '#eceff1',
        minWidth: 200,
        border: '1px solid rgba(100,181,246,0.35)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.75, color: '#81d4fa' }}>
        Say
      </div>
      <input
        value={message}
        onChange={onChange}
        placeholder="Message…"
        style={{
          width: '100%',
          marginTop: 6,
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(0,0,0,0.25)',
          color: '#fff',
          fontSize: 12,
          boxSizing: 'border-box',
        }}
      />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function CameraGotoNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const { viewpointOptions } = useGameLabFlowContext();
  const entityId = String((data as { entityId?: string } | undefined)?.entityId ?? '');
  const onSel = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as object), entityId: v } } : n))
    );
  };
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#1b2a2a',
        borderRadius: 10,
        color: '#eceff1',
        minWidth: 210,
        border: '1px solid rgba(255,213,79,0.45)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.75, color: '#fff59d' }}>
        Move camera
      </div>
      <p style={{ margin: '6px 0 8px', fontSize: 10, opacity: 0.72, lineHeight: 1.35 }}>
        Animates the map to a <strong>Camera viewpoint</strong> you placed in Assets.
      </p>
      <select
        value={entityId}
        onChange={onSel}
        style={{
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(0,0,0,0.35)',
          color: '#fff',
          fontSize: 12,
        }}
      >
        <option value="">Choose viewpoint…</option>
        {viewpointOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function WaitNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const seconds = Number((data as { seconds?: number } | undefined)?.seconds ?? 1);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(0, Number(e.target.value));
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...(n.data as object), seconds: v } } : n))
    );
  };
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#37474f',
        borderRadius: 10,
        color: '#eceff1',
        minWidth: 160,
        border: '1px solid rgba(255,183,77,0.4)',
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.75 }}>Wait</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12 }}>
        Seconds
        <input
          type="number"
          min={0}
          step={0.1}
          value={seconds}
          onChange={onChange}
          style={{
            width: 72,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.25)',
            color: '#fff',
            fontSize: 12,
          }}
        />
      </label>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function FitViewWhenVisible({ visible }: { visible: boolean }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      rf.fitView({ padding: 0.18 });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, rf]);
  return null;
}

export interface VisualLogicEditorProps {
  tabVisible: boolean;
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  readOnly?: boolean;
}

export function VisualLogicEditor({
  tabVisible,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  readOnly = false,
}: VisualLogicEditorProps) {
  const { viewpointOptions } = useGameLabFlowContext();

  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      gameStart: GameStartNode,
      toast: ToastNode,
      wait: WaitNode,
      cameraGoto: CameraGotoNode,
    }),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  const noopNodesChange = useCallback<OnNodesChange>(() => {
    return;
  }, []);
  const noopEdgesChange = useCallback<OnEdgesChange>(() => {
    return;
  }, []);
  const noopConnect = useCallback((_p: Connection) => {
    void _p;
  }, []);

  const addToast = () => {
    setNodes((nds) => [
      ...nds,
      {
        id: `toast-${Date.now()}`,
        type: 'toast',
        position: { x: 180, y: 100 + nds.length * 6 },
        data: { message: 'Hello from GameLab!' },
      },
    ]);
  };

  const addWait = () => {
    setNodes((nds) => [
      ...nds,
      {
        id: `wait-${Date.now()}`,
        type: 'wait',
        position: { x: 180, y: 140 + nds.length * 6 },
        data: { seconds: 1 },
      },
    ]);
  };

  const addCameraGoto = () => {
    setNodes((nds) => [
      ...nds,
      {
        id: `cam-${Date.now()}`,
        type: 'cameraGoto',
        position: { x: 180, y: 200 + nds.length * 6 },
        data: { entityId: viewpointOptions[0]?.id ?? '' },
      },
    ]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={addToast}
          disabled={readOnly}
          style={chipBtnStyle}
        >
          + Say
        </button>
        <button type="button" onClick={addWait} disabled={readOnly} style={chipBtnStyle}>
          + Wait
        </button>
        <button type="button" onClick={addCameraGoto} disabled={readOnly} style={chipBtnStyleGold}>
          + Move camera
        </button>
      </div>
      <div
        style={{
          height: 280,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          background: '#121218',
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={readOnly ? noopNodesChange : onNodesChange}
          onEdgesChange={readOnly ? noopEdgesChange : onEdgesChange}
          onConnect={readOnly ? noopConnect : onConnect}
          nodeTypes={nodeTypes}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          elementsSelectable={!readOnly}
          panOnScroll
          zoomOnScroll={!readOnly}
          proOptions={{ hideAttribution: true }}
        >
          <FitViewWhenVisible visible={tabVisible} />
          <Background color="#1e1e28" gap={14} size={1} />
          <Controls showInteractive={false} />
          <MiniMap style={{ height: 52, width: 72, borderRadius: 6 }} zoomable pannable />
        </ReactFlow>
      </div>
      <p style={{ fontSize: 11, opacity: 0.65, margin: 0, lineHeight: 1.4 }}>
        Connect top-to-bottom. Add at least one <strong>Camera viewpoint</strong> in Assets, capture its angle, then chain
        “Move camera” in playtest. Branches: only the first link runs (v1).
      </p>
    </div>
  );
}

const chipBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid rgba(124, 77, 255, 0.45)',
  background: 'rgba(124, 77, 255, 0.18)',
  color: '#e8eaf6',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const chipBtnStyleGold: React.CSSProperties = {
  ...chipBtnStyle,
  border: '1px solid rgba(255, 213, 79, 0.45)',
  background: 'rgba(255, 213, 79, 0.12)',
  color: '#fff9c4',
};
