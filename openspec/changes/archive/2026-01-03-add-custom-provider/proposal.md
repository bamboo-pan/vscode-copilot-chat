# Change: Add Custom Provider Support for BYOK Models

## Why

Currently, the "Add Models" feature provides a fixed list of predefined providers (Anthropic, Azure, Google, Groq, Ollama, OpenAI, OpenRouter, xAI). Users who want to connect to self-hosted or alternative AI model services that are compatible with OpenAI/Gemini/Claude APIs have no way to configure a custom provider with their own URL and authentication.

This limitation prevents users from:
- Using self-hosted model inference services (e.g., vLLM, text-generation-inference)
- Connecting to enterprise model gateways with custom endpoints
- Using emerging AI providers not yet officially supported

## What Changes

- **Add "Customize" option** in the "Add Models" provider dropdown menu
- **Multi-step configuration wizard** for custom providers:
  1. Provider name (user-defined display name)
  2. Provider base URL
  3. API format selection (OpenAI Responses API / OpenAI Chat Completions / Gemini / Claude)
  4. API token/key input
- **Automatic model discovery** from the configured endpoint after setup
- **Persistent storage** of custom provider configurations
- **UI integration** to manage (add/edit/delete) custom providers

## Impact

- **Affected specs**: None currently exist (new capability)
- **Affected code**:
  - `src/extension/byok/vscode-node/byokContribution.ts` - Register custom providers
  - `src/extension/byok/vscode-node/byokStorageService.ts` - Store custom provider configs
  - `src/extension/byok/vscode-node/` - New custom provider implementation
  - `package.json` - Configuration schema for custom providers
- **User-visible changes**:
  - New "Customize" option appears in "Add Models" dropdown
  - Configuration wizard for adding custom providers
  - Custom providers appear in the model selection UI alongside built-in providers
