# BYOK Custom URL Feature - 进度日志

## 2026-01-10

### 开始实施
- 创建了任务计划文件
- 开始阅读现有代码结构

### 功能完成审核
- 审核发现所有 Phase 1-5 已经完成
- Phase 1: ConfigKey 定义和 package.json Settings 贡献点 ✓
- Phase 2: 三个 Provider（Anthropic、OpenAI、Gemini）都已支持自定义 baseURL ✓
- Phase 3: byokStorageService 已支持 isCustomUrl 参数区分 official/custom API Key ✓
- Phase 4: byokUIService 已实现多步骤 QuickPick 交互、URL 验证、返回上一步、配置菜单 ✓
- Phase 5: 所有三个 Provider 已添加 "(Custom)" 标记 ✓

### 编译验证
- BYOK 相关文件编译无错误
- 现有错误与 `@vscode/copilot-api` 相关（CCAModel、CCAModelsList），与本次修改无关

### 单元测试
- `src/extension/byok/common/` 测试: 37 通过
- `src/extension/byok/vscode-node/test/geminiNativeProvider.spec.ts`: 需要更新以匹配新的 UI 流程
  - 测试基于旧的 `handleAPIKeyUpdate` 函数设计
  - 新实现使用 `showConfigurationMenu` 和 `configureBYOKProviderWithCustomUrl`
  - 需要重写测试以 mock 新的 UI 服务
- 已添加 `configurationService` mock 到测试文件
- 已添加 UI 服务 mock 但需要进一步完善测试逻辑

### 修复模型信息显示问题 (2026-01-10)
问题：使用自定义 URL（如 OpenRouter）时，Anthropic 模型的名称、视觉支持、思考模式显示为空
原因分析：
1. `getAllModels` 方法中，对于未知模型直接使用 `model.display_name`，若为空则名称显示为空
2. 视觉支持 (`vision`) 和思考模式 (`thinking`) 被硬编码为 `false`

修复方案：
- 添加 `_inferModelCapabilities` 辅助函数，根据模型 ID 模式推断能力：
  - **模型名称**：优先使用 `display_name`，若为空则回退到 `model.id`
  - **视觉支持**：Claude 3+ 及 Claude 4 系列模型默认支持
  - **思考模式**：Claude 3.5+、Claude 3.7+ 及 Claude 4 系列模型默认支持
  - **Token 限制**：根据模型系列自动推断合理的默认值

### 修复 OpenAI 和 Gemini Provider 类似问题 (2026-01-10)
发现 OpenAI 和 Gemini Provider 存在更严重的问题 - 未知模型根本不会显示，因为只过滤已知模型。

修复方案：
1. **BaseOpenAICompatibleLMProvider (OpenAI)**：
   - 添加 `_inferModelCapabilities` 辅助函数
   - 根据模型 ID 推断 GPT-4o、GPT-4-turbo、o1/o3/o4 系列的能力
   - 未知模型现在也会显示，并带有推断的能力信息

2. **GeminiNativeBYOKLMProvider (Gemini)**：
   - 添加 `_inferModelCapabilities` 辅助函数
   - 根据模型 ID 推断 Gemini 1.5/2.0 系列的能力
   - 使用 `model.displayName` 作为首选名称
   - 未知模型现在也会显示，并带有推断的能力信息

编译验证：修改未引入新错误（仍保持 5 个预先存在的错误）
