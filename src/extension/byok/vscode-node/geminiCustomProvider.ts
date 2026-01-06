/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as readline from 'readline';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Response as FetchResponse, IFetcherService } from '../../../platform/networking/common/fetcherService';
import { BYOKKnownModels } from '../common/byokProvider';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { detectThinkingCapability } from '../common/customProviderUtils';
import { apiMessageToGeminiMessage } from '../common/geminiMessageConverter';
import { BaseCustomProvider } from './baseCustomProvider';
import { IBYOKStorageService } from './byokStorageService';

/**
 * Custom provider for Google Gemini API format.
 * Uses the /v1beta/models endpoint with URL parameter authentication.
 */
export class GeminiCustomProvider extends BaseCustomProvider {
	constructor(
		providerId: string,
		config: CustomProviderConfig,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService
	) {
		super(providerId, config, byokStorageService, fetcherService, logService);
	}

	/**
	 * Fetch available models from the Gemini /v1beta/models endpoint.
	 */
	protected async _fetchModels(apiKey: string): Promise<BYOKKnownModels> {
		const models: BYOKKnownModels = {};

		try {
			const modelsUrl = `${this._config.baseUrl.replace(/\/$/, '')}/v1beta/models?key=${apiKey}`;

			const response = await this._fetcherService.fetch(modelsUrl, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			const data = await response.json();

			if (data.error) {
				throw new Error(data.error.message || JSON.stringify(data.error));
			}

			const modelList = data.models || [];
			for (const model of modelList) {
				const modelId = model.name?.replace('models/', '') || model.id;
				if (!modelId) {
					continue;
				}

				models[modelId] = this._parseModelCapabilities(model, modelId);
			}

			this._logService.info(`GeminiCustomProvider: Fetched ${Object.keys(models).length} models from ${this._config.name}`);
		} catch (error) {
			this._logService.error(`GeminiCustomProvider: Error fetching models from ${this._config.name}:`, error);
			throw error;
		}

		this._cachedModels = models;
		return models;
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

		const baseUrl = this._config.baseUrl.replace(/\/$/, '');
		const modelId = model.id.startsWith('models/') ? model.id : `models/${model.id}`;
		const url = `${baseUrl}/v1beta/${modelId}:streamGenerateContent?key=${this._apiKey}&alt=sse`;

		// Convert messages to Gemini format using the official converter
		const { contents, systemInstruction } = apiMessageToGeminiMessage(messages as LanguageModelChatMessage[]);

		// Build tools array if provided - strip $schema and other unsupported properties
		const tools = options.tools?.length ? [{
			functionDeclarations: options.tools.map(tool => {
				const cleanedParams = this._cleanSchemaForGemini((tool.inputSchema || { type: 'object', properties: {} }) as Record<string, unknown>);
				this._logService.debug(`GeminiCustomProvider: Tool ${tool.name} schema: ${JSON.stringify(cleanedParams)}`);
				return {
					name: tool.name,
					description: tool.description || '',
					parameters: cleanedParams
				};
			})
		}] : undefined;

		if (tools) {
			this._logService.info(`GeminiCustomProvider: Sending ${options.tools?.length} tools to model`);
		}

		// Check if this model supports thinking
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? detectThinkingCapability({}, model.id);

		const requestBody: Record<string, unknown> = {
			contents,
			generationConfig: {
				maxOutputTokens: model.maxOutputTokens,
				// Enable thinking mode if supported
				...(hasThinking && { thinkingConfig: { thinkingBudget: 8192 } })
			}
		};

		if (systemInstruction) {
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

			await this._processStream(response, progress, token);
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			throw error;
		}
	}

	/**
	 * Clean JSON Schema for Gemini API - remove unsupported properties
	 */
	private _cleanSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
		if (!schema || typeof schema !== 'object') {
			return schema;
		}

		// Properties that Gemini doesn't support
		const unsupportedProps = [
			'$schema', 'additionalProperties', '$id', '$ref', '$defs', 'definitions',
			'cache_control', 'mimeType' // VS Code might inject these
		];

		const cleaned: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(schema)) {
			if (unsupportedProps.includes(key)) {
				continue;
			}
			if (key === 'properties' && typeof value === 'object' && value !== null) {
				// Recursively clean nested properties
				cleaned[key] = {};
				for (const [propName, propValue] of Object.entries(value as Record<string, unknown>)) {
					(cleaned[key] as Record<string, unknown>)[propName] = this._cleanSchemaForGemini(propValue as Record<string, unknown>);
				}
			} else if (key === 'items' && typeof value === 'object' && value !== null) {
				// Clean array items schema
				cleaned[key] = this._cleanSchemaForGemini(value as Record<string, unknown>);
			} else if (Array.isArray(value)) {
				cleaned[key] = value.map(item =>
					typeof item === 'object' && item !== null ? this._cleanSchemaForGemini(item as Record<string, unknown>) : item
				);
			} else {
				cleaned[key] = value;
			}
		}
		return cleaned;
	}

	/**
	 * Process Gemini SSE stream
	 *
	 * Note: For Claude thinking blocks, the signature typically comes in the final chunk.
	 * We accumulate thinking text and emit a final ThinkingPart with metadata at the end.
	 */
	private async _processStream(
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

		// Track accumulated thinking for proper signature handling
		let accumulatedThinking: { text: string; signature?: string; redactedData?: string } | null = null;

		return new Promise<void>((resolve, reject) => {
			token.onCancellationRequested(() => {
				rl.close();
				resolve();
			});

			const flushThinking = () => {
				if (accumulatedThinking) {
					const thinkingPart = new LanguageModelThinkingPart(accumulatedThinking.text);
					if (accumulatedThinking.signature || accumulatedThinking.redactedData) {
						(thinkingPart as LanguageModelThinkingPart & { metadata?: Record<string, unknown> }).metadata = {
							_completeThinking: accumulatedThinking.text,
							...(accumulatedThinking.signature ? { signature: accumulatedThinking.signature } : {}),
							...(accumulatedThinking.redactedData ? { redactedData: accumulatedThinking.redactedData } : {})
						};
					}
					progress.report(thinkingPart);
					accumulatedThinking = null;
				}
			};

			rl.on('line', (line: string) => {
				if (token.isCancellationRequested) {
					return;
				}

				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim();
					if (data === '[DONE]') {
						flushThinking();
						rl.close();
						return;
					}

					try {
						const chunk = JSON.parse(data);
						if (chunk.candidates?.[0]?.content?.parts) {
							for (const part of chunk.candidates[0].content.parts) {
								// Log all parts to debug thinking detection
								this._logService.debug(`GeminiCustomProvider: Received part: ${JSON.stringify(part)}`);

								// Handle thinking/reasoning parts
								// Gemini 2.0+ uses 'thought: true' flag on the part
								const isThinking = ('thought' in part && part.thought === true) ||
									('thinking' in part && part.thinking) ||
									(part.thinkingContent);

								if (isThinking) {
									this._logService.info(`GeminiCustomProvider: Detected thinking part, text length: ${(part.text || part.thinking || '').length}`);
									const thinkingText = part.text || part.thinking || part.thinkingContent || '';

									if (!accumulatedThinking) {
										accumulatedThinking = { text: '' };
									}
									accumulatedThinking.text += thinkingText;

									// Capture signature and redactedData when they appear
									if (part.signature) {
										accumulatedThinking.signature = part.signature;
									}
									if (part.redactedData) {
										accumulatedThinking.redactedData = part.redactedData;
									}

									// Stream thinking text for UI responsiveness (without metadata)
									if (thinkingText) {
										progress.report(new LanguageModelThinkingPart(thinkingText));
									}
								} else {
									// Non-thinking content - flush any accumulated thinking first
									flushThinking();

									if (part.text) {
										progress.report(new LanguageModelTextPart(part.text));
									} else if (part.functionCall) {
										const callId = part.functionCall.id || `${part.functionCall.name}_${Date.now()}`;
										progress.report(new LanguageModelToolCallPart(
											callId,
											part.functionCall.name,
											part.functionCall.args || {}
										));
									}
								}
							}
						}
					} catch {
						// Skip invalid JSON
					}
				}
			});

			rl.on('close', () => {
				flushThinking();
				resolve();
			});
			rl.on('error', (err) => reject(err));
		});
	}
}
