/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as readline from 'readline';
import { CancellationToken, Event, EventEmitter, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Response as FetchResponse, IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { LanguageModelChatMessageRole, LanguageModelDataPart, LanguageModelToolResultPart, LanguageModelToolResultPart2, LanguageModelTextPart as VSCodeTextPart, LanguageModelToolCallPart as VSCodeToolCallPart } from '../../../vscodeTypes';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';
import { apiMessageToAnthropicMessage } from '../common/anthropicMessageConverter';
import { BYOKAuthType, BYOKKnownModels, BYOKModelProvider, resolveModelInfo } from '../common/byokProvider';
import { APIFormat, CustomProviderConfig } from '../common/customProviderTypes';
import { apiMessageToGeminiMessage } from '../common/geminiMessageConverter';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { IBYOKStorageService } from './byokStorageService';
import { promptForAPIKey } from './byokUIService';

/**
 * Custom provider implementation that supports OpenAI-compatible endpoints.
 * This provider works with any endpoint that implements the OpenAI chat completions API,
 * including custom deployments of various models (OpenAI, Gemini, Claude, etc.) that
 * expose an OpenAI-compatible interface.
 */
export class CustomProvider implements BYOKModelProvider<LanguageModelChatInformation> {
	public readonly authType: BYOKAuthType = BYOKAuthType.GlobalApiKey;
	private _apiKey: string | undefined;
	private readonly _lmWrapper: CopilotLanguageModelWrapper;
	private _cachedModels: BYOKKnownModels | undefined;

	private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation: Event<void> = this._onDidChangeLanguageModelChatInformation.event;

	constructor(
		public readonly providerId: string,
		private readonly _config: CustomProviderConfig,
		private readonly _byokStorageService: IBYOKStorageService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		this._lmWrapper = this._instantiationService.createInstance(CopilotLanguageModelWrapper);
		this._logService.info(`CustomProvider: Created provider '${this._config.name}' (${providerId})`);
	}

	/**
	 * Notify VS Code that the model list has changed
	 */
	fireModelChange(): void {
		this._logService.info(`CustomProvider: Firing model change event for '${this._config.name}'`);
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	get providerName(): string {
		return this._config.name;
	}

	get apiFormat(): APIFormat {
		return this._config.apiFormat;
	}

	get baseUrl(): string {
		return this._config.baseUrl;
	}

	/**
	 * Fetch available models from the custom provider endpoint.
	 * Uses OpenAI-compatible /models endpoint format.
	 */
	private async _fetchModels(apiKey: string): Promise<BYOKKnownModels> {
		const models: BYOKKnownModels = {};

		try {
			// Build the models endpoint URL
			let modelsUrl = this._config.baseUrl.replace(/\/$/, '');

			// Handle different API format endpoints
			if (this._config.apiFormat === 'gemini') {
				// Gemini REST API format
				modelsUrl = `${modelsUrl}/v1beta/models?key=${apiKey}`;
			} else if (this._config.apiFormat === 'claude') {
				// Anthropic API format - use /v1/models with x-api-key header
				modelsUrl = `${modelsUrl}/v1/models`;
			} else {
				// OpenAI-compatible format
				modelsUrl = `${modelsUrl}/v1/models`;
			}

			const headers: Record<string, string> = {
				'Content-Type': 'application/json'
			};

			// Set authorization header based on format
			if (this._config.apiFormat === 'claude') {
				headers['x-api-key'] = apiKey;
				headers['anthropic-version'] = '2023-06-01';
			} else if (this._config.apiFormat !== 'gemini') {
				// OpenAI format uses Bearer token
				headers['Authorization'] = `Bearer ${apiKey}`;
			}

			const response = await this._fetcherService.fetch(modelsUrl, {
				method: 'GET',
				headers
			});

			const data = await response.json();

			if (data.error) {
				throw new Error(data.error.message || JSON.stringify(data.error));
			}

			// Parse models - handle different response formats
			const modelList = data.data || data.models || [];
			for (const model of modelList) {
				const modelId = model.id || model.name?.replace('models/', '');
				if (!modelId) {
					continue;
				}

				// Detect vision capability from various API response formats
				const hasVision = this._detectVisionCapability(model, modelId);
				// Detect tool calling capability
				const hasToolCalling = this._detectToolCallingCapability(model, modelId);
				// Detect thinking/reasoning capability
				const hasThinking = this._detectThinkingCapability(model, modelId);

				models[modelId] = {
					name: model.display_name || model.displayName || model.name || modelId,
					maxInputTokens: model.context_length || model.inputTokenLimit || 128000,
					maxOutputTokens: model.max_output_tokens || model.outputTokenLimit || 16000,
					toolCalling: hasToolCalling,
					vision: hasVision,
					thinking: hasThinking
				};
			}

			this._logService.info(`CustomProvider: Fetched ${Object.keys(models).length} models from ${this._config.name}`);
		} catch (error) {
			this._logService.error(`CustomProvider: Error fetching models from ${this._config.name}:`, error);
			throw error;
		}

		// Cache the models for use in response handling
		this._cachedModels = models;
		return models;
	}

	/**
	 * Detect if a model supports vision/image input based on API response and model name
	 */
	private _detectVisionCapability(model: any, modelId: string): boolean {
		// Check explicit capability flags in API response
		if (model.capabilities?.vision === true) {
			return true;
		}
		if (model.supported_generation_methods?.includes('generateContent')) {
			// Gemini models with generateContent typically support vision
		}
		// Check for vision in supported modalities (Gemini format)
		if (Array.isArray(model.supported_input_types) && model.supported_input_types.includes('image')) {
			return true;
		}
		// Check inputTokenLimit with image support (some APIs)
		if (model.input_modalities?.includes('image') || model.input_modalities?.includes('IMAGE')) {
			return true;
		}

		// Heuristic: check model name for vision-related keywords
		const lowerModelId = modelId.toLowerCase();
		const lowerName = (model.name || '').toLowerCase();

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
	private _detectToolCallingCapability(model: any, modelId: string): boolean {
		// Check explicit capability flags
		if (model.capabilities?.function_calling === true || model.capabilities?.tools === true) {
			return true;
		}
		if (model.supported_generation_methods?.includes('generateContent')) {
			// Most modern Gemini models support function calling
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
	private _detectThinkingCapability(model: any, modelId: string): boolean {
		// Check explicit capability flags
		if (model.capabilities?.thinking === true || model.capabilities?.reasoning === true) {
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

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: CancellationToken): Promise<LanguageModelChatInformation[]> {
		if (!this._apiKey) {
			this._apiKey = await this._byokStorageService.getAPIKey(this.providerId);
		}

		try {
			if (this._apiKey) {
				const models = await this._fetchModels(this._apiKey);
				return this._modelsToAPIInfo(models);
			} else if (options.silent) {
				return [];
			} else {
				await this.updateAPIKey();
				if (this._apiKey) {
					const models = await this._fetchModels(this._apiKey);
					return this._modelsToAPIInfo(models);
				}
				return [];
			}
		} catch (error) {
			if (!options.silent && error instanceof Error && error.message.toLowerCase().includes('key')) {
				await this.updateAPIKey();
				return this.provideLanguageModelChatInformation({ silent: true }, token);
			}
			this._logService.error(`CustomProvider: Error fetching models for ${this._config.name}:`, error);
			return [];
		}
	}

	/**
	 * Convert models to API info with provider name prefix for disambiguation
	 */
	private _modelsToAPIInfo(models: BYOKKnownModels): LanguageModelChatInformation[] {
		return Object.entries(models).map(([id, capabilities]) => {
			// Add provider name prefix to distinguish models from different providers
			const displayName = `[${this._config.name}] ${capabilities.name}`;
			return {
				id,
				name: displayName,
				version: '1.0.0',
				maxOutputTokens: capabilities.maxOutputTokens,
				maxInputTokens: capabilities.maxInputTokens,
				detail: this._config.name,
				family: this.providerId,
				tooltip: `${capabilities.name} via ${this._config.name} (${this._config.apiFormat})`,
				capabilities: {
					toolCalling: capabilities.toolCalling,
					imageInput: capabilities.vision
				},
			} satisfies LanguageModelChatInformation;
		});
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		if (!this._apiKey) {
			throw new Error('API key not configured');
		}

		// Route to appropriate handler based on API format
		switch (this._config.apiFormat) {
			case 'gemini':
				return this._handleGeminiRequest(model, messages, options, progress, token);
			case 'claude':
				return this._handleClaudeRequest(model, messages, options, progress, token);
			case 'openai-responses':
				return this._handleOpenAIResponsesRequest(model, messages, options, progress, token);
			case 'openai-chat':
			default:
				return this._handleOpenAIRequest(model, messages, options, progress, token);
		}
	}

	/**
	 * Handle requests using native Gemini API format
	 */
	private async _handleGeminiRequest(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const baseUrl = this._config.baseUrl.replace(/\/$/, '');
		const modelId = model.id.startsWith('models/') ? model.id : `models/${model.id}`;
		const url = `${baseUrl}/v1beta/${modelId}:streamGenerateContent?key=${this._apiKey}&alt=sse`;

		// Convert messages to Gemini format using the official converter
		const { contents, systemInstruction } = apiMessageToGeminiMessage(messages as LanguageModelChatMessage[]);

		// Build tools array if provided - strip $schema and other unsupported properties
		const tools = options.tools?.length ? [{
			functionDeclarations: options.tools.map(tool => ({
				name: tool.name,
				description: tool.description || '',
				parameters: this._cleanSchemaForGemini(tool.inputSchema || { type: 'object', properties: {} })
			}))
		}] : undefined;

		// Check if this model supports thinking
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? this._detectThinkingCapability({}, model.id);

		const requestBody: any = {
			contents,
			generationConfig: {
				maxOutputTokens: model.maxOutputTokens,
				// Enable thinking mode if supported
				...(hasThinking && { thinkingConfig: { thinkingBudget: 8192 } })
			}
		};

		if (systemInstruction) {
			// systemInstruction from apiMessageToGeminiMessage is already a Content object
			requestBody.systemInstruction = systemInstruction;
		}
		if (tools) {
			requestBody.tools = tools;
		}

		const abortController = new AbortController();
		token.onCancellationRequested(() => abortController.abort());

		try {
			const response = await this._fetcherService.fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `Gemini API error: ${response.status}`);
			}

			await this._processGeminiStream(response, progress, token);
		} catch (error) {
			if ((error as any)?.name === 'AbortError') {
				return;
			}
			throw error;
		}
	}

	/**
	 * Clean JSON Schema for Gemini API - remove unsupported properties
	 */
	private _cleanSchemaForGemini(schema: any): any {
		if (!schema || typeof schema !== 'object') {
			return schema;
		}

		// Properties that Gemini doesn't support
		const unsupportedProps = [
			'$schema', 'additionalProperties', '$id', '$ref', '$defs', 'definitions',
			'cache_control', 'mimeType' // VS Code might inject these
		];

		const cleaned: any = {};
		for (const [key, value] of Object.entries(schema)) {
			if (unsupportedProps.includes(key)) {
				continue;
			}
			if (key === 'properties' && typeof value === 'object') {
				// Recursively clean nested properties
				cleaned[key] = {};
				for (const [propName, propValue] of Object.entries(value as object)) {
					cleaned[key][propName] = this._cleanSchemaForGemini(propValue);
				}
			} else if (key === 'items' && typeof value === 'object') {
				// Clean array items schema
				cleaned[key] = this._cleanSchemaForGemini(value);
			} else if (Array.isArray(value)) {
				cleaned[key] = value.map(item =>
					typeof item === 'object' ? this._cleanSchemaForGemini(item) : item
				);
			} else {
				cleaned[key] = value;
			}
		}
		return cleaned;
	}

	/**
	 * Handle requests using OpenAI Responses API format
	 */
	private async _handleOpenAIResponsesRequest(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const baseUrl = this._config.baseUrl.replace(/\/$/, '');
		const url = `${baseUrl}/v1/responses`;

		// Check if this model supports thinking/reasoning
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? this._detectThinkingCapability({}, model.id);

		// Convert messages to OpenAI Responses format (uses 'input' instead of 'messages')
		const input: any[] = [];
		let systemPrompt: string | undefined;

		for (const message of messages as LanguageModelChatMessage[]) {
			if (message.role === LanguageModelChatMessageRole.System) {
				// System message
				const textParts = message.content
					.filter((p): p is VSCodeTextPart => p instanceof VSCodeTextPart)
					.map(p => p.value);
				systemPrompt = textParts.join('\n');
			} else {
				const role = message.role === LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
				const content: any[] = [];

				for (const part of message.content) {
					if (part instanceof VSCodeToolCallPart) {
						// Tool calls in Responses API format
						input.push({
							type: 'function_call',
							id: part.callId,
							name: part.name,
							arguments: JSON.stringify(part.input || {})
						});
					} else if (part instanceof LanguageModelToolResultPart || part instanceof LanguageModelToolResultPart2) {
						// Tool result in Responses API format
						const textContent = part.content
							.filter((p): p is VSCodeTextPart => p instanceof VSCodeTextPart)
							.map(p => p.value)
							.join('');
						input.push({
							type: 'function_call_output',
							call_id: part.callId,
							output: textContent
						});
					} else if (part instanceof VSCodeTextPart) {
						// Text part
						if (part.value) {
							content.push({ type: 'input_text', text: part.value });
						}
					} else if (part instanceof LanguageModelDataPart) {
						// Image data - OpenAI Responses format uses url or base64
						content.push({
							type: 'image_url',
							image_url: {
								url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
							}
						});
					}
				}

				if (content.length > 0) {
					input.push({ role, content });
				}
			}
		}

		// Build tools array if provided
		const tools = options.tools?.map(tool => ({
			type: 'function',
			name: tool.name,
			description: tool.description || '',
			parameters: tool.inputSchema || { type: 'object', properties: {} }
		}));

		const requestBody: any = {
			model: model.id,
			input,
			stream: true
		};

		if (systemPrompt) {
			requestBody.instructions = systemPrompt;
		}
		if (tools?.length) {
			requestBody.tools = tools;
		}

		// Enable reasoning for models that support it (o1, o3, etc.)
		if (hasThinking) {
			requestBody.reasoning = {
				effort: 'medium',
				summary: 'auto'
			};
		}

		const abortController = new AbortController();
		token.onCancellationRequested(() => abortController.abort());

		try {
			const response = await this._fetcherService.fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this._apiKey}`
				},
				body: JSON.stringify(requestBody),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `OpenAI Responses API error: ${response.status}`);
			}

			await this._processOpenAIResponsesStream(response, progress, token);
		} catch (error) {
			if ((error as any)?.name === 'AbortError') {
				return;
			}
			throw error;
		}
	}

	/**
	 * Process OpenAI Responses API SSE stream
	 */
	private async _processOpenAIResponsesStream(
		response: FetchResponse,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const responseBody = await response.body();
		if (!responseBody) {
			throw new Error('No response body');
		}

		const rl = readline.createInterface({
			input: responseBody as NodeJS.ReadableStream,
			crlfDelay: Infinity
		});

		let pendingToolCalls: Map<string, { name: string; arguments: string }> = new Map();

		return new Promise<void>((resolve, reject) => {
			token.onCancellationRequested(() => {
				rl.close();
				resolve();
			});

			rl.on('line', (line: string) => {
				if (token.isCancellationRequested) {
					return;
				}

				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						rl.close();
						return;
					}

					try {
						const event = JSON.parse(data);

						// Handle different event types in Responses API
						if (event.type === 'response.output_item.added') {
							// New output item (text, function_call, etc.)
							if (event.item?.type === 'function_call') {
								pendingToolCalls.set(event.item.id, {
									name: event.item.name || '',
									arguments: ''
								});
							}
						} else if (event.type === 'response.output_text.delta') {
							// Text delta - the main text streaming event
							if (event.delta) {
								progress.report(new LanguageModelTextPart(event.delta));
							}
						} else if (event.type === 'response.reasoning_summary_text.delta') {
							// Reasoning/thinking delta
							if (event.delta) {
								progress.report(new LanguageModelThinkingPart(event.delta));
							}
						} else if (event.type === 'response.function_call_arguments.delta') {
							// Function call arguments delta
							const toolCall = pendingToolCalls.get(event.item_id);
							if (toolCall) {
								toolCall.arguments += event.delta || '';
							}
						} else if (event.type === 'response.function_call_arguments.done') {
							// Function call complete - has 'name' and 'arguments' fields
							const toolCall = pendingToolCalls.get(event.item_id);
							try {
								const argsStr = toolCall?.arguments || event.arguments || '{}';
								const args = JSON.parse(argsStr);
								progress.report(new LanguageModelToolCallPart(
									event.item_id,
									event.name || toolCall?.name || 'function',
									args
								));
							} catch {
								// Invalid JSON
							}
							if (toolCall) {
								pendingToolCalls.delete(event.item_id);
							}
						} else if (event.type === 'response.content_part.delta' && event.delta?.type === 'text_delta') {
							// Alternative text delta format
							progress.report(new LanguageModelTextPart(event.delta.text || ''));
						} else if (event.type === 'response.completed') {
							// Response completed - extract final text if we haven't streamed any
							rl.close();
						} else if (event.type === 'response.failed') {
							// Response failed
							const errorMsg = event.response?.error?.message || 'Request failed';
							rl.close();
							reject(new Error(errorMsg));
							return;
						}
					} catch {
						// Skip invalid JSON
					}
				}
			});

			rl.on('close', () => resolve());
			rl.on('error', (err) => reject(err));
		});
	}

	/**
	 * Process Gemini SSE stream
	 */
	private async _processGeminiStream(
		response: FetchResponse,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const responseBody = await response.body();
		if (!responseBody) {
			throw new Error('No response body');
		}

		const rl = readline.createInterface({
			input: responseBody as NodeJS.ReadableStream,
			crlfDelay: Infinity
		});

		return new Promise<void>((resolve, reject) => {
			token.onCancellationRequested(() => {
				rl.close();
				resolve();
			});

			rl.on('line', (line: string) => {
				if (token.isCancellationRequested) {
					return;
				}

				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						rl.close();
						return;
					}

					try {
						const chunk = JSON.parse(data);
						if (chunk.candidates?.[0]?.content?.parts) {
							for (const part of chunk.candidates[0].content.parts) {
								if ('thought' in part && part.thought === true && part.text) {
									progress.report(new LanguageModelThinkingPart(part.text));
								} else if (part.text) {
									progress.report(new LanguageModelTextPart(part.text));
								} else if (part.functionCall) {
									const callId = `${part.functionCall.name}_${Date.now()}`;
									progress.report(new LanguageModelToolCallPart(
										callId,
										part.functionCall.name,
										part.functionCall.args || {}
									));
								}
							}
						}
					} catch {
						// Skip invalid JSON
					}
				}
			});

			rl.on('close', () => resolve());
			rl.on('error', (err) => reject(err));
		});
	}

	/**
	 * Handle requests using native Claude/Anthropic API format
	 */
	private async _handleClaudeRequest(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const baseUrl = this._config.baseUrl.replace(/\/$/, '');
		const url = `${baseUrl}/v1/messages`;

		// Convert messages to Claude format using the official converter
		const { messages: convertedMessages, system } = apiMessageToAnthropicMessage(messages as LanguageModelChatMessage[]);

		// Check if this model supports thinking
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? this._detectThinkingCapability({}, model.id);

		// Build tools array if provided
		const tools = options.tools?.map(tool => ({
			name: tool.name,
			description: tool.description || '',
			input_schema: tool.inputSchema || { type: 'object', properties: {} }
		}));

		const requestBody: any = {
			model: model.id,
			messages: convertedMessages,
			max_tokens: model.maxOutputTokens,
			stream: true
		};

		if (system && system.text) {
			requestBody.system = system.text;
		}
		if (tools?.length) {
			requestBody.tools = tools;
		}

		// Enable extended thinking for Claude 3.5+ models that support it
		if (hasThinking) {
			requestBody.thinking = {
				type: 'enabled',
				budget_tokens: 8192
			};
		}

		const abortController = new AbortController();
		token.onCancellationRequested(() => abortController.abort());

		try {
			const response = await this._fetcherService.fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this._apiKey!,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify(requestBody),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
			}

			await this._processClaudeStream(response, progress, token);
		} catch (error) {
			if ((error as any)?.name === 'AbortError') {
				return;
			}
			throw error;
		}
	}

	/**
	 * Process Claude SSE stream
	 */
	private async _processClaudeStream(
		response: FetchResponse,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const responseBody = await response.body();
		if (!responseBody) {
			throw new Error('No response body');
		}

		const rl = readline.createInterface({
			input: responseBody as NodeJS.ReadableStream,
			crlfDelay: Infinity
		});

		let pendingToolCall: { id?: string; name?: string; input: string } | undefined;
		let pendingThinking: { text: string; signature?: string } | undefined;

		return new Promise<void>((resolve, reject) => {
			token.onCancellationRequested(() => {
				rl.close();
				resolve();
			});

			rl.on('line', (line: string) => {
				if (token.isCancellationRequested) {
					return;
				}

				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						rl.close();
						return;
					}

					try {
						const chunk = JSON.parse(data);

						if (chunk.type === 'content_block_start') {
							if (chunk.content_block?.type === 'tool_use') {
								pendingToolCall = {
									id: chunk.content_block.id,
									name: chunk.content_block.name,
									input: ''
								};
							} else if (chunk.content_block?.type === 'thinking') {
								pendingThinking = { text: '', signature: '' };
							}
						} else if (chunk.type === 'content_block_delta') {
							if (chunk.delta?.type === 'text_delta') {
								progress.report(new LanguageModelTextPart(chunk.delta.text || ''));
							} else if (chunk.delta?.type === 'thinking_delta' && pendingThinking) {
								pendingThinking.text += chunk.delta.thinking || '';
								progress.report(new LanguageModelThinkingPart(chunk.delta.thinking || ''));
							} else if (chunk.delta?.type === 'signature_delta' && pendingThinking) {
								pendingThinking.signature = (pendingThinking.signature || '') + (chunk.delta.signature || '');
							} else if (chunk.delta?.type === 'input_json_delta' && pendingToolCall) {
								pendingToolCall.input += chunk.delta.partial_json || '';
							}
						} else if (chunk.type === 'content_block_stop') {
							if (pendingToolCall) {
								try {
									const args = JSON.parse(pendingToolCall.input || '{}');
									progress.report(new LanguageModelToolCallPart(
										pendingToolCall.id!,
										pendingToolCall.name!,
										args
									));
								} catch {
									// Invalid JSON
								}
								pendingToolCall = undefined;
							}
							if (pendingThinking) {
								pendingThinking = undefined;
							}
						}
					} catch {
						// Skip invalid JSON
					}
				}
			});

			rl.on('close', () => resolve());
			rl.on('error', (err) => reject(err));
		});
	}

	/**
	 * Handle requests using OpenAI API format (chat completions or responses)
	 */
	private async _handleOpenAIRequest(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		// Get thinking capability from cached models
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? this._detectThinkingCapability({}, model.id);

		const modelInfo = await resolveModelInfo(model.id, this.providerId, undefined, {
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			toolCalling: !!model.capabilities?.toolCalling,
			vision: !!model.capabilities?.imageInput,
			thinking: hasThinking,
			name: model.name
		});

		// Build URL based on format
		const url = this._buildChatUrl();

		const openAIChatEndpoint = this._instantiationService.createInstance(
			OpenAIEndpoint,
			modelInfo,
			this._apiKey!,
			url
		);

		return this._lmWrapper.provideLanguageModelResponse(
			openAIChatEndpoint,
			messages,
			options,
			options.requestInitiator,
			progress,
			token
		);
	}

	/**
	 * Build the chat completions URL based on the configured API format
	 * Only used for OpenAI formats (openai-chat and openai-responses)
	 */
	private _buildChatUrl(): string {
		let url = this._config.baseUrl.replace(/\/$/, '');

		// Check if URL already has an explicit API path
		if (url.includes('/chat/completions') || url.includes('/responses')) {
			return url;
		}

		// Build URL based on API format
		switch (this._config.apiFormat) {
			case 'openai-responses':
				return `${url}/v1/responses`;
			case 'openai-chat':
			default:
				return `${url}/v1/chat/completions`;
		}
	}

	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage | LanguageModelChatMessage2,
		_token: CancellationToken
	): Promise<number> {
		// Get thinking capability from cached models
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? this._detectThinkingCapability({}, model.id);

		const modelInfo = await resolveModelInfo(model.id, this.providerId, undefined, {
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			toolCalling: !!model.capabilities?.toolCalling,
			vision: !!model.capabilities?.imageInput,
			thinking: hasThinking,
			name: model.name
		});

		const url = this._buildChatUrl();

		const openAIChatEndpoint = this._instantiationService.createInstance(
			OpenAIEndpoint,
			modelInfo,
			this._apiKey ?? '',
			url
		);

		return this._lmWrapper.provideTokenCount(openAIChatEndpoint, text);
	}

	async updateAPIKey(): Promise<void> {
		const newKey = await promptForAPIKey(this._config.name, !!this._apiKey);

		if (newKey === undefined) {
			// User cancelled
			return;
		}

		if (newKey === '') {
			// User wants to delete the key
			this._apiKey = undefined;
			await this._byokStorageService.deleteAPIKey(this.providerId, this.authType);
		} else {
			this._apiKey = newKey;
			await this._byokStorageService.storeAPIKey(this.providerId, newKey, this.authType);
		}
	}
}
