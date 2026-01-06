/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as readline from 'readline';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Response as FetchResponse, IFetcherService } from '../../../platform/networking/common/fetcherService';
import { apiMessageToAnthropicMessage } from '../common/anthropicMessageConverter';
import { BYOKKnownModels } from '../common/byokProvider';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { detectThinkingCapability } from '../common/customProviderUtils';
import { BaseCustomProvider } from './baseCustomProvider';
import { IBYOKStorageService } from './byokStorageService';

/**
 * Custom provider for Anthropic Claude API format.
 * Uses the /v1/messages endpoint with x-api-key header authentication.
 * Supports extended thinking with signature preservation for multi-turn conversations.
 */
export class ClaudeCustomProvider extends BaseCustomProvider {
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
	 * Fetch available models from the Anthropic /v1/models endpoint.
	 */
	protected async _fetchModels(apiKey: string): Promise<BYOKKnownModels> {
		const models: BYOKKnownModels = {};

		try {
			const modelsUrl = `${this._config.baseUrl.replace(/\/$/, '')}/v1/models`;

			const response = await this._fetcherService.fetch(modelsUrl, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01'
				}
			});

			const data = await response.json();

			if (data.error) {
				throw new Error(data.error.message || JSON.stringify(data.error));
			}

			const modelList = data.data || data.models || [];
			for (const model of modelList) {
				const modelId = model.id || model.name?.replace('models/', '');
				if (!modelId) {
					continue;
				}

				models[modelId] = this._parseModelCapabilities(model, modelId);
			}

			this._logService.info(`ClaudeCustomProvider: Fetched ${Object.keys(models).length} models from ${this._config.name}`);
		} catch (error) {
			this._logService.error(`ClaudeCustomProvider: Error fetching models from ${this._config.name}:`, error);
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
		const url = `${baseUrl}/v1/messages`;

		// Check if this model supports thinking
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? detectThinkingCapability({}, model.id);

		// Convert messages to Claude format using the official converter
		// Pass thinkingEnabled so the converter can inject placeholder thinking blocks when needed
		const { messages: convertedMessages, system } = apiMessageToAnthropicMessage(
			messages as LanguageModelChatMessage[],
			{ thinkingEnabled: hasThinking }
		);

		// Build tools array if provided
		const tools = options.tools?.map(tool => ({
			name: tool.name,
			description: tool.description || '',
			input_schema: tool.inputSchema || { type: 'object', properties: {} }
		}));

		const requestBody: Record<string, unknown> = {
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
					'x-api-key': this._apiKey,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify(requestBody),
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.error?.message || `Claude API error: ${response.status}`);
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
	 * Process Claude SSE stream
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
							} else if (chunk.content_block?.type === 'redacted_thinking') {
								// Handle redacted thinking blocks - emit immediately with redactedData
								const redactedPart = new LanguageModelThinkingPart('');
								redactedPart.metadata = {
									redactedData: chunk.content_block.data || ''
								};
								progress.report(redactedPart);
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
								// Emit the final thinking part with complete content and signature
								// This is required for multi-turn conversations with thinking enabled
								if (pendingThinking.signature) {
									const finalThinkingPart = new LanguageModelThinkingPart('');
									finalThinkingPart.metadata = {
										signature: pendingThinking.signature,
										_completeThinking: pendingThinking.text
									};
									progress.report(finalThinkingPart);
								}
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
}
