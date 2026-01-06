## 1. Preparation

- [x] 1.1 Create `customProviderUtils.ts` with shared utility functions:
  - `detectVisionCapability()`
  - `detectToolCallingCapability()`
  - `detectThinkingCapability()`
  - `modelsToAPIInfo()`
  - `filterModelsByAPIFormat()`
  - `isModelMatchingAPIFormat()`
- [x] 1.2 Create abstract `BaseCustomProvider` class with common logic:
  - API key management
  - Model change event firing
  - Token count fallback
  - Model filtering by API format

## 2. Create Format-Specific Providers

- [x] 2.1 Create `OpenAICustomProvider`:
  - Model discovery via `/v1/models`
  - Request handling via `OpenAIEndpoint` and `CopilotLanguageModelWrapper`
  - Bearer token authentication
- [x] 2.2 Create `OpenAIResponsesCustomProvider`:
  - Model discovery via `/v1/models`
  - Custom request/response handling for Responses API
  - Reasoning support for o1/o3 models
  - SSE stream processing for Responses format
- [x] 2.3 Create `GeminiCustomProvider`:
  - Model discovery via `/v1beta/models?key=`
  - URL parameter authentication
  - Gemini message conversion using `apiMessageToGeminiMessage`
  - Schema cleanup for function declarations
  - Thinking mode support
  - SSE stream processing for Gemini format
- [x] 2.4 Create `ClaudeCustomProvider`:
  - Model discovery via `/v1/models`
  - `x-api-key` header authentication
  - Claude message conversion using `apiMessageToAnthropicMessage`
  - Extended thinking support with signature preservation
  - Redacted thinking block handling
  - SSE stream processing for Claude format

## 3. Update Aggregator

- [x] 3.1 Add factory function `_createProvider(providerId, config)` in `CustomProviderAggregator`
- [x] 3.2 Update `addProvider()` to use factory function
- [x] 3.3 Update imports to use new provider classes
- [x] 3.4 Update type for providers map from `CustomProvider` to `BaseCustomProvider`

## 4. Fix Claude Extended Thinking Multi-Turn Errors

- [x] 4.1 Add duck typing helpers `isThinkingPart()` and `isToolCallPart()` in `anthropicMessageConverter.ts`
- [x] 4.2 Ensure thinking blocks are placed first in assistant message content
- [x] 4.3 Add `AnthropicMessageConversionOptions` interface with `thinkingEnabled` option
- [x] 4.4 Inject placeholder `redacted_thinking` block when assistant has tool_use but no thinking blocks
- [x] 4.5 Update `ClaudeCustomProvider` to pass `thinkingEnabled` option to message converter

## 5. Enhance Gemini Message Converter

- [x] 5.1 Add `LanguageModelThinkingPart` support in `geminiMessageConverter.ts`
- [x] 5.2 Preserve `callId` in `functionCall` for backend proxy routing
- [x] 5.3 Preserve `callId` in `functionResponse` for backend proxy routing
- [x] 5.4 Place thinking parts at beginning of content array

## 6. Testing

- [x] 6.1 Add unit tests for `customProviderUtils.ts`
- [x] 6.2 Add unit tests for `OpenAICustomProvider`
- [x] 6.3 Add unit tests for `OpenAIResponsesCustomProvider`
- [x] 6.4 Add unit tests for `GeminiCustomProvider`
- [x] 6.5 Add unit tests for `ClaudeCustomProvider`
- [x] 6.6 Update unit tests for `anthropicMessageConverter.ts` with thinking block scenarios
- [x] 6.7 Add integration tests for aggregator with mixed providers

## 7. Cleanup

- [x] 7.1 Delete old `customProvider.ts`
- [x] 7.2 Verify all imports are updated
- [x] 7.3 Run full test suite
- [x] 7.4 Update documentation in `docs/custom-provider-lessons-learned.md`

## Dependencies

- Tasks 2.x depend on 1.x being complete
- Tasks 3.x depend on 2.x being complete
- Tasks 4.x (Claude Extended Thinking) can be done in parallel with 2.4
- Tasks 5.x (Gemini Message Converter) can be done in parallel with 2.3
- Tasks 6.x can be done in parallel with their corresponding implementation tasks
- Tasks 7.x depend on all other tasks being complete
