# BYOK Custom URL Feature Specification

## 概述

为 Anthropic、OpenAI、Google (Gemini) 三个 BYOK Provider 添加自定义 URL 功能，支持用户使用第三方兼容 API 服务。

## 需求来源

用户访谈 - 2026年1月9日

---

## 功能需求

### 1. 核心功能

| 项目 | 决定 |
|------|------|
| **适用 Provider** | Anthropic, OpenAI, Google (Gemini) |
| **使用场景** | 第三方兼容 API 服务 |
| **技术方案** | 继续使用官方 SDK + 自定义 baseURL |

### 2. 用户交互

| 项目 | 决定 |
|------|------|
| **配置入口** | 点击 Provider 时的交互式对话框 |
| **对话框类型** | VS Code 原生多步骤 QuickPick |
| **URL 默认值** | 显示完整官方 URL |
| **管理功能** | 支持显示/修改/重置 URL |
| **返回功能** | 提供 "< Back" 选项返回上一步 |
| **已有配置时** | 询问用户是"查看模型"还是"修改配置" |

### 3. 存储设计

| 项目 | 决定 |
|------|------|
| **URL 存储** | VS Code Settings（可同步） |
| **Settings 结构** | 扁平结构，每个 provider 单独 key |
| **API Key 存储** | 区分 official/custom 两种 |
| **配置生效** | 需要重启/手动刷新 |

#### Settings 键名

```jsonc
{
  "github.copilot.chat.byok.anthropic.baseUrl": "https://...",
  "github.copilot.chat.byok.openai.baseUrl": "https://...",
  "github.copilot.chat.byok.google.baseUrl": "https://..."
}
```

#### 官方 URL

| Provider | 官方 URL |
|----------|----------|
| Anthropic | `https://api.anthropic.com` |
| OpenAI | `https://api.openai.com/` |
| Google | `https://generativelanguage.googleapis.com` |

#### API Key 存储键名

| Provider | 官方 Key | 自定义 Key |
|----------|----------|------------|
| Anthropic | `Anthropic` | `Anthropic_custom` |
| OpenAI | `OpenAI` | `OpenAI_custom` |
| Gemini | `Gemini` | `Gemini_custom` |

### 4. 验证逻辑

| 项目 | 决定 |
|------|------|
| **验证方式** | 调用 `/models` API |
| **验证深度** | 格式 + 端点可达 + API Key 有效 |
| **超时时间** | 5 秒 |
| **URL 规范化** | 自动去除尾部斜杠 |

### 5. 反馈与错误处理

| 项目 | 决定 |
|------|------|
| **验证中状态** | Loading 状态 + 禁用按钮 |
| **成功反馈** | 提示 + 可用模型数量 |
| **错误反馈** | 对话框内 + VS Code 通知结合 |
| **获取失败时** | 显示错误，不显示任何模型 |

### 6. UI 显示

- 在模型列表中显示标记: "Anthropic (Custom)"

### 7. 不支持的场景

- 第三方服务不支持 `/models` API → 不考虑

---

## 用户交互流程

### 新用户配置流程

```
用户点击 "Add Models..." → 选择 "Anthropic"
                ↓
┌─────────────────────────────────────────┐
│ Step 1: Enter API Base URL              │
│ ─────────────────────────────────────── │
│ > https://api.anthropic.com             │  ← 默认值，可编辑
│   [Enter to confirm, Esc to cancel]     │
└─────────────────────────────────────────┘
                ↓ (Enter)
┌─────────────────────────────────────────┐
│ Step 2: Enter API Key                   │
│ ─────────────────────────────────────── │
│ > ••••••••••••••                        │  ← 密码输入
│   < Back                                │  ← 返回上一步选项
│   [Enter to confirm, Esc to cancel]     │
└─────────────────────────────────────────┘
                ↓ (Enter)
┌─────────────────────────────────────────┐
│ Validating configuration...             │
│ ─────────────────────────────────────── │
│ $(loading~spin) Testing connection...   │
└─────────────────────────────────────────┘
                ↓
        [验证成功] → 通知: "✓ Connected! Found 5 models"
                   → 保存配置
                   → 显示模型列表
                ↓
        [验证失败] → 通知: "✗ Failed: Invalid API key"
                   → 在 QuickPick 显示错误
                   → 返回 Step 2 让用户重试
```

### 已有配置用户流程

```
用户点击 "Add Models..." → 选择 "Anthropic"
                ↓
┌─────────────────────────────────────────┐
│ Anthropic Configuration                 │
│ ─────────────────────────────────────── │
│ > View Available Models                 │
│   Modify Configuration                  │
│   Reset to Default                      │
└─────────────────────────────────────────┘
```

---

## 技术实现

### 需要修改的文件

1. **`src/platform/configuration/common/configurationService.ts`**
   - 添加新的 ConfigKey：
     - `BYOKAnthropicBaseUrl`
     - `BYOKOpenAIBaseUrl`
     - `BYOKGoogleBaseUrl`

2. **`package.json`**
   - 添加 Settings 定义到 contributes.configuration

3. **`src/extension/byok/vscode-node/byokUIService.ts`**
   - 添加多步骤 QuickPick 交互
   - 添加 URL 验证逻辑
   - 添加返回上一步功能

4. **`src/extension/byok/vscode-node/anthropicProvider.ts`**
   - 支持从 settings 读取自定义 baseURL
   - 传递 baseURL 到 Anthropic SDK

5. **`src/extension/byok/vscode-node/openAIProvider.ts`**
   - 支持从 settings 读取自定义 baseURL

6. **`src/extension/byok/vscode-node/geminiNativeProvider.ts`**
   - 支持从 settings 读取自定义 baseURL
   - 传递 baseURL 到 Google GenAI SDK

7. **`src/extension/byok/vscode-node/byokStorageService.ts`**
   - 支持区分 official/custom API Key 存储

8. **`src/extension/byok/vscode-node/byokContribution.ts`** (如需要)
   - 更新模型列表显示，添加 "(Custom)" 标记

---

## SDK 配置参考

### Anthropic SDK

```typescript
new Anthropic({
  apiKey: 'xxx',
  baseURL: 'https://custom.example.com'  // 支持自定义
});
```

### Google GenAI SDK

```typescript
new GoogleGenAI({
  apiKey: 'xxx',
  httpOptions: {
    baseUrl: 'https://custom.example.com'  // 支持自定义
  }
});
```

### OpenAI (BaseOpenAICompatible)

```typescript
// 已支持通过 _baseUrl 参数配置
super(
  authType,
  providerName,
  'https://custom.example.com',  // baseUrl
  knownModels,
  ...
);
```

---

## 验收标准

1. [ ] 用户可以通过 QuickPick 配置自定义 URL
2. [ ] URL 和 API Key 分别正确存储
3. [ ] 验证逻辑正确工作（格式、连接、认证）
4. [ ] 错误信息清晰显示
5. [ ] 成功时显示可用模型数量
6. [ ] 模型列表正确显示 "(Custom)" 标记
7. [ ] 支持返回上一步修改
8. [ ] 已有配置时正确显示选项菜单
9. [ ] Settings 可同步
10. [ ] URL 自动规范化（去除尾部斜杠）
