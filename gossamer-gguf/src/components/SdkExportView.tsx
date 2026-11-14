import React, { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { GGUFModelProfile, WorkflowDefinition } from '../types/gguf';
import { generateFrameworkTsCode } from '../utils/sdkGenerator';

interface SdkExportViewProps {
  workflow: WorkflowDefinition;
  models: GGUFModelProfile[];
}

export const SdkExportView: React.FC<SdkExportViewProps> = ({ workflow, models }) => {
  const primaryModel = models.find((m) => m.status === 'loaded') ?? models[0];
  const [copied, setCopied] = useState(false);

  const tsCode = generateFrameworkTsCode(workflow, primaryModel);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tsCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              轻量级 TypeScript 框架源码导出
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              基于当前任务流「{workflow.name}」与模型「{primaryModel.name}」生成零外部框架依赖的独立运行代码。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? '已复制代码' : '复制 TypeScript'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadFile('gossamer-agent.ts', tsCode)}
              className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载 gossamer-agent.ts</span>
            </button>
            <button
              type="button"
              onClick={() =>
                handleDownloadFile('workflow.json', JSON.stringify(workflow, null, 2))
              }
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 workflow.json</span>
            </button>
          </div>
        </div>

        <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed max-h-[620px]">
          {tsCode}
        </pre>
      </div>
    </div>
  );
};
