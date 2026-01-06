# Custom Provider 功能开发经验总结

## 项目概述

为 GitHub Copilot Chat 扩展添加自定义 Provider 支持，允许用户配置任意 API 端点（支持 OpenAI Chat Completions、OpenAI Responses API、Gemini、Claude 四种格式）。

**开发周期**: 2026年1月3日

---

## 一、架构设计经验

### 1.1 使用官方消息转换器而非自己实现

**问题**: 最初尝试自己编写消息格式转换逻辑，导致多轮对话失败。

**解决方案**: 使用项目中已有的官方转换器：
- `apiMessageToGeminiMessage` - Gemini 格式转换
- `apiMessageToAnthropicMessage` - Claude 格式转换

**教训**:
> 在大型项目中，优先搜索是否已有类似功能的实现，复用经过验证的代码比重新造轮子更可靠。

### 1.2 Provider 注册架构演进

#### 第一版: 聚合器模式（已废弃）

**问题**: VS Code 的 `lm.registerLanguageModelChatProvider` API 对同一 vendor 名称只显示最后注册的 provider 的模型。

**错误尝试**:
- 尝试为每个自定义 provider 使用唯一的 vendor 名称 → 导致 "UNKNOWN vendor" 错误

**方案**: 创建 `CustomProviderAggregator` 聚合器：
```typescript
// 所有自定义 provider 注册到同一个 'custom' vendor
lm.registerLanguageModelChatProvider('custom', aggregator);

// 使用 providerId:modelId 格式确保模型唯一性
const uniqueModelId = `${providerId}:${model.id}`;
```

**问题**: 所有自定义 provider 都聚合在一个 "Custom Providers" 下，用户无法从顶层就区分不同的 provider。

#### 第二版: 独立 Provider 注册（当前）

**改进方案**: 每个自定义 provider 配置直接注册为独立的 VS Code language model provider：

```typescript
// 每个 provider 使用唯一的 providerId 注册
private _registerCustomProvider(providerId: string, config: CustomProviderConfig): void {
    const provider = this._createProviderByFormat(providerId, config);
    // 直接注册为独立 provider
    lm.registerLanguageModelChatProvider(providerId, provider);
    this._customProviders.set(providerId, provider);
}
```

**效果**:
- ✅ 每个自定义 provider 在 VS Code UI 中显示为独立的顶层条目
- ✅ 用户可以清晰地看到每个 provider 的名称和模型列表
- ✅ 不需要聚合器的额外抽象层，代码更简洁

**教训**:
> 初始方案解决了技术限制，但用户体验不佳。重新审视需求后，发现可以直接使用每个 provider 的唯一 ID 注册，无需聚合。

### 1.3 Provider 名称前缀区分模型

**问题**: 多个 provider 可能有同名模型（如 `gpt-4`），用户无法区分来源。

**解决方案**: 在模型显示名称中添加 provider 前缀：
```typescript
const displayName = `[${this._config.name}] ${capabilities.name}`;
```

---

## 二、API 格式处理经验

### 2.1 四种 API 格式的关键差异

| 格式 | 认证方式 | 端点路径 | 消息格式 |
|------|----------|----------|----------|
| OpenAI Chat | Bearer Token | `/v1/chat/completions` | messages 数组 |
| OpenAI Responses | Bearer Token | `/v1/responses` | input 数组 |
| Gemini | URL 参数 key | `/v1beta/models/{model}:streamGenerateContent` | contents 数组 |
| Claude | x-api-key 头 | `/v1/messages` | messages 数组 + system 字段 |

### 2.2 Gemini JSON Schema 清理

**问题**: Gemini API 不支持某些 JSON Schema 属性（如 `$schema`、`additionalProperties`），直接传入会报错。

**解决方案**: 递归清理 schema：
```typescript
private _cleanSchemaForGemini(schema: any): any {
    const unsupportedProps = ['$schema', 'additionalProperties', '$id', '$ref', ...];
    // 递归移除不支持的属性
}
```

### 2.3 Thinking/Reasoning 支持

不同 API 的 thinking 配置方式不同：

```typescript
// Gemini
{ thinkingConfig: { thinkingBudget: 8192 } }

// OpenAI Responses
{ reasoning: { effort: 'medium', summary: 'auto' } }

// Claude
{ thinking: { type: 'enabled', budget_tokens: 8192 } }
```

**响应解析也不同**:
- Gemini: `part.thought === true`
- OpenAI Responses: `response.reasoning_summary_text.delta`
- Claude: `delta.type === 'thinking_delta'`

### 2.4 Claude Extended Thinking 多轮对话问题

**问题**: 启用 `thinking` 后，多轮对话（特别是包含 tool_use 的场景）报错：
```
Expected thinking or redacted_thinking, but found tool_use.
When thinking is enabled, a final assistant message must start with a thinking block.
```

**原因**: Claude API 要求在 thinking 模式下：
1. Assistant 消息**必须**以 `thinking` 或 `redacted_thinking` block 开头
2. 之前轮次的 thinking blocks 必须保留并完整传回（包括 signature）

**错误实现**:
```typescript
// ❌ 只收集 thinking 文本，在 content_block_stop 时直接清除
if (pendingThinking) {
    pendingThinking = undefined;
}
```

**正确实现**:
```typescript
// ✅ 在 content_block_stop 时，创建带有完整元数据的 ThinkingPart
if (pendingThinking && pendingThinking.signature) {
    const finalThinkingPart = new LanguageModelThinkingPart('');
    finalThinkingPart.metadata = {
        signature: pendingThinking.signature,
        _completeThinking: pendingThinking.text
    };
    progress.report(finalThinkingPart);
}
```

**关键点**:
- `_completeThinking`: 包含完整的 thinking 文本（用于 `apiMessageToAnthropicMessage` 转换）
- `signature`: Claude 返回的签名，必须原样传回
- `redactedData`: 处理被审查的 thinking blocks

**教训**:
> 处理 AI 特有功能时（如 thinking），必须理解完整的消息生命周期，确保在 request → response → next request 过程中正确传递所有必要信息。

---

## 三、TypeScript 类型安全经验

### 3.1 空值检查

**问题**: `provideLanguageModelChatInformation` 返回值可能为 `null` 或 `undefined`。

```typescript
// ❌ 错误
if (models.length === 0) { ... }

// ✅ 正确
if (!models || models.length === 0) { ... }
```

**教训**:
> 始终检查 TypeScript 编译器报告的可能为空的警告，不要假设外部 API 总是返回预期的值。

### 3.2 接口实现完整性

**问题**: 实现 `BYOKModelProvider` 接口时遗漏了 `provideTokenCount` 和 `updateAPIKey` 方法。

**教训**:
> 实现接口时，使用 IDE 的"实现所有成员"功能确保完整性。

---

## 四、配置管理经验

### 4.1 配置与密钥分离

```typescript
// 配置存储在 VS Code settings（可同步）
interface CustomProviderConfig {
    name: string;
    baseUrl: string;
    apiFormat: APIFormat;
}

// API Key 存储在 SecretStorage（安全存储）
await this._byokStorageService.storeAPIKey(providerId, apiKey, BYOKAuthType.GlobalApiKey);
```

### 4.2 配置更新时的列表刷新

**问题**: 删除 provider 后，UI 列表没有更新。

**解决方案**: 在 while 循环中每次重新读取配置：
```typescript
async configure() {
    while (true) {
        // 每次迭代重新读取配置
        const providers = this._getProviderConfigs();
        // ... 显示 UI
    }
}
```

---

## 五、开发流程经验

### 5.1 使用 OpenSpec 管理变更

```bash
# 创建变更提案
openspec change create add-custom-provider

# 验证规范
openspec validate add-custom-provider --strict

# 归档完成的变更
openspec archive add-custom-provider --yes
```

**好处**:
- 强制思考设计决策
- 记录 requirements 和 scenarios
- 便于后续维护和回顾

### 5.2 监控编译任务

始终运行 `start-watch-tasks` 监控编译错误，不要等到最后才发现问题。

---

## 六、关键代码文件

| 文件 | 职责 |
|------|------|
| `customProviderTypes.ts` | 类型定义（APIFormat, CustomProviderConfig 等）|
| `customProviderUtils.ts` | 共享工具函数（能力检测、模型转换）|
| `baseCustomProvider.ts` | 抽象基类，提供 API key 管理、事件触发、token 计数 |
| `openaiCustomProvider.ts` | OpenAI Chat Completions API 格式实现 |
| `openaiResponsesCustomProvider.ts` | OpenAI Responses API 格式实现 |
| `geminiCustomProvider.ts` | Google Gemini API 格式实现 |
| `claudeCustomProvider.ts` | Anthropic Claude API 格式实现 |
| `customProviderAggregator.ts` | *(已移除)* 之前用于聚合多个 provider 的实现 |
| `byokContribution.ts` | 注册和生命周期管理，每个自定义 provider 配置独立注册 |

### 6.1 架构重构 (2026年1月)

**之前**: 所有格式逻辑在单一的 `customProvider.ts` 文件中（800+ 行），使用 switch 语句处理不同格式。

**之后**: 拆分为四个格式特定的 Provider 类，继承自共同的 `BaseCustomProvider`：

```
BaseCustomProvider (抽象基类)
├── OpenAICustomProvider       - OpenAI Chat Completions
├── OpenAIResponsesCustomProvider - OpenAI Responses API
├── GeminiCustomProvider       - Google Gemini
└── ClaudeCustomProvider       - Anthropic Claude
```

**改进点**:
- 每个 provider 只包含相关格式的逻辑（~150-250 行）
- 更容易独立测试每种格式
- 添加新格式时不影响现有代码
- 共享逻辑提取到 `customProviderUtils.ts` 避免重复
- **每个自定义 provider 配置独立注册**，无需聚合器（v2 架构）

---

## 七、待改进项

1. **手动模型输入**: 当 `/models` 端点不可用时，允许用户手动输入模型 ID
2. **自定义请求头**: 某些网关需要额外的 headers（如 `x-api-version`）
3. **连接测试**: 保存配置前验证端点可达性
4. **模型缓存**: 缓存模型列表，避免每次都请求

---

## 八、总结

### 成功经验
- ✅ 复用现有代码（消息转换器）
- ✅ 使用聚合器模式解决 API 限制
- ✅ 配置与密钥分离存储
- ✅ 使用 OpenSpec 管理变更

### 避免的陷阱
- ❌ 不要自己实现已有的转换逻辑
- ❌ 不要假设 API 返回值总是有效
- ❌ 不要忽略 TypeScript 编译警告
- ❌ 不要在循环中使用过时的状态

---

*文档创建于: 2026年1月3日*
*最后更新: 2026年1月6日 - 添加独立 Provider 注册架构（v2）*
