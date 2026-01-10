# BYOK Custom URL Feature - 研究发现

## 官方 URL
| Provider | 官方 URL |
|----------|----------|
| Anthropic | `https://api.anthropic.com` |
| OpenAI | `https://api.openai.com/v1` |
| Google | `https://generativelanguage.googleapis.com` |

## API Key 存储键名
| Provider | 官方 Key | 自定义 Key |
|----------|----------|------------|
| Anthropic | `Anthropic` | `Anthropic_custom` |
| OpenAI | `OpenAI` | `OpenAI_custom` |
| Gemini | `Gemini` | `Gemini_custom` |

## Settings 键名
```jsonc
{
  "github.copilot.chat.byok.anthropic.baseUrl": "https://...",
  "github.copilot.chat.byok.openai.baseUrl": "https://...",
  "github.copilot.chat.byok.google.baseUrl": "https://..."
}
```

## 现有代码结构分析

### 配置服务
- `src/platform/configuration/common/configurationService.ts` - 使用 `defineSetting` 函数定义配置
- `ConfigKey.BYOKAnthropicBaseUrl`, `ConfigKey.BYOKOpenAIBaseUrl`, `ConfigKey.BYOKGoogleBaseUrl` 已添加

### Provider 结构
- `anthropicProvider.ts` - 使用 `@anthropic-ai/sdk`, 通过 `new Anthropic({ apiKey, baseURL })` 支持自定义 baseURL ✓
- `openAIProvider.ts` - 继承 `BaseOpenAICompatibleLMProvider`, 覆盖 `getBaseUrl()` 方法 ✓
- `geminiNativeProvider.ts` - 使用 `@google/genai`, 通过 `new GoogleGenAI({ apiKey, httpOptions: { baseUrl } })` 支持自定义 baseURL ✓
- `baseOpenAICompatibleProvider.ts` - 接受 `_baseUrl` 参数，用于构建 API 端点

### 存储服务
- `byokStorageService.ts` - 使用 `extensionContext.secrets` 存储 API Key
- 支持 `GlobalApiKey` 和 `PerModelDeployment` 两种认证类型
- 添加了 `isCustomUrl` 参数支持区分官方/自定义 API Key ✓

### UI 服务
- `byokUIService.ts` - 提供完整的多步骤配置向导
  - `BYOK_OFFICIAL_URLS` - 官方 URL 常量
  - `promptForBaseUrl` - 第一步：输入 Base URL
  - `promptForAPIKeyWithBack` - 第二步：输入 API Key（带返回按钮）
  - `showConfigurationMenu` - 已有配置时的选项菜单（查看/修改/重置）
  - `configureBYOKProviderWithCustomUrl` - 完整的多步骤配置向导
  - `normalizeUrl` - URL 规范化（去除尾部斜杠）
  - `validateUrlFormat` - URL 格式验证

### 贡献
- `byokContribution.ts` - 注册所有 BYOK Provider，使用 `lm.registerLanguageModelChatProvider`

## 实现完成状态

### ✅ 已完成
1. ConfigKey 定义（3个新配置）
2. package.json Settings 贡献点
3. Anthropic Provider 自定义 URL 支持
4. OpenAI Provider 自定义 URL 支持
5. Gemini Provider 自定义 URL 支持
6. Storage Service 支持 official/custom API Key 区分
7. UI Service 多步骤配置向导
8. "(Custom)" 标记显示
9. 编译验证通过

### ⚠️ 需要注意
1. `geminiNativeProvider.spec.ts` 测试需要更新以匹配新的 UI 流程
2. 需要手动验证功能是否正常工作
