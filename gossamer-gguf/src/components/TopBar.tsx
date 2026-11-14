import React from 'react';
import { Play, Plus, Square } from 'lucide-react';
import type { WorkspaceTab } from './Sidebar';

interface TopBarProps {
  activeTab: WorkspaceTab;
  activeWorkflowName: string;
  isRunning: boolean;
  onRunWorkflow: () => void;
  onCreateWorkflow: () => void;
  onOpenModelCenter: () => void;
}

const TAB_TITLES: Record<WorkspaceTab, string> = {
  workflow: '任务流编排',
  models: '模型加载中心',
  tools: '工具与记忆',
  sdk: '轻量 SDK 导出',
};

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  activeWorkflowName,
  isRunning,
  onRunWorkflow,
  onCreateWorkflow,
  onOpenModelCenter,
}) => {
  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8">
      <div className="flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-400 whitespace-nowrap shrink-0">工作台</span>
        <span className="text-slate-300" aria-hidden="true">
          /
        </span>
        <span className="font-medium text-slate-700 whitespace-nowrap shrink-0">
          {TAB_TITLES[activeTab]}
        </span>
        {activeTab === 'workflow' && (
          <>
            <span className="text-slate-300" aria-hidden="true">
              /
            </span>
            <span className="font-semibold text-slate-900 truncate">{activeWorkflowName}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {activeTab === 'workflow' ? (
          <>
            <button
              type="button"
              onClick={onCreateWorkflow}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建任务流</span>
            </button>
            <button
              type="button"
              onClick={onRunWorkflow}
              disabled={isRunning}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isRunning ? '执行中…' : '运行任务流'}</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onOpenModelCenter}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            {activeTab === 'models' ? '导入本地 .gguf 文件' : '前往模型中心'}
          </button>
        )}
      </div>
    </header>
  );
};
