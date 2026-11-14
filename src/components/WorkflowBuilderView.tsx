import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cpu,
  FileOutput,
  GitFork,
  LayoutGrid,
  Link2,
  Loader2,
  Play,
  Plus,
  SkipForward,
  Trash2,
  Wrench,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  AgentToolDefinition,
  GGUFModelProfile,
  NodeExecutionTrace,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRunRecord,
} from '../types/gguf';

interface WorkflowBuilderViewProps {
  workflows: WorkflowDefinition[];
  activeWorkflowId: string;
  onSelectWorkflow: (id: string) => void;
  onUpdateWorkflow: (wf: WorkflowDefinition) => void;
  onDeleteWorkflow: (id: string) => void;
  models: GGUFModelProfile[];
  tools: AgentToolDefinition[];
  isRunning: boolean;
  liveTraces: Record<string, NodeExecutionTrace>;
  latestRun: WorkflowRunRecord | null;
  runHistory: WorkflowRunRecord[];
  triggerPayload: string;
  onTriggerPayloadChange: (val: string) => void;
  onRunWithPayload: () => void;
}

const NODE_WIDTH = 236;
const NODE_HEIGHT = 96;

const NODE_TYPE_META: Record<
  WorkflowNodeType,
  { title: string; icon: React.ComponentType<{ className?: string }>; badgeText: string }
> = {
  trigger: { title: '触发器', icon: Play, badgeText: 'text-blue-700' },
  agent: { title: 'GGUF Agent', icon: Bot, badgeText: 'text-slate-800' },
  condition: { title: '条件分支', icon: GitFork, badgeText: 'text-amber-700' },
  tool: { title: '本地工具', icon: Wrench, badgeText: 'text-emerald-700' },
  output: { title: '输出节点', icon: FileOutput, badgeText: 'text-slate-700' },
};

export const WorkflowBuilderView: React.FC<WorkflowBuilderViewProps> = ({
  workflows,
  activeWorkflowId,
  onSelectWorkflow,
  onUpdateWorkflow,
  onDeleteWorkflow,
  models,
  tools,
  isRunning,
  liveTraces,
  latestRun,
  runHistory,
  triggerPayload,
  onTriggerPayloadChange,
  onRunWithPayload,
}) => {
  const workflow = workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0];
  const [selectedNodeId, setSelectedNodeId] = useState<string>(workflow?.nodes[0]?.id ?? '');
  const [rightTab, setRightTab] = useState<'config' | 'trace'>('config');
  const [zoom, setZoom] = useState(1);
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    branch: 'default' | 'true' | 'false';
  } | null>(null);

  const dragState = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const selectedNode = useMemo(
    () => workflow?.nodes.find((n) => n.id === selectedNodeId) ?? workflow?.nodes[0] ?? null,
    [workflow, selectedNodeId]
  );

  // Switch automatically to trace tab when a run starts
  const activeTraceMap = useMemo(() => {
    if (Object.keys(liveTraces).length > 0) return liveTraces;
    if (latestRun && latestRun.workflowId === workflow?.id) return latestRun.traces;
    return {};
  }, [liveTraces, latestRun, workflow?.id]);

  if (!workflow) return null;

  const handleNodeMouseDown = (e: React.MouseEvent, node: WorkflowNode) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    setSelectedNodeId(node.id);
    dragState.current = {
      nodeId: node.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!dragState.current) return;
    const { nodeId, startMouseX, startMouseY, origX, origY } = dragState.current;
    const dx = (e.clientX - startMouseX) / zoom;
    const dy = (e.clientY - startMouseY) / zoom;
    onUpdateWorkflow({
      ...workflow,
      updatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      nodes: workflow.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, x: Math.max(16, Math.round(origX + dx)), y: Math.max(16, Math.round(origY + dy)) }
          : n
      ),
    });
  };

  const handleCanvasMouseUp = () => {
    dragState.current = null;
  };

  const addNode = (type: WorkflowNodeType) => {
    const id = `node-${Date.now().toString().slice(-5)}`;
    const maxX = workflow.nodes.reduce((acc, n) => Math.max(acc, n.x), 40);
    const defaultModel = models.find((m) => m.status === 'loaded') ?? models[0];
    const base: WorkflowNode = {
      id,
      type,
      label:
        type === 'agent'
          ? '新建 GGUF Agent'
          : type === 'condition'
            ? '新建条件判断'
            : type === 'tool'
              ? '新建工具节点'
              : type === 'output'
                ? '输出节点'
                : '触发器',
      x: Math.min(1300, maxX + 260),
      y: 180,
    };

    if (type === 'agent') {
      base.agentConfig = {
        modelId: defaultModel?.id ?? '',
        systemPrompt: '你是本地部署的轻量级任务 Agent，请简洁准确地处理输入数据。',
        promptTemplate: '{{input}}',
        jsonMode: false,
        enabledTools: ['kv_memory_rw'],
        maxToolIterations: 2,
      };
    } else if (type === 'condition') {
      base.conditionConfig = {
        expression: "output.length > 0 && !output.toLowerCase().includes('error')",
        description: '判断输出是否有效且无错误',
      };
    } else if (type === 'tool') {
      base.toolConfig = {
        toolId: tools[0]?.id ?? 'json_extract',
        inputTemplate: '{{input}}',
        extraArgsJson: '{}',
      };
    } else if (type === 'output') {
      base.outputConfig = { format: 'markdown' };
    } else {
      base.triggerConfig = { triggerType: 'manual', defaultInput: triggerPayload };
    }

    onUpdateWorkflow({
      ...workflow,
      nodes: [...workflow.nodes, base],
    });
    setSelectedNodeId(id);
    setRightTab('config');
  };

  const updateSelectedNode = (patch: Partial<WorkflowNode>) => {
    if (!selectedNode) return;
    onUpdateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((n) => (n.id === selectedNode.id ? { ...n, ...patch } : n)),
    });
  };

  const deleteNode = (nodeId: string) => {
    if (workflow.nodes.length <= 1) return;
    const nextNodes = workflow.nodes.filter((n) => n.id !== nodeId);
    const nextEdges = workflow.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    onUpdateWorkflow({ ...workflow, nodes: nextNodes, edges: nextEdges });
    if (selectedNodeId === nodeId && nextNodes[0]) {
      setSelectedNodeId(nextNodes[0].id);
    }
  };

  const completeConnection = (targetId: string) => {
    if (!connectingFrom) return;
    if (connectingFrom.nodeId === targetId) {
      setConnectingFrom(null);
      return;
    }
    const exists = workflow.edges.some(
      (e) =>
        e.source === connectingFrom.nodeId &&
        e.target === targetId &&
        e.branch === connectingFrom.branch
    );
    if (!exists) {
      const newEdge: WorkflowEdge = {
        id: `edge-${Date.now()}`,
        source: connectingFrom.nodeId,
        target: targetId,
        branch: connectingFrom.branch,
      };
      onUpdateWorkflow({ ...workflow, edges: [...workflow.edges, newEdge] });
    }
    setConnectingFrom(null);
  };

  const removeEdge = (edgeId: string) => {
    onUpdateWorkflow({
      ...workflow,
      edges: workflow.edges.filter((e) => e.id !== edgeId),
    });
  };

  const autoLayout = () => {
    // Simple BFS column layout
    const depth = new Map<string, number>();
    const roots = workflow.nodes.filter(
      (n) => !workflow.edges.some((e) => e.target === n.id)
    );
    const queue = roots.map((r) => ({ id: r.id, col: 0 }));
    while (queue.length > 0) {
      const { id, col } = queue.shift()!;
      depth.set(id, Math.max(depth.get(id) ?? 0, col));
      for (const e of workflow.edges.filter((ed) => ed.source === id)) {
        queue.push({ id: e.target, col: col + 1 });
      }
    }
    const colBuckets = new Map<number, WorkflowNode[]>();
    for (const n of workflow.nodes) {
      const c = depth.get(n.id) ?? 0;
      const list = colBuckets.get(c) ?? [];
      list.push(n);
      colBuckets.set(c, list);
    }

    const laidOut = workflow.nodes.map((n) => {
      const c = depth.get(n.id) ?? 0;
      const list = colBuckets.get(c) ?? [n];
      const idx = list.findIndex((item) => item.id === n.id);
      return {
        ...n,
        x: 60 + c * 290,
        y: 80 + idx * 160,
      };
    });
    onUpdateWorkflow({ ...workflow, nodes: laidOut });
  };

  const canvasBounds = workflow.nodes.reduce(
    (acc, n) => ({
      w: Math.max(acc.w, n.x + NODE_WIDTH + 180),
      h: Math.max(acc.h, n.y + NODE_HEIGHT + 160),
    }),
    { w: 1200, h: 520 }
  );

  const selectedTrace = selectedNode ? activeTraceMap[selectedNode.id] : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Compact Workspace Sub-toolbar */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <select
            value={workflow.id}
            onChange={(e) => {
              const nextWf = workflows.find((w) => w.id === e.target.value);
              onSelectWorkflow(e.target.value);
              if (nextWf?.nodes[0]) setSelectedNodeId(nextWf.nodes[0].id);
            }}
            aria-label="选择任务流"
            className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500 max-w-xs"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          <div className="h-4 w-px bg-slate-200" aria-hidden="true" />

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => addNode('agent')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agent</span>
            </button>
            <button
              type="button"
              onClick={() => addNode('tool')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>工具</span>
            </button>
            <button
              type="button"
              onClick={() => addNode('condition')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>条件分支</span>
            </button>
            <button
              type="button"
              onClick={() => addNode('output')}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-1 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>输出</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {connectingFrom && (
            <button
              type="button"
              onClick={() => setConnectingFrom(null)}
              className="px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md whitespace-nowrap"
            >
              正在连线 · 点击目标左侧端口或点此取消
            </button>
          )}
          <button
            type="button"
            onClick={autoLayout}
            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md flex items-center gap-1 whitespace-nowrap"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>整理布局</span>
          </button>
          <div className="flex items-center border border-slate-200 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.65, Number((z - 0.1).toFixed(2))))}
              className="p-1.5 text-slate-600 hover:bg-slate-100"
              title="缩小画布"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-xs font-mono tabular-nums text-slate-600">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.3, Number((z + 0.1).toFixed(2))))}
              className="p-1.5 text-slate-600 hover:bg-slate-100"
              title="放大画布"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          {workflows.length > 1 && (
            <button
              type="button"
              onClick={() => onDeleteWorkflow(workflow.id)}
              className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-slate-100"
              title="删除当前任务流"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Split: DAG Canvas + Right Inspector */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* DAG Canvas Viewport */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            className="flex-1 overflow-auto canvas-grid-bg relative select-none"
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: `${canvasBounds.w}px`,
                height: `${canvasBounds.h}px`,
                transform: `scale(${zoom})`,
              }}
            >
              {/* SVG Edges */}
              <svg
                className="absolute inset-0 pointer-events-none"
                width={canvasBounds.w}
                height={canvasBounds.h}
              >
                {workflow.edges.map((edge) => {
                  const src = workflow.nodes.find((n) => n.id === edge.source);
                  const tgt = workflow.nodes.find((n) => n.id === edge.target);
                  if (!src || !tgt) return null;

                  const startX = src.x + NODE_WIDTH;
                  const startY =
                    src.type === 'condition'
                      ? edge.branch === 'true'
                        ? src.y + 34
                        : src.y + 66
                      : src.y + NODE_HEIGHT / 2;
                  const endX = tgt.x;
                  const endY = tgt.y + NODE_HEIGHT / 2;
                  const cOffset = Math.max(60, Math.abs(endX - startX) * 0.45);
                  const pathD = `M ${startX} ${startY} C ${startX + cOffset} ${startY}, ${endX - cOffset} ${endY}, ${endX} ${endY}`;

                  const srcTrace = activeTraceMap[src.id];
                  const tgtTrace = activeTraceMap[tgt.id];
                  const isActiveEdge =
                    srcTrace?.state === 'completed' &&
                    (tgtTrace?.state === 'running' || tgtTrace?.state === 'completed');

                  const strokeColor = isActiveEdge
                    ? '#2563EB'
                    : edge.branch === 'true'
                      ? '#16A34A'
                      : edge.branch === 'false'
                        ? '#D97706'
                        : '#94A3B8';

                  const midX = (startX + endX) / 2;
                  const midY = (startY + endY) / 2;

                  return (
                    <g key={edge.id} className="pointer-events-auto group">
                      <path
                        d={pathD}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={isActiveEdge ? 2.5 : 1.75}
                        strokeDasharray={tgtTrace?.state === 'skipped' ? '5 4' : undefined}
                      />
                      {(edge.branch === 'true' || edge.branch === 'false') && (
                        <g transform={`translate(${midX}, ${midY - 12})`}>
                          <rect
                            x={-18}
                            y={-9}
                            width={36}
                            height={18}
                            rx={4}
                            fill="#FFFFFF"
                            stroke={strokeColor}
                            strokeWidth={1}
                          />
                          <text
                            x={0}
                            y={3}
                            textAnchor="middle"
                            fontSize={10}
                            fontFamily="JetBrains Mono, monospace"
                            fill={strokeColor}
                          >
                            {edge.branch === 'true' ? 'TRUE' : 'FALSE'}
                          </text>
                        </g>
                      )}
                      <circle
                        cx={midX}
                        cy={midY}
                        r={8}
                        fill="#FFFFFF"
                        stroke="#CBD5E1"
                        className="opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity"
                        onClick={() => removeEdge(edge.id)}
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fontSize={11}
                        fill="#EF4444"
                        className="opacity-0 group-hover:opacity-100 cursor-pointer pointer-events-none font-bold"
                      >
                        ×
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Nodes */}
              {workflow.nodes.map((node) => {
                const meta = NODE_TYPE_META[node.type];
                const Icon = meta.icon;
                const isSelected = selectedNode?.id === node.id;
                const trace = activeTraceMap[node.id];
                const assignedModel =
                  node.type === 'agent'
                    ? models.find((m) => m.id === node.agentConfig?.modelId)
                    : null;

                return (
                  <div
                    key={node.id}
                    onMouseDown={(e) => handleNodeMouseDown(e, node)}
                    style={{
                      left: `${node.x}px`,
                      top: `${node.y}px`,
                      width: `${NODE_WIDTH}px`,
                      minHeight: `${NODE_HEIGHT}px`,
                    }}
                    className={`absolute bg-white rounded-xl border p-3.5 cursor-grab active:cursor-grabbing transition-shadow ${
                      trace?.state === 'running'
                        ? 'border-blue-600 shadow-md ring-2 ring-blue-100'
                        : trace?.state === 'error'
                          ? 'border-red-500'
                          : isSelected
                            ? 'border-slate-900 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Input Port */}
                    {node.type !== 'trigger' && (
                      <button
                        type="button"
                        onClick={() => completeConnection(node.id)}
                        title="连接输入端口"
                        className={`absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                          connectingFrom && connectingFrom.nodeId !== node.id
                            ? 'bg-blue-600 border-white scale-110'
                            : 'bg-white border-slate-400 hover:border-blue-600'
                        }`}
                      />
                    )}

                    {/* Header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <Icon className={`w-3.5 h-3.5 ${meta.badgeText}`} />
                        <span>{meta.title}</span>
                      </div>
                      {trace && (
                        <div className="flex items-center gap-1 text-xs font-mono tabular-nums">
                          {trace.state === 'running' && (
                            <span className="text-blue-600 flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              执行中
                            </span>
                          )}
                          {trace.state === 'completed' && (
                            <span className="text-emerald-700 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {trace.durationMs}ms
                            </span>
                          )}
                          {trace.state === 'skipped' && (
                            <span className="text-slate-400 flex items-center gap-1">
                              <SkipForward className="w-3 h-3" />
                              跳过
                            </span>
                          )}
                          {trace.state === 'error' && (
                            <span className="text-red-600 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              失败
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Title */}
                    <div className="mt-1.5 text-sm font-semibold text-slate-900 truncate">
                      {node.label}
                    </div>

                    {/* Sub-info (Zero-pill clean text) */}
                    <div className="mt-1 text-xs text-slate-500 font-mono truncate">
                      {node.type === 'agent' && assignedModel
                        ? `${assignedModel.name} · ${assignedModel.quantization}`
                        : node.type === 'tool'
                          ? `tool: ${node.toolConfig?.toolId}`
                          : node.type === 'condition'
                            ? node.conditionConfig?.description || '表达式分支'
                            : node.type === 'trigger'
                              ? '工作流入口载荷'
                              : `格式: ${node.outputConfig?.format ?? 'markdown'}`}
                    </div>

                    {/* Output Ports */}
                    {node.type === 'condition' ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setConnectingFrom({ nodeId: node.id, branch: 'true' })
                          }
                          title="拖出 TRUE 分支连线"
                          className="absolute -right-2 top-[28px] w-4 h-4 rounded-full bg-emerald-600 border-2 border-white hover:scale-110 transition-transform"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setConnectingFrom({ nodeId: node.id, branch: 'false' })
                          }
                          title="拖出 FALSE 分支连线"
                          className="absolute -right-2 top-[60px] w-4 h-4 rounded-full bg-amber-500 border-2 border-white hover:scale-110 transition-transform"
                        />
                      </>
                    ) : (
                      node.type !== 'output' && (
                        <button
                          type="button"
                          onClick={() =>
                            setConnectingFrom({ nodeId: node.id, branch: 'default' })
                          }
                          title="连接下游节点"
                          className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border-2 border-slate-400 hover:border-blue-600 hover:bg-blue-50 transition-colors"
                        />
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Trigger Input Strip */}
          <div className="bg-white border-t border-slate-200 px-6 py-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
            <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
              输入载荷 (Trigger Payload)
            </span>
            <input
              type="text"
              value={triggerPayload}
              onChange={(e) => onTriggerPayloadChange(e.target.value)}
              placeholder="输入待处理的日志、代码或用户指令…"
              className="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => {
                setRightTab('trace');
                onRunWithPayload();
              }}
              disabled={isRunning}
              className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{isRunning ? '执行中…' : '立即执行'}</span>
            </button>
          </div>
        </div>

        {/* Right Inspector Panel */}
        <aside className="w-96 shrink-0 bg-white border-l border-slate-200 flex flex-col min-h-0">
          {/* Segmented Tabs */}
          <div className="p-2 border-b border-slate-200 flex items-center gap-1 bg-slate-50">
            <button
              type="button"
              onClick={() => setRightTab('config')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                rightTab === 'config'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              节点配置
            </button>
            <button
              type="button"
              onClick={() => setRightTab('trace')}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                rightTab === 'trace'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              执行追踪与输出
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {rightTab === 'config' && selectedNode && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400 font-mono">{selectedNode.id}</div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
                      {NODE_TYPE_META[selectedNode.type].title}属性
                    </h3>
                  </div>
                  {workflow.nodes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteNode(selectedNode.id)}
                      className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除节点</span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    节点名称
                  </label>
                  <input
                    type="text"
                    value={selectedNode.label}
                    onChange={(e) => updateSelectedNode({ label: e.target.value })}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Trigger Config */}
                {selectedNode.type === 'trigger' && selectedNode.triggerConfig && (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-600">
                      默认测试载荷
                    </label>
                    <textarea
                      rows={5}
                      value={triggerPayload}
                      onChange={(e) => {
                        onTriggerPayloadChange(e.target.value);
                        updateSelectedNode({
                          triggerConfig: {
                            ...selectedNode.triggerConfig!,
                            defaultInput: e.target.value,
                          },
                        });
                      }}
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                {/* Agent Config */}
                {selectedNode.type === 'agent' && selectedNode.agentConfig && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        绑定本地 GGUF 模型
                      </label>
                      <select
                        value={selectedNode.agentConfig.modelId}
                        onChange={(e) =>
                          updateSelectedNode({
                            agentConfig: {
                              ...selectedNode.agentConfig!,
                              modelId: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.quantization} · {m.status === 'loaded' ? '已加载' : '未加载'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        系统指令 (System Prompt)
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.agentConfig.systemPrompt}
                        onChange={(e) =>
                          updateSelectedNode({
                            agentConfig: {
                              ...selectedNode.agentConfig!,
                              systemPrompt: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-slate-600">
                          提示词模板 (支持变量插值)
                        </label>
                      </div>
                      <textarea
                        rows={4}
                        value={selectedNode.agentConfig.promptTemplate}
                        onChange={(e) =>
                          updateSelectedNode({
                            agentConfig: {
                              ...selectedNode.agentConfig!,
                              promptTemplate: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {workflow.nodes
                          .filter((n) => n.id !== selectedNode.id && n.type !== 'output')
                          .map((up) => (
                            <button
                              key={up.id}
                              type="button"
                              onClick={() =>
                                updateSelectedNode({
                                  agentConfig: {
                                    ...selectedNode.agentConfig!,
                                    promptTemplate: `${selectedNode.agentConfig!.promptTemplate}\n{{${up.id}.output}}`,
                                  },
                                })
                              }
                              className="text-[11px] font-mono text-blue-600 hover:underline"
                            >
                              + {`{{${up.id}.output}}`}
                            </button>
                          ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedNode.agentConfig.jsonMode}
                          onChange={(e) =>
                            updateSelectedNode({
                              agentConfig: {
                                ...selectedNode.agentConfig!,
                                jsonMode: e.target.checked,
                              },
                            })
                          }
                          className="rounded border-slate-300 accent-blue-600"
                        />
                        <span>强制 JSON Schema 输出</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">
                        挂载本地工具
                      </label>
                      <div className="space-y-1.5">
                        {tools.map((t) => {
                          const checked = selectedNode.agentConfig!.enabledTools.includes(t.id);
                          return (
                            <label
                              key={t.id}
                              className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const prev = selectedNode.agentConfig!.enabledTools;
                                  const next = e.target.checked
                                    ? [...prev, t.id]
                                    : prev.filter((id) => id !== t.id);
                                  updateSelectedNode({
                                    agentConfig: {
                                      ...selectedNode.agentConfig!,
                                      enabledTools: next,
                                    },
                                  });
                                }}
                                className="rounded border-slate-300 accent-blue-600"
                              />
                              <span className="font-medium">{t.name}</span>
                              <span className="font-mono text-slate-400">({t.id})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Condition Config */}
                {selectedNode.type === 'condition' && selectedNode.conditionConfig && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        条件表达式 (JS，可用变量 output, memory)
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.conditionConfig.expression}
                        onChange={(e) =>
                          updateSelectedNode({
                            conditionConfig: {
                              ...selectedNode.conditionConfig!,
                              expression: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        分支语义说明
                      </label>
                      <input
                        type="text"
                        value={selectedNode.conditionConfig.description}
                        onChange={(e) =>
                          updateSelectedNode({
                            conditionConfig: {
                              ...selectedNode.conditionConfig!,
                              description: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}

                {/* Tool Config */}
                {selectedNode.type === 'tool' && selectedNode.toolConfig && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        选择本地工具
                      </label>
                      <select
                        value={selectedNode.toolConfig.toolId}
                        onChange={(e) =>
                          updateSelectedNode({
                            toolConfig: {
                              ...selectedNode.toolConfig!,
                              toolId: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      >
                        {tools.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.id})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        主输入模板
                      </label>
                      <input
                        type="text"
                        value={selectedNode.toolConfig.inputTemplate}
                        onChange={(e) =>
                          updateSelectedNode({
                            toolConfig: {
                              ...selectedNode.toolConfig!,
                              inputTemplate: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        附加 JSON 参数
                      </label>
                      <textarea
                        rows={3}
                        value={selectedNode.toolConfig.extraArgsJson}
                        onChange={(e) =>
                          updateSelectedNode({
                            toolConfig: {
                              ...selectedNode.toolConfig!,
                              extraArgsJson: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                )}

                {/* Output Config */}
                {selectedNode.type === 'output' && selectedNode.outputConfig && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        输出格式化
                      </label>
                      <select
                        value={selectedNode.outputConfig.format}
                        onChange={(e) =>
                          updateSelectedNode({
                            outputConfig: {
                              ...selectedNode.outputConfig!,
                              format: e.target.value as 'markdown' | 'json' | 'plain',
                            },
                          })
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      >
                        <option value="markdown">Markdown 报告</option>
                        <option value="json">JSON 封装</option>
                        <option value="plain">纯文本透传</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        自动归档到 KV 记忆键（可选）
                      </label>
                      <input
                        type="text"
                        value={selectedNode.outputConfig.saveToMemoryKey ?? ''}
                        onChange={(e) =>
                          updateSelectedNode({
                            outputConfig: {
                              ...selectedNode.outputConfig!,
                              saveToMemoryKey: e.target.value || undefined,
                            },
                          })
                        }
                        placeholder="例如: last_incident_report"
                        className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>
                )}

                {/* Outgoing Edges Summary */}
                <div className="pt-4 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" />
                    <span>下游连线</span>
                  </div>
                  <div className="space-y-1.5">
                    {workflow.edges.filter((e) => e.source === selectedNode.id).length === 0 ? (
                      <div className="text-xs text-slate-400">
                        暂无下游连接（点击节点右侧圆点可连线）
                      </div>
                    ) : (
                      workflow.edges
                        .filter((e) => e.source === selectedNode.id)
                        .map((e) => {
                          const tgt = workflow.nodes.find((n) => n.id === e.target);
                          return (
                            <div
                              key={e.id}
                              className="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-1.5 rounded-md"
                            >
                              <span className="flex items-center gap-1.5 text-slate-700 truncate">
                                <ArrowRight className="w-3 h-3 text-slate-400" />
                                <span>{tgt?.label ?? e.target}</span>
                                {e.branch && e.branch !== 'default' && (
                                  <span className="font-mono text-slate-500">[{e.branch}]</span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeEdge(e.id)}
                                className="text-slate-400 hover:text-red-600"
                              >
                                断开
                              </button>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </>
            )}

            {rightTab === 'trace' && (
              <div className="space-y-4">
                {Object.keys(activeTraceMap).length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <Cpu className="w-6 h-6 text-slate-300 mx-auto" />
                    <div className="text-sm font-medium text-slate-700">尚未触发执行</div>
                    <p className="text-xs text-slate-500">
                      点击右上角或底部「立即执行」运行当前 GGUF 任务流。
                    </p>
                  </div>
                ) : (
                  <>
                    {latestRun && latestRun.workflowId === workflow.id && (
                      <div className="pb-3 border-b border-slate-100 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">
                          {latestRun.status === 'completed'
                            ? '最近运行成功'
                            : latestRun.status === 'failed'
                              ? '运行中断'
                              : '运行中'}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {latestRun.totalTokens} tokens · {latestRun.totalDurationMs} ms
                        </span>
                      </div>
                    )}

                    {/* Selected Node Detailed Output */}
                    {selectedTrace && (
                      <div className="space-y-2 pb-4 border-b border-slate-100">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-900">
                            当前节点：{selectedTrace.nodeLabel}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500">
                            {selectedTrace.tokensPerSec
                              ? `${selectedTrace.tokensPerSec} tok/s`
                              : selectedTrace.durationMs
                                ? `${selectedTrace.durationMs} ms`
                                : ''}
                          </span>
                        </div>
                        {selectedTrace.inferenceMode && (
                          <div className="text-[11px] font-mono text-slate-500">
                            模式：
                            {selectedTrace.inferenceMode === 'live'
                              ? '实时本地 GGUF 服务端'
                              : selectedTrace.inferenceMode === 'sandbox'
                                ? '本地沙盒模拟引擎'
                                : '确定性规则执行'}
                            {selectedTrace.promptTokens !== undefined &&
                              ` · Prompt ${selectedTrace.promptTokens} / Gen ${selectedTrace.completionTokens}`}
                          </div>
                        )}
                        {selectedTrace.error ? (
                          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                            {selectedTrace.error}
                          </div>
                        ) : (
                          <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto leading-relaxed">
                            {selectedTrace.output || '(等待输出…)'}
                          </pre>
                        )}
                        {selectedTrace.toolCalls.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <div className="text-xs font-medium text-slate-600">关联工具调用</div>
                            {selectedTrace.toolCalls.map((tc) => (
                              <div
                                key={tc.id}
                                className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono space-y-1"
                              >
                                <div className="flex justify-between text-slate-700">
                                  <span>{tc.toolName}</span>
                                  <span className="tabular-nums text-slate-400">{tc.durationMs}ms</span>
                                </div>
                                <div className="text-slate-500 break-all">{tc.result}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* All Executed Nodes Timeline */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-700">全链路节点追踪</div>
                      {Object.values(activeTraceMap).map((tr) => (
                        <button
                          key={tr.nodeId}
                          type="button"
                          onClick={() => setSelectedNodeId(tr.nodeId)}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                            selectedNode?.id === tr.nodeId
                              ? 'border-blue-500 bg-blue-50/40'
                              : 'border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-slate-900 truncate">
                              {tr.nodeLabel}
                            </span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {tr.state === 'completed'
                                ? `${tr.durationMs}ms`
                                : tr.state === 'skipped'
                                  ? '跳过'
                                  : tr.state === 'error'
                                    ? '错误'
                                    : '运行中'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Recent Run History */}
                    {runHistory.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <div className="text-xs font-semibold text-slate-700">历史运行记录</div>
                        {runHistory.slice(0, 5).map((r) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between text-xs text-slate-600 py-1"
                          >
                            <span className="truncate">{r.workflowName}</span>
                            <span className="font-mono tabular-nums text-slate-400 shrink-0">
                              {r.totalDurationMs}ms · {r.totalTokens} tok
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
