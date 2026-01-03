# Implementation Tasks

## 1. Configuration Schema & Storage
- [x] 1.1 Add `github.copilot.chat.customProviders` configuration schema in `package.json`
- [x] 1.2 Update `ConfigKey` enum with `CustomProviders` key in configuration service
- [x] 1.3 Extend `IBYOKStorageService` to handle per-provider API key storage for custom providers

## 2. Custom Provider Core Implementation
- [x] 2.1 Create `customProviderTypes.ts` defining `CustomProviderConfig` interface and `APIFormat` enum
- [x] 2.2 Create `customProviderFactory.ts` to instantiate appropriate endpoint based on API format (merged into CustomProvider)
- [x] 2.3 Implement `CustomProvider` class extending appropriate base classes for each format:
  - OpenAI Chat Completions format (reuse `OpenAIEndpoint`)
  - OpenAI Responses API format
  - Gemini format (via OpenAI-compatible proxy)
  - Claude/Anthropic format (via OpenAI-compatible proxy)

## 3. Configuration Wizard UI
- [x] 3.1 Create `customProviderConfigurator.ts` with multi-step wizard:
  - Step 1: Provider name input
  - Step 2: Base URL input with validation
  - Step 3: API format selection (QuickPick)
  - Step 4: API token input (password field)
- [x] 3.2 Add model discovery logic to fetch available models from custom endpoint
- [x] 3.3 Implement provider management UI (list/edit/delete existing custom providers)

## 4. Integration with BYOK System
- [x] 4.1 Register "Customize" command and add to "Add Models" dropdown menu
- [x] 4.2 Update `BYOKContrib` to dynamically register custom providers on startup
- [x] 4.3 Handle provider lifecycle (add/update/remove) with proper cleanup

## 5. Testing & Validation
- [x] 5.1 Add unit tests for custom provider configuration parsing
- [x] 5.2 Add unit tests for API format detection and endpoint creation
- [ ] 5.3 Manual testing with various endpoints (OpenAI-compatible, Gemini, Claude)

## Dependencies
- Tasks 1.x must complete before 2.x (storage needed for provider data)
- Tasks 2.x must complete before 3.x (core logic needed for wizard)
- Tasks 3.x and 4.x can be parallelized after 2.x completion
