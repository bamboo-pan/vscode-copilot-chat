# Design: Custom Provider Support

## Context

The BYOK (Bring Your Own Key) system currently supports a fixed set of providers, each implemented as a separate class (`AnthropicLMProvider`, `GeminiNativeBYOKLMProvider`, `OpenRouterLMProvider`, etc.). Users cannot add providers that aren't in this predefined list.

**Stakeholders**: Users with self-hosted model services, enterprise users with custom model gateways

**Constraints**:
- Must integrate with existing VS Code `lm.registerLanguageModelChatProvider` API
- Must support multiple API formats (OpenAI, Gemini, Claude)
- Must persist configuration across sessions
- Must handle API key storage securely

## Goals / Non-Goals

**Goals**:
- Allow users to add custom providers with arbitrary URLs
- Support OpenAI (Chat Completions & Responses API), Gemini, and Claude API formats
- Auto-discover available models from the custom endpoint
- Seamless integration with existing model selection UI

**Non-Goals**:
- Support for non-standard/proprietary API formats (only the 4 formats above)
- Advanced configuration (rate limiting, retry policies, etc.) - can be added later
- Provider-to-provider model migration

## Decisions

### Decision 1: API Format Abstraction

**What**: Create a format-agnostic `CustomProvider` that delegates to format-specific endpoint implementations.

**Why**: Reuses existing battle-tested code (`OpenAIEndpoint`, Anthropic SDK, Gemini SDK) rather than reimplementing protocol handling.

**Implementation**:
```
CustomProvider
  ├─ OpenAI Chat Completions → OpenAIEndpoint (existing)
  ├─ OpenAI Responses API → OpenAIEndpoint with responses path
  ├─ Gemini → GeminiEndpoint (new, adapted from GeminiNativeBYOKLMProvider)
  └─ Claude → AnthropicEndpoint (new, adapted from AnthropicLMProvider)
```

**Alternatives considered**:
- Single unified endpoint handling all formats: Rejected due to complexity and maintenance burden
- Separate provider classes per format: Rejected as it duplicates configuration/storage logic

### Decision 2: Configuration Storage

**What**: Store custom provider configs in VS Code settings (`github.copilot.chat.customProviders`) with API keys in secure storage.

**Why**:
- Settings are portable and can be synced
- API keys in secure storage follow existing BYOK pattern
- Separates sensitive (keys) from non-sensitive (URLs, format) data

**Schema**:
```typescript
interface CustomProviderConfig {
  name: string;           // Display name
  baseUrl: string;        // API endpoint base URL
  apiFormat: 'openai-chat' | 'openai-responses' | 'gemini' | 'claude';
  // API key stored separately in IBYOKStorageService
}
```

### Decision 3: Model Discovery

**What**: Fetch models from provider's `/models` endpoint (or equivalent) after configuration.

**Why**: Allows users to select from actually available models rather than guessing model IDs.

**Fallback**: If model discovery fails, allow manual model ID entry.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Custom endpoint may not implement `/models` | Provide manual model entry fallback |
| API format mismatch causes cryptic errors | Validate format with test request during setup |
| URL validation may reject valid endpoints | Use permissive validation, warn but don't block |
| Multiple custom providers with same name | Enforce unique names at configuration time |

## Open Questions

1. **Should we support custom headers?** - Some gateways require additional headers (e.g., `x-api-version`). Consider adding optional `requestHeaders` field.

2. **Rate limiting / retry configuration?** - Defer to future enhancement.

3. **Model capability detection?** - For now, assume all models support tools/vision; refine based on user feedback.
