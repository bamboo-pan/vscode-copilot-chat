# Change: Split CustomProvider into Four Format-Specific Providers

## Why

The current `CustomProvider` class handles all four API formats (OpenAI Chat, OpenAI Responses, Gemini, Claude) in a single 800+ line file with complex switch statements and format-specific logic intermixed. This makes the code:
- Difficult to maintain and extend
- Prone to regressions when adding format-specific features
- Hard to test individual format implementations

Splitting into dedicated providers simplifies the architecture, improves maintainability, and allows format-specific optimizations without affecting other formats.

## What Changes

- **BREAKING**: Remove the unified `CustomProvider` class
- Create four new provider classes:
  - `GeminiCustomProvider` - handles Google Gemini API format only
  - `ClaudeCustomProvider` - handles Anthropic Claude API format only
  - `OpenAIResponsesCustomProvider` - handles OpenAI Responses API format only
  - `OpenAICustomProvider` - handles OpenAI Chat Completions API format only
- Update `CustomProviderAggregator` to instantiate the correct provider based on `apiFormat`
- Each provider contains only the logic relevant to its format
- Extract shared utilities (capability detection, model info conversion, model filtering) to common module
- Fix Claude Extended Thinking multi-turn conversation errors:
  - Add duck typing for ThinkingPart/ToolCallPart detection (handles cross-module instanceof issues)
  - Ensure thinking blocks are placed first in assistant messages
  - Inject placeholder redacted_thinking block when context summarization strips thinking blocks
- Enhance Gemini message converter:
  - Support LanguageModelThinkingPart for Claude proxy scenarios
  - Preserve callId in function calls/responses for backend routing

## Impact

- Affected specs: `custom-provider`
- Affected code:
  - `src/extension/byok/vscode-node/customProvider.ts` → deleted and replaced by:
    - `src/extension/byok/vscode-node/baseCustomProvider.ts`
    - `src/extension/byok/vscode-node/geminiCustomProvider.ts`
    - `src/extension/byok/vscode-node/claudeCustomProvider.ts`
    - `src/extension/byok/vscode-node/openaiResponsesCustomProvider.ts`
    - `src/extension/byok/vscode-node/openaiCustomProvider.ts`
  - `src/extension/byok/vscode-node/customProviderAggregator.ts` - update factory logic
  - `src/extension/byok/common/customProviderUtils.ts` - new shared utilities module
  - `src/extension/byok/common/anthropicMessageConverter.ts` - fix thinking block handling for multi-turn
  - `src/extension/byok/common/geminiMessageConverter.ts` - add thinking block and callId support
  - `src/extension/byok/vscode-node/byokContribution.ts` - simplify provider registration
