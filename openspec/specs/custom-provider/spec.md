# 自定义 Provider 规范

## 目的
允许用户配置自定义模型 Provider，连接到自托管或第三方 AI 模型服务，支持 OpenAI、Gemini、Claude 等 API 格式。

## 架构概述

```
用户 → "Add Models" → "Customize" → CustomProviderConfigurator (配置向导)
                                            ↓
                                    CustomProviderConfig (存储到 settings)
                                    API Key (存储到 SecretStorage)
                                            ↓
                            CustomProviderAggregator (聚合所有自定义 Provider)
                                            ↓
                    ┌───────────────────────┼───────────────────────┐
                    ↓                       ↓                       ↓
            CustomProvider A         CustomProvider B         CustomProvider C
            (openai-chat)           (gemini)                 (claude)
```

## 需求

### 需求：自定义 Provider 配置
系统应允许用户通过指定 Provider 名称、基础 URL、API 格式和认证令牌来配置自定义模型 Provider。

#### 场景：用户通过"添加模型"菜单添加新的自定义 Provider
- **当** 用户点击"添加模型"按钮并选择 "Customize"
- **则** 系统应显示多步骤配置向导

#### 场景：用户完成自定义 Provider 配置
- **当** 用户提供有效的 Provider 名称、基础 URL、API 格式选择和 API Token
- **则** 系统应持久化存储配置到 `github.copilot.chat.customProviders`
- **且** 系统应将 API 密钥存储到 VS Code SecretStorage
- **且** 系统应将自定义 Provider 添加到 CustomProviderAggregator

#### 场景：用户输入无效的基础 URL
- **当** 用户在基础 URL 字段中输入格式错误的 URL
- **则** 系统应显示验证错误："Please enter a valid URL"
- **且** 系统应阻止进入下一步

#### 场景：用户输入重复的 Provider 名称
- **当** 用户输入的 Provider 名称已存在
- **则** 系统应显示验证错误："A provider with this name already exists"

### 需求：API 格式选择
系统应支持自定义 Provider 的多种 API 格式：OpenAI Chat Completions、OpenAI Responses API、Gemini 和 Claude。

#### 场景：用户选择 API 格式
- **当** 用户到达 API 格式选择步骤
- **则** 系统应显示选项列表：
  - "OpenAI Chat Completions" - 标准 OpenAI 聊天补全 API
  - "OpenAI Responses API" - OpenAI Responses API 格式
  - "Google Gemini" - Google Gemini 原生 API
  - "Anthropic Claude" - Anthropic Messages API
- **且** 用户应能够选择且仅选择一种格式

#### 场景：系统使用 OpenAI Chat 格式
- **当** Provider 配置为 `openai-chat` 格式
- **则** 系统应使用 `/v1/chat/completions` 端点
- **且** 系统应使用 `Authorization: Bearer <token>` 认证

#### 场景：系统使用 Gemini 格式
- **当** Provider 配置为 `gemini` 格式
- **则** 系统应使用 `/v1beta/models/{model}:streamGenerateContent` 端点
- **且** 系统应使用 URL 参数 `key=<token>` 认证
- **且** 系统应使用 `apiMessageToGeminiMessage` 转换消息格式

#### 场景：系统使用 Claude 格式
- **当** Provider 配置为 `claude` 格式
- **则** 系统应使用 `/v1/messages` 端点
- **且** 系统应使用 `x-api-key` 和 `anthropic-version: 2023-06-01` 头认证
- **且** 系统应使用 `apiMessageToAnthropicMessage` 转换消息格式

### 需求：自定义 Provider 模型发现
系统应在配置完成后自动从自定义 Provider 端点发现可用模型。

#### 场景：成功发现 OpenAI 格式模型
- **当** 自定义 Provider 配置保存后
- **且** Provider 为 OpenAI 格式
- **则** 系统应请求 `GET /v1/models`
- **且** 系统应从 `data` 数组中解析模型列表

#### 场景：成功发现 Gemini 格式模型
- **当** 自定义 Provider 配置保存后
- **且** Provider 为 Gemini 格式
- **则** 系统应请求 `GET /v1beta/models?key=<token>`
- **且** 系统应从 `models` 数组中解析模型列表

#### 场景：模型发现失败
- **当** Provider 端点不支持模型列表或返回错误
- **则** 系统应返回空模型列表
- **且** 系统应记录发现失败到日志

### 需求：模型能力检测
系统应自动检测模型的能力（视觉、工具调用、thinking）。

#### 场景：检测视觉能力
- **当** 模型名称包含 `vision`、`gpt-4o`、`claude-3`、`gemini` 等关键词
- **则** 系统应将模型标记为支持视觉输入

#### 场景：检测 thinking 能力
- **当** 模型名称包含 `thinking`、`reasoning`、`o1`、`o3`、`deepseek-r1`、`gemini`
- **则** 系统应将模型标记为支持 thinking 模式
- **且** 系统应在请求中启用相应的 thinking 参数

### 需求：自定义 Provider 管理
系统应允许用户查看、编辑和删除现有的自定义 Provider 配置。

#### 场景：用户查看现有自定义 Provider
- **当** 用户执行 "Manage Custom Providers" 命令
- **则** 系统应显示已配置的自定义 Provider 列表
- **且** 每个 Provider 显示名称、ID、API 格式和 URL

#### 场景：用户编辑自定义 Provider
- **当** 用户选择编辑某个 Provider
- **则** 系统应提供选项：
  - "Select Models" - 查看该 Provider 的可用模型
  - "Update Base URL" - 修改 API 端点
  - "Change API Format" - 修改 API 格式
  - "Update API Token" - 更新认证令牌
  - "Delete Provider" - 删除该 Provider

#### 场景：用户删除自定义 Provider
- **当** 用户选择删除某个自定义 Provider
- **且** 用户在确认对话框中点击 "Delete"
- **则** 系统应从 settings 中删除 Provider 配置
- **且** 系统应从 SecretStorage 中删除关联的 API 密钥
- **且** 系统应从 CustomProviderAggregator 中移除该 Provider
- **且** 系统应触发模型列表刷新

### 需求：多 Provider 模型聚合
系统应聚合所有自定义 Provider 的模型，统一展示在模型选择 UI 中。

#### 场景：多个 Provider 的模型同时可见
- **当** 用户配置了多个自定义 Provider
- **则** 所有 Provider 的模型都应显示在模型选择列表中
- **且** 模型显示名称应包含 Provider 前缀：`[ProviderName] ModelName`
- **且** 模型 ID 应使用 `providerId:modelId` 格式确保唯一性

### 需求：自定义 Provider 持久化
系统应跨 VS Code 会话持久化自定义 Provider 配置。

#### 场景：重启后自定义 Provider 可用
- **当** VS Code 重启
- **且** 之前已配置自定义 Provider
- **则** 系统应从 settings 读取所有 Provider 配置
- **且** 系统应自动注册所有已保存的自定义 Provider 到聚合器
- **且** 系统应使其模型可供选择

## 已知限制

1. **手动模型输入**：当 `/models` 端点不可用时，暂不支持手动输入模型 ID
2. **自定义请求头**：暂不支持添加自定义 HTTP 请求头
3. **连接测试**：保存配置前不会验证端点可达性

