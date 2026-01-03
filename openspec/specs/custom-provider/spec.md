# custom-provider Specification

## Purpose
TBD - created by archiving change add-custom-provider. Update Purpose after archive.
## Requirements
### Requirement: Custom Provider Configuration
The system SHALL allow users to configure custom model providers by specifying a provider name, base URL, API format, and authentication token.

#### Scenario: User adds a new custom provider via Add Models menu
- **WHEN** user clicks "Add Models" button and selects "Customize"
- **THEN** the system SHALL display a multi-step configuration wizard

#### Scenario: User completes custom provider configuration
- **WHEN** user provides valid provider name, base URL, API format selection, and API token
- **THEN** the system SHALL store the configuration persistently
- **AND** the system SHALL register the custom provider with VS Code's language model API

#### Scenario: User enters invalid base URL
- **WHEN** user enters a malformed URL in the base URL field
- **THEN** the system SHALL display a validation error
- **AND** the system SHALL prevent progression to the next step

### Requirement: API Format Selection
The system SHALL support multiple API formats for custom providers: OpenAI Chat Completions, OpenAI Responses API, Gemini, and Claude.

#### Scenario: User selects API format
- **WHEN** user reaches the API format selection step
- **THEN** the system SHALL display a list with options: "OpenAI Chat Completions", "OpenAI Responses API", "Gemini", "Claude"
- **AND** user SHALL be able to select exactly one format

#### Scenario: System uses selected format for requests
- **WHEN** a model from a custom provider is used for chat
- **THEN** the system SHALL format requests according to the selected API format
- **AND** the system SHALL parse responses according to the selected API format

### Requirement: Custom Provider Model Discovery
The system SHALL automatically discover available models from custom provider endpoints after configuration.

#### Scenario: Successful model discovery
- **WHEN** custom provider configuration is saved
- **AND** the provider endpoint supports model listing
- **THEN** the system SHALL fetch the list of available models
- **AND** the system SHALL display these models in the model selection UI

#### Scenario: Model discovery fails
- **WHEN** the provider endpoint does not support model listing or returns an error
- **THEN** the system SHALL allow the user to manually specify model IDs
- **AND** the system SHALL log the discovery failure for debugging

### Requirement: Custom Provider Management
The system SHALL allow users to view, edit, and delete existing custom provider configurations.

#### Scenario: User views existing custom providers
- **WHEN** user selects "Customize" from Add Models menu with existing custom providers
- **THEN** the system SHALL display a list of configured custom providers
- **AND** the system SHALL provide options to add new, edit existing, or delete providers

#### Scenario: User deletes a custom provider
- **WHEN** user selects delete action for a custom provider
- **THEN** the system SHALL remove the provider configuration
- **AND** the system SHALL remove the associated API key from secure storage
- **AND** the system SHALL unregister the provider's models from VS Code

### Requirement: Custom Provider Persistence
The system SHALL persist custom provider configurations across VS Code sessions.

#### Scenario: Custom providers available after restart
- **WHEN** VS Code restarts
- **AND** custom providers were previously configured
- **THEN** the system SHALL automatically register all saved custom providers
- **AND** the system SHALL make their models available for selection

