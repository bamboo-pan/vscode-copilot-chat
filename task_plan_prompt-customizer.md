# Prompt Customizer 任务计划

## 项目概述

实现 Prompt Customizer 功能，允许用户自定义 GitHub Copilot Chat 的 System Prompt 组件。

**开始时间**：2026-01-16 | **最后更新**：2026-01-24 | **状态**：✅ 已完成

---

## 📊 完成度总览

| Phase | 名称 | 状态 | 完成度 |
|-------|------|------|--------|
| 1 | 基础架构 | ✅ | 100% |
| 2 | TreeView UI | ✅ | 100% |
| 3 | 编辑功能 | ✅ | 100% |
| 4 | 高级功能 | ✅ | 100% |
| 5 | 集成与测试 | ✅ | 100% |
| 6 | Skills/Agents/Tools 管理 | ✅ | 100% |
| 7 | Agents 只读功能 | ✅ | 100% |
| 8 | 导入导出增强 | ✅ | 100% |
| 9 | Preview/Reset 增强 | ✅ | 100% |

**编译状态**：0 errors ✅

---

## 🎯 功能清单

### 核心功能

| 功能 | 描述 | 状态 |
|------|------|------|
| 组件管理 | 16个内置组件的启用/禁用 | ✅ |
| 自定义内容 | 编辑组件内容，支持重置 | ✅ |
| 自定义组件 | 创建/删除/编辑用户自定义组件 | ✅ |
| 组件排序 | moveUp/moveDown 调整顺序 | ✅ |
| Token 估算 | 实时显示 Token 计数 | ✅ |
| 配置导入导出 | JSON 格式备份和恢复 | ✅ |
| 预览功能 | 完整 Prompt 预览（含模型选择） | ✅ |

### 扩展功能

| 功能 | 描述 | 状态 |
|------|------|------|
| Skills 管理 | Claude Skills 启用/禁用 | ✅ |
| Agents 管理 | 自定义 Agents 管理（只读保护） | ✅ |
| Tools 管理 | 52+ 工具分类管理 | ✅ |
| 批量操作 | 全选/取消全选（分类级别） | ✅ |
| Read Only 标识 | 不发送给模型的工具特殊显示 | ✅ |

### 模型集成

| 模型家族 | Prompt 类数量 | 状态 |
|----------|---------------|------|
| Anthropic/Claude | 2 | ✅ |
| Google Gemini | 2 | ✅ |
| OpenAI/GPT | 6 | ✅ |
| 通用 Agent | 2 | ✅ |
| **合计** | **12** | ✅ |

---

## 📁 关键文件索引

### 服务层

| 文件 | 职责 |
|------|------|
| `promptCustomizationServiceImpl.ts` | 核心服务实现 |
| `toolsManagementService.ts` | 工具管理服务 |
| `skillsManagementService.ts` | Skills 管理服务 |
| `agentsManagementService.ts` | Agents 管理服务 |

### UI 层

| 文件 | 职责 |
|------|------|
| `promptCustomizerTreeView.ts` | TreeView 提供者 |
| `promptEditorProvider.ts` | 组件编辑器 |

### 类型与组件

| 文件 | 职责 |
|------|------|
| `types.ts` | 类型定义（含 ModelFamily） |
| `builtInComponents.ts` | 16 个内置组件定义 |
| `toolNames.ts` | 工具名称和分类映射 |

### Prompt 集成

| 目录/文件 | 模型 |
|-----------|------|
| `anthropicPrompts.tsx` | Claude 系列 |
| `geminiPrompts.tsx` | Gemini 系列 |
| `openai/*.tsx` | GPT/OpenAI 系列 |
| `defaultAgentInstructions.tsx` | 通用 Agent |

---

## 📝 技术备忘

### 模型组件支持情况

| 组件 | GPT | Claude | Gemini |
|------|-----|--------|--------|
| Structured Workflow | ✅ | ❌ | ❌ |
| Communication Guidelines | ✅ | ❌ | ❌ |
| Apply Patch Instructions | ✅ | ❌ | ❌ |
| Tool Use Instructions | ❌ | ✅ | ✅ |
| Edit File Instructions | ❌ | ✅ | ✅ |
| 其他组件 | ✅ | ✅ | ✅ |

### 内置组件分类（20 个）

| 分类 | 数量 | 组件 |
|------|------|------|
| Identity | 1 | copilotIdentityRules |
| Safety | 1 | safetyRules |
| Context | 3 | environmentInfo, workspaceInfo, currentContext |
| Tools | 7 | coreInstructions, toolUseInstructions, editFileInstructions, notebookInstructions, applyPatchInstructions, mcpToolInstructions, genericEditingTips |
| Formatting | 4 | fileLinkification, outputFormatting, mathIntegrationRules, codeBlockFormattingRules |
| Workflow | 4 | structuredWorkflow, communicationGuidelines, codesearchModeInstructions, reminderInstructions |

### Tools 分类（10 类）

| 分类 | 工具数量 | 说明 |
|------|----------|------|
| File Read & Search | 6 | 文件读取和搜索 |
| File Edit | 6 | 文件编辑 |
| Terminal | 5 | 终端操作 |
| Task & Todo | 4 | 任务管理 |
| Agent & Memory | 2 | Agent 和记忆 |
| Jupyter Notebook | 5 | Notebook 操作 |
| Web Interaction | 3 | 网页交互 |
| VS Code Interaction | 12 | VS Code 交互 |
| Testing | 3 | 测试相关 |
| Read Only | 6 | 不发送给模型的工具 |

---

## 🔗 相关文档

- [用户文档](docs/prompt-customizer.md)
- [进度日志](progress.md)
- [功能规格](prompt-customizer-spec.md)
