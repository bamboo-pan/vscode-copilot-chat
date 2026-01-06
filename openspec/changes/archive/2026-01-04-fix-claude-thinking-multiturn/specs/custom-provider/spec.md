## 新增需求

### 需求：Claude Extended Thinking 多轮对话支持
系统应正确处理 Claude extended thinking blocks 以确保多轮对话中的 API 兼容性。

#### 场景：保留带签名的 thinking blocks
- **当** Claude 模型返回 thinking block 和 signature
- **则** 系统应创建带有 `_completeThinking` 和 `signature` 元数据的 ThinkingPart
- **且** 系统应确保下一轮请求中 assistant 消息以 thinking block 开头

#### 场景：处理 redacted thinking blocks
- **当** Claude 模型返回 `redacted_thinking` block
- **则** 系统应创建带有 `redactedData` 元数据的 ThinkingPart
- **且** 系统应正确传回 redacted_thinking 以满足 API 要求
