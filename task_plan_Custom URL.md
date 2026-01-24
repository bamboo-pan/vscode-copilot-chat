# BYOK Custom URL Feature - 任务计划

## Phase 1: 配置基础设施
- [x] 1.1 在 `configurationService.ts` 添加 ConfigKey 定义
- [x] 1.2 在 `package.json` 添加 Settings 贡献点

## Phase 2: Provider 层支持
- [x] 2.1 修改 `anthropicProvider.ts` 支持自定义 baseURL
- [x] 2.2 修改 `openAIProvider.ts` 支持自定义 baseURL
- [x] 2.3 修改 `geminiNativeProvider.ts` 支持自定义 baseURL

## Phase 3: 存储服务
- [x] 3.1 修改 `byokStorageService.ts` 支持区分 official/custom API Key

## Phase 4: UI 服务
- [x] 4.1 在 `byokUIService.ts` 添加多步骤 QuickPick 交互
- [x] 4.2 添加 URL 验证逻辑
- [x] 4.3 添加返回上一步功能
- [x] 4.4 添加已有配置时的选项菜单

## Phase 5: 模型列表显示
- [x] 5.1 在各 Provider 中添加 "(Custom)" 标记

## Phase 6: 验证与测试
- [x] 6.1 检查编译错误
- [x] 6.2 运行单元测试 (common 测试全部通过，Provider UI 测试需要更新)
- [x] 6.3 修复模型信息显示问题（名称、视觉支持、思考模式）

## Phase 7: 修复未知模型显示问题
- [x] 7.1 修复 Anthropic Provider - 添加 `_inferModelCapabilities` 推断未知模型能力
- [x] 7.2 修复 OpenAI Provider - 在 `BaseOpenAICompatibleLMProvider` 中添加 `_inferModelCapabilities`
- [x] 7.3 修复 Gemini Provider - 添加 `_inferModelCapabilities` 推断未知模型能力

### 问题描述
使用自定义 URL（如 OpenRouter）时，三个 Provider 存在以下问题：
| Provider | 问题 |
|----------|------|
| Anthropic | 未知模型的名称/视觉/思考模式可能显示为空 |
| OpenAI | 未知模型**根本不显示**（只过滤已知模型） |
| Gemini | 未知模型**根本不显示**（只过滤已知模型） |

### 修复方案
为每个 Provider 添加 `_inferModelCapabilities` 函数，根据模型 ID 模式推断能力：
- **模型名称**：优先使用 API 返回的 `display_name`，若为空则回退到 `model.id`
- **视觉支持**：根据模型系列推断（Claude 3+、GPT-4o、Gemini 1.5+ 等）
- **思考模式**：根据模型系列推断（Claude 3.5+、o1/o3/o4、Gemini 2+ 等）
- **Token 限制**：根据模型系列自动推断合理的默认值

## Phase 8: 修复 Anthropic Thinking 功能对未知模型不生效问题
- [x] 8.1 分析问题：`_getThinkingBudget` 只查 `_knownModels`，不使用推断结果
- [x] 8.2 添加 `_inferSupportsThinking` 方法，根据模型 ID 推断是否支持 thinking
- [x] 8.3 修改 `_getThinkingBudget` 方法，回退使用 `_inferSupportsThinking`

### 问题描述
对于 `gemini-claude-opus-4-5-thinking` 这样通过自定义 URL 使用的模型：
- `_inferModelCapabilities` 正确推断了 `thinking: true`
- 但 `_getThinkingBudget` 只从 `this._knownModels` 查找，不使用推断结果
- 导致 thinking 功能无法启用

### 修复方案
修改 `_getThinkingBudget` 方法：
```typescript
const modelCapabilities = this._knownModels?.[modelId];
const modelSupportsThinking = modelCapabilities?.thinking ?? this._inferSupportsThinking(modelId);
```

### 其他 Provider 分析
| Provider | 是否有此问题？ | 原因 |
|----------|---------------|------|
| **Anthropic** | ✅ 有，已修复 | `_getThinkingBudget` 只查 `_knownModels` |
| **OpenAI** | ❌ 无 | thinking 由 API 自动处理，不需要客户端启用 |
| **Gemini** | ❌ 无 | `thinkingConfig.includeThoughts` 硬编码为 `true` |

## Phase 9: 修复 "Prompt is too long" 错误
- [x] 9.1 分析问题：Token 估算不准确导致 Summarization 未能提前触发
- [x] 9.2 改进 `provideTokenCount` 方法：使用 tiktoken + 1.3x 安全系数
- [x] 9.3 添加 `ITokenizerProvider` 依赖注入
- [x] 9.4 编译验证通过
- [x] 9.5 **重大发现**：修改方向错误，`provideTokenCount` 在主流程中从未被调用

### 问题描述
使用自定义 URL 调用模型时收到 `400 "Prompt is too long"` 错误。

### 初始分析（错误方向）
1. 原 `provideTokenCount` 使用 `text.length / 4` 粗略估算，严重低估实际 token 数
2. 客户端认为未超预算 → 渲染成功 → 发送请求 → API 拒绝
3. Summarization 触发条件是 prompt 渲染时的 `BudgetExceededError`，但渲染通过了

### 实际根因（2026-01-17 重新分析）
**BYOK 请求路径完全绕过了 token 预算检查！**

| 路径 | Token 预算检查 | Summarization |
|------|---------------|---------------|
| CAPI 路径 | ✅ `PromptRenderer` | ✅ 有 |
| BYOK 路径 | ❌ 无 | ❌ 不可能触发 |

`provideLanguageModelChatResponse` 直接将上层传入的 messages 发送给 API，没有任何预算检查。

### 待选修复方案
- **方案 A**: 在 `provideLanguageModelChatResponse` 中添加 token 预算检查
- **方案 B**: 让 BYOK 模型报告更保守的 `maxInputTokens`
- **方案 C**: 在 BYOK 路径中启用 Anthropic Context Editing

## Phase 10: 修复 BYOK Token 预算检查（已完成）
- [x] 10.1 选择修复方案：方案 C - 对 Custom URL 默认启用 Context Editing（无效）
- [x] 10.2 实施修复：在 `anthropicProvider.ts` 添加 `_getContextManagement` 方法（无效）
- [x] 10.3 测试验证：编译通过

## Phase 11: 修复 "Prompt is too long" 错误 - 方案 B（2026-01-18）
- [x] 11.1 分析问题：方案 C 无效，因为 OpenRouter 等代理不支持 Anthropic Context Editing beta
- [x] 11.2 选择方案 B：让 BYOK 模型报告更保守的 `maxInputTokens`
- [x] 11.3 添加 `CUSTOM_URL_TOKEN_SAFETY_FACTOR = 0.6` 常量
- [x] 11.4 修改 `_inferModelCapabilities` 方法，接受 `isCustomUrl` 参数
- [x] 11.5 修改 `getAllModels` 方法，对已知模型也应用安全系数
- [x] 11.6 编译验证通过

### 修复效果
| 模型类型 | 原始限制 | Custom URL 限制 (60%) | 效果 |
|---------|---------|----------------------|------|
| Claude 3.5/3.7 | 200K | 120K | 上层 PromptRenderer 会提前触发截断/summarization |
| Claude 4 | 200K | 120K | 同上 |
| 默认模型 | 100K | 60K | 同上 |

## Phase 12: 修复 Summarization 后 Thinking Block 丢失问题（2026-01-18）
- [x] 12.1 分析问题：Summarization 后 assistant 消息缺少 thinking block，违反 Claude API 规范
- [x] 12.2 修改 `ChatToolCallsProps` 添加 `thinkingForFirstRoundAfterSummarization` 属性
- [x] 12.3 修改 `renderOneToolCallRound` 方法，在 summary 后第一个 round 强制渲染 thinking
- [x] 12.4 修改 `ConversationHistory.render()` 历史 turn 处理，传递 thinking 数据
- [x] 12.5 编译验证通过

### 问题描述
当 Claude 模型启用 thinking 时，每个 assistant 消息必须以 thinking 或 redacted_thinking block 开头。
Summarization 触发后，历史对话被压缩成 summary（作为 UserMessage），后面的 AssistantMessage 丢失了 thinking block。

### 根因分析
1. **当前 turn 的处理已正确**：第 230-231 行有 `thinkingForFirstRoundAfterSummarization` 逻辑
2. **历史 turn 的处理缺失**：
   - 第 287 行创建 `SummarizedConversationHistoryMetadata` 时没有传递 `round.thinking`
   - 第 307-315 行的 `ChatToolCalls` 设置 `isHistorical=true`
   - `renderOneToolCallRound` 第 106 行：`(!this.props.isHistorical) && round.thinking` 导致 thinking 被跳过
3. **跨 session 恢复缺失**：
   - `IResultMetadata.summary` 类型没有 `thinking` 字段
   - `normalizeSummariesOnRounds` 不恢复 thinking

### 修复方案
1. 在 `ChatToolCallsProps` 添加 `thinkingForFirstRoundAfterSummarization` 可选属性
2. 修改 `renderOneToolCallRound`：当 index === 0 且有 `thinkingForFirstRoundAfterSummarization` 时，优先使用它
3. 修改历史 turn 处理：从 summarized round 获取 thinking，传递给 `ChatToolCalls`
4. 更新 `IResultMetadata.summary` 类型以包含 `thinking`
5. 更新 `normalizeSummariesOnRounds` 以恢复 thinking

---

**当前状态**: Phase 12 已完成 - 修复 Summarization 后 Thinking Block 丢失问题

---

# Prompt Customizer Feature - 任务计划

> 需求文档: [docs/prompt-customizer-spec.md](docs/prompt-customizer-spec.md)

## Phase 1: 基础架构 (Week 1)

- [ ] 1.1 创建 `src/extension/promptCustomizer/common/types.ts` - 类型定义
- [ ] 1.2 创建 `PromptComponentRegistry` 类 - 组件注册表
- [ ] 1.3 创建 `IPromptCustomizationService` 接口
- [ ] 1.4 实现 `PromptCustomizationService` - 自定义配置服务
- [ ] 1.5 注册所有内置组件 (`builtInComponents.ts`)
- [ ] 1.6 添加配置存储逻辑 (settings key)
- [ ] 1.7 单元测试

## Phase 2: TreeView UI (Week 2)

- [ ] 2.1 创建 `PromptCustomizerTreeProvider` - TreeView 数据提供器
- [ ] 2.2 实现组件分类展示 (分组 TreeItem)
- [ ] 2.3 实现 Checkbox 状态管理
- [ ] 2.4 添加 `package.json` 贡献点 (views, viewsContainers)
- [ ] 2.5 实现右键菜单
- [ ] 2.6 添加状态栏统计 (已启用组件数/Token 估算)

## Phase 3: 编辑功能 (Week 3)

- [ ] 3.1 创建虚拟文档 Provider (`promptEditor://`)
- [ ] 3.2 实现内容编辑功能
- [ ] 3.3 实现保存逻辑
- [ ] 3.4 实现重置为默认功能
- [ ] 3.5 Token 计数功能
- [ ] 3.6 变量占位符提示 (如 `{ToolName.EditFile}`)

## Phase 4: 高级功能 (Week 4)

- [ ] 4.1 预览完整 Prompt 功能
- [ ] 4.2 配置导出 (JSON)
- [ ] 4.3 配置导入 (JSON)
- [ ] 4.4 自定义组件添加/删除
- [ ] 4.5 组件排序功能 (拖拽或上下移动)

## Phase 5: 集成与测试 (Week 5)

- [ ] 5.1 创建 `CustomizableAgentPrompt` 组件
- [ ] 5.2 集成到现有 `AgentPrompt` 渲染流程
- [ ] 5.3 添加 feature flag 控制新功能
- [ ] 5.4 端到端测试
- [ ] 5.5 文档编写
- [ ] 5.6 性能优化

---

**当前状态**: 需求已完成，待开发
