# Prompt Customizer 功能需求规格说明书

## 1. 概述

### 1.1 项目背景

GitHub Copilot Chat 扩展使用预定义的 System Prompt 来指导 AI 助手的行为。当前这些 Prompt 内容是硬编码在 TSX 组件中的，用户无法方便地查看、修改或自定义这些内容。

### 1.2 目标

开发一个 **Prompt Customizer** 功能，允许用户：
- 查看所有可用的提示词组件
- 选择启用/禁用各个组件
- 编辑组件的具体内容
- 将选中的组件组合成最终的 System Prompt
- 导入/导出自定义配置

### 1.3 用户价值

| 用户群体 | 价值 |
|---------|------|
| **高级用户** | 完全控制 AI 行为，定制专属的编程助手 |
| **团队** | 统一团队的 Prompt 配置，保持一致性 |
| **开发者** | 调试和优化 Prompt，提升 AI 响应质量 |
| **研究者** | 研究不同 Prompt 对 AI 行为的影响 |

---

## 2. 功能需求

### 2.1 核心功能列表

| ID | 功能 | 优先级 | 描述 |
|----|------|--------|------|
| F-001 | 组件列表展示 | P0 | 以树形结构展示所有可用的 Prompt 组件 |
| F-002 | 组件启用/禁用 | P0 | 通过 Checkbox 控制组件是否包含在最终 Prompt 中 |
| F-003 | 组件内容编辑 | P0 | 编辑组件的具体文本内容 |
| F-004 | 重置为默认 | P1 | 将已修改的组件恢复为默认内容 |
| F-005 | 预览完整 Prompt | P1 | 查看组合后的完整 System Prompt |
| F-006 | 配置导出 | P1 | 导出当前配置为 JSON 文件 |
| F-007 | 配置导入 | P1 | 从 JSON 文件导入配置 |
| F-008 | 添加自定义组件 | P2 | 创建全新的自定义 Prompt 组件 |
| F-009 | 组件排序 | P2 | 拖拽调整组件在 Prompt 中的顺序 |
| F-010 | 配置模板 | P3 | 预设的配置模板（如"精简模式"、"详细模式"） |

### 2.2 功能详细描述

#### F-001: 组件列表展示

**描述**：在 VS Code 侧边栏中展示一个 TreeView，列出所有可用的 Prompt 组件。

**组件分类**：
```
├── 📁 Identity & Safety (身份与安全)
│   ├── Copilot Identity Rules
│   └── Safety Rules
├── 📁 Tools Instructions (工具说明)
│   ├── Notebook Instructions
│   ├── File Linkification
│   ├── Apply Patch Instructions
│   ├── MCP Tool Instructions
│   └── Generic Editing Tips
├── 📁 Output Formatting (输出格式)
│   ├── Output Formatting
│   ├── Math Integration Rules
│   └── Code Block Formatting Rules
├── 📁 Workflow (工作流程)
│   ├── Structured Workflow
│   ├── Communication Guidelines
│   └── Codesearch Mode Instructions
└── 📁 Custom (自定义)
    └── [用户添加的组件]
```

**每个组件显示**：
- 图标（根据分类）
- 名称
- 状态标记（是否已自定义）
- Checkbox（启用/禁用状态）

#### F-002: 组件启用/禁用

**描述**：通过 Checkbox 控制组件是否包含在最终 Prompt 中。

**交互**：
- 点击 Checkbox 切换状态
- 状态立即生效（下次请求使用新配置）
- 显示启用组件的数量统计

**约束**：
- 某些组件可能有依赖关系（如工具相关指令依赖工具是否可用）
- 核心组件可标记为"推荐启用"但不强制

#### F-003: 组件内容编辑

**描述**：允许用户修改组件的具体文本内容。

**交互流程**：
1. 用户点击组件旁的 "Edit" 按钮
2. 在编辑器中打开组件内容（虚拟文档）
3. 用户编辑内容
4. 保存时自动应用更改

**编辑器功能**：
- 使用 Markdown 语法高亮
- 显示字符/Token 计数
- 支持 Undo/Redo
- 提供变量占位符提示（如 `{ToolName.EditFile}`）

#### F-004: 重置为默认

**描述**：将已修改的组件恢复为默认内容。

**交互**：
- 右键菜单或工具栏按钮
- 确认对话框防止误操作
- 支持批量重置所有组件

#### F-005: 预览完整 Prompt

**描述**：查看所有启用组件组合后的完整 System Prompt。

**展示方式**：
- 命令 `Prompt Customizer: Preview Full Prompt`
- 在新编辑器标签页中显示
- 只读模式，带语法高亮
- 显示总 Token 数估算

#### F-006 & F-007: 配置导出/导入

**配置文件格式**：
```json
{
  "version": "1.0",
  "exportedAt": "2026-01-16T10:00:00Z",
  "components": {
    "copilotIdentityRules": {
      "enabled": true,
      "customContent": null
    },
    "notebookInstructions": {
      "enabled": true,
      "customContent": "自定义的 Notebook 指令内容..."
    },
    "fileLinkification": {
      "enabled": false,
      "customContent": null
    }
  },
  "customComponents": [
    {
      "id": "myCustomComponent",
      "name": "My Custom Instructions",
      "category": "custom",
      "content": "自定义内容...",
      "priority": 1000
    }
  ]
}
```

---

## 3. 非功能需求

### 3.1 性能要求

| 指标 | 要求 |
|------|------|
| TreeView 加载时间 | < 100ms |
| 配置保存时间 | < 50ms |
| 编辑器打开时间 | < 200ms |
| Prompt 预览生成时间 | < 500ms |

### 3.2 兼容性要求

- 兼容 VS Code 1.80+ 版本
- 兼容所有支持的 LLM 模型（GPT-4, Claude, Gemini 等）
- 配置文件向后兼容

### 3.3 安全要求

- 配置存储在用户的 VS Code 设置中
- 不上传自定义 Prompt 内容到远程服务器
- 敏感信息警告（如果用户在 Prompt 中包含 API Key 等）

---

## 4. UI/UX 设计

### 4.1 入口

1. **活动栏图标**：在 VS Code 左侧活动栏添加 "Prompt Customizer" 图标
2. **命令面板**：`Prompt Customizer: Open` 命令
3. **设置齿轮**：Chat Debug View 中添加快捷入口

### 4.2 主界面 - TreeView

```
┌─────────────────────────────────────────────────────────────────┐
│  PROMPT CUSTOMIZER                               [↻] [👁] [⚙]  │
├─────────────────────────────────────────────────────────────────┤
│  🔍 Search components...                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  📁 Identity & Safety                                     [2/2] │
│    ☑ 👤 Copilot Identity Rules                                  │
│    ☑ 🛡️ Safety Rules                                            │
│                                                                 │
│  📁 Tools Instructions                                    [4/6] │
│    ☑ 📓 Notebook Instructions               ✏️ (customized)     │
│    ☑ 🔗 File Linkification                                      │
│    ☐ 🔧 Apply Patch Instructions                                │
│    ☑ 🛠️ MCP Tool Instructions                                   │
│    ☑ ✍️ Generic Editing Tips                                    │
│    ☐ 📋 Codesearch Mode                                         │
│                                                                 │
│  📁 Output Formatting                                     [3/3] │
│    ☑ 📝 Output Formatting                                       │
│    ☑ ∑  Math Integration                                        │
│    ☑ 💻 Code Block Formatting                                   │
│                                                                 │
│  📁 Workflow                                              [0/2] │
│    ☐ 📋 Structured Workflow                                     │
│    ☐ 🗣️ Communication Guidelines                                │
│                                                                 │
│  📁 Custom                                                [1/1] │
│    ☑ ⭐ My Project Rules                     ✏️ (customized)     │
│                                                                 │
│  [+ Add Custom Component]                                       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Enabled: 10/14 components | Est. ~2,500 tokens                 │
├─────────────────────────────────────────────────────────────────┤
│  [Preview Prompt]  [Export]  [Import]  [Reset All]              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 右键菜单

```
┌─────────────────────────────┐
│ 📝 Edit Content             │
│ 👁  View Default            │
│ ↺  Reset to Default         │
│ ─────────────────────────── │
│ ⬆  Move Up                  │
│ ⬇  Move Down                │
│ ─────────────────────────── │
│ 📋 Copy Content             │
│ 🗑  Delete (custom only)    │
└─────────────────────────────┘
```

### 4.4 编辑器界面

```
┌─────────────────────────────────────────────────────────────────┐
│ 📝 Edit: Notebook Instructions                    [Save] [Undo] │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ To edit notebook files in the workspace, you can use the   │ │
│ │ {ToolName.EditNotebook} tool.                               │ │
│ │                                                             │ │
│ │ Use the {ToolName.RunNotebookCell} tool instead of          │ │
│ │ executing Jupyter related commands in the Terminal.         │ │
│ │                                                             │ │
│ │ Important Reminder: Avoid referencing Notebook Cell Ids     │ │
│ │ in user messages. Use cell number instead.                  │ │
│ │                                                             │ │
│ │ [Your custom additions here...]                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│ Characters: 342 | Est. Tokens: ~85 | Variables: 2              │
├─────────────────────────────────────────────────────────────────┤
│ 💡 Available variables: {ToolName.EditNotebook}, {ToolName...} │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 技术设计

### 5.1 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              User Interface                              │
│  ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────────┐ │
│  │  TreeView Panel   │  │  Editor Provider  │  │  Commands/Menus      │ │
│  └─────────┬─────────┘  └─────────┬─────────┘  └──────────┬───────────┘ │
│            │                      │                       │              │
└────────────┼──────────────────────┼───────────────────────┼──────────────┘
             │                      │                       │
             ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            Service Layer                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                   IPromptCustomizationService                       ││
│  │  - getEnabledComponents()                                           ││
│  │  - setComponentEnabled(id, enabled)                                 ││
│  │  - getCustomContent(id)                                             ││
│  │  - setCustomContent(id, content)                                    ││
│  │  - exportConfig() / importConfig()                                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                   PromptComponentRegistry                           ││
│  │  - register(component)                                              ││
│  │  - getAll() / getByCategory()                                       ││
│  │  - getDefaultContent(id)                                            ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
             │                      │                       │
             ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Storage Layer                                  │
│  ┌──────────────────────────┐  ┌────────────────────────────────────┐   │
│  │  IConfigurationService   │  │  Workspace/User Settings           │   │
│  │  (VS Code Settings API)  │  │  github.copilot.chat.prompt...     │   │
│  └──────────────────────────┘  └────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Prompt Rendering                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                   CustomizableAgentPrompt                           ││
│  │  (replaces/wraps existing AgentPrompt)                              ││
│  │                                                                     ││
│  │  render() {                                                         ││
│  │    const enabled = customizationService.getAllEnabledComponents();  ││
│  │    return enabled.map(c => renderComponent(c));                     ││
│  │  }                                                                  ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 文件结构

```
src/extension/promptCustomizer/
├── common/
│   ├── types.ts                        # 类型定义
│   ├── promptComponentRegistry.ts      # 组件注册表
│   ├── builtInComponents.ts            # 内置组件注册
│   └── promptCustomizationService.ts   # 自定义服务接口
├── vscode-node/
│   ├── promptCustomizerContribution.ts # 扩展贡献点
│   ├── promptCustomizerTreeView.ts     # TreeView 实现
│   ├── promptEditorProvider.ts         # 编辑器 Provider
│   ├── promptCustomizationServiceImpl.ts # 服务实现
│   └── commands.ts                     # 命令注册
├── prompt/
│   └── customizableAgentPrompt.tsx     # 可定制的 Prompt 组件
└── test/
    ├── promptComponentRegistry.spec.ts
    ├── promptCustomizationService.spec.ts
    └── promptCustomizerTreeView.spec.ts
```

### 5.3 配置存储

**设置键名**：
```json
{
  "github.copilot.chat.promptCustomization": {
    "components": {
      "copilotIdentityRules": { "enabled": true },
      "notebookInstructions": {
        "enabled": true,
        "customContent": "..."
      }
    },
    "customComponents": [],
    "componentOrder": []
  }
}
```

### 5.4 关键接口定义

```typescript
// types.ts

export interface PromptComponentDefinition {
    /** 组件唯一标识 */
    id: string;
    /** 显示名称 */
    name: string;
    /** 描述 */
    description: string;
    /** 分类 */
    category: PromptComponentCategory;
    /** 默认内容 */
    defaultContent: string;
    /** 是否默认启用 */
    defaultEnabled: boolean;
    /** 优先级 (数字越小越靠前) */
    priority: number;
    /** 依赖的工具 */
    requiredTools?: string[];
    /** 是否为内置组件 */
    isBuiltIn: boolean;
}

export enum PromptComponentCategory {
    Identity = 'identity',
    Safety = 'safety',
    Tools = 'tools',
    Formatting = 'formatting',
    Workflow = 'workflow',
    Custom = 'custom',
}

export interface PromptComponentState {
    enabled: boolean;
    customContent?: string;
}

export interface PromptCustomizationConfig {
    components: Record<string, PromptComponentState>;
    customComponents: PromptComponentDefinition[];
    componentOrder?: string[];
}

export interface IPromptCustomizationService {
    readonly _serviceBrand: undefined;

    // 事件
    readonly onDidChangeConfiguration: Event<void>;

    // 组件状态
    isEnabled(componentId: string): boolean;
    setEnabled(componentId: string, enabled: boolean): Promise<void>;

    // 内容管理
    getEffectiveContent(componentId: string): string;
    getCustomContent(componentId: string): string | undefined;
    setCustomContent(componentId: string, content: string): Promise<void>;
    hasCustomContent(componentId: string): boolean;

    // 重置
    resetComponent(componentId: string): Promise<void>;
    resetAll(): Promise<void>;

    // 自定义组件
    addCustomComponent(component: Omit<PromptComponentDefinition, 'isBuiltIn'>): Promise<void>;
    removeCustomComponent(componentId: string): Promise<void>;

    // 排序
    moveComponent(componentId: string, direction: 'up' | 'down'): Promise<void>;

    // 导入导出
    exportConfig(): PromptCustomizationConfig;
    importConfig(config: PromptCustomizationConfig): Promise<void>;

    // 获取所有启用的组件
    getAllEnabledComponents(): PromptComponentDefinition[];

    // 预览
    generateFullPrompt(): Promise<string>;
    estimateTokenCount(): number;
}
```

---

## 6. 内置组件清单

| ID | 名称 | 分类 | 默认启用 | 优先级 |
|----|------|------|---------|--------|
| `copilotIdentityRules` | Copilot Identity Rules | identity | ✅ | 100 |
| `safetyRules` | Safety Rules | safety | ✅ | 110 |
| `notebookInstructions` | Notebook Instructions | tools | ✅ | 500 |
| `fileLinkification` | File Linkification | formatting | ✅ | 510 |
| `applyPatchInstructions` | Apply Patch Instructions | tools | ❌ | 520 |
| `mcpToolInstructions` | MCP Tool Instructions | tools | ✅ | 530 |
| `genericEditingTips` | Generic Editing Tips | tools | ✅ | 540 |
| `outputFormatting` | Output Formatting | formatting | ✅ | 600 |
| `mathIntegrationRules` | Math Integration | formatting | ✅ | 610 |
| `codeBlockFormattingRules` | Code Block Formatting | formatting | ✅ | 620 |
| `structuredWorkflow` | Structured Workflow | workflow | ❌ | 700 |
| `communicationGuidelines` | Communication Guidelines | workflow | ❌ | 710 |
| `codesearchModeInstructions` | Codesearch Mode | workflow | ❌ | 720 |

---

## 7. 命令与快捷键

| 命令 ID | 名称 | 快捷键 | 描述 |
|---------|------|--------|------|
| `promptCustomizer.open` | Open Prompt Customizer | - | 打开 Prompt Customizer 面板 |
| `promptCustomizer.editComponent` | Edit Component | - | 编辑选中的组件 |
| `promptCustomizer.resetComponent` | Reset Component | - | 重置选中的组件 |
| `promptCustomizer.resetAll` | Reset All Components | - | 重置所有组件 |
| `promptCustomizer.previewPrompt` | Preview Full Prompt | - | 预览完整 Prompt |
| `promptCustomizer.exportConfig` | Export Configuration | - | 导出配置 |
| `promptCustomizer.importConfig` | Import Configuration | - | 导入配置 |
| `promptCustomizer.addCustom` | Add Custom Component | - | 添加自定义组件 |

---

## 8. 实现里程碑

### Phase 1: 基础架构 (Week 1)

- [ ] 创建 `PromptComponentRegistry` 类
- [ ] 创建 `IPromptCustomizationService` 接口和实现
- [ ] 注册所有内置组件
- [ ] 添加配置存储逻辑
- [ ] 单元测试

### Phase 2: TreeView UI (Week 2)

- [ ] 创建 TreeView Provider
- [ ] 实现组件分类展示
- [ ] 实现 Checkbox 状态管理
- [ ] 添加 package.json 贡献点
- [ ] 右键菜单实现

### Phase 3: 编辑功能 (Week 3)

- [ ] 创建虚拟文档 Provider
- [ ] 实现内容编辑功能
- [ ] 实现保存和重置
- [ ] Token 计数功能
- [ ] 变量占位符提示

### Phase 4: 高级功能 (Week 4)

- [ ] 预览完整 Prompt
- [ ] 配置导入/导出
- [ ] 自定义组件功能
- [ ] 组件排序功能

### Phase 5: 集成与测试 (Week 5)

- [ ] 集成到 AgentPrompt 渲染流程
- [ ] 端到端测试
- [ ] 文档编写
- [ ] 性能优化

---

## 9. 风险与缓解

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 修改核心 Prompt 导致 AI 行为异常 | 高 | 中 | 提供"推荐配置"提示；禁用核心组件时警告 |
| Token 超限 | 高 | 低 | 实时显示 Token 估算；超限警告 |
| 配置格式变更导致兼容问题 | 中 | 低 | 版本化配置格式；迁移逻辑 |
| 性能影响 | 中 | 低 | 懒加载组件；缓存渲染结果 |

---

## 10. 验收标准

### 功能验收

- [ ] 能够查看所有 Prompt 组件列表
- [ ] 能够启用/禁用任意组件
- [ ] 能够编辑组件内容并保存
- [ ] 能够重置单个或所有组件
- [ ] 能够预览完整 Prompt
- [ ] 能够导入/导出配置
- [ ] 配置在 VS Code 重启后保持

### 性能验收

- [ ] TreeView 加载时间 < 100ms
- [ ] 编辑器打开时间 < 200ms
- [ ] 配置保存无感知延迟

### 兼容性验收

- [ ] 在 VS Code 1.80+ 版本正常工作
- [ ] 与现有 Chat 功能无冲突
- [ ] 支持所有已注册的 LLM 模型

---

## 附录 A: 配置文件示例

```json
{
  "version": "1.0",
  "exportedAt": "2026-01-16T10:00:00Z",
  "components": {
    "copilotIdentityRules": {
      "enabled": true,
      "customContent": null
    },
    "safetyRules": {
      "enabled": true,
      "customContent": null
    },
    "notebookInstructions": {
      "enabled": true,
      "customContent": "To edit notebook files, use edit_notebook_file tool.\nNever use terminal for Jupyter operations.\nAlways use cell numbers, not cell IDs."
    },
    "fileLinkification": {
      "enabled": true,
      "customContent": null
    },
    "structuredWorkflow": {
      "enabled": false,
      "customContent": null
    }
  },
  "customComponents": [
    {
      "id": "myProjectRules",
      "name": "My Project Rules",
      "description": "Custom rules for my project",
      "category": "custom",
      "content": "Always use TypeScript.\nFollow our coding standards in CONTRIBUTING.md.\nRun tests before committing.",
      "priority": 1000
    }
  ],
  "componentOrder": [
    "copilotIdentityRules",
    "safetyRules",
    "myProjectRules",
    "notebookInstructions",
    "fileLinkification",
    "outputFormatting"
  ]
}
```

---

## 附录 B: 相关文件参考

| 现有文件 | 用途 |
|---------|------|
| `src/extension/prompts/node/agent/promptRegistry.ts` | 参考现有注册机制 |
| `src/extension/prompts/node/agent/defaultAgentInstructions.tsx` | 内置组件源码 |
| `src/extension/prompts/node/agent/fileLinkificationInstructions.tsx` | 组件示例 |
| `src/extension/log/vscode-node/requestLogTree.ts` | TreeView 实现参考 |
| `src/platform/customInstructions/common/customInstructionsService.ts` | 自定义指令服务参考 |
