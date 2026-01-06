# 设计：自定义 Provider 支持

## 背景

BYOK（Bring Your Own Key，自带密钥）系统目前支持固定的 Provider 集合，每个都实现为单独的类（`AnthropicLMProvider`、`GeminiNativeBYOKLMProvider`、`OpenRouterLMProvider` 等）。用户无法添加不在预定义列表中的 Provider。

**利益相关者**：自托管模型服务的用户、使用自定义模型网关的企业用户

**约束条件**：
- 必须与现有的 VS Code `lm.registerLanguageModelChatProvider` API 集成
- 必须支持多种 API 格式（OpenAI、Gemini、Claude）
- 必须跨会话持久化配置
- 必须安全地处理 API 密钥存储

## 目标 / 非目标

**目标**：
- 允许用户添加任意 URL 的自定义 Provider
- 支持 OpenAI（Chat Completions 和 Responses API）、Gemini 和 Claude API 格式
- 自动从自定义端点发现可用模型
- 与现有模型选择 UI 无缝集成

**非目标**：
- 支持非标准/专有 API 格式（仅支持上述 4 种格式）
- 高级配置（限流、重试策略等）- 可以后续添加
- Provider 间的模型迁移

## 设计决策

### 决策 1：API 格式抽象

**内容**：创建一个格式无关的 `CustomProvider`，内部根据 API 格式路由到不同的处理方法。

**原因**：统一的 Provider 接口，同时支持原生 API 格式以获得最佳兼容性。

**实际实现**：
```
CustomProvider.provideLanguageModelChatResponse()
  switch (apiFormat):
    ├─ 'openai-chat'      → _handleOpenAIRequest()      使用 OpenAIEndpoint
    ├─ 'openai-responses' → _handleOpenAIResponsesRequest() 原生 Responses API
    ├─ 'gemini'           → _handleGeminiRequest()      原生 Gemini REST API
    └─ 'claude'           → _handleClaudeRequest()      原生 Anthropic Messages API
```

**关键实现细节**：
- Gemini 和 Claude 使用**原生 API 格式**，而非 OpenAI 兼容代理
- 使用官方消息转换器：`apiMessageToGeminiMessage`、`apiMessageToAnthropicMessage`
- OpenAI Chat 格式复用现有 `OpenAIEndpoint`

**考虑过的替代方案**：
- 单一统一端点处理所有格式：因复杂性和维护负担而被否决
- 每种格式单独的 Provider 类：因重复配置/存储逻辑而被否决
- 所有格式都走 OpenAI 兼容代理：因多轮对话失败而被否决

### 决策 2：Provider 聚合器

**内容**：创建 `CustomProviderAggregator` 聚合多个自定义 Provider。

**原因**：VS Code 的 `lm.registerLanguageModelChatProvider` API 对同一 vendor 名称只显示最后注册的 provider 的模型。

**实际实现**：
```typescript
// 所有自定义 provider 注册到同一个 'custom' vendor
lm.registerLanguageModelChatProvider('custom', aggregator);

// 使用 providerId:modelId 格式确保模型唯一性
const uniqueModelId = `${providerId}:${model.id}`;

// 在显示名称中添加 provider 前缀区分来源
const displayName = `[${providerName}] ${modelName}`;
```

### 决策 3：配置存储

**内容**：将自定义 Provider 配置存储在 VS Code 设置（`github.copilot.chat.customProviders`）中，API 密钥存储在安全存储中。

**原因**：
- 设置可移植且可同步
- API 密钥在安全存储中遵循现有 BYOK 模式
- 将敏感数据（密钥）与非敏感数据（URL、格式）分开

**Schema**：
```typescript
interface CustomProviderConfig {
  name: string;           // 显示名称
  baseUrl: string;        // API 端点基础 URL
  apiFormat: 'openai-chat' | 'openai-responses' | 'gemini' | 'claude';
  // API 密钥单独存储在 IBYOKStorageService 中，使用 providerId 作为 key
}
```

### 决策 4：模型发现

**内容**：配置完成后从 Provider 的模型列表端点获取模型。

**实际实现**：
- OpenAI 格式：`GET /v1/models`，使用 `Authorization: Bearer <key>`
- Claude 格式：`GET /v1/models`，使用 `x-api-key` 和 `anthropic-version` 头
- Gemini 格式：`GET /v1beta/models?key=<key>`

**模型能力检测**：
- 从 API 响应中提取 `context_length`、`max_output_tokens` 等
- 通过模型名称启发式检测 vision、tool calling、thinking 能力
- thinking 检测模式：`thinking`、`reasoning`、`o1`、`o3`、`deepseek-r1`、`gemini`

### 决策 5：Thinking/Reasoning 支持

**内容**：支持模型的 thinking/reasoning 模式。

**实际实现**：
| API 格式 | 请求参数 | 响应解析 |
|----------|----------|----------|
| Gemini | `thinkingConfig: { thinkingBudget: 8192 }` | `part.thought === true` |
| OpenAI Responses | `reasoning: { effort: 'medium', summary: 'auto' }` | `reasoning_summary_text.delta` |
| Claude | `thinking: { type: 'enabled', budget_tokens: 8192 }` | `delta.type === 'thinking_delta'` |

## 风险 / 权衡

| 风险 | 缓解措施 | 实际状态 |
|------|----------|----------|
| 自定义端点可能未实现 `/models` | 提供手动输入模型的降级方案 | ⚠️ 待实现 |
| API 格式不匹配导致难以理解的错误 | 在设置时通过测试请求验证格式 | ⚠️ 待实现 |
| URL 验证可能拒绝有效端点 | 使用宽松验证，警告但不阻止 | ✅ 已实现 |
| 多个自定义 Provider 同名 | 在配置时强制名称唯一 | ✅ 已实现 |
| 多 Provider 模型冲突 | 使用聚合器 + 唯一 ID | ✅ 已实现 |

## 待解决问题

1. **~~是否支持自定义请求头？~~** - 未实现，推迟到后续版本

2. **~~限流/重试配置？~~** - 未实现，推迟到后续版本

3. **模型能力检测** - 已实现基于名称的启发式检测，后续可根据用户反馈优化

## 关键文件

| 文件 | 职责 |
|------|------|
| `customProviderTypes.ts` | 类型定义（APIFormat、CustomProviderConfig） |
| `customProvider.ts` | 核心 Provider 实现，支持 4 种 API 格式 |
| `customProviderAggregator.ts` | 聚合多个 Provider，解决 VS Code API 限制 |
| `customProviderConfigurator.ts` | 配置向导 UI |
| `customizeProvider.ts` | "Customize..." 菜单入口 |
| `byokContribution.ts` | 注册和生命周期管理 |
