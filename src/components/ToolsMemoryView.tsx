import React, { useState } from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { executeTool } from '../engine/agentRuntime';
import type { AgentToolDefinition, MemoryEntry } from '../types/gguf';

interface ToolsMemoryViewProps {
  tools: AgentToolDefinition[];
  onAddCustomTool: (tool: AgentToolDefinition) => void;
  onDeleteCustomTool: (id: string) => void;
  memory: MemoryEntry[];
  onUpdateMemory: (entries: MemoryEntry[]) => void;
}

export const ToolsMemoryView: React.FC<ToolsMemoryViewProps> = ({
  tools,
  onAddCustomTool,
  onDeleteCustomTool,
  memory,
  onUpdateMemory,
}) => {
  const [selectedToolId, setSelectedToolId] = useState(tools[0]?.id ?? 'json_extract');
  const [testArgsJson, setTestArgsJson] = useState('{"text": "{\\"status\\": \\"ok\\", \\"vram\\": 4.68}", "path": "vram"}');
  const [testResult, setTestResult] = useState<string>('');

  const [newToolName, setNewToolName] = useState('');
  const [newToolDesc, setNewToolDesc] = useState('');
  const [newToolCode, setNewToolCode] = useState('return `处理结果: ${JSON.stringify(args)}`;');

  const [memKey, setMemKey] = useState('');
  const [memVal, setMemVal] = useState('');

  const selectedTool = tools.find((t) => t.id === selectedToolId) ?? tools[0];

  const handleRunToolTest = async () => {
    if (!selectedTool) return;
    try {
      const parsed = JSON.parse(testArgsJson || '{}');
      const customList = tools.filter((t) => !t.isBuiltIn);
      const res = await executeTool(selectedTool.id, parsed, memory, customList, onUpdateMemory);
      setTestResult(res.output);
    } catch (err) {
      setTestResult(`测试参数 JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateCustomTool = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newToolName.trim()) return;
    const id = `custom_${Date.now().toString().slice(-5)}`;
    onAddCustomTool({
      id,
      name: newToolName.trim(),
      description: newToolDesc.trim() || '自定义本地 JavaScript 沙盒工具',
      parametersSchema: '{ "text": "string" }',
      isBuiltIn: false,
      customCode: newToolCode,
    });
    setSelectedToolId(id);
    setNewToolName('');
    setNewToolDesc('');
  };

  const handleSaveMemory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memKey.trim()) return;
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const idx = memory.findIndex((m) => m.key === memKey.trim());
    const entry: MemoryEntry = {
      key: memKey.trim(),
      value: memVal,
      updatedAt: now,
      source: '控制台手动录入',
    };
    const next = idx >= 0 ? memory.map((m, i) => (i === idx ? entry : m)) : [entry, ...memory];
    onUpdateMemory(next);
    setMemKey('');
    setMemVal('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Tools Registry + Tester */}
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              01. 本地 Agent 工具注册表与沙盒调试
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              为本地小参数 GGUF 模型提供确定性计算、正则提取、JSON 解析与内网 HTTP 能力，减少推理幻觉。
            </p>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {tools.map((t) => (
              <div
                key={t.id}
                onClick={() => setSelectedToolId(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedToolId(t.id);
                }}
                className={`px-4 py-3 cursor-pointer flex items-start justify-between gap-3 transition-colors ${
                  selectedTool?.id === t.id ? 'bg-slate-50' : 'hover:bg-slate-50/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <span>{t.name}</span>
                    <span className="text-xs font-mono text-slate-400">· {t.id}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>
                </div>
                {!t.isBuiltIn && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomTool(t.id);
                    }}
                    className="text-slate-400 hover:text-red-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {selectedTool && (
            <div className="pt-2 space-y-3 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800">
                  在线测试：{selectedTool.name}
                </span>
                <span className="font-mono text-slate-500">
                  Schema: {selectedTool.parametersSchema}
                </span>
              </div>
              <textarea
                rows={3}
                value={testArgsJson}
                onChange={(e) => setTestArgsJson(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={handleRunToolTest}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>执行测试</span>
                </button>
              </div>
              {testResult && (
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono whitespace-pre-wrap">
                  {testResult}
                </pre>
              )}
            </div>
          )}

          {/* Create Custom Tool */}
          <form onSubmit={handleCreateCustomTool} className="pt-4 border-t border-slate-100 space-y-3">
            <div className="text-xs font-semibold text-slate-800">注册自定义 JS 工具</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={newToolName}
                onChange={(e) => setNewToolName(e.target.value)}
                placeholder="工具名称（如：日志脱敏器）"
                className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
              <input
                type="text"
                value={newToolDesc}
                onChange={(e) => setNewToolDesc(e.target.value)}
                placeholder="用途说明"
                className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
              />
            </div>
            <textarea
              rows={2}
              value={newToolCode}
              onChange={(e) => setNewToolCode(e.target.value)}
              placeholder="JS 函数体，可用参数 args, memory"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加到工具库</span>
            </button>
          </form>
        </div>

        {/* Right: Persistent KV Memory */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              02. 轻量级 KV 上下文记忆库
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              在任务流中通过 <code className="font-mono">{`{{memory.key}}`}</code> 或 <code className="font-mono">kv_memory_rw</code> 工具直接读写。
            </p>
          </div>

          <form onSubmit={handleSaveMemory} className="space-y-2.5">
            <input
              type="text"
              value={memKey}
              onChange={(e) => setMemKey(e.target.value)}
              placeholder="键名（例如：infra.cluster_name）"
              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg"
            />
            <textarea
              rows={2}
              value={memVal}
              onChange={(e) => setMemVal(e.target.value)}
              placeholder="记忆内容…"
              className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              写入 / 更新记忆
            </button>
          </form>

          <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {memory.length === 0 ? (
              <div className="p-4 text-xs text-slate-400 text-center">暂无记忆条目</div>
            ) : (
              memory.map((m) => (
                <div key={m.key} className="p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-semibold text-slate-900">{m.key}</span>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="font-mono tabular-nums">{m.updatedAt}</span>
                      <button
                        type="button"
                        onClick={() => onUpdateMemory(memory.filter((x) => x.key !== m.key))}
                        className="text-slate-400 hover:text-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 break-words">{m.value}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
