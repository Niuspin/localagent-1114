import type { GGUFModelProfile, WorkflowDefinition } from '../types/gguf';
import { buildLlamaServerCommand } from './ggufParser';

export function generateFrameworkTsCode(
  workflow: WorkflowDefinition,
  primaryModel: GGUFModelProfile
): string {
  const workflowJson = JSON.stringify(
    {
      id: workflow.id,
      name: workflow.name,
      nodes: workflow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        agentConfig: n.agentConfig,
        conditionConfig: n.conditionConfig,
        toolConfig: n.toolConfig,
      })),
      edges: workflow.edges,
    },
    null,
    2
  );

  return `/**
 * Gossamer GGUF — 轻量级本地 GGUF Agent 编排运行库 (Standalone TypeScript)
 * 零外部重型依赖，可直接对接 llama-server / Ollama / node-llama-cpp。
 *
 * 启动本地模型示例:
 *   ${buildLlamaServerCommand(primaryModel.filePath, primaryModel.params).replace(/\n/g, '\n * ')}
 */

export interface GGUFEndpointConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export class LocalGGUFAgent {
  constructor(private config: GGUFEndpointConfig) {}

  async generate(systemPrompt: string, userPrompt: string, jsonMode = false): Promise<string> {
    const endpoint = \`\${this.config.baseUrl.replace(/\\/+$/, '')}/v1/chat/completions\`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.config.temperature ?? 0.2,
        max_tokens: this.config.maxTokens ?? 1024,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!resp.ok) {
      throw new Error(\`Local GGUF endpoint error: HTTP \${resp.status}\`);
    }
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? '';
  }
}

export const WORKFLOW_SPEC = ${workflowJson} as const;

export async function runLocalPipeline(triggerInput: string) {
  const endpointMap: Record<string, GGUFEndpointConfig> = {
    '${primaryModel.id}': {
      baseUrl: '${primaryModel.endpointUrl}',
      model: '${primaryModel.remoteModelId || primaryModel.name}',
      temperature: ${primaryModel.params.temperature},
      maxTokens: ${primaryModel.params.maxTokens},
    },
  };

  const outputs: Record<string, string> = {};
  const interpolate = (tpl: string) =>
    tpl.replace(/\\{\\{([^}]+)\\}\\}/g, (_, k: string) => {
      const key = k.trim();
      if (key === 'input' || key === 'trigger.output') return triggerInput;
      if (key.endsWith('.output')) return outputs[key.slice(0, -7)] ?? '';
      return outputs[key] ?? '';
    });

  for (const node of WORKFLOW_SPEC.nodes) {
    if (node.type === 'trigger') {
      outputs[node.id] = triggerInput;
    } else if (node.type === 'agent' && node.agentConfig) {
      const cfg = endpointMap[node.agentConfig.modelId] ?? Object.values(endpointMap)[0];
      const agent = new LocalGGUFAgent(cfg);
      const prompt = interpolate(node.agentConfig.promptTemplate);
      outputs[node.id] = await agent.generate(
        node.agentConfig.systemPrompt,
        prompt,
        node.agentConfig.jsonMode
      );
    } else if (node.type === 'output') {
      const prevEdge = WORKFLOW_SPEC.edges.find((e) => e.target === node.id);
      outputs[node.id] = prevEdge ? outputs[prevEdge.source] ?? '' : triggerInput;
    }
  }

  return outputs;
}
`;
}
