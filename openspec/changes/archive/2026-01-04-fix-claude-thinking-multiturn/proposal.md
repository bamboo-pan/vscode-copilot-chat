# Change: 修复 Claude Extended Thinking 多轮对话错误

## Why
当 Claude 模型启用 extended thinking 功能时，多轮对话（特别是涉及 tool_use 的场景）会报错：
```
Expected thinking or redacted_thinking, but found tool_use.
When thinking is enabled, a final assistant message must start with a thinking block.
```

这是因为 Claude API 要求：
1. 在 thinking 模式下，assistant 消息**必须**以 `thinking` 或 `redacted_thinking` block 开头
2. 之前轮次的 thinking blocks 必须保留并完整传回（包括 signature）

## What Changes
- 修复 `customProvider.ts` 中的 `_processClaudeStream` 方法
- 在 `content_block_stop` 时正确创建带有 `_completeThinking` 和 `signature` 元数据的 `LanguageModelThinkingPart`
- 添加对 `redacted_thinking` blocks 的处理支持
- 更新 `custom-provider-lessons-learned.md` 文档

## Impact
- Affected specs: custom-provider
- Affected code: `src/extension/byok/vscode-node/customProvider.ts`
