## 新增需求

### 需求：自定义 Provider 配置
系统应允许用户通过指定 Provider 名称、基础 URL、API 格式和认证令牌来配置自定义模型 Provider。

#### 场景：用户通过"添加模型"菜单添加新的自定义 Provider
- **当** 用户点击"添加模型"按钮并选择 "Customize"
- **则** 系统应显示多步骤配置向导

#### 场景：用户完成自定义 Provider 配置
- **当** 用户提供有效的 Provider 名称、基础 URL、API 格式选择和 API Token
- **则** 系统应持久化存储配置
- **且** 系统应将自定义 Provider 注册到 VS Code 的语言模型 API

#### 场景：用户输入无效的基础 URL
- **当** 用户在基础 URL 字段中输入格式错误的 URL
- **则** 系统应显示验证错误
- **且** 系统应阻止进入下一步

### 需求：API 格式选择
系统应支持自定义 Provider 的多种 API 格式：OpenAI Chat Completions、OpenAI Responses API、Gemini 和 Claude。

#### 场景：用户选择 API 格式
- **当** 用户到达 API 格式选择步骤
- **则** 系统应显示选项列表："OpenAI Chat Completions"、"OpenAI Responses API"、"Gemini"、"Claude"
- **且** 用户应能够选择且仅选择一种格式

#### 场景：系统使用选定的格式处理请求
- **当** 使用自定义 Provider 的模型进行聊天
- **则** 系统应根据选定的 API 格式格式化请求
- **且** 系统应根据选定的 API 格式解析响应

### 需求：自定义 Provider 模型发现
系统应在配置完成后自动从自定义 Provider 端点发现可用模型。

#### 场景：成功发现模型
- **当** 自定义 Provider 配置保存后
- **且** Provider 端点支持模型列表
- **则** 系统应获取可用模型列表
- **且** 系统应在模型选择 UI 中显示这些模型

#### 场景：模型发现失败
- **当** Provider 端点不支持模型列表或返回错误
- **则** 系统应允许用户手动指定模型 ID
- **且** 系统应记录发现失败以便调试

### 需求：自定义 Provider 管理
系统应允许用户查看、编辑和删除现有的自定义 Provider 配置。

#### 场景：用户查看现有自定义 Provider
- **当** 用户在有自定义 Provider 时选择"添加模型"菜单中的"Customize"
- **则** 系统应显示已配置的自定义 Provider 列表
- **且** 系统应提供添加新 Provider、编辑或删除现有 Provider 的选项

#### 场景：用户删除自定义 Provider
- **当** 用户选择删除某个自定义 Provider
- **则** 系统应删除 Provider 配置
- **且** 系统应从安全存储中删除关联的 API 密钥
- **且** 系统应从 VS Code 中注销该 Provider 的模型

### 需求：自定义 Provider 持久化
系统应跨 VS Code 会话持久化自定义 Provider 配置。

#### 场景：重启后自定义 Provider 可用
- **当** VS Code 重启
- **且** 之前已配置自定义 Provider
- **则** 系统应自动注册所有已保存的自定义 Provider
- **且** 系统应使其模型可供选择
