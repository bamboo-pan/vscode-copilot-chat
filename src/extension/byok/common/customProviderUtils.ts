/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChatInformation } from 'vscode';
import { BYOKKnownModels } from './byokProvider';
import { APIFormat, CustomProviderConfig } from './customProviderTypes';

/**
 * Check if a model ID matches the expected API format.
 * Only native format matches are supported:
 * - OpenAI formats (openai-chat, openai-responses) → OpenAI models
 * - Gemini format → Gemini models (excluding those with 'claude' in name)
 * - Claude format → Claude models
 *
 * Note: Some model names may contain multiple provider keywords (e.g., 'gemini-claude-*').
 * The priority is: Claude > Gemini > OpenAI (Claude is most specific)
 *
 * Special cases:
 * - Models with 'oss' in name are treated as Gemini models (Google OSS models)
 */
export function isModelMatchingAPIFormat(modelId: string, apiFormat: APIFormat): boolean {
	const lowerModelId = modelId.toLowerCase();

	// Check for provider keywords
	const hasClaude = lowerModelId.includes('claude');
	const hasGemini = lowerModelId.includes('gemini');
	const hasOss = lowerModelId.includes('oss');  // Google OSS models use Gemini format
	const hasOpenAI = (
		lowerModelId.startsWith('gpt-') ||
		lowerModelId.startsWith('o1') ||
		lowerModelId.startsWith('o3') ||
		lowerModelId.startsWith('o4') ||
		lowerModelId.startsWith('chatgpt-') ||
		lowerModelId.startsWith('text-') ||
		lowerModelId.includes('openai')
	) && !hasOss;  // Exclude OSS models from OpenAI

	switch (apiFormat) {
		case 'openai-chat':
		case 'openai-responses':
			// OpenAI models: must have OpenAI keywords and NOT have Claude, Gemini, or OSS
			return hasOpenAI && !hasClaude && !hasGemini && !hasOss;

		case 'gemini':
			// Gemini models: must have 'gemini' or 'oss' but NOT 'claude'
			// Models like 'gemini-claude-*' are actually Claude models proxied through Gemini
			// Models with 'oss' (like gpt-oss-*) are Google OSS models using Gemini format
			return (hasGemini || hasOss) && !hasClaude;

		case 'claude':
			// Claude models: must have 'claude' (regardless of other keywords)
			// This includes 'gemini-claude-*' which are Claude models
			return hasClaude;

		default:
			return true;
	}
}

/**
 * Filter models by API format, keeping only native format matches
 */
export function filterModelsByAPIFormat(models: BYOKKnownModels, apiFormat: APIFormat): BYOKKnownModels {
	const filtered: BYOKKnownModels = {};
	for (const [modelId, capabilities] of Object.entries(models)) {
		if (isModelMatchingAPIFormat(modelId, apiFormat)) {
			filtered[modelId] = capabilities;
		}
	}
	return filtered;
}

/**
 * Detect if a model supports vision/image input based on API response and model name
 */
export function detectVisionCapability(model: Record<string, unknown>, modelId: string): boolean {
	// Check explicit capability flags in API response
	const capabilities = model.capabilities as Record<string, unknown> | undefined;
	if (capabilities?.vision === true) {
		return true;
	}
	// Check for vision in supported modalities (Gemini format)
	const supportedInputTypes = model.supported_input_types as string[] | undefined;
	if (Array.isArray(supportedInputTypes) && supportedInputTypes.includes('image')) {
		return true;
	}
	// Check inputTokenLimit with image support (some APIs)
	const inputModalities = model.input_modalities as string[] | undefined;
	if (inputModalities?.includes('image') || inputModalities?.includes('IMAGE')) {
		return true;
	}

	// Heuristic: check model name for vision-related keywords
	const lowerModelId = modelId.toLowerCase();
	const lowerName = ((model.name as string | undefined) || '').toLowerCase();

	// Models known to support vision
	const visionPatterns = [
		'vision', 'image', 'multimodal',
		'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
		'claude-3', 'claude-sonnet', 'claude-opus', 'claude-haiku',
		'gemini-pro', 'gemini-1.5', 'gemini-2', 'gemini-flash', 'gemini-ultra',
		'llava', 'cogvlm', 'qwen-vl', 'yi-vl', 'gemini'
	];

	for (const pattern of visionPatterns) {
		if (lowerModelId.includes(pattern) || lowerName.includes(pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Detect if a model supports tool/function calling
 */
export function detectToolCallingCapability(model: Record<string, unknown>, modelId: string): boolean {
	// Check explicit capability flags
	const capabilities = model.capabilities as Record<string, unknown> | undefined;
	if (capabilities?.function_calling === true || capabilities?.tools === true) {
		return true;
	}

	// Heuristic: most modern LLMs support tool calling
	const lowerModelId = modelId.toLowerCase();

	// Models known to NOT support tool calling
	const noToolPatterns = ['embed', 'embedding', 'whisper', 'tts', 'dall-e', 'stable-diffusion'];
	for (const pattern of noToolPatterns) {
		if (lowerModelId.includes(pattern)) {
			return false;
		}
	}

	// Default to true for chat models
	return true;
}

/**
 * Detect if a model supports thinking/reasoning mode
 */
export function detectThinkingCapability(model: Record<string, unknown>, modelId: string): boolean {
	// Check explicit capability flags
	const capabilities = model.capabilities as Record<string, unknown> | undefined;
	if (capabilities?.thinking === true || capabilities?.reasoning === true) {
		return true;
	}

	// Heuristic: check model name
	const lowerModelId = modelId.toLowerCase();
	const thinkingPatterns = ['thinking', 'reasoning', 'o1', 'o3', 'deepseek-r1', 'gemini'];

	for (const pattern of thinkingPatterns) {
		if (lowerModelId.includes(pattern)) {
			return true;
		}
	}

	return false;
}

/**
 * Convert models to API info with provider name prefix for disambiguation
 */
export function modelsToAPIInfo(
	models: BYOKKnownModels,
	config: CustomProviderConfig,
	providerId: string
): LanguageModelChatInformation[] {
	return Object.entries(models).map(([id, capabilities]) => {
		// Add provider name prefix to distinguish models from different providers
		const displayName = `[${config.name}] ${capabilities.name}`;
		return {
			id,
			name: displayName,
			version: '1.0.0',
			maxOutputTokens: capabilities.maxOutputTokens,
			maxInputTokens: capabilities.maxInputTokens,
			detail: config.name,
			family: providerId,
			tooltip: `${capabilities.name} via ${config.name} (${config.apiFormat})`,
			capabilities: {
				toolCalling: capabilities.toolCalling,
				imageInput: capabilities.vision
			},
		} satisfies LanguageModelChatInformation;
	});
}
