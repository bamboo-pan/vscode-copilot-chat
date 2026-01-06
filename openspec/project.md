# Project Context

## Purpose
The **GitHub Copilot Chat** extension for Visual Studio Code provides conversational AI assistance, a coding agent with many tools, inline editing capabilities, and advanced AI-powered features for VS Code. It aims to enhance developer productivity through natural language interaction, context-aware code generation, and intelligent workspace analysis.

## Tech Stack
- **TypeScript**: Primary language (follows VS Code coding standards)
- **TSX**: Prompts are built using the `@vscode/prompt-tsx` library
- **Node.js**: Runtime for extension host and language server features
- **WebAssembly**: For performance-critical parsing and tokenization
- **VS Code Extension API**: Extensive use of proposed APIs for chat, language models, and editing
- **ESBuild**: Bundling and compilation
- **Vitest**: Unit testing framework
- **Python**: For notebooks integration and ML evaluation scripts

## Project Conventions

### Code Style
- **Indentation**: Use **tabs**, not spaces.
- **Naming**:
  - `PascalCase` for types and enum values.
  - `camelCase` for functions, methods, properties, and local variables.
  - Descriptive, whole words in names.
- **Strings**:
  - "double quotes" for user-visible strings (localization).
  - 'single quotes' for internal strings.
- **Functions**: Arrow functions `=>` preferred over anonymous function expressions.
- **Conditionals**: Always use curly braces; opening brace on the same line.

### Architecture Patterns
- **Service-oriented**: Heavy use of dependency injection via `IInstantiationService`.
- **Contribution-based**: Modular system where features register themselves.
- **Event-driven**: Extensive use of VS Code's event system and disposables.
- **Layered**: Clear separation between platform services (`src/platform/`) and extension features (`src/extension/`).

### Testing Strategy
- **Unit Tests**: Vitest for isolated component testing (`npm run test:unit`).
- **Integration Tests**: VS Code extension host tests for API integration (`npm run test:extension`).
- **Simulation Tests**: End-to-end scenario testing (`npm run simulate`).
- **Validation**: Always check `start-watch-tasks` output for compilation errors.

### Git Workflow
- Standard GitHub flow.
- Feature branches.
- Pull Requests for review.

## Domain Context
- **VS Code Extension Development**: Deep understanding of VS Code APIs, contribution points, and extension lifecycle.
- **AI/LLM Integration**: Working with chat participants, prompt engineering, context resolution, and model interactions.
- **Workspace Analysis**: Semantic search, file system operations, and code parsing.

## Important Constraints
- **Performance**: Critical for inline chat and completions. Use WebAssembly for heavy parsing.
- **Security**: Handle authentication tokens securely. Follow Microsoft content policies.
- **Compatibility**: Must support specified VS Code versions.

## External Dependencies
- **GitHub API**: For authentication and repository access.
- **OpenAI/Anthropic APIs**: For language model inference.
- **Azure**: For cloud services and experimentation.
