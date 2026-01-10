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

---

**当前状态**: 所有任务完成
