# 构建与配置指南

本指南将帮助你了解如何编译打包 Copilot Chat 扩展，以及如何配置自定义模型 Provider（BYOK - Bring Your Own Key）。

## 目录

- [构建与打包](#构建与打包)
  - [环境准备](#环境准备)
  - [编译项目](#编译项目)
  - [打包扩展](#打包扩展)
  - [测试扩展](#测试扩展)
- [自定义模型配置](#自定义模型配置)
  - [启用功能](#启用功能)
  - [配置提供商](#配置提供商)
  - [API 格式说明](#api-格式说明)
    - [OpenAI Chat](#openai-chat-completions)
    - [OpenAI Responses](#openai-responses-api)
    - [Google Gemini](#google-gemini)
    - [Anthropic Claude](#anthropic-claude)
  - [管理提供商](#管理提供商)

## 构建与打包

### 环境准备

在开始之前，请确保你已经安装了以下工具：

1. **Node.js**: 推荐版本 v18.x 或更高
2. **npm**: 通常随 Node.js 一起安装
3. **Git**: 用于版本控制

### 编译项目

1. 克隆仓库（如果你还没有）：
   ```bash
   git clone https://github.com/microsoft/vscode-copilot-release.git
   cd vscode-copilot-release
   ```

2. 安装依赖：
   ```bash
   npm install
   
   编译问题已修复！问题原因是缺少依赖包 @parcel/watcher，因为 node_modules 没有正确安装。npm install 失败是因为 Playwright 下载浏览器时出现协议错误，所以使用了 npm install --ignore-scripts 来跳过 postinstall 脚本，成功安装了依赖。现在 npm run compile 可以正常运行，构建成功生成了所有输出文件。
   如果是 Playwright，可以手动运行 npx playwright install 来下载浏览器
   ```
   
3. 运行编译命令：
   ```bash
   npm run compile
   ```

   如果你想在开发过程中实时监视文件更改并自动重新编译，可以使用：
   ```bash
   npm run watch
   ```

### 打包扩展

要生成 `.vsix` 扩展安装包，请使用 `vsce` 工具（Visual Studio Code Extensions CLI）。

1. 如果尚未安装 `vsce`，请全局安装：
   ```bash
   npm install -g @vscode/vsce
   ```

2. 运行打包命令：
   ```bash
   vsce package
   ```

   这将生成一个名为 `copilot-chat-x.x.x.vsix` 的文件。

3. **安装扩展**：
   - 打开 VS Code
   - 按 `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (macOS)
   - 输入并选择 "Extensions: Install from VSIX..."
   - 选择生成的 `.vsix` 文件

### 测试扩展

项目包含多种类型的测试：

- **单元测试**: `npm run test:unit`
- **集成测试**: `npm run test:extension`
- **模拟测试**: `npm run simulate`

## 自定义模型配置

Copilot Chat 支持 Bring Your Own Key (BYOK) 功能，允许你连接到自托管或第三方的 LLM 服务。支持的 API 格式包括 OpenAI、Google Gemini 和 Anthropic Claude。

### 启用功能

目前 BYOK 功能可能需要通过特定配置或命令启用。在 Chat 视图中，查找 "Add Models" 或 "Customize" 选项。

### 配置提供商

1. 在 Copilot Chat 界面中点击 "Add Models" 按钮。
2. 选择 "Customize" 选项进入配置向导。
3. 按照向导填写以下信息：
   - **Name**: 为你的提供商起一个名字（例如 "My Local LLM" 或 "Company Gemini"）
   - **Base URL**: API 服务的基础地址
   - **API Format**: 选择匹配你服务的 API 格式
   - **API Key**: 你的服务认证密钥

### API 格式说明

不同的服务使用不同的 API 格式。请根据你的后端服务选择正确的格式：

#### OpenAI Chat Completions
适用于标准的 OpenAI 兼容接口（如 OpenAI 官方 API、vLLM、Ollama 等）。

- **Endpoint**: 使用 `/v1/chat/completions`
- **Auth**: `Authorization: Bearer <token>`
- **配置示例**:
  - Base URL: `https://api.openai.com` (或你的本地地址 `http://localhost:11434`)
  - API Format: `openai-chat`

#### OpenAI Responses API
适用于支持 OpenAI Responses API 格式的服务。此格式支持 `o1`/`o3` 等推理模型的 reasoning 功能。

- **Endpoint**: 使用 `/v1/responses`
- **Auth**: `Authorization: Bearer <token>`
- **配置示例**:
  - Base URL: `https://api.openai.com`
  - API Format: `openai-responses`

#### Google Gemini
适用于 Google Gemini API。

- **Endpoint**: 使用 `/v1beta/models/{model}:streamGenerateContent`
- **Auth**: URL 参数 `key=<token>`
- **特殊功能**: 支持 Thinking 模式和原生多模态输入
- **配置示例**:
  - Base URL: `https://generativelanguage.googleapis.com`
  - API Format: `gemini`

#### Anthropic Claude
适用于 Anthropic Claude API。

- **Endpoint**: 使用 `/v1/messages`
- **Auth**: Header `x-api-key: <token>` 和 `anthropic-version: 2023-06-01`
- **特殊功能**:
  - 支持 Extended Thinking（多轮对话中保留 thinking 签名）
  - 支持 Redacted Thinking blocks
- **配置示例**:
  - Base URL: `https://api.anthropic.com`
  - API Format: `claude`

### 管理提供商

配置完成后，你可以：

1. **选择模型**: 系统会自动发现该 Provider 下的可用模型。
2. **管理配置**: 使用 "Manage Custom Providers" 命令可以：
   - 查看已配置的 Provider
   - 编辑 Base URL 或 Token
   - 删除不再需要的 Provider

### 常见问题

**Q: 为什么我的本地模型没有显示？**
A: 请确保你的本地服务（如 Ollama）已启动，且 Base URL 正确。对于 Ollama，通常是 `http://localhost:11434`。此外，确保服务实现了 `/v1/models` 端点以便 Copilot 发现模型。

**Q: 如何在多轮对话中保持 Claude 的 Thinking 内容？**
A: 请确保选择 `claude` API 格式。系统会自动处理 Thinking 签名并在多轮对话中传递，即使在上下文摘要时也会注入占位符以保持 API 兼容性。

**Q: Gemini 模型支持函数调用吗？**
A: 支持。系统会自动将 Copilot 的工具定义转换为 Gemini 兼容的格式，并处理函数调用的响应。
