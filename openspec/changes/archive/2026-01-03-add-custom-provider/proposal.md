# 变更：为 BYOK 模型添加自定义 Provider 支持

## 为什么需要这个功能

目前，"添加模型"功能只提供固定的预定义 Provider 列表（Anthropic、Azure、Google、Groq、Ollama、OpenAI、OpenRouter、xAI）。希望连接到兼容 OpenAI/Gemini/Claude API 的自托管或其他 AI 模型服务的用户，无法配置自定义 Provider。

这个限制导致用户无法：
- 使用自托管的模型推理服务（如 vLLM、text-generation-inference）
- 连接到企业级自定义端点的模型网关
- 使用尚未被官方支持的新兴 AI 服务商

## 变更内容

- **添加 "Customize" 选项**到"添加模型"下拉菜单
- **多步骤配置向导**用于自定义 Provider：
  1. Provider 名称（用户自定义显示名称，验证唯一性）
  2. Provider 基础 URL（带 URL 格式验证）
  3. API 格式选择（OpenAI Chat Completions / OpenAI Responses API / Google Gemini / Anthropic Claude）
  4. API Token/密钥输入（存储到 VS Code SecretStorage）
- **自动模型发现**：配置完成后根据 API 格式从端点获取可用模型
- **持久化存储**自定义 Provider 配置到 `github.copilot.chat.customProviders` 设置
- **Provider 管理**用于添加/编辑/删除自定义 Provider
- **多 Provider 聚合**通过 `CustomProviderAggregator` 统一注册到 VS Code
- **Thinking/Reasoning 支持**自动检测并启用模型的 thinking 能力

## 影响范围

- **相关规范**：[openspec/specs/custom-provider/spec.md](openspec/specs/custom-provider/spec.md)
- **相关代码**：
  - `src/extension/byok/vscode-node/customProviderTypes.ts` - 类型定义
  - `src/extension/byok/vscode-node/customProvider.ts` - 核心 Provider 实现
  - `src/extension/byok/vscode-node/customProviderConfigurator.ts` - 配置向导 UI
  - `src/extension/byok/vscode-node/customProviderAggregator.ts` - 多 Provider 聚合
  - `src/extension/byok/vscode-node/byokContribution.ts` - 集成和启动注册
  - `package.json` - 配置 schema 和命令定义
- **用户可见变化**：
  - "添加模型"下拉菜单中出现新的 "Customize" 选项
  - 添加自定义 Provider 的配置向导
  - 自定义 Provider 模型显示为 `[ProviderName] ModelName` 格式
  - Provider 管理界面支持查看模型、修改配置、删除 Provider
