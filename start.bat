@echo off
chcp 65001 >nul
cd /d "%~dp0"
where python >nul 2>nul || (echo 未找到 python，请先安装 Python 3.10+ 并勾选 "Add to PATH" & pause & exit /b 1)
if not exist .venv (
  echo [LocalAgent] 创建虚拟环境...
  python -m venv .venv || (pause & exit /b 1)
)
rem 首次安装若中途失败，.venv 可能已存在但依赖不全；每次启动做一次轻量检查。
.venv\Scripts\python -c "import starlette, uvicorn, bs4" >nul 2>nul
if errorlevel 1 (
  echo [LocalAgent] 安装/更新依赖...
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\python -m pip install -q -r requirements.txt || (echo 依赖安装失败，请检查网络后重试。 & pause & exit /b 1)
)
if not exist models mkdir models
if not exist bin mkdir bin
if not exist skills mkdir skills
.venv\Scripts\python run.py %*
pause
