## MODIFIED Requirements

### 需求：API 格式选择
系统应支持自定义 Provider 的多种 API 格式：OpenAI Chat Completions、OpenAI Responses API、Gemini 和 Claude。每种格式 SHALL 由专用的 Provider 类实现。

#### 场景：用户选择 API 格式
- **当** 用户到达 API 格式选择步骤
- **则** 系统 SHALL 显示选项列表：
  - "OpenAI Chat Completions" - 由 `OpenAICustomProvider` 处理
  - "OpenAI Responses API" - 由 `OpenAIResponsesCustomProvider` 处理
  - "Google Gemini" - 由 `GeminiCustomProvider` 处理
  - "Anthropic Claude" - 由 `ClaudeCustomProvider` 处理
- **且** 用户 SHALL 选择且仅选择一种格式

#### 场景：系统使用 OpenAI Chat 格式
- **当** Provider 配置为 `openai-chat` 格式
- **则** 系统 SHALL 实例化 `OpenAICustomProvider`
- **且** 系统 SHALL 使用 `/v1/chat/completions` 端点
- **且** 系统 SHALL 使用 `Authorization: Bearer <token>` 认证

#### 场景：系统使用 OpenAI Responses 格式
- **当** Provider 配置为 `openai-responses` 格式
- **则** 系统 SHALL 实例化 `OpenAIResponsesCustomProvider`
- **且** 系统 SHALL 使用 `/v1/responses` 端点
- **且** 系统 SHALL 使用 `Authorization: Bearer <token>` 认证
- **且** 系统 SHALL 支持 o1/o3 模型的 reasoning 模式

#### 场景：系统使用 Gemini 格式
- **当** Provider 配置为 `gemini` 格式
- **则** 系统 SHALL 实例化 `GeminiCustomProvider`
- **且** 系统 SHALL 使用 `/v1beta/models/{model}:streamGenerateContent` 端点
- **且** 系统 SHALL 使用 URL 参数 `key=<token>` 认证
- **且** 系统 SHALL 使用 `apiMessageToGeminiMessage` 转换消息格式

#### 场景：系统使用 Claude 格式
- **当** Provider 配置为 `claude` 格式
- **则** 系统 SHALL 实例化 `ClaudeCustomProvider`
- **且** 系统 SHALL 使用 `/v1/messages` 端点
- **且** 系统 SHALL 使用 `x-api-key` 和 `anthropic-version: 2023-06-01` 头认证
- **且** 系统 SHALL 使用 `apiMessageToAnthropicMessage` 转换消息格式

### 需求：Claude Extended Thinking 多轮对话支持
系统 SHALL 正确处理 Claude extended thinking blocks 以确保多轮对话中的 API 兼容性。

#### 场景：保留带签名的 thinking blocks
- **当** Claude 模型返回 thinking block 和 signature
- **则** 系统 SHALL 创建带有 `_completeThinking` 和 `signature` 元数据的 ThinkingPart
- **且** 系统 SHALL 确保下一轮请求中 assistant 消息以 thinking block 开头

#### 场景：处理 redacted thinking blocks
- **当** Claude 模型返回 `redacted_thinking` block
- **则** 系统 SHALL 创建带有 `redactedData` 元数据的 ThinkingPart
- **且** 系统 SHALL 正确传回 redacted_thinking 以满足 API 要求

#### 场景：上下文摘要后注入占位 thinking block
- **当** assistant 消息有 tool_use 但没有 thinking blocks（上下文被摘要处理）
- **且** thinking 模式已启用
- **则** 系统 SHALL 注入占位的 `redacted_thinking` block
- **且** 这满足 Claude API 对 assistant 消息 MUST 以 thinking block 开头的要求

#### 场景：跨模块类型检测
- **当** 检查消息 part 是否为 ThinkingPart 或 ToolCallPart
- **则** 系统 SHALL 使用鸭子类型检测（duck typing）配合 instanceof 检查
- **且** 系统 SHALL 检查特征属性（如 ToolCallPart 的 `callId`、`name`、`input`）
- **且** 这处理了跨模块实例化时 instanceof 可能失败的问题

## ADDED Requirements

### 需求：Provider 架构分离
系统 SHALL 为每种 API 格式提供独立的 Provider 实现类，继承自公共基类。

#### 场景：Provider 类结构
- **当** 系统初始化自定义 Provider
- **则** 系统 SHALL 包含以下 Provider 类：
  - `BaseCustomProvider` - 抽象基类，包含共享逻辑
  - `OpenAICustomProvider` - OpenAI Chat Completions 格式
  - `OpenAIResponsesCustomProvider` - OpenAI Responses API 格式
  - `GeminiCustomProvider` - Google Gemini 格式
  - `ClaudeCustomProvider` - Anthropic Claude 格式
- **且** 每个 Provider 类 SHALL 仅包含格式特定的逻辑

#### 场景：聚合器使用工厂模式创建 Provider
- **当** 用户添加新的自定义 Provider 配置
- **则** `CustomProviderAggregator` SHALL 使用工厂方法根据 `apiFormat` 字段创建对应的 Provider 实例
- **且** 创建的 Provider SHALL 仅处理其支持的 API 格式

### 需求：共享工具函数
系统 SHALL 提供共享的工具函数用于所有 Provider 的通用功能。

#### 场景：能力检测工具函数
- **当** 任何 Provider 需要检测模型能力
- **则** 系统 SHALL 提供以下共享函数：
  - `detectVisionCapability(model, modelId)` - 检测视觉能力
  - `detectToolCallingCapability(model, modelId)` - 检测工具调用能力
  - `detectThinkingCapability(model, modelId)` - 检测 thinking/reasoning 能力
- **且** 这些函数 SHALL 定义在 `customProviderUtils.ts`

#### 场景：模型信息转换工具函数
- **当** 任何 Provider 需要将模型信息转换为 API 格式
- **则** 系统 SHALL 提供 `modelsToAPIInfo(models, config, providerId)` 共享函数
- **且** 函数 SHALL 添加 Provider 名称前缀以区分不同来源的模型

#### 场景：按 API 格式过滤模型
- **当** 任何 Provider 从端点获取可用模型
- **则** 系统 SHALL 使用 `filterModelsByAPIFormat(models, apiFormat)` 函数过滤模型
- **且** Claude 格式 SHALL 仅包含模型 ID 中含 'claude' 的模型
- **且** Gemini 格式 SHALL 包含模型 ID 中含 'gemini' 或 'oss' 但不含 'claude' 的模型
- **且** OpenAI 格式 SHALL 包含 OpenAI 前缀的模型但不含 'claude'、'gemini' 或 'oss'

### 需求：Gemini 消息转换器 Thinking 支持
系统 SHALL 支持 Gemini 消息转换中的 thinking blocks 和 call ID 保留，用于 Claude 代理场景。

#### 场景：Gemini 格式中的 thinking blocks
- **当** 转换包含 ThinkingPart 的消息到 Gemini 格式
- **则** 系统 SHALL 使用 `thought: true` 标志转换 thinking parts
- **且** 系统 SHALL 保留 signature 和 redactedData 元数据（如存在）
- **且** thinking parts SHALL 放置在内容数组的开头

#### 场景：为代理后端保留 call ID
- **当** 转换 tool call 或 tool result parts 到 Gemini 格式
- **则** 系统 SHALL 在 functionCall 和 functionResponse 中包含 `id` 字段
- **且** 这允许后端代理（如 cloudcode）正确路由到 Claude/GPT
