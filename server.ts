import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const STATE_FILE = path.resolve(process.cwd(), '.gossamer-state.json');

interface ServerState {
  runs: unknown[];
  updatedAt: number;
}

let serverState: ServerState = {
  runs: [],
  updatedAt: Date.now(),
};

try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ServerState>;
    if (Array.isArray(parsed.runs)) {
      serverState.runs = parsed.runs;
    }
  }
} catch {
  // Ignore read errors on ephemeral filesystems
}

function persistState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(serverState, null, 2), 'utf-8');
  } catch {
    // Ignore write errors in read-only runtimes
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, framework: 'gossamer-gguf', timestamp: Date.now() });
  });

  // Probe a local GGUF runtime server (llama.cpp llama-server, Ollama, LM Studio)
  app.post('/api/gguf/probe', async (req, res) => {
    const { endpointUrl, backend } = req.body as {
      endpointUrl?: string;
      backend?: string;
    };

    if (!endpointUrl || !/^https?:\/\//i.test(endpointUrl)) {
      res.status(400).json({ ok: false, error: '请提供合法的 HTTP/HTTPS 端点地址，例如 http://127.0.0.1:8080' });
      return;
    }

    const base = endpointUrl.replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      let probePath = '/v1/models';
      if (backend === 'ollama') {
        probePath = '/api/tags';
      } else if (backend === 'llama-cpp') {
        probePath = '/health';
      }

      const start = Date.now();
      const response = await fetch(`${base}${probePath}`, {
        method: 'GET',
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        res.json({
          ok: false,
          status: response.status,
          latencyMs,
          error: `目标端口响应异常 (HTTP ${response.status})`,
        });
        return;
      }

      const data = await response.json().catch(() => ({}));
      const detectedModels: string[] = [];

      if (Array.isArray((data as { models?: Array<{ name?: string }> }).models)) {
        for (const m of (data as { models: Array<{ name?: string }> }).models) {
          if (m.name) detectedModels.push(m.name);
        }
      } else if (Array.isArray((data as { data?: Array<{ id?: string }> }).data)) {
        for (const m of (data as { data: Array<{ id?: string }> }).data) {
          if (m.id) detectedModels.push(m.id);
        }
      }

      // If llama.cpp /health succeeded, also fetch /props for loaded GGUF info
      let llamaProps: Record<string, unknown> | null = null;
      if (backend === 'llama-cpp') {
        try {
          const propsResp = await fetch(`${base}/props`, { signal: controller.signal });
          if (propsResp.ok) {
            llamaProps = (await propsResp.json()) as Record<string, unknown>;
          }
        } catch {
          // Optional endpoint
        }
      }

      res.json({
        ok: true,
        latencyMs,
        detectedModels,
        llamaProps,
        raw: data,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? '连接超时 (3.5s)：未检测到运行中的本地 GGUF 服务'
          : `无法连接到 ${base} (${err instanceof Error ? err.message : '网络错误'})`;
      res.json({ ok: false, error: message });
    } finally {
      clearTimeout(timer);
    }
  });

  // Proxy OpenAI-compatible chat completions to local GGUF server
  app.post('/api/gguf/chat', async (req, res) => {
    const {
      endpointUrl,
      model,
      messages,
      temperature = 0.2,
      topP = 0.9,
      repeatPenalty = 1.08,
      maxTokens = 1024,
      jsonMode = false,
    } = req.body as {
      endpointUrl?: string;
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      temperature?: number;
      topP?: number;
      repeatPenalty?: number;
      maxTokens?: number;
      jsonMode?: boolean;
    };

    if (!endpointUrl || !/^https?:\/\//i.test(endpointUrl)) {
      res.status(400).json({ ok: false, error: '无效的本地推理端点 URL' });
      return;
    }

    const base = endpointUrl.replace(/\/+$/, '');
    const targetUrl = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const start = Date.now();

    try {
      const payload: Record<string, unknown> = {
        model: model || 'local-gguf',
        messages: messages || [],
        temperature,
        top_p: topP,
        repeat_penalty: repeatPenalty,
        max_tokens: maxTokens,
        stream: false,
      };
      if (jsonMode) {
        payload.response_format = { type: 'json_object' };
      }

      const upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const durationMs = Date.now() - start;
      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '');
        res.status(upstream.status).json({
          ok: false,
          error: `本地模型服务端返回 HTTP ${upstream.status}: ${errText.slice(0, 240)}`,
        });
        return;
      }

      const data = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        timings?: { predicted_per_second?: number; predicted_n?: number; prompt_n?: number };
      };

      const content = data.choices?.[0]?.message?.content ?? '';
      const promptTokens = data.usage?.prompt_tokens ?? data.timings?.prompt_n ?? 0;
      const completionTokens =
        data.usage?.completion_tokens ??
        data.timings?.predicted_n ??
        Math.max(1, Math.round(content.length / 3.2));
      const tokensPerSec =
        data.timings?.predicted_per_second ??
        Number(((completionTokens / Math.max(1, durationMs)) * 1000).toFixed(1));

      res.json({
        ok: true,
        content,
        promptTokens,
        completionTokens,
        tokensPerSec: Number(tokensPerSec.toFixed(1)),
        durationMs,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: `本地 GGUF 服务调用失败：${err instanceof Error ? err.message : '连接被拒绝'}`,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // Safe HTTP fetch tool proxy for Agent tool calls
  app.post('/api/tools/http-fetch', async (req, res) => {
    const { url, method = 'GET', body } = req.body as {
      url?: string;
      method?: string;
      body?: unknown;
    };

    if (!url || !/^https?:\/\//i.test(url)) {
      res.status(400).json({ ok: false, error: '仅支持 http:// 或 https:// 协议' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        method: method.toUpperCase() === 'POST' ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body && method.toUpperCase() === 'POST' ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await resp.text();
      res.json({
        ok: resp.ok,
        status: resp.status,
        body: text.slice(0, 4000),
      });
    } catch (err) {
      res.json({
        ok: false,
        error: err instanceof Error ? err.message : 'HTTP 请求失败',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/runs', (_req, res) => {
    res.json({ runs: serverState.runs.slice(0, 30) });
  });

  app.post('/api/runs', (req, res) => {
    const { run } = req.body as { run?: unknown };
    if (run) {
      serverState.runs = [run, ...serverState.runs].slice(0, 30);
      serverState.updatedAt = Date.now();
      persistState();
    }
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gossamer GGUF server running on http://localhost:${PORT}`);
  });
}

startServer();
