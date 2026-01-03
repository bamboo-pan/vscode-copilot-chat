/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Supported API formats for custom providers
 */
export type APIFormat = 'openai-chat' | 'openai-responses' | 'gemini' | 'claude';

/**
 * Display names for API formats shown in the UI
 */
export const APIFormatLabels: Record<APIFormat, string> = {
	'openai-chat': 'OpenAI Chat Completions',
	'openai-responses': 'OpenAI Responses API',
	'gemini': 'Google Gemini',
	'claude': 'Anthropic Claude'
};

/**
 * Configuration for a custom provider stored in VS Code settings
 */
export interface CustomProviderConfig {
	/** Display name of the provider */
	name: string;
	/** Base URL for the provider's API */
	baseUrl: string;
	/** The API format used by this provider */
	apiFormat: APIFormat;
}

/**
 * Model information discovered from a custom provider
 */
export interface CustomProviderModelInfo {
	id: string;
	name: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
}

/**
 * Validates if a string is a valid API format
 */
export function isValidAPIFormat(format: string): format is APIFormat {
	return ['openai-chat', 'openai-responses', 'gemini', 'claude'].includes(format);
}

/**
 * Generates a unique provider ID from the provider name
 */
export function generateProviderId(name: string): string {
	return `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
