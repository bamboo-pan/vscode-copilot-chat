# Prompt Customizer - 进度日志

## 目录

- [2026-01-24](#2026-01-24) - ESLint 架构规范修复、Preview/Reset 增强、导入导出增强、Agents 只读
- [2026-01-23](#2026-01-23) - Agents 管理功能、Phase 5 完成
- [2026-01-22](#2026-01-22) - NotInModelContext → ReadOnly 重命名
- [2026-01-21](#2026-01-21) - VS Code Core Tools、NotInModelContext 分类
- [2026-01-20](#2026-01-20) - 内部工具过滤、Tools 分类细化
- [2026-01-19](#2026-01-19) - Tools 管理功能、Bug 修复
- [2026-01-18](#2026-01-18) - 模型集成、用户消息组件、Bug 修复（多项）
- [2026-01-17](#2026-01-17) - 模型支持标识、Prompt 类集成

---

## 2026-01-24

### 修复 ESLint 分层架构规范错误 ✅

**问题**：4 个 ESLint 错误
1. `agentsManagementService.ts` - `local/no-runtime-import`（common 目录不能运行时导入 vscode）
2. `toolsManagementService.ts` - `local/no-runtime-import`
3. `builtInComponents.spec.ts` - `local/no-unlayered-files`（测试文件需要在分层目录中）
4. `promptComponentRegistry.spec.ts` - `local/no-unlayered-files`

**根因**：
- `common/` 目录中的文件不能有 `import * as vscode from 'vscode'`，只能用 `import type`
- 测试文件必须放在分层子目录中（如 `test/common/`）

**修复**：
1. 移动服务文件：
   - `common/agentsManagementService.ts` → `vscode-node/agentsManagementService.ts`
   - `common/toolsManagementService.ts` → `vscode-node/toolsManagementService.ts`
2. 移动测试文件：
   - `test/*.spec.ts` → `test/common/*.spec.ts`
3. 更新所有相关的导入路径（7 个文件）

**修改文件**：
- `common/index.ts` - 移除 tools management 导出
- `vscode-node/index.ts` - 添加 agents/tools management 导出
- `vscode-node/promptCustomizationServiceImpl.ts` - 更新导入路径
- `vscode-node/promptCustomizerTreeView.ts` - 更新导入路径
- `agents/vscode-node/organizationAndEnterpriseAgentProvider.ts` - 更新导入路径
- `agents/vscode-node/test/organizationAndEnterpriseAgentProvider.spec.ts` - 更新导入路径
- `extension/vscode-node/services.ts` - 更新导入路径
- `tools/vscode-node/toolsService.ts` - 更新导入路径
- `test/common/builtInComponents.spec.ts` - 更新导入路径
- `test/common/promptComponentRegistry.spec.ts` - 更新导入路径

**经验教训**：
- `common/` 目录中的代码必须是平台无关的，不能依赖 vscode 运行时
- 使用 vscode API 的服务应该放在 `vscode/` 或 `vscode-node/` 目录
- 测试文件必须放在分层子目录中（common/vscode/node 等）

---

### Preview Full Prompt 和 Reset All 功能增强 ✅

**问题**：
1. Preview Full Prompt 只显示 Prompt 组件，不包含 Skills/Agents/Tools
2. Reset All to Default 只重置 Prompt 组件

**修复**：
- `generateFullPrompt()` 添加 Skills/Agents/Tools 状态摘要
- `resetAll()` 重置 Skills/Agents/Tools 禁用状态

**修改文件**：`promptCustomizationServiceImpl.ts`

---

### 导入导出功能增强 ✅

**问题**：配置导入导出只包含 Prompt 组件，不包含 Tools/Skills/Agents

**修复**：
- `types.ts` 添加 `disabledTools`, `disabledSkills`, `disabledAgents` 字段
- `exportConfig()` 导出三个管理服务的禁用列表
- `importConfig()` 恢复禁用设置

---

### Agents 只读功能 ✅

**实现**：
- `AgentInfo` 接口添加 `isReadOnly` 属性
- 本地 agents 设置 `isReadOnly: true`，始终启用
- TreeView 显示锁定图标，无 checkbox
- `setAgentEnabled()` 跳过只读 agents

**修改文件**：`agentsManagementService.ts`, `promptCustomizerTreeView.ts`

---

## 2026-01-23

### 添加本地 Agents 支持 ✅

**问题**：TreeView 中没有 "Agents" 分类

**根因**：`AgentsManagementService` 只从组织 Provider 获取 agents

**修复**：添加 `_loadLocalAgents()` 从 `package.json` 的 `chatAgents` 贡献点加载

---

### Phase 6.2 Agents 管理功能 ✅

**新增**：
- `AgentsManagementService` 服务
- `AgentsCategoryTreeItem`、`AgentTreeItem` TreeView 节点
- `viewAgent`、`enableAllAgents`、`disableAllAgents` 命令

---

### Phase 5 完成：端到端测试和用户文档 ✅

- 创建 `test/simulation/promptCustomizer.stest.ts`
- 创建 `docs/prompt-customizer.md` 用户文档

---

## 2026-01-22

### 重命名 NotInModelContext 为 ReadOnly ✅

- 枚举值：`NotInModelContext` → `ReadOnly`
- 显示名称：`'Read Only'`
- 图标：`circle-slash` → `lock`
- contextValue：`toolNotInModelContext` → `toolReadOnly`

---

## 2026-01-21

### 添加 VS Code Core Tools 到 UI ✅

**问题**：`manage_todo_list` 和 `runSubagent` 有时不显示

**根因**：这些是 VS Code Core 工具，不通过 `vscode.lm.registerTool()` 注册

**修复**：在 `toolsManagementService.ts` 手动添加 `VSCODE_CORE_TOOLS`

---

### 添加 NotInModelContext 工具分类 ✅

**识别的 6 个工具**：
- `apply_patch`, `multi_replace_string_in_file`
- `read_project_structure`, `get_doc_info`
- `test_search`, `search_workspace_symbols`

**实现**：特殊图标、无复选框、固定状态

---

## 2026-01-20

### 修复内部工具过滤问题 ✅

**识别的内部工具（6个）**：
- `edit_files`, `vscode_get_confirmation`, `vscode_get_terminal_confirmation`
- `inline_chat_exit`, `vscode_editFile_internal`, `vscode_fetchWebPage_internal`

**修复**：在 `toolNames.ts` 添加 `internalToolNames` 集合和 `isInternalTool()` 函数

---

## 2026-01-19

### Tools 分类细化和全选功能 ✅

**新增分类**（原 Core 拆分）：
- File Read & Search (6), File Edit (6), Terminal (5)
- Task & Todo (4), Agent & Memory (2)

**新增命令**：
- `enableAllSkills/disableAllSkills`
- `enableAllTools/disableAllTools`
- `enableToolSubcategory/disableToolSubcategory`

---

### Bug 修复：Tools 过滤不生效 ✅

**根因**：`ToolsManagementService._getNormalizedToolName()` 与 `ToolsService.getToolName()` 实现不一致

**修复**：统一使用 `getToolName()` 函数

---

### Phase 6.3 Tools 管理功能 ✅

- 创建 `ToolsManagementService`
- TreeView 支持 Tools 分类显示
- 集成到 `ToolsService.getEnabledTools()`

---

## 2026-01-18

### 用户消息结构组件集成 ✅

**新增组件（4个）**：
| 组件 | 分类 | 代码位置 |
|------|------|----------|
| `environmentInfo` | Context | GlobalAgentContext |
| `workspaceInfo` | Context | GlobalAgentContext |
| `currentContext` | Context | AgentUserMessage |
| `reminderInstructions` | Workflow | AgentUserMessage |

---

### Bug 修复：editFileInstructions 渲染条件 ✅

**问题**：Claude 模型没有 `<editFileInstructions>` 标签

**根因**：条件过于严格，Claude 使用 `ReplaceString` 独占模式

**修复**：渲染条件改为 `tools[ToolName.EditFile] || tools[ToolName.ReplaceString]`

---

### 系统性修复所有 Prompt 类集成 ✅

修复的 Prompt 类（14个）：
- Anthropic: `DefaultAnthropicAgentPrompt`, `Claude45DefaultPrompt`
- Gemini: `DefaultGeminiAgentPrompt`, `HiddenModelFGeminiAgentPrompt`
- OpenAI: 6个 Prompt 类
- 通用: `DefaultAgentPrompt`, `AlternateGPTPrompt`

---

### Skills 管理功能实现 ✅

**文件夹移动方案**：
- 取消勾选 → 移动到 `~/.claude/skills_back/`
- 重新勾选 → 移回 `~/.claude/skills/`

---

## 2026-01-17

### 添加模型支持标识功能 ✅

- 新增 `ModelFamily` 枚举
- 组件定义添加 `supportedModels` 字段
- TreeView 显示模型支持信息（如 `[OpenAI GPT]`）

---

### Prompt 类 PromptCustomizer 集成 ✅

集成的模型路径：
- Anthropic/Claude: 2 个
- Gemini: 2 个
- OpenAI/GPT: 6 个
- 通用 Agent: 2 个

---

## 经验教训总结

### 架构设计

1. **函数复用原则**：多个服务需要相同转换逻辑时，必须使用同一个函数
2. **避免循环依赖**：服务间依赖需仔细设计，必要时使用 VS Code API 直接访问
3. **模型特定路径**：不同模型家族有各自的 Prompt 类，修改时需检查所有路径

### UI/UX 设计

1. **预览应反映完整状态**：显示用户可控制的所有设置
2. **重置应该全面**：恢复所有用户可控设置到默认状态
3. **组件独立渲染原则**：可独立启用/禁用的组件应独立渲染，不要嵌套

### 测试策略

1. **测试多个模型路径**：不同模型家族有不同的工具配置
2. **端到端流程验证**：UI 状态变化 → 服务存储 → 实际过滤
3. **边界情况**：添加第一个自定义组件等

### 代码质量

1. **完整性检查清单**：添加新功能时检查所有模型路径的 Prompt 类
2. **向后兼容**：新字段设为可选，旧版本配置仍可正常使用
3. **只读设计**：在 UI 层、TreeView 处理层、Service 层都添加保护逻辑
