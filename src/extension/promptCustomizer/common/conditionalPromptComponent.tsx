/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Component IDs for built-in prompt components.
 * These IDs must match the IDs defined in builtInComponents.ts
 */
export const PromptComponentId = {
	// Identity & Safety
	CopilotIdentityRules: 'copilotIdentityRules',
	SafetyRules: 'safetyRules',

	// Context & Environment
	EnvironmentInfo: 'environmentInfo',
	WorkspaceInfo: 'workspaceInfo',
	CurrentContext: 'currentContext',
	ReminderInstructions: 'reminderInstructions',

	// Core Instructions (from DefaultAgentPrompt)
	CoreInstructions: 'coreInstructions',
	ToolUseInstructions: 'toolUseInstructions',
	EditFileInstructions: 'editFileInstructions',

	// Tools
	NotebookInstructions: 'notebookInstructions',
	ApplyPatchInstructions: 'applyPatchInstructions',
	McpToolInstructions: 'mcpToolInstructions',
	GenericEditingTips: 'genericEditingTips',

	// Formatting
	FileLinkification: 'fileLinkification',
	OutputFormatting: 'outputFormatting',
	MathIntegrationRules: 'mathIntegrationRules',
	CodeBlockFormattingRules: 'codeBlockFormattingRules',

	// Workflow
	StructuredWorkflow: 'structuredWorkflow',
	CommunicationGuidelines: 'communicationGuidelines',
	CodesearchModeInstructions: 'codesearchModeInstructions',
} as const;

export type PromptComponentIdType = typeof PromptComponentId[keyof typeof PromptComponentId];

