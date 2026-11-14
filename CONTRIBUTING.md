# 贡献指南

感谢参与 LocalAgent。提交改动前请先阅读 [`AGENTS.md`](AGENTS.md)，其中包含环境配置、运行方式和安全约定。

## 开发流程

1. Fork 仓库并新建分支。
2. 创建虚拟环境并安装开发依赖：

   ```bash
   python -m venv .venv
   .venv/bin/python -m pip install -r requirements-dev.txt   # Windows: .venv\Scripts\python
   ```

3. 修改代码，补充或更新测试。
4. 运行测试，确保全部通过：

   ```bash
   python -m pytest tests -q
   ```

5. 提交 Pull Request，说明改动目的、影响范围和验证方式。

## 提交前检查

- [ ] `python -m pytest tests -q` 全绿（不需要真实模型或 GPU）
- [ ] 没有提交 `data/`、`config.json`、模型、llama.cpp 二进制、密钥、构建产物或截图
- [ ] 前端没有引入任何外部资源（CDN、字体、图片、统计脚本）
- [ ] 涉及文件、命令、MCP 或权限的改动仍然经过 `PathGuard`、审批与审计
- [ ] 修改了配置默认值时，同步更新 `config.example.json` 与相关文档
- [ ] 测试在 Windows 与 Linux 上都能运行（路径、编码、shell 命令）

## 代码风格

- Python 3.10+，4 空格缩进，行宽尽量不超过 120 字符。
- 前端为原生 JavaScript，不引入构建工具或框架。
- 注释简短，解释“为什么”而不是复述代码。
- 界面文案和文档使用中文。

## 安全问题

请不要在公开 Issue 中披露可利用细节或真实密钥，按 [`SECURITY.md`](SECURITY.md) 的方式私密报告。
