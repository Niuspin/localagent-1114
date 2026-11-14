import React from 'react';
import { Cpu, Database, FileCode2, GitBranch } from 'lucide-react';
import type { GGUFModelProfile } from '../types/gguf';

export type WorkspaceTab = 'workflow' | 'models' | 'tools' | 'sdk';

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  models: GGUFModelProfile[];
  workflowCount: number;
  runCount: number;
}

const NAV_ITEMS: Array<{ id: WorkspaceTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'workflow', label: '任务流编排', icon: GitBranch },
  { id: 'models', label: '模型加载中心', icon: Cpu },
  { id: 'tools', label: '工具与记忆', icon: Database },
  { id: 'sdk', label: '轻量 SDK 导出', icon: FileCode2 },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  models,
  workflowCount,
  runCount,
}) => {
  const loadedModels = models.filter((m) => m.status === 'loaded');

  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between select-none">
      <div>
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Gossamer GGUF
          </span>
        </div>

        <nav className="p-3 space-y-1" aria-label="主导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-5 pt-4 pb-3 border-t border-slate-100 mt-2">
          <div className="text-xs font-medium text-slate-400 mb-2.5">已加载推理槽位</div>
          {loadedModels.length === 0 ? (
            <div className="text-xs text-slate-500">当前无已加载的 GGUF 模型</div>
          ) : (
            <div className="space-y-2.5">
              {loadedModels.map((m) => (
                <div key={m.id} className="text-xs">
                  <div className="font-medium text-slate-800 truncate">{m.name}</div>
                  <div className="text-slate-500 font-mono tabular-nums mt-0.5">
                    {m.quantization} · {m.params.nCtx} ctx ·{' '}
                    {m.backend === 'sandbox' ? '沙盒' : '本地服务'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1.5">
        <div className="flex items-center justify-between">
          <span>已加载模型</span>
          <span className="font-mono tabular-nums font-medium text-slate-800">
            {loadedModels.length} / {models.length}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>任务流数量</span>
          <span className="font-mono tabular-nums font-medium text-slate-800">{workflowCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>累计执行次数</span>
          <span className="font-mono tabular-nums font-medium text-slate-800">{runCount}</span>
        </div>
      </div>
    </aside>
  );
};
