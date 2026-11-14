# AGENTS.md

本文件面向在本仓库工作的 AI Agent 和新贡献者。项目的运行方式、测试命令和硬性约束都以这里为准，请保持内容准确。

## 项目概览

LocalAgent 是一个**完全本地**的 Agent 框架：本地 GGUF 模型 + `llama-server`（llama.cpp），后端 Python，前端为无构建步骤的原生 HTML/CSS/JS。

- 后端：Python 3.10+、Starlette、uvicorn
- 前端：`web/` 静态文件，必须可离线运行（不允许 CDN、外部字体、统计脚本）
- 数据：`data/`（会话、记忆 SQLite、审计日志、密钥）只在本机，已被 `.gitignore` 忽略
- 测试：不依赖真实模型或 GPU；`tests/mock_llama_server.py` 模拟 llama-server，`tests/mock_mcp_server.py` 模拟 MCP 服务器

## 环境配置

```bash
python -m venv .venv
# Linux / macOS
.venv/bin/python -m pip install -r requirements-dev.txt
# Windows
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

不要执行 `pip install -e .`：本项目按源码目录运行，`web/` 不在 Python 包内。安装依赖用 `requirements*.txt`。

## 运行

```bash
python run.py --no-browser --port 8765
# 终端会打印 http://127.0.0.1:8765/?t=<令牌>，打开即可
```

真实使用需要：

- `bin/` 下有 llama.cpp 发行包（含 `llama-server` / `llama-server.exe`）
- `models/` 下有 `.gguf` 模型（多模态模型配 `mmproj-*.gguf`）

CI 和单元/端到端测试**不需要**这两样东西。

常用参数：`--workspace DIR`、`--browser`、`--load`、`--no-browser`。数据目录可用 `LAGENT_HOME` 覆盖。

## 测试与检查

```bash
python -m pytest tests -q                  # 必须全绿；约 80 秒
python tests/ui_smoke.py shots             # 可选：Playwright 浏览器冒烟（需 chromium）
python tests/eval/run_eval.py --repeat 3   # 可选：真实模型评测；没有模型时自动跳过
```

- CI（`.github/workflows/ci.yml`）在 Ubuntu 的 Python 3.10 / 3.12 上跑 pytest、UI 冒烟和评测脚本自检，并在 Windows 上构建 exe。
- 测试应保持跨平台：路径用 `pathlib`，文件读写显式 `encoding="utf-8"`；命令测试要同时兼容 bash 与 PowerShell。
- 需要真实环境验证时按 `docs/REAL_ENV_TEST.md` 操作。

## 目录

```
run.py                启动入口（参数解析在 lagent/launcher.py）
lagent/               后端：server、agent loop、engine、security、tools、mcp…
web/                  前端静态文件（无构建步骤）
tests/                单元 + 端到端测试、假 llama-server / 假 MCP 服务器
docs/API.md           前后端接口契约
docs/REAL_ENV_TEST.md 真实模型/GPU 环境验证清单
packaging/            PyInstaller 打包
data/                 本地数据（不提交）
models/ bin/ skills/  用户资源（不提交）
config.json           本地设置（不提交）；config.example.json 是可分享的默认值示例
```

## 修改约定

- **安全边界不能绕开**：所有文件操作走 `lagent.security.PathGuard`；新增工具必须经过 `lagent/tools` 的注册与 `toolset` 分组，写入、删除、命令和 MCP 调用必须走审批与审计日志。
- **前端离线**：不得引入任何外部资源；CSP 为 `script-src 'self'`，不能写内联 `<script>`。
- **配置同步**：修改默认配置时，同时更新 `lagent/config.py` 的 `DEFAULTS`、`config.example.json` 和需要时的 `docs/API.md`。
- **测试**：新增引擎/工具行为时扩展对应的 mock，而不是要求测试环境安装真实模型；测试里不要写死绝对路径。
- **语言与风格**：界面和文档使用中文；代码注释保持简短、解释“为什么”。
- **不要提交**：`data/`、`config.json`、模型、llama.cpp 二进制、密钥、构建产物或截图。
