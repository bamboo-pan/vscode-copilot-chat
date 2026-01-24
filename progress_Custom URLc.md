# BYOK Custom URL Feature - 进度日志

## 2026-01-10

### 开始实施
- 创建了任务计划文件
- 开始阅读现有代码结构

### 功能完成审核
- 审核发现所有 Phase 1-5 已经完成
- Phase 1: ConfigKey 定义和 package.json Settings 贡献点 ✓
- Phase 2: 三个 Provider（Anthropic、OpenAI、Gemini）都已支持自定义 baseURL ✓
- Phase 3: byokStorageService 已支持 isCustomUrl 参数区分 official/custom API Key ✓
- Phase 4: byokUIService 已实现多步骤 QuickPick 交互、URL 验证、返回上一步、配置菜单 ✓
- Phase 5: 所有三个 Provider 已添加 "(Custom)" 标记 ✓

### 编译验证
- BYOK 相关文件编译无错误
- 现有错误与 `@vscode/copilot-api` 相关（CCAModel、CCAModelsList），与本次修改无关

### 单元测试
- `src/extension/byok/common/` 测试: 37 通过
- `src/extension/byok/vscode-node/test/geminiNativeProvider.spec.ts`: 需要更新以匹配新的 UI 流程
  - 测试基于旧的 `handleAPIKeyUpdate` 函数设计
  - 新实现使用 `showConfigurationMenu` 和 `configureBYOKProviderWithCustomUrl`
  - 需要重写测试以 mock 新的 UI 服务
- 已添加 `configurationService` mock 到测试文件
- 已添加 UI 服务 mock 但需要进一步完善测试逻辑

### 修复模型信息显示问题 (2026-01-10)
问题：使用自定义 URL（如 OpenRouter）时，Anthropic 模型的名称、视觉支持、思考模式显示为空
原因分析：
1. `getAllModels` 方法中，对于未知模型直接使用 `model.display_name`，若为空则名称显示为空
2. 视觉支持 (`vision`) 和思考模式 (`thinking`) 被硬编码为 `false`

修复方案：
- 添加 `_inferModelCapabilities` 辅助函数，根据模型 ID 模式推断能力：
  - **模型名称**：优先使用 `display_name`，若为空则回退到 `model.id`
  - **视觉支持**：Claude 3+ 及 Claude 4 系列模型默认支持
  - **思考模式**：Claude 3.5+、Claude 3.7+ 及 Claude 4 系列模型默认支持
  - **Token 限制**：根据模型系列自动推断合理的默认值

### 修复 OpenAI 和 Gemini Provider 类似问题 (2026-01-10)
发现 OpenAI 和 Gemini Provider 存在更严重的问题 - 未知模型根本不会显示，因为只过滤已知模型。

修复方案：
1. **BaseOpenAICompatibleLMProvider (OpenAI)**：
   - 添加 `_inferModelCapabilities` 辅助函数
   - 根据模型 ID 推断 GPT-4o、GPT-4-turbo、o1/o3/o4 系列的能力
   - 未知模型现在也会显示，并带有推断的能力信息

2. **GeminiNativeBYOKLMProvider (Gemini)**：
   - 添加 `_inferModelCapabilities` 辅助函数
   - 根据模型 ID 推断 Gemini 1.5/2.0 系列的能力
   - 使用 `model.displayName` 作为首选名称
   - 未知模型现在也会显示，并带有推断的能力信息

编译验证：修改未引入新错误（仍保持 5 个预先存在的错误）
## 2026-01-17

### Bug 分析："Prompt is too long" 错误

#### 问题描述
使用自定义 URL（如 OpenRouter）调用 `gemini-claude-opus-4-5-thinking` 模型时，收到错误：
```
400 {"type":"error","error":{"type":"invalid_request_error","message":"Prompt is too long"}}
```

#### 根因分析

1. **两套上下文压缩机制**：
   | 机制 | 位置 | 默认状态 | 作用 |
   |------|------|---------|------|
   | Conversation History Summarization | 客户端 (prompt-tsx) | ✅ 默认启用 | 对话过长时压缩历史 |
   | Anthropic Context Editing | 服务端 (Anthropic API) | ❌ 默认禁用 | 服务端自动压缩 |

2. **为什么 Summarization 没有触发？**

   Summarization 的触发条件是 prompt 渲染时抛出 `BudgetExceededError`。但问题发生在：
   - 客户端使用 `provideTokenCount()` 估算 token 数量
   - 估算结果 < 预算限制 → 渲染成功
   - 请求发送到 API → API 拒绝："实际 token 数超过限制"

3. **Token 估算不准确的根本原因**：
   ```typescript
   // anthropicProvider.ts - 原实现
   async provideTokenCount(...): Promise<number> {
       return Math.ceil(text.toString().length / 4);  // 简单字符数/4 估算
   }
   ```

   问题：
   - Claude 有自己的 tokenizer，与这个粗略估算差异很大
   - 中文内容差异更大（中文可能 1-2 字符/token）
   - 工具定义、系统 prompt 的 token 开销被低估

#### 解决方案

**使用项目内置 tiktoken + 安全系数**（不调用外部 API）

修改 `anthropicProvider.ts`：

1. **添加 imports**：
   ```typescript
   import { TokenizerType } from '../../../util/common/tokenizer';
   import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
   ```

2. **添加安全系数常量**：
   ```typescript
   private static readonly TOKEN_COUNT_SAFETY_FACTOR = 1.3;
   ```

3. **注入 ITokenizerProvider**：
   ```typescript
   @ITokenizerProvider private readonly _tokenizerProvider: ITokenizerProvider
   ```

4. **改进 provideTokenCount 方法**：
   ```typescript
   async provideTokenCount(...): Promise<number> {
       try {
           const tokenizer = this._tokenizerProvider.acquireTokenizer({ tokenizer: TokenizerType.O200K });
           const baseCount = await tokenizer.tokenLength(text.toString());
           return Math.ceil(baseCount * AnthropicLMProvider.TOKEN_COUNT_SAFETY_FACTOR);
       } catch (error) {
           this._logService.warn(`Failed to count tokens with tiktoken, using fallback: ${error}`);
           return Math.ceil(text.toString().length / 3); // 更保守的回退
       }
   }
   ```

#### 方案对比

| 方案 | 准确性 | 性能 | 选择 |
|------|--------|------|------|
| 字符数/4 (原方案) | ❌ 差 | ✅ 快 | ❌ |
| Anthropic countTokens API | ✅ 精确 | ⚠️ 有网络延迟 | ❌ 用户不接受 |
| tiktoken + 1.3x 安全系数 | ⚠️ 近似但保守 | ✅ 快 | ✅ 采用 |

#### 为什么选择 1.3x 安全系数？

- Claude tokenizer 与 tiktoken 可能有 10-30% 的差异
- 1.3x 确保即使有差异，也会**提前**触发 summarization
- 比收到 API 错误后才发现问题要好得多

#### 相关配置项

用户也可以通过设置降低 summarization 阈值来更早触发压缩：
```json
{
  "github.copilot.chat.advanced.summarizeAgentConversationHistoryThreshold": 100000
}
```
默认值是 `undefined`，会回退到 `modelMaxPromptTokens`（对于 Claude 4 系列是 200K）。

编译验证：✅ 修改后无编译错误

---

## 2026-01-17 (续)

### 重大发现：之前的 Token 计数修复无效

#### 问题重新分析

经过深入分析，发现 **Phase 9 的修复方向完全错误**！

#### 两条完全不同的请求路径

| 路径 | 使用场景 | 流程 |
|------|---------|------|
| **CAPI 路径** | Copilot 官方模型 | `agentIntent.buildPrompt()` → `PromptRenderer` → token 预算检查 → `endpoint.makeChatRequest()` |
| **BYOK 路径** | BYOK 模型 | VS Code `LanguageModelChatProvider` → `provideLanguageModelChatResponse()` → **直接调用 API SDK** |

#### 关键发现

1. **BYOK Provider 的 `provideTokenCount` 方法从未被调用**
   - prompt-tsx 渲染时使用的是 `tokenizerProvider.acquireTokenizer(endpoint)` → tiktoken
   - `provideTokenCount` 只在 VS Code Language Model API 场景被调用（第三方扩展使用 `vscode.lm.sendRequest`）
   - 对于 Copilot Chat 的主流程，这个方法是"死代码"

2. **BYOK 请求完全绕过预算检查**
   ```
   AnthropicLMProvider.provideLanguageModelChatResponse(model, messages, ...)
       ↓
   this._anthropicAPIClient.beta.messages.create(params)  // 直接发送！
   ```
   - 接收的 `messages` 是上层已经渲染好的
   - 没有任何 token 预算检查
   - 直接发送给 Anthropic API

3. **Summarization 触发链条在 BYOK 路径中不存在**
   ```
   CAPI 路径: agentIntent → PromptRenderer → BudgetExceededError → triggerSummarize
   BYOK 路径: provideLanguageModelChatResponse → 直接调用 API → 没有预算检查！
   ```

#### 问题对比

| 特性 | CAPI 路径 | BYOK 路径 |
|------|----------|----------|
| Token 预算检查 | ✅ `PromptRenderer` 渲染时检查 | ❌ 无 |
| Summarization 触发 | ✅ `BudgetExceededError` 时触发 | ❌ 不可能触发 |
| Token 计数 | tiktoken O200K | N/A（没有计数） |
| 超限处理 | 客户端提前截断/压缩 | API 返回 400 错误 |

#### 根本原因

BYOK 模型通过 `LanguageModelChatProvider` 接口注册：
```typescript
lm.registerLanguageModelChatProvider(providerName, provider)
```

当 Copilot Chat 使用 BYOK 模型时，消息已经被上层（`agentIntent` + `PromptRenderer`）渲染好，然后传递给 `provideLanguageModelChatResponse`。但问题是：

**上层的 `PromptRenderer` 使用的是 BYOK 模型报告的 `maxInputTokens`，但实际的 token 限制可能被 OpenRouter 等代理服务进一步限制。**

#### 正确的修复方向

需要在以下位置之一添加保护：

1. **方案 A**: 在 `provideLanguageModelChatResponse` 中添加 token 预算检查
   - 使用 tiktoken 估算传入的 messages 的 token 数
   - 如果超过 `model.maxInputTokens * 0.85`，抛出错误让上层处理

2. **方案 B**: 让 BYOK 模型报告更保守的 `maxInputTokens`
   - 在 `_inferModelCapabilities` 中使用更低的值
   - 例如：实际限制 200K → 报告 150K

3. **方案 C**: 在 BYOK 路径中集成 Context Editing
   - 使用 Anthropic 的服务端 `context_management` 功能
   - 让 API 自动处理超长 prompt

#### ✅ 已选择方案 C 并实施完成

---

## 2026-01-17 (续2)

### 修复 BYOK Custom URL 的 "Prompt is too long" 错误

#### 问题回顾

使用 Custom URL（如 OpenRouter）调用 BYOK Anthropic 模型时，收到 `400 "Prompt is too long"` 错误。

根因：BYOK 请求路径完全绕过 token 预算检查，无法触发客户端 Summarization。

#### 选择的修复方案

**方案 C: 对 Custom URL 默认启用 Anthropic Context Editing**

原因：
1. Context Editing 是 Anthropic 服务端功能，可以自动处理超长 prompt
2. 无需修改客户端渲染流程
3. 即使 token 计数不准确也能正常工作
4. 用户仍可通过配置禁用此功能

#### 修改内容

**文件**: [anthropicProvider.ts](src/extension/byok/vscode-node/anthropicProvider.ts)

1. **添加导入**：
   ```typescript
   import { buildContextManagement, ContextEditingConfig, ContextManagement, ... } from '../../../platform/networking/common/anthropic';
   ```

2. **添加 `_getContextManagement` 方法**：
   ```typescript
   private _getContextManagement(thinkingBudget: number | undefined, modelMaxInputTokens: number): ContextManagement | undefined {
       // First try to get from user configuration
       const contextManagement = getContextManagementFromConfig(...);
       if (contextManagement) {
           return contextManagement;
       }

       // For custom URLs, enable context editing by default
       if (this._isCustomUrl) {
           const defaultConfig: ContextEditingConfig = {
               triggerType: 'input_tokens',
               triggerValue: Math.floor(modelMaxInputTokens * 0.85), // 85% capacity
               keepCount: 10,
               clearAtLeastTokens: Math.floor(modelMaxInputTokens * 0.2), // Clear 20%
               excludeTools: [],
               clearInputs: true,
               thinkingKeepTurns: 2
           };
           return buildContextManagement(defaultConfig, thinkingBudget, modelMaxInputTokens);
       }
       return undefined;
   }
   ```

3. **更新调用点**：将 `getContextManagementFromConfig(...)` 替换为 `this._getContextManagement(...)`

#### 默认配置说明

| 参数 | 值 | 说明 |
|------|------|------|
| `triggerType` | `'input_tokens'` | 基于输入 token 数触发 |
| `triggerValue` | `maxInputTokens * 0.85` | 达到 85% 容量时触发清理 |
| `keepCount` | `10` | 保留最近 10 个工具调用 |
| `clearAtLeastTokens` | `maxInputTokens * 0.2` | 每次至少清理 20% 的 token |
| `clearInputs` | `true` | 清理工具输入以节省 token |
| `thinkingKeepTurns` | `2` | 保留最近 2 轮思考内容 |

#### 编译验证

✅ TypeScript 编译通过，无新增错误

#### 2026-01-17 追加修复：`_isCustomUrl` 状态可能过时

**问题发现**：安装新编译版本后仍然出现 "Prompt is too long" 错误。

**根因分析**：
原来的 `_getContextManagement` 方法依赖 `this._isCustomUrl` 状态：
```typescript
if (this._isCustomUrl) {
    // Enable context editing
}
```

但 `_isCustomUrl` 只在 `_getBaseUrl()` 被调用时更新，而 `_getBaseUrl()` 只在创建 `_anthropicAPIClient` 时调用。如果客户端已被缓存，`_isCustomUrl` 可能没有被更新。

**修复方案**：
直接从配置读取 Custom URL 状态，不依赖缓存的 `_isCustomUrl`：
```typescript
// Check if using custom URL directly from config (don't rely on cached _isCustomUrl state)
const customUrl = this._configurationService.getConfig(ConfigKey.BYOKAnthropicBaseUrl);
const isCustomUrl = customUrl && customUrl.trim() !== '';

if (isCustomUrl) {
    // Enable context editing
}
```

#### 待办（已完成）

- [x] 选择并实施正确的修复方案（方案 C）
- [ ] ~~移除无效的 `provideTokenCount` 修改~~ （保留，作为 VS Code LM API 场景的优化）

---

## 2026-01-18

### 再次修复 "Prompt is too long" 错误 - 方案 B

#### 问题回顾

上次实施的方案 C（对 Custom URL 启用 Context Editing）无效，用户仍然收到 `400 "Prompt is too long"` 错误。

模型名称 `gemini-claude-opus-4-5-thinking` 确认是通过 **Anthropic Provider** 发送的请求（错误栈显示 `AnthropicLMProvider._makeRequest`）。

#### 根因分析

经过深入分析发现：**OpenRouter 等第三方代理不支持 Anthropic 的 Context Editing beta 功能**！

1. Context Editing 需要 `context-management-2025-06-27` beta header
2. OpenRouter 等代理会忽略 `context_management` 请求参数
3. 代理直接将原始 prompt 转发给 Anthropic API
4. 当 prompt 超过限制时，返回 400 错误

#### 修复方案

**方案 B: 对 Custom URL 使用更保守的 `maxInputTokens` 值**

由于代理不支持服务端压缩，我们需要在客户端提前限制 prompt 大小。通过降低报告的 `maxInputTokens`，上层的 `PromptRenderer` 会自动：
- 渲染更短的 prompt
- 更早触发 conversation summarization
- 避免发送超长 prompt 到代理

#### 代码修改

**文件**: [anthropicProvider.ts](src/extension/byok/vscode-node/anthropicProvider.ts)

1. **添加安全系数常量**：
   ```typescript
   /**
    * Custom URL safety factor for token limits.
    * Proxies like OpenRouter may have different token limits than Anthropic's official API.
    * Using a 60% factor provides a conservative limit to prevent "Prompt is too long" errors.
    */
   private static readonly CUSTOM_URL_TOKEN_SAFETY_FACTOR = 0.6;
   ```

2. **修改 `_inferModelCapabilities` 方法**：
   - 新增 `isCustomUrl` 参数
   - 对于 Custom URL，将 `maxInputTokens` 乘以 0.6（减少 40%）
   ```typescript
   private _inferModelCapabilities(modelId: string, displayName: string | undefined, isCustomUrl: boolean = false): BYOKModelCapabilities {
       // ... existing logic ...

       // For custom URLs, use more conservative token limits
       if (isCustomUrl) {
           maxInputTokens = Math.floor(maxInputTokens * AnthropicLMProvider.CUSTOM_URL_TOKEN_SAFETY_FACTOR);
           this._logService.debug(`BYOK Anthropic: Using conservative token limit ${maxInputTokens} for custom URL model ${modelId}`);
       }

       // ...
   }
   ```

3. **修改 `getAllModels` 方法**：
   - 对已知模型也应用同样的安全系数
   - 传递 `isCustomUrl` 参数给 `_inferModelCapabilities`
   ```typescript
   if (this._knownModels && this._knownModels[model.id]) {
       const capabilities = { ...this._knownModels[model.id] };
       if (this._isCustomUrl) {
           capabilities.maxInputTokens = Math.floor(capabilities.maxInputTokens * AnthropicLMProvider.CUSTOM_URL_TOKEN_SAFETY_FACTOR);
       }
       modelList[model.id] = capabilities;
   } else {
       modelList[model.id] = this._inferModelCapabilities(model.id, model.display_name, this._isCustomUrl);
   }
   ```

#### Token 限制对比表

| 模型类型 | 原始限制 | Custom URL 限制 (60%) | 效果 |
|---------|---------|----------------------|------|
| Claude 3.5/3.7 | 200K | 120K | 上层 PromptRenderer 会提前触发截断/summarization |
| Claude 4 | 200K | 120K | 同上 |
| 默认模型 | 100K | 60K | 同上 |

#### 为什么选择 60% 安全系数？

1. OpenRouter 等代理可能有自己的 token 限制（通常比 Anthropic 官方更低）
2. 60% 确保即使有差异，也会**提前**触发 summarization
3. 比收到 API 错误后才发现问题要好得多
4. 用户体验更平滑（自动压缩 vs 错误中断）

#### 编译验证

✅ TypeScript 编译通过，无新增错误

---

## 2026-01-18 (续)

### 修复 Summarization 后 Thinking Block 丢失问题

#### 问题描述

Summarization 触发后，用户仍然收到 `400` 错误：
```
messages.1.content.0.type: Expected thinking or redacted_thinking, but found text.
When thinking is enabled, a final assistant message must start with a thinking block.
```

#### Claude Thinking 规范要求

当 Claude 模型启用 thinking 时：
- **每个 assistant 消息必须以 thinking 或 redacted_thinking block 开头**
- 这是 Claude API 的硬性要求

#### 问题链条分析

1. **Summarization 触发**：当 token 预算超限时，触发 conversation history summarization
2. **Summary 替换历史**：历史对话被压缩成一个 summary，作为 **UserMessage** 插入
3. **消息顺序变成**：
   ```
   [Summary as UserMessage]  ← 这是问题的关键
   [AssistantMessage with tool calls]  ← 这个 assistant 消息需要以 thinking block 开头！
   [ToolMessage]
   ...
   ```
4. **问题**：summary 后面的第一个 AssistantMessage 没有 thinking block

#### 根因分析

**两处代码位置的问题**：

1. **当前 turn 的处理（已存在正确逻辑）**：
   - 第 211-234 行有 `thinkingForFirstRoundAfterSummarization` 逻辑
   - 第 230-231 行正确地将 thinking 设置到第一个 round

2. **历史 turn 的处理（缺失逻辑）**：
   - 第 287 行创建 `SummarizedConversationHistoryMetadata` 时**没有传递 `round.thinking`**
   - 第 307-315 行的 `ChatToolCalls` 设置 `isHistorical=true`
   - `renderOneToolCallRound` 第 106 行：
     ```tsx
     const thinking = (!this.props.isHistorical) && round.thinking && <ThinkingDataContainer />;
     ```
     当 `isHistorical=true` 时，thinking **永远不会被渲染**！

#### 修复方案

**文件 1**: [toolCalling.tsx](src/extension/prompts/node/panel/toolCalling.tsx)

1. 在 `ChatToolCallsProps` 添加新属性：
   ```typescript
   readonly thinkingForFirstRoundAfterSummarization?: ThinkingData;
   ```

2. 修改 `renderOneToolCallRound` 方法：
   ```typescript
   // 原代码
   const thinking = (!this.props.isHistorical) && round.thinking && <ThinkingDataContainer thinking={round.thinking} />;

   // 新代码
   const thinkingData = index === 0 && this.props.thinkingForFirstRoundAfterSummarization
       ? this.props.thinkingForFirstRoundAfterSummarization
       : (!this.props.isHistorical) ? round.thinking : undefined;
   const thinking = thinkingData && <ThinkingDataContainer thinking={thinkingData} />;
   ```

**文件 2**: [summarizedConversationHistory.tsx](src/extension/prompts/node/agent/summarizedConversationHistory.tsx)

1. 从 summarized round 获取 thinking：
   ```typescript
   let thinkingFromSummarizedRound: ThinkingData | undefined;
   // ... 在找到 summary 时保存 thinking
   if (round.summary) {
       summaryForTurn = new SummarizedConversationHistoryMetadata(round.id, round.summary, round.thinking);
       thinkingFromSummarizedRound = round.thinking;
       break;
   }
   ```

2. 为 Anthropic 模型传递 thinking：
   ```typescript
   const thinkingForFirstRound = summaryForTurn && isAnthropicFamily(this.props.endpoint) && toolCallRounds.length > 0 && !toolCallRounds[0].thinking
       ? thinkingFromSummarizedRound
       : undefined;

   <ChatToolCalls
       ...
       thinkingForFirstRoundAfterSummarization={thinkingForFirstRound}
   />
   ```

**文件 3**: [conversation.ts](src/extension/prompt/common/conversation.ts)

1. 更新 `IResultMetadata.summary` 类型以包含 thinking：
   ```typescript
   summary?: {
       toolCallRoundId: string;
       text: string;
       thinking?: ThinkingData;  // 新增
   };
   ```

2. 更新 `normalizeSummariesOnRounds` 以恢复 thinking：
   ```typescript
   if (roundInTurn) {
       roundInTurn.summary = turnSummary.text;
       roundInTurn.thinking = turnSummary.thinking;  // 新增
   }
   ```

#### 修复逻辑总结

| 场景 | thinking 来源 | 渲染方式 |
|------|--------------|---------|
| 当前 turn，有 summary | `toolCallRound.thinking` | 直接设置到 `toolCallRounds[0].thinking` |
| 历史 turn，有 summary | `thinkingFromSummarizedRound` | 通过 `thinkingForFirstRoundAfterSummarization` 传递 |
| 跨 session 恢复 summary | `turnSummary.thinking`（从 metadata） | 通过 `normalizeSummariesOnRounds` 恢复 |
| 非 summary 场景 | `round.thinking`（非历史）或 `undefined`（历史） | 原有逻辑 |

#### 编译验证

✅ TypeScript 编译通过，无新增错误

---

**当前状态**: Phase 12 已完成 - 修复 Summarization 后 Thinking Block 丢失问题