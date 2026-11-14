/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { ModelManagerView } from './components/ModelManagerView';
import { SdkExportView } from './components/SdkExportView';
import { Sidebar, type WorkspaceTab } from './components/Sidebar';
import { ToolsMemoryView } from './components/ToolsMemoryView';
import { TopBar } from './components/TopBar';
import { WorkflowBuilderView } from './components/WorkflowBuilderView';
import {
  BUILTIN_TOOLS,
  INITIAL_MEMORY,
  PRESET_MODELS,
  PRESET_WORKFLOWS,
} from './data/presets';
import { executeWorkflowDAG } from './engine/agentRuntime';
import type {
  AgentToolDefinition,
  GGUFModelProfile,
  MemoryEntry,
  NodeExecutionTrace,
  WorkflowDefinition,
  WorkflowRunRecord,
} from './types/gguf';

function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('workflow');
  const [models, setModels] = useState<GGUFModelProfile[]>(() =>
    loadStored('gossamer_models_v1', PRESET_MODELS)
  );
  const [selectedModelId, setSelectedModelId] = useState<string>(
    () => models[0]?.id ?? 'model-qwen25-7b'
  );

  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>(() =>
    loadStored('gossamer_workflows_v1', PRESET_WORKFLOWS)
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(
    () => workflows[0]?.id ?? 'wf-incident-triage'
  );

  const [customTools, setCustomTools] = useState<AgentToolDefinition[]>(() =>
    loadStored('gossamer_custom_tools_v1', [])
  );
  const [memory, setMemory] = useState<MemoryEntry[]>(() =>
    loadStored('gossamer_memory_v1', INITIAL_MEMORY)
  );

  const [runHistory, setRunHistory] = useState<WorkflowRunRecord[]>([]);
  const [latestRun, setLatestRun] = useState<WorkflowRunRecord | null>(null);
  const [liveTraces, setLiveTraces] = useState<Record<string, NodeExecutionTrace>>({});
  const [isRunning, setIsRunning] = useState(false);

  const activeWorkflow =
    workflows.find((w) => w.id === activeWorkflowId) ?? workflows[0];

  const [triggerPayload, setTriggerPayload] = useState<string>(
    () =>
      activeWorkflow?.nodes.find((n) => n.type === 'trigger')?.triggerConfig
        ?.defaultInput ?? ''
  );

  const ggufFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('gossamer_models_v1', JSON.stringify(models));
    } catch {
      // Ignore quota errors
    }
  }, [models]);

  useEffect(() => {
    try {
      localStorage.setItem('gossamer_workflows_v1', JSON.stringify(workflows));
    } catch {
      // Ignore quota errors
    }
  }, [workflows]);

  useEffect(() => {
    try {
      localStorage.setItem('gossamer_custom_tools_v1', JSON.stringify(customTools));
    } catch {
      // Ignore quota errors
    }
  }, [customTools]);

  useEffect(() => {
    try {
      localStorage.setItem('gossamer_memory_v1', JSON.stringify(memory));
    } catch {
      // Ignore quota errors
    }
  }, [memory]);

  useEffect(() => {
    fetch('/api/runs')
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((data: { runs?: WorkflowRunRecord[] }) => {
        if (Array.isArray(data.runs)) {
          setRunHistory(data.runs);
          if (data.runs[0]) setLatestRun(data.runs[0]);
        }
      })
      .catch(() => {});
  }, []);

  const allTools = [...BUILTIN_TOOLS, ...customTools];

  const handleSelectWorkflow = (id: string) => {
    setActiveWorkflowId(id);
    const wf = workflows.find((w) => w.id === id);
    const defaultInput =
      wf?.nodes.find((n) => n.type === 'trigger')?.triggerConfig?.defaultInput ?? '';
    setTriggerPayload(defaultInput);
    setLiveTraces({});
  };

  const handleCreateWorkflow = () => {
    const id = `wf-${Date.now().toString().slice(-5)}`;
    const loadedModel = models.find((m) => m.status === 'loaded') ?? models[0];
    const newWf: WorkflowDefinition = {
      id,
      name: `新建 GGUF 任务流 ${workflows.length + 1}`,
      description: '自定义本地 GGUF 模型自动化处理流',
      updatedAt: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      nodes: [
        {
          id: `${id}-trigger`,
          type: 'trigger',
          label: '任务输入',
          x: 80,
          y: 180,
          triggerConfig: {
            triggerType: 'manual',
            defaultInput: '请总结本地边缘网关在过去 5 分钟内的关键性能指标与异常风险。',
          },
        },
        {
          id: `${id}-agent`,
          type: 'agent',
          label: 'GGUF 推理节点',
          x: 400,
          y: 180,
          agentConfig: {
            modelId: loadedModel?.id ?? '',
            systemPrompt: '你是本地部署的高效推理助手，请直接给出条理清晰的结论。',
            promptTemplate: '待处理任务：\n{{input}}',
            jsonMode: false,
            enabledTools: ['kv_memory_rw'],
            maxToolIterations: 2,
          },
        },
        {
          id: `${id}-output`,
          type: 'output',
          label: '结果输出',
          x: 720,
          y: 180,
          outputConfig: { format: 'markdown' },
        },
      ],
      edges: [
        { id: `${id}-e1`, source: `${id}-trigger`, target: `${id}-agent`, branch: 'default' },
        { id: `${id}-e2`, source: `${id}-agent`, target: `${id}-output`, branch: 'default' },
      ],
    };
    setWorkflows((prev) => [newWf, ...prev]);
    setActiveWorkflowId(id);
    setTriggerPayload(newWf.nodes[0].triggerConfig!.defaultInput);
    setLiveTraces({});
  };

  const handleRunWorkflow = async () => {
    if (!activeWorkflow || isRunning) return;
    setIsRunning(true);
    setLiveTraces({});
    setActiveTab('workflow');

    try {
      const record = await executeWorkflowDAG(
        activeWorkflow,
        triggerPayload,
        models,
        memory,
        customTools,
        {
          onNodeStart: (nodeId, trace) => {
            setLiveTraces((prev) => ({ ...prev, [nodeId]: trace }));
          },
          onNodeToken: (nodeId, partialOutput) => {
            setLiveTraces((prev) => {
              const existing = prev[nodeId];
              if (!existing) return prev;
              return {
                ...prev,
                [nodeId]: { ...existing, output: partialOutput },
              };
            });
          },
          onNodeFinish: (nodeId, trace) => {
            setLiveTraces((prev) => ({ ...prev, [nodeId]: trace }));
          },
          onMemoryUpdate: (nextMem) => {
            setMemory(nextMem);
          },
        }
      );

      setLatestRun(record);
      setRunHistory((prev) => [record, ...prev].slice(0, 30));
      fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run: record }),
      }).catch(() => {});
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        models={models}
        workflowCount={workflows.length}
        runCount={runHistory.length}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <TopBar
          activeTab={activeTab}
          activeWorkflowName={activeWorkflow?.name ?? '未命名任务流'}
          isRunning={isRunning}
          onRunWorkflow={handleRunWorkflow}
          onCreateWorkflow={handleCreateWorkflow}
          onOpenModelCenter={() => {
            if (activeTab === 'models') {
              ggufFileInputRef.current?.click();
            } else {
              setActiveTab('models');
            }
          }}
        />

        {activeTab === 'workflow' && activeWorkflow && (
          <WorkflowBuilderView
            workflows={workflows}
            activeWorkflowId={activeWorkflow.id}
            onSelectWorkflow={handleSelectWorkflow}
            onUpdateWorkflow={(updated) =>
              setWorkflows((prev) =>
                prev.map((w) => (w.id === updated.id ? updated : w))
              )
            }
            onDeleteWorkflow={(id) => {
              const next = workflows.filter((w) => w.id !== id);
              setWorkflows(next);
              if (next[0]) handleSelectWorkflow(next[0].id);
            }}
            models={models}
            tools={allTools}
            isRunning={isRunning}
            liveTraces={liveTraces}
            latestRun={latestRun}
            runHistory={runHistory}
            triggerPayload={triggerPayload}
            onTriggerPayloadChange={setTriggerPayload}
            onRunWithPayload={handleRunWorkflow}
          />
        )}

        {activeTab === 'models' && (
          <ModelManagerView
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
            onUpdateModel={(updated) =>
              setModels((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m))
              )
            }
            onAddModel={(newModel) => setModels((prev) => [newModel, ...prev])}
            onDeleteModel={(id) => {
              const next = models.filter((m) => m.id !== id);
              setModels(next);
              if (next[0]) setSelectedModelId(next[0].id);
            }}
            fileInputRef={ggufFileInputRef}
          />
        )}

        {activeTab === 'tools' && (
          <ToolsMemoryView
            tools={allTools}
            onAddCustomTool={(tool) => setCustomTools((prev) => [...prev, tool])}
            onDeleteCustomTool={(id) =>
              setCustomTools((prev) => prev.filter((t) => t.id !== id))
            }
            memory={memory}
            onUpdateMemory={setMemory}
          />
        )}

        {activeTab === 'sdk' && activeWorkflow && (
          <SdkExportView workflow={activeWorkflow} models={models} />
        )}
      </div>
    </div>
  );
}
