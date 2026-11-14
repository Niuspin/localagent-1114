export type RuntimeBackend = 'llama-cpp' | 'ollama' | 'lm-studio' | 'sandbox';

export type ModelLoadStatus = 'unloaded' | 'loading' | 'loaded' | 'error';

export type QuantizationType =
  | 'F16'
  | 'Q8_0'
  | 'Q6_K'
  | 'Q5_K_M'
  | 'Q5_K_S'
  | 'Q4_K_M'
  | 'Q4_K_S'
  | 'Q4_0'
  | 'Q3_K_M'
  | 'Q2_K'
  | 'IQ4_XS'
  | 'UNKNOWN';

export interface GGUFParsedHeader {
  fileName: string;
  fileSizeBytes: number;
  magic: string;
  version: number;
  tensorCount: number;
  kvCount: number;
  architecture: string;
  modelName: string;
  quantization: QuantizationType;
  contextLength: number;
  embeddingLength: number;
  blockCount: number;
  headCount: number;
  headCountKv: number;
  vocabSize: number;
  tokenizerModel: string;
  metadataEntries: Array<{ key: string; value: string; type: string }>;
}

export interface ModelRuntimeParams {
  nCtx: number;
  nGpuLayers: number;
  nThreads: number;
  nBatch: number;
  flashAttn: boolean;
  kvCacheType: 'f16' | 'q8_0' | 'q4_0';
  temperature: number;
  topP: number;
  repeatPenalty: number;
  maxTokens: number;
}

export interface GGUFModelProfile {
  id: string;
  name: string;
  filePath: string;
  architecture: string;
  parametersLabel: string;
  quantization: QuantizationType;
  fileSizeGB: number;
  totalLayers: number;
  maxContextLength: number;
  embeddingLength: number;
  headCountKv: number;
  backend: RuntimeBackend;
  endpointUrl: string;
  remoteModelId: string;
  status: ModelLoadStatus;
  loadedAt?: number;
  params: ModelRuntimeParams;
  parsedHeader?: GGUFParsedHeader;
}

export type WorkflowNodeType = 'trigger' | 'agent' | 'condition' | 'tool' | 'output';

export type NodeExecutionState = 'idle' | 'queued' | 'running' | 'completed' | 'skipped' | 'error';

export interface AgentNodeConfig {
  modelId: string;
  systemPrompt: string;
  promptTemplate: string;
  temperatureOverride?: number;
  maxTokensOverride?: number;
  jsonMode: boolean;
  enabledTools: string[];
  maxToolIterations: number;
}

export interface TriggerNodeConfig {
  triggerType: 'manual' | 'interval' | 'webhook';
  defaultInput: string;
  intervalSeconds?: number;
}

export interface ConditionNodeConfig {
  expression: string; // e.g. "output.includes('CRITICAL') || json.severity === 'high'"
  description: string;
}

export interface ToolNodeConfig {
  toolId: string;
  inputTemplate: string;
  extraArgsJson: string;
}

export interface OutputNodeConfig {
  format: 'markdown' | 'json' | 'plain';
  saveToMemoryKey?: string;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  x: number;
  y: number;
  triggerConfig?: TriggerNodeConfig;
  agentConfig?: AgentNodeConfig;
  conditionConfig?: ConditionNodeConfig;
  toolConfig?: ToolNodeConfig;
  outputConfig?: OutputNodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  branch?: 'default' | 'true' | 'false';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ToolCallLog {
  id: string;
  toolId: string;
  toolName: string;
  arguments: string;
  result: string;
  durationMs: number;
  success: boolean;
}

export interface NodeExecutionTrace {
  nodeId: string;
  nodeLabel: string;
  nodeType: WorkflowNodeType;
  state: NodeExecutionState;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  inputPreview: string;
  output: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSec?: number;
  inferenceMode?: 'live' | 'sandbox' | 'deterministic';
  toolCalls: ToolCallLog[];
  error?: string;
}

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'completed' | 'failed';
  triggerInput: string;
  finalOutput: string;
  totalTokens: number;
  totalDurationMs: number;
  traces: Record<string, NodeExecutionTrace>;
  executionOrder: string[];
}

export interface AgentToolDefinition {
  id: string;
  name: string;
  description: string;
  parametersSchema: string;
  isBuiltIn: boolean;
  customCode?: string;
}

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: string;
  source: string;
}
