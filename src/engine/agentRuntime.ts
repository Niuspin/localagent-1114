import type {
  AgentToolDefinition,
  GGUFModelProfile,
  MemoryEntry,
  NodeExecutionTrace,
  ToolCallLog,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRunRecord,
} from '../types/gguf';

export interface ExecutionCallbacks {
  onNodeStart: (nodeId: string, trace: NodeExecutionTrace) => void;
  onNodeToken?: (nodeId: string, partialOutput: string) => void;
  onNodeFinish: (nodeId: string, trace: NodeExecutionTrace) => void;
  onMemoryUpdate: (entries: MemoryEntry[]) => void;
}

function interpolateTemplate(
  template: string,
  outputs: Record<string, string>,
  memoryMap: Record<string, string>,
  triggerInput: string
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawPath: string) => {
    const key = rawPath.trim();
    if (key === 'input' || key === 'trigger.output') {
      return triggerInput;
    }
    if (key.startsWith('memory.')) {
      const memKey = key.slice('memory.'.length);
      return memoryMap[memKey] ?? '';
    }
    if (key.endsWith('.output')) {
      const nodeId = key.slice(0, -'.output'.length);
      return outputs[nodeId] ?? '';
    }
    return outputs[key] ?? '';
  });
}

function safeMathEval(expr: string): string {
  const cleaned = expr.replace(/[^0-9+\-*/().%\s]/g, '');
  if (!cleaned.trim()) {
    throw new Error('算术表达式为空或包含非法字符');
  }
  const fn = new Function(`"use strict"; return (${cleaned});`);
  const result = fn();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('算术计算结果无效');
  }
  return Number(result.toFixed(6)).toString();
}

function extractJsonFromText(text: string, dotPath?: string): unknown {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();
  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace === -1) {
    throw new Error('未在文本中发现合法 JSON 结构');
  }
  const sliced = candidate.slice(firstBrace);
  const parsed = JSON.parse(sliced);
  if (!dotPath) return parsed;
  return dotPath.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object' && seg in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[seg];
    }
    return undefined;
  }, parsed);
}

export async function executeTool(
  toolId: string,
  args: Record<string, unknown>,
  memoryEntries: MemoryEntry[],
  customTools: AgentToolDefinition[],
  onMemoryUpdate: (next: MemoryEntry[]) => void
): Promise<{ output: string; success: boolean; updatedMemory: MemoryEntry[] }> {
  let currentMemory = [...memoryEntries];

  try {
    switch (toolId) {
      case 'json_extract': {
        const text = String(args.text ?? '');
        const pathStr = args.path ? String(args.path) : undefined;
        const val = extractJsonFromText(text, pathStr);
        return {
          output: typeof val === 'string' ? val : JSON.stringify(val, null, 2),
          success: true,
          updatedMemory: currentMemory,
        };
      }
      case 'regex_match': {
        const text = String(args.text ?? '');
        const pattern = String(args.pattern ?? '.*');
        const re = new RegExp(pattern, 'gi');
        const matches = Array.from(text.matchAll(re)).map((m) => m[0]);
        return {
          output: JSON.stringify({ matchCount: matches.length, matches }, null, 2),
          success: true,
          updatedMemory: currentMemory,
        };
      }
      case 'math_eval': {
        const expr = String(args.expression ?? '');
        const res = safeMathEval(expr);
        return {
          output: res,
          success: true,
          updatedMemory: currentMemory,
        };
      }
      case 'kv_memory_rw': {
        const action = String(args.action ?? 'get').toLowerCase();
        const key = String(args.key ?? '');
        if (action === 'set' && key) {
          const val = String(args.value ?? args.text ?? '');
          const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const idx = currentMemory.findIndex((m) => m.key === key);
          const nextEntry: MemoryEntry = {
            key,
            value: val,
            updatedAt: now,
            source: 'Agent 运行写入',
          };
          if (idx >= 0) {
            currentMemory[idx] = nextEntry;
          } else {
            currentMemory = [nextEntry, ...currentMemory];
          }
          onMemoryUpdate(currentMemory);
          return {
            output: JSON.stringify({ status: 'saved', key, value: val }),
            success: true,
            updatedMemory: currentMemory,
          };
        }
        if (key) {
          const found = currentMemory.find((m) => m.key === key);
          return {
            output: found ? found.value : `未找到键 "${key}"`,
            success: Boolean(found),
            updatedMemory: currentMemory,
          };
        }
        return {
          output: JSON.stringify(
            Object.fromEntries(currentMemory.map((m) => [m.key, m.value])),
            null,
            2
          ),
          success: true,
          updatedMemory: currentMemory,
        };
      }
      case 'text_chunker': {
        const text = String(args.text ?? '');
        const maxChars = Math.max(120, Number(args.maxChars ?? 1500));
        if (text.length <= maxChars) {
          return { output: text, success: true, updatedMemory: currentMemory };
        }
        const chunk = text.slice(0, maxChars);
        return {
          output: `${chunk}\n...[已按 ${maxChars} 字符预算截断，原文共 ${text.length} 字符]`,
          success: true,
          updatedMemory: currentMemory,
        };
      }
      case 'http_fetch': {
        const url = String(args.url ?? '');
        const method = String(args.method ?? 'GET');
        const resp = await fetch('/api/tools/http-fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, method, body: args.body }),
        });
        const data = (await resp.json()) as { ok: boolean; status?: number; body?: string; error?: string };
        return {
          output: data.ok ? data.body ?? '' : `请求失败: ${data.error ?? data.status}`,
          success: data.ok,
          updatedMemory: currentMemory,
        };
      }
      default: {
        const custom = customTools.find((t) => t.id === toolId);
        if (custom?.customCode) {
          const runner = new Function('args', 'memory', `"use strict";\n${custom.customCode}`);
          const memObj = Object.fromEntries(currentMemory.map((m) => [m.key, m.value]));
          const out = runner(args, memObj);
          return {
            output: typeof out === 'string' ? out : JSON.stringify(out, null, 2),
            success: true,
            updatedMemory: currentMemory,
          };
        }
        return {
          output: `未知工具: ${toolId}`,
          success: false,
          updatedMemory: currentMemory,
        };
      }
    }
  } catch (err) {
    return {
      output: `工具执行错误: ${err instanceof Error ? err.message : String(err)}`,
      success: false,
      updatedMemory: currentMemory,
    };
  }
}

async function runSandboxInference(
  node: WorkflowNode,
  model: GGUFModelProfile,
  prompt: string,
  toolLogs: ToolCallLog[],
  memoryMap: Record<string, string>,
  onToken?: (partial: string) => void
): Promise<{ content: string; promptTokens: number; completionTokens: number; tokensPerSec: number }> {
  const lower = prompt.toLowerCase();
  let generated = '';

  if (node.agentConfig?.jsonMode) {
    const isOom = lower.includes('out of memory') || lower.includes('oom') || lower.includes('cuda');
    const isHigh = isOom || lower.includes('error') || lower.includes('fatal') || lower.includes('critical');
    const severity = isHigh ? 'high' : lower.includes('warn') ? 'medium' : 'low';
    const rootCause = isOom
      ? 'KV Cache 显存分配超出可用余量 (Free 312 MiB < Requested 2048 MiB)，并发会话数过高。'
      : isHigh
        ? '检测到服务关键错误特征，需排查对应工作节点异常堆栈。'
        : '日志状态平稳，仅包含常规信息或轻微告警。';
    const action = isOom
      ? '建议将 llama-server 的 n_ctx 从 16384 下调至 8192，并开启 --cache-type-k q8_0 --cache-type-v q8_0 压缩 KV 显存。'
      : '保持当前运行参数并写入周期巡检记录。';

    generated = JSON.stringify(
      {
        severity,
        model_used: `${model.name} (${model.quantization})`,
        root_cause: rootCause,
        immediate_action: action,
        detected_signals: toolLogs.length > 0 ? '已结合前置正则/工具上下文验证' : '直出语义研判',
      },
      null,
      2
    );
  } else if (lower.includes('select *') || lower.includes('db.query') || lower.includes('sql') || lower.includes('req.query')) {
    const standard = memoryMap['repo.coding_standard'] || '参数化查询规范';
    generated = [
      `### 本地离线代码安全审查报告`,
      `- **执行模型**：\`${model.name}\`（${model.quantization} · n_ctx=${model.params.nCtx}）`,
      `- **遵循规范**：${standard}`,
      ``,
      `#### 1. 检出高危漏洞：SQL 注入 (CWE-89)`,
      `代码直接将用户输入 \`req.query.id\` 拼接进 SQL 字符串 \`"SELECT * FROM users WHERE id = " + id\`，攻击者可构造恶意载荷绕过认证或拖库。`,
      ``,
      `#### 2. 修复建议（参数化查询 + 超时控制）`,
      '```ts',
      'app.get("/user", async (req, res) => {',
      '  const id = Number(req.query.id);',
      '  if (!Number.isInteger(id) || id <= 0) {',
      '    return res.status(400).json({ error: "Invalid user id" });',
      '  }',
      '  const rows = await db.query("SELECT id, name, role FROM users WHERE id = $1", [id]);',
      '  res.json(rows);',
      '});',
      '```',
    ].join('\n');
  } else if (lower.includes('工单') || lower.includes('调优') || lower.includes('n_ctx')) {
    const owner = memoryMap['infra.oncall_owner'] || '值班工程师';
    const vramCap = memoryMap['policy.gguf_vram_limit_gb'] || '8.0';
    generated = [
      `### 紧急运维处置工单（本地 GGUF Agent 自动生成）`,
      `- **通知责任人**：${owner}`,
      `- **显存红线策略**：单卡上限 ${vramCap} GB`,
      `- **根因摘要**：KV Cache 分配请求 2048 MiB 失败（可用仅 312 MiB），已触发 3 次重试。`,
      ``,
      `#### 推荐重启参数（llama-server）`,
      '```bash',
      `llama-server -m ./models/Qwen2.5-7B-Instruct-Q4_K_M.gguf -c 8192 -ngl 28 --cache-type-k q8_0 --cache-type-v q8_0 --flash-attn`,
      '```',
      `开启 \`q8_0\` KV Cache 量化后预计可降低约 46% 的上下文显存占用，立即恢复 14 路并发会话。`,
    ].join('\n');
  } else {
    generated = [
      `[${model.name} · 沙盒推理输出]`,
      `已接收上游上下文 (${prompt.length} 字符) 并完成语义综合：`,
      toolLogs.length > 0
        ? `本次调用关联了 ${toolLogs.length} 次本地工具返回，关键状态已核验通过。`
        : '当前节点未触发额外工具循环，直接生成结构化响应。',
      `\n摘要结果：任务流节点按温度 ${model.params.temperature} / 上下文 ${model.params.nCtx} 执行完毕，可继续传递至下游节点。`,
    ].join('\n');
  }

  // Stream tokens smoothly so the user sees realistic local GGUF generation cadence
  const chunks = generated.match(/.{1,12}/gs) ?? [generated];
  let acc = '';
  for (const ch of chunks) {
    acc += ch;
    onToken?.(acc);
    await new Promise((r) => setTimeout(r, 18));
  }

  const promptTokens = Math.max(24, Math.round(prompt.length / 3.1));
  const completionTokens = Math.max(18, Math.round(generated.length / 2.8));
  const tokensPerSec = model.parametersLabel.startsWith('2') ? 68.4 : 38.6;

  return { content: generated, promptTokens, completionTokens, tokensPerSec };
}

function sortNodesTopologically(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
    nodeMap.set(n.id, n);
  }
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }
  }

  const queue: WorkflowNode[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) queue.push(n);
  }

  const ordered: WorkflowNode[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    ordered.push(curr);
    for (const nextId of adj.get(curr.id) ?? []) {
      const deg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, deg);
      if (deg === 0) {
        const nextNode = nodeMap.get(nextId);
        if (nextNode) queue.push(nextNode);
      }
    }
  }

  // Include any remaining nodes in case of disconnected components
  for (const n of nodes) {
    if (!ordered.some((o) => o.id === n.id)) {
      ordered.push(n);
    }
  }

  return ordered;
}

export async function executeWorkflowDAG(
  workflow: WorkflowDefinition,
  triggerInput: string,
  models: GGUFModelProfile[],
  memoryEntries: MemoryEntry[],
  customTools: AgentToolDefinition[],
  callbacks: ExecutionCallbacks
): Promise<WorkflowRunRecord> {
  const runId = `run-${Date.now()}`;
  const startedAt = Date.now();
  const orderedNodes = sortNodesTopologically(workflow.nodes, workflow.edges);

  let currentMemory = [...memoryEntries];
  const outputs: Record<string, string> = {};
  const traces: Record<string, NodeExecutionTrace> = {};
  const skippedNodes = new Set<string>();
  const executionOrder: string[] = [];

  let totalTokens = 0;
  let lastOutput = triggerInput;
  let failed = false;

  for (const node of orderedNodes) {
    // Check if all incoming edges come from skipped nodes or deactivated branches
    const incomingEdges = workflow.edges.filter((e) => e.target === node.id);
    if (incomingEdges.length > 0) {
      const hasActiveIncoming = incomingEdges.some((e) => !skippedNodes.has(e.source) && outputs[e.source] !== undefined);
      if (!hasActiveIncoming) {
        skippedNodes.add(node.id);
        const skipTrace: NodeExecutionTrace = {
          nodeId: node.id,
          nodeLabel: node.label,
          nodeType: node.type,
          state: 'skipped',
          inputPreview: '上游条件分支未命中',
          output: '',
          inferenceMode: 'deterministic',
          toolCalls: [],
        };
        traces[node.id] = skipTrace;
        callbacks.onNodeFinish(node.id, skipTrace);
        continue;
      }
    }

    const memMap = Object.fromEntries(currentMemory.map((m) => [m.key, m.value]));
    const parentOutputs = incomingEdges
      .map((e) => outputs[e.source])
      .filter((v) => v !== undefined);
    const defaultParentOutput = parentOutputs[parentOutputs.length - 1] ?? triggerInput;

    const nodeStart = Date.now();
    const initialTrace: NodeExecutionTrace = {
      nodeId: node.id,
      nodeLabel: node.label,
      nodeType: node.type,
      state: 'running',
      startedAt: nodeStart,
      inputPreview: defaultParentOutput.slice(0, 280),
      output: '',
      toolCalls: [],
    };
    traces[node.id] = initialTrace;
    callbacks.onNodeStart(node.id, initialTrace);
    executionOrder.push(node.id);

    try {
      if (node.type === 'trigger') {
        const out = triggerInput;
        outputs[node.id] = out;
        lastOutput = out;
        const done: NodeExecutionTrace = {
          ...initialTrace,
          state: 'completed',
          finishedAt: Date.now(),
          durationMs: Math.max(8, Date.now() - nodeStart),
          output: out,
          inferenceMode: 'deterministic',
        };
        traces[node.id] = done;
        callbacks.onNodeFinish(node.id, done);
      } else if (node.type === 'tool') {
        const cfg = node.toolConfig;
        const toolId = cfg?.toolId ?? 'json_extract';
        const resolvedInput = cfg?.inputTemplate
          ? interpolateTemplate(cfg.inputTemplate, outputs, memMap, triggerInput)
          : defaultParentOutput;
        let extraArgs: Record<string, unknown> = {};
        if (cfg?.extraArgsJson) {
          try {
            extraArgs = JSON.parse(cfg.extraArgsJson);
          } catch {
            extraArgs = {};
          }
        }
        const toolArgs = { text: resolvedInput, ...extraArgs };
        const tStart = Date.now();
        const res = await executeTool(
          toolId,
          toolArgs,
          currentMemory,
          customTools,
          (nextMem) => {
            currentMemory = nextMem;
            callbacks.onMemoryUpdate(nextMem);
          }
        );
        currentMemory = res.updatedMemory;
        const tDur = Math.max(6, Date.now() - tStart);
        const callLog: ToolCallLog = {
          id: `tc-${Date.now()}`,
          toolId,
          toolName: toolId,
          arguments: JSON.stringify(toolArgs),
          result: res.output,
          durationMs: tDur,
          success: res.success,
        };
        outputs[node.id] = res.output;
        lastOutput = res.output;

        const done: NodeExecutionTrace = {
          ...initialTrace,
          state: res.success ? 'completed' : 'error',
          finishedAt: Date.now(),
          durationMs: Math.max(10, Date.now() - nodeStart),
          inputPreview: resolvedInput.slice(0, 280),
          output: res.output,
          inferenceMode: 'deterministic',
          toolCalls: [callLog],
          error: res.success ? undefined : res.output,
        };
        traces[node.id] = done;
        callbacks.onNodeFinish(node.id, done);
      } else if (node.type === 'condition') {
        const expr = node.conditionConfig?.expression ?? 'true';
        const fn = new Function('output', 'memory', `"use strict"; return Boolean(${expr});`);
        const passed = Boolean(fn(defaultParentOutput, memMap));

        // Mark outgoing edges not matching the branch as skipped downstream
        const outgoing = workflow.edges.filter((e) => e.source === node.id);
        for (const edge of outgoing) {
          const wantBranch = passed ? 'true' : 'false';
          if (edge.branch && edge.branch !== 'default' && edge.branch !== wantBranch) {
            skippedNodes.add(edge.target);
          }
        }

        const outStr = passed ? `分支命中：TRUE (${expr})` : `分支命中：FALSE (${expr})`;
        outputs[node.id] = defaultParentOutput; // Pass upstream payload forward along winning branch
        const done: NodeExecutionTrace = {
          ...initialTrace,
          state: 'completed',
          finishedAt: Date.now(),
          durationMs: Math.max(5, Date.now() - nodeStart),
          output: outStr,
          inferenceMode: 'deterministic',
        };
        traces[node.id] = done;
        callbacks.onNodeFinish(node.id, done);
      } else if (node.type === 'agent') {
        const cfg = node.agentConfig;
        const model =
          models.find((m) => m.id === cfg?.modelId) ??
          models.find((m) => m.status === 'loaded') ??
          models[0];

        if (!model) {
          throw new Error('未找到可用的本地 GGUF 模型配置');
        }
        if (model.status !== 'loaded') {
          throw new Error(`模型 "${model.name}" 尚未加载，请先在模型中心执行加载操作`);
        }

        const resolvedPrompt = interpolateTemplate(
          cfg?.promptTemplate || '{{input}}',
          outputs,
          memMap,
          triggerInput
        );

        const toolCalls: ToolCallLog[] = [];
        // Pre-fetch KV memory context if kv_memory_rw is enabled on this agent
        if (cfg?.enabledTools.includes('kv_memory_rw') && currentMemory.length > 0) {
          const tStart = Date.now();
          const memRes = await executeTool(
            'kv_memory_rw',
            { action: 'get' },
            currentMemory,
            customTools,
            (nextMem) => {
              currentMemory = nextMem;
              callbacks.onMemoryUpdate(nextMem);
            }
          );
          toolCalls.push({
            id: `tc-${Date.now()}-mem`,
            toolId: 'kv_memory_rw',
            toolName: 'kv_memory_rw (上下文注入)',
            arguments: '{"action":"get"}',
            result: memRes.output,
            durationMs: Math.max(4, Date.now() - tStart),
            success: true,
          });
        }

        let content = '';
        let promptTokens = 0;
        let completionTokens = 0;
        let tokensPerSec = 0;
        let inferenceMode: 'live' | 'sandbox' = 'sandbox';

        if (model.backend === 'sandbox') {
          const sim = await runSandboxInference(
            node,
            model,
            resolvedPrompt,
            toolCalls,
            memMap,
            (partial) => callbacks.onNodeToken?.(node.id, partial)
          );
          content = sim.content;
          promptTokens = sim.promptTokens;
          completionTokens = sim.completionTokens;
          tokensPerSec = sim.tokensPerSec;
          inferenceMode = 'sandbox';
        } else {
          inferenceMode = 'live';
          const sys = [
            cfg?.systemPrompt || 'You are a helpful local GGUF agent.',
            toolCalls.length > 0 ? `已注入本地 KV 记忆：\n${toolCalls[0].result}` : '',
          ]
            .filter(Boolean)
            .join('\n\n');

          const resp = await fetch('/api/gguf/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpointUrl: model.endpointUrl,
              model: model.remoteModelId || model.name,
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: resolvedPrompt },
              ],
              temperature: cfg?.temperatureOverride ?? model.params.temperature,
              topP: model.params.topP,
              repeatPenalty: model.params.repeatPenalty,
              maxTokens: cfg?.maxTokensOverride ?? model.params.maxTokens,
              jsonMode: cfg?.jsonMode ?? false,
            }),
          });

          const data = (await resp.json()) as {
            ok: boolean;
            content?: string;
            promptTokens?: number;
            completionTokens?: number;
            tokensPerSec?: number;
            error?: string;
          };

          if (!resp.ok || !data.ok) {
            throw new Error(data.error || '本地 GGUF 模型端点调用失败');
          }

          content = data.content ?? '';
          promptTokens = data.promptTokens ?? 0;
          completionTokens = data.completionTokens ?? 0;
          tokensPerSec = data.tokensPerSec ?? 0;
          callbacks.onNodeToken?.(node.id, content);
        }

        totalTokens += promptTokens + completionTokens;
        outputs[node.id] = content;
        lastOutput = content;

        const done: NodeExecutionTrace = {
          ...initialTrace,
          state: 'completed',
          finishedAt: Date.now(),
          durationMs: Math.max(15, Date.now() - nodeStart),
          inputPreview: resolvedPrompt.slice(0, 280),
          output: content,
          promptTokens,
          completionTokens,
          tokensPerSec,
          inferenceMode,
          toolCalls,
        };
        traces[node.id] = done;
        callbacks.onNodeFinish(node.id, done);
      } else if (node.type === 'output') {
        const format = node.outputConfig?.format ?? 'markdown';
        const formatted =
          format === 'json'
            ? JSON.stringify({ timestamp: new Date().toISOString(), result: defaultParentOutput }, null, 2)
            : defaultParentOutput;

        if (node.outputConfig?.saveToMemoryKey) {
          const memRes = await executeTool(
            'kv_memory_rw',
            { action: 'set', key: node.outputConfig.saveToMemoryKey, value: formatted.slice(0, 500) },
            currentMemory,
            customTools,
            (nextMem) => {
              currentMemory = nextMem;
              callbacks.onMemoryUpdate(nextMem);
            }
          );
          currentMemory = memRes.updatedMemory;
        }

        outputs[node.id] = formatted;
        lastOutput = formatted;

        const done: NodeExecutionTrace = {
          ...initialTrace,
          state: 'completed',
          finishedAt: Date.now(),
          durationMs: Math.max(5, Date.now() - nodeStart),
          output: formatted,
          inferenceMode: 'deterministic',
        };
        traces[node.id] = done;
        callbacks.onNodeFinish(node.id, done);
      }
    } catch (err) {
      failed = true;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errTrace: NodeExecutionTrace = {
        ...initialTrace,
        state: 'error',
        finishedAt: Date.now(),
        durationMs: Math.max(5, Date.now() - nodeStart),
        output: '',
        error: errMsg,
      };
      traces[node.id] = errTrace;
      callbacks.onNodeFinish(node.id, errTrace);
      break;
    }
  }

  const finishedAt = Date.now();
  return {
    id: runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    startedAt,
    finishedAt,
    status: failed ? 'failed' : 'completed',
    triggerInput,
    finalOutput: lastOutput,
    totalTokens,
    totalDurationMs: finishedAt - startedAt,
    traces,
    executionOrder,
  };
}
