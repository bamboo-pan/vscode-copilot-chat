## Context

The current `CustomProvider` implementation is a monolithic class that handles four different API formats through switch statements. As we add more format-specific features (like Claude extended thinking, Gemini function declarations cleanup, OpenAI reasoning), the complexity increases and the risk of cross-format regressions grows.

**Stakeholders**: Developers maintaining the custom provider feature, users configuring custom endpoints.

**Constraints**:
- Must maintain backward compatibility with existing configurations
- Must not break existing API key storage mechanism
- Must preserve the aggregator pattern for VS Code model registration

## Goals / Non-Goals

**Goals**:
- Simplify each provider implementation to ~150-200 lines
- Enable independent testing of each format
- Make format-specific enhancements isolated
- Improve code readability and maintainability

**Non-Goals**:
- Changing the user-facing configuration flow
- Modifying the API format options available
- Changing how API keys are stored

## Decisions

### Decision: Create Four Separate Provider Classes

Each format gets its own provider class that implements `BYOKModelProvider`:

```
BaseCustomProvider (abstract)
├── GeminiCustomProvider
├── ClaudeCustomProvider
├── OpenAIResponsesCustomProvider
└── OpenAICustomProvider
```

**Rationale**:
- Follows Single Responsibility Principle
- Allows format-specific optimizations
- Enables easier unit testing

**Alternatives considered**:
1. **Strategy pattern with handler objects** - Would still require a coordinator class, adds indirection
2. **Keep unified class with better organization** - Doesn't solve the testing and maintenance issues

### Decision: Factory Function in Aggregator

The `CustomProviderAggregator.addProvider()` method will use a factory function to instantiate the correct provider based on `apiFormat`:

```typescript
private _createProvider(providerId: string, config: CustomProviderConfig): BaseCustomProvider {
  switch (config.apiFormat) {
    case 'gemini': return new GeminiCustomProvider(...);
    case 'claude': return new ClaudeCustomProvider(...);
    case 'openai-responses': return new OpenAIResponsesCustomProvider(...);
    case 'openai-chat':
    default: return new OpenAICustomProvider(...);
  }
}
```

**Rationale**: Centralizes creation logic, easy to add new formats in future.

### Decision: Extract Common Utilities

Move shared functionality to `customProviderUtils.ts`:
- `detectVisionCapability(model, modelId)`
- `detectToolCallingCapability(model, modelId)`
- `detectThinkingCapability(model, modelId)`
- `modelsToAPIInfo(models, config, providerId)`
- `filterModelsByAPIFormat(models, apiFormat)`
- `isModelMatchingAPIFormat(modelId, apiFormat)`

**Rationale**: Avoids code duplication across providers.

### Decision: Duck Typing for Cross-Module Type Detection

Use duck typing in addition to `instanceof` checks for `LanguageModelThinkingPart` and `LanguageModelToolCallPart`:

```typescript
function isThinkingPart(part: any): part is LanguageModelThinkingPart {
  return part instanceof LanguageModelThinkingPart ||
    (part && typeof part === 'object' && part.constructor?.name === 'LanguageModelThinkingPart') ||
    (part && typeof part === 'object' && 'value' in part && 'metadata' in part && part.metadata !== undefined);
}
```

**Rationale**: When VS Code creates message parts and passes them to extension code, the `instanceof` check may fail due to different module contexts. Duck typing ensures reliable detection.

### Decision: Placeholder Thinking Block Injection

When extended thinking is enabled and an assistant message has `tool_use` but no thinking blocks (due to context summarization), inject a placeholder `redacted_thinking` block:

```typescript
if (options?.thinkingEnabled && options?.isAssistant && hasToolUse && thinkingBlocks.length === 0) {
  thinkingBlocks.push({
    type: 'redacted_thinking',
    data: '',  // Empty data for placeholder
  });
}
```

**Rationale**: Claude API requires assistant messages to start with thinking blocks when thinking mode is enabled. Context summarization may strip thinking blocks, causing API errors. The placeholder satisfies the API requirement without fabricating content.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Comprehensive test coverage before refactor |
| Increased file count | Smaller, focused files are easier to navigate |
| Duplicated base logic | Abstract base class and shared utilities |

## Migration Plan

1. Create abstract `BaseCustomProvider` with shared logic
2. Create each format-specific provider, copying relevant code
3. Add unit tests for each new provider
4. Update aggregator factory logic
5. Delete old `CustomProvider` class
6. Run full integration tests

**Rollback**: Revert to previous commit containing unified `CustomProvider`

## Open Questions

1. Should we also split the model discovery logic or keep it format-aware in each provider?
   - **Resolution**: Keep in each provider - discovery endpoints and response formats differ significantly
