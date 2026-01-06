# 实现任务清单

## 1. 配置 Schema 和存储
- [x] 1.1 在 `package.json` 中添加 `github.copilot.chat.customProviders` 配置 schema
- [x] 1.2 在配置服务中更新 `ConfigKey` 枚举，添加 `CustomProviders` 键
- [x] 1.3 扩展 `IBYOKStorageService` 以处理自定义 Provider 的 API 密钥存储

## 2. 自定义 Provider 核心实现
- [x] 2.1 创建 `customProviderTypes.ts` 定义 `CustomProviderConfig` 接口和 `APIFormat` 枚举
- [x] 2.2 创建 `customProvider.ts` 实现 `CustomProvider` 类
- [x] 2.3 实现四种 API 格式处理器：
  - `_handleOpenAIRequest`: OpenAI Chat Completions 格式 (`/v1/chat/completions`)
  - `_handleOpenAIResponsesRequest`: OpenAI Responses API 格式 (`/v1/responses`)
  - `_handleGeminiRequest`: Gemini 原生格式 (`/v1beta/models/{model}:streamGenerateContent`)
  - `_handleClaudeRequest`: Claude/Anthropic 原生格式 (`/v1/messages`)
- [x] 2.4 创建 `customProviderAggregator.ts` 聚合多个自定义 Provider

## 3. 配置向导 UI
- [x] 3.1 创建 `customProviderConfigurator.ts` 实现多步骤向导：
  - 步骤 1：Provider 名称输入（验证重复）
  - 步骤 2：基础 URL 输入（带 URL 格式验证）
  - 步骤 3：API 格式选择（QuickPick 四选一）
  - 步骤 4：API Token 输入（SecretStorage 密码字段）
- [x] 3.2 实现模型发现逻辑，支持不同格式的端点：
  - OpenAI: `GET /v1/models` → `data` 数组
  - Gemini: `GET /v1beta/models?key=<token>` → `models` 数组
  - Claude: 无标准端点，使用已知模型列表
- [x] 3.3 实现 Provider 管理 UI：
  - 列出所有 Provider（显示 ID、名称、格式、URL）
  - 编辑选项：Select Models / Update URL / Change Format / Update Token / Delete

## 4. 与 BYOK 系统集成
- [x] 4.1 注册 "Customize" 命令，添加到 "Add Models" 下拉菜单
- [x] 4.2 使用 `CustomProviderAggregator` 单次注册：`lm.registerLanguageModelChatProvider('custom', aggregator)`
- [x] 4.3 处理 Provider 生命周期：
  - 添加：`aggregator.addProvider(provider)`
  - 删除：`aggregator.removeProvider(providerId)` + 清理 SecretStorage

## 5. Thinking/Reasoning 支持
- [x] 5.1 实现模型能力检测 (`hasThinkingCapability` 方法)
- [x] 5.2 实现各格式的 thinking 请求参数：
  - Gemini: `thinkingConfig: { thinkingBudget: 24576 }`
  - OpenAI Responses: `reasoning: { effort: 'medium' }`
  - Claude: `thinking: { type: 'enabled', budget_tokens: 10000 }`
  - OpenAI Chat: 检测 `usage.completion_tokens_details.reasoning_tokens`
- [x] 5.3 实现各格式的 thinking 响应解析：
  - Gemini: `part.thought` 字段
  - OpenAI Responses: `type: 'reasoning_summary_text'` 事件
  - Claude: `type: 'content_block_delta'` + `thinking_delta`

## 6. 测试和验证
- [x] 6.1 手动测试各种端点（OpenAI、Gemini、Claude）
- [x] 6.2 验证多 Provider 场景下模型都可见
- [x] 6.3 验证 thinking 模式输出正确

## 依赖关系
```
任务 1.x (存储)
    ↓
任务 2.x (核心实现)
    ↓
┌───┴───┐
3.x     4.x (可并行)
(UI)   (集成)
    ↓
任务 5.x (Thinking 支持)
    ↓
任务 6.x (测试)
```

## 关键文件
| 文件 | 说明 |
|------|------|
| `customProviderTypes.ts` | 类型定义：`CustomProviderConfig`, `APIFormat` |
| `customProvider.ts` | 核心实现：API 请求、消息转换、thinking |
| `customProviderConfigurator.ts` | 配置 UI：向导流程、管理界面 |
| `customProviderAggregator.ts` | 聚合器：多 Provider 统一注册 |
| `byokContribution.ts` | 集成点：启动注册、命令绑定 |
