import React, { useRef, useState } from 'react';
import {
  Activity,
  Check,
  Copy,
  HardDrive,
  Loader2,
  Play,
  Power,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type { GGUFModelProfile, RuntimeBackend } from '../types/gguf';
import {
  buildLlamaServerCommand,
  estimateModelMemory,
  parseGGUFFileHeader,
} from '../utils/ggufParser';

interface ModelManagerViewProps {
  models: GGUFModelProfile[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onUpdateModel: (model: GGUFModelProfile) => void;
  onAddModel: (model: GGUFModelProfile) => void;
  onDeleteModel: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const BACKEND_LABELS: Record<RuntimeBackend, string> = {
  sandbox: '内置沙盒引擎（免本地端口，直接可测）',
  'llama-cpp': 'llama.cpp (llama-server)',
  ollama: 'Ollama 本地服务',
  'lm-studio': 'LM Studio / OpenAI 兼容端点',
};

export const ModelManagerView: React.FC<ModelManagerViewProps> = ({
  models,
  selectedModelId,
  onSelectModel,
  onUpdateModel,
  onAddModel,
  onDeleteModel,
  fileInputRef,
}) => {
  const selectedModel = models.find((m) => m.id === selectedModelId) ?? models[0];
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [probeState, setProbeState] = useState<{
    loading: boolean;
    ok?: boolean;
    message?: string;
    detected?: string[];
  }>({ loading: false });
  const [copiedCmd, setCopiedCmd] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const handleGGUFFile = async (file: File) => {
    setParseError(null);
    try {
      const header = await parseGGUFFileHeader(file);
      const sizeGB = Number((file.size / 1024 ** 3).toFixed(2));
      const newId = `model-${Date.now()}`;
      const newProfile: GGUFModelProfile = {
        id: newId,
        name: header.modelName,
        filePath: `./models/${file.name}`,
        architecture: header.architecture,
        parametersLabel: `${Math.max(0.5, Number((sizeGB * 1.45).toFixed(1)))}B 估算`,
        quantization: header.quantization,
        fileSizeGB: Math.max(0.01, sizeGB),
        totalLayers: header.blockCount,
        maxContextLength: header.contextLength,
        embeddingLength: header.embeddingLength,
        headCountKv: header.headCountKv,
        backend: 'llama-cpp',
        endpointUrl: 'http://127.0.0.1:8080',
        remoteModelId: header.modelName.toLowerCase().replace(/\s+/g, '-'),
        status: 'unloaded',
        parsedHeader: header,
        params: {
          nCtx: Math.min(8192, header.contextLength),
          nGpuLayers: header.blockCount,
          nThreads: 8,
          nBatch: 512,
          flashAttn: true,
          kvCacheType: 'q8_0',
          temperature: 0.2,
          topP: 0.9,
          repeatPenalty: 1.08,
          maxTokens: 1024,
        },
      };
      onAddModel(newProfile);
      onSelectModel(newId);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析 GGUF 文件头失败');
    }
  };

  const handleProbeEndpoint = async () => {
    if (!selectedModel) return;
    if (selectedModel.backend === 'sandbox') {
      setProbeState({
        loading: false,
        ok: true,
        message: '内置沙盒推理引擎就绪（支持确定性工具调用与流式输出模拟）。',
      });
      return;
    }

    setProbeState({ loading: true });
    try {
      const resp = await fetch('/api/gguf/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: selectedModel.endpointUrl,
          backend: selectedModel.backend,
        }),
      });
      const data = (await resp.json()) as {
        ok: boolean;
        latencyMs?: number;
        detectedModels?: string[];
        error?: string;
      };
      if (data.ok) {
        setProbeState({
          loading: false,
          ok: true,
          message: `连接成功（${data.latencyMs} ms）`,
          detected: data.detectedModels ?? [],
        });
      } else {
        setProbeState({
          loading: false,
          ok: false,
          message: data.error || '未能探测到运行中的本地 GGUF 服务',
        });
      }
    } catch (err) {
      setProbeState({
        loading: false,
        ok: false,
        message: err instanceof Error ? err.message : '探测请求异常',
      });
    }
  };

  const handleToggleLoad = () => {
    if (!selectedModel) return;
    if (selectedModel.status === 'loaded') {
      onUpdateModel({ ...selectedModel, status: 'unloaded', loadedAt: undefined });
      return;
    }
    onUpdateModel({ ...selectedModel, status: 'loading' });
    setTimeout(() => {
      onUpdateModel({ ...selectedModel, status: 'loaded', loadedAt: Date.now() });
    }, 380);
  };

  const mem = selectedModel
    ? estimateModelMemory(
        selectedModel.fileSizeGB,
        selectedModel.totalLayers,
        selectedModel.embeddingLength,
        selectedModel.headCountKv,
        selectedModel.params
      )
    : null;

  const cliCmd = selectedModel
    ? buildLlamaServerCommand(selectedModel.filePath, selectedModel.params)
    : '';

  const copyCommand = async () => {
    if (!cliCmd) return;
    await navigator.clipboard.writeText(cliCmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 1800);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".gguf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleGGUFFile(f);
          e.target.value = '';
        }}
      />

      {/* GGUF File Dropzone */}
      <div
        ref={dropZoneRef}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleGGUFFile(f);
        }}
        className={`bg-white border rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200'
        }`}
      >
        <div className="space-y-1">
          <h2 className="font-display text-base font-semibold text-slate-900">
            01. 本地 .gguf 二进制头解析与注册
          </h2>
          <p className="text-sm text-slate-500">
            拖入或选择磁盘上的任意 <code className="font-mono text-slate-700">.gguf</code> 模型文件（仅读取前 4 MB 头部，秒级解析几十 GB 大模型架构与张量元数据）。
          </p>
          {parseError && <p className="text-xs text-red-600 font-medium pt-1">{parseError}</p>}
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>选择 .gguf 文件</span>
        </button>
      </div>

      {/* Main Split: Model Registry Table + Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Model List */}
        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">模型注册表</h3>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              共 {models.length} 个配置
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {models.map((m) => {
              const isSelected = m.id === selectedModel?.id;
              return (
                <div
                  key={m.id}
                  onClick={() => {
                    onSelectModel(m.id);
                    setProbeState({ loading: false });
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onSelectModel(m.id);
                  }}
                  className={`px-5 py-4 cursor-pointer transition-colors ${
                    isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {m.name}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-1">
                        {m.architecture} · {m.quantization} · {m.fileSizeGB} GB · {m.totalLayers} 层
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-medium whitespace-nowrap ${
                          m.status === 'loaded'
                            ? 'text-emerald-700'
                            : m.status === 'loading'
                              ? 'text-amber-600'
                              : 'text-slate-400'
                        }`}
                      >
                        {m.status === 'loaded'
                          ? '已加载'
                          : m.status === 'loading'
                            ? '加载中'
                            : '未加载'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Model Runtime & Loader Inspector */}
        {selectedModel && mem && (
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold text-slate-900 truncate">
                  {selectedModel.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                  {selectedModel.filePath}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {models.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteModel(selectedModel.id)}
                    className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100 transition-colors"
                    title="移除该模型配置"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleLoad}
                  disabled={selectedModel.status === 'loading'}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    selectedModel.status === 'loaded'
                      ? 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {selectedModel.status === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : selectedModel.status === 'loaded' ? (
                    <Power className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {selectedModel.status === 'loaded'
                      ? '卸载模型释放内存'
                      : selectedModel.status === 'loading'
                        ? '正在挂载权重…'
                        : '加载模型到运行时'}
                  </span>
                </button>
              </div>
            </div>

            {/* Memory Allocation Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                  <span>显存 / 内存分层预算</span>
                </span>
                <span className="font-mono tabular-nums text-slate-600">
                  VRAM 预计 {mem.totalVramGB} GB · RAM 预计 {mem.totalRamGB} GB
                </span>
              </div>

              <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-blue-600 h-full transition-all"
                  style={{
                    width: `${Math.min(100, (mem.weightsVramGB / Math.max(1, mem.totalVramGB + mem.totalRamGB)) * 100)}%`,
                  }}
                  title={`GPU 权重: ${mem.weightsVramGB} GB`}
                />
                <div
                  className="bg-amber-500 h-full transition-all"
                  style={{
                    width: `${Math.min(100, (mem.kvCacheGB / Math.max(1, mem.totalVramGB + mem.totalRamGB)) * 100)}%`,
                  }}
                  title={`KV Cache: ${mem.kvCacheGB} GB`}
                />
                <div
                  className="bg-slate-400 h-full transition-all"
                  style={{
                    width: `${Math.min(100, (mem.weightsRamGB / Math.max(1, mem.totalVramGB + mem.totalRamGB)) * 100)}%`,
                  }}
                  title={`CPU 权重: ${mem.weightsRamGB} GB`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                <span>GPU 权重: {mem.weightsVramGB} GB</span>
                <span>CPU 权重: {mem.weightsRamGB} GB</span>
                <span>
                  KV Cache ({selectedModel.params.kvCacheType.toUpperCase()}): {mem.kvCacheGB} GB
                </span>
                <span>计算缓冲: {mem.computeBufferGB} GB</span>
              </div>
            </div>

            {/* Runtime Backend & Connection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  推理运行时后端
                </label>
                <select
                  value={selectedModel.backend}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      backend: e.target.value as RuntimeBackend,
                    })
                  }
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-blue-500"
                >
                  {(Object.keys(BACKEND_LABELS) as RuntimeBackend[]).map((b) => (
                    <option key={b} value={b}>
                      {BACKEND_LABELS[b]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  本地服务端点 URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={selectedModel.backend === 'sandbox'}
                    value={selectedModel.endpointUrl}
                    onChange={(e) =>
                      onUpdateModel({ ...selectedModel, endpointUrl: e.target.value })
                    }
                    placeholder="http://127.0.0.1:8080"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800 disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleProbeEndpoint}
                    disabled={probeState.loading}
                    className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>{probeState.loading ? '探测中' : '探测'}</span>
                  </button>
                </div>
              </div>
            </div>

            {probeState.message && (
              <div
                className={`text-xs px-3.5 py-2.5 rounded-lg border ${
                  probeState.ok
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50/70 border-amber-200 text-amber-800'
                }`}
              >
                <div>{probeState.message}</div>
                {probeState.detected && probeState.detected.length > 0 && (
                  <div className="font-mono mt-1 text-slate-600">
                    检测到模型: {probeState.detected.join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* GGUF Loading Parameters */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">n_ctx 上下文</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {selectedModel.params.nCtx}
                  </span>
                </div>
                <input
                  type="range"
                  min={1024}
                  max={Math.min(65536, selectedModel.maxContextLength)}
                  step={1024}
                  value={selectedModel.params.nCtx}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      params: { ...selectedModel.params, nCtx: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">n_gpu_layers</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {selectedModel.params.nGpuLayers} / {selectedModel.totalLayers}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={selectedModel.totalLayers}
                  step={1}
                  value={Math.max(0, selectedModel.params.nGpuLayers)}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      params: { ...selectedModel.params, nGpuLayers: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">temperature</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {selectedModel.params.temperature.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.05}
                  value={selectedModel.params.temperature}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      params: { ...selectedModel.params, temperature: Number(e.target.value) },
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  KV Cache 量化
                </label>
                <select
                  value={selectedModel.params.kvCacheType}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      params: {
                        ...selectedModel.params,
                        kvCacheType: e.target.value as 'f16' | 'q8_0' | 'q4_0',
                      },
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg"
                >
                  <option value="f16">F16 (无损)</option>
                  <option value="q8_0">Q8_0 (推荐平衡)</option>
                  <option value="q4_0">Q4_0 (极限省显存)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  CPU 线程数 (n_threads)
                </label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={selectedModel.params.nThreads}
                  onChange={(e) =>
                    onUpdateModel({
                      ...selectedModel,
                      params: { ...selectedModel.params, nThreads: Number(e.target.value) || 4 },
                    })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg tabular-nums"
                />
              </div>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={selectedModel.params.flashAttn}
                    onChange={(e) =>
                      onUpdateModel({
                        ...selectedModel,
                        params: { ...selectedModel.params, flashAttn: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 accent-blue-600"
                  />
                  <span>启用 Flash Attention</span>
                </label>
              </div>
            </div>

            {/* Generated llama-server CLI command */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-slate-500" />
                  <span>本地 llama-server 启动命令</span>
                </span>
                <button
                  type="button"
                  onClick={copyCommand}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 whitespace-nowrap"
                >
                  {copiedCmd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCmd ? '已复制' : '复制命令'}</span>
                </button>
              </div>
              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">
                {cliCmd}
              </pre>
            </div>

            {/* Parsed Binary GGUF KV Table if user uploaded a real .gguf file */}
            {selectedModel.parsedHeader && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">
                    GGUF v{selectedModel.parsedHeader.version} 二进制头元数据
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">
                    Tensors: {selectedModel.parsedHeader.tensorCount} · KV Pairs:{' '}
                    {selectedModel.parsedHeader.kvCount}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="text-left font-medium px-3 py-2">Metadata Key</th>
                        <th className="text-left font-medium px-3 py-2">Type</th>
                        <th className="text-left font-medium px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      {selectedModel.parsedHeader.metadataEntries.map((kv) => (
                        <tr key={kv.key} className="hover:bg-slate-50">
                          <td className="px-3 py-1.5 text-slate-700">{kv.key}</td>
                          <td className="px-3 py-1.5 text-slate-400">{kv.type}</td>
                          <td className="px-3 py-1.5 text-slate-900 break-all">{kv.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
