/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as readline from 'readline';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Response as FetchResponse, IFetcherService } from '../../../platform/networking/common/fetcherService';
import { LanguageModelChatMessageRole } from '../../../vscodeTypes';
import { BYOKKnownModels } from '../common/byokProvider';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { detectThinkingCapability } from '../common/customProviderUtils';
import { BaseCustomProvider } from './baseCustomProvider';
import { IBYOKStorageService } from './byokStorageService';

/**
 * Custom provider for OpenAI Responses API format.
 * Uses the /v1/responses endpoint with Bearer token authentication.
 * Supports reasoning mode for o1/o3 models.
 */
export class OpenAIResponsesCustomProvider extends BaseCustomProvider {
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
	 * Fetch available models from the OpenAI-compatible /v1/models endpoint.
	 */
	protected async _fetchModels(apiKey: string): Promise<BYOKKnownModels> {
		const models: BYOKKnownModels = {};

		try {
			const modelsUrl = `${this._config.baseUrl.replace(/\/$/, '')}/v1/models`;

			const response = await this._fetcherService.fetch(modelsUrl, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
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

			this._logService.info(`OpenAIResponsesCustomProvider: Fetched ${Object.keys(models).length} models from ${this._config.name}`);
		} catch (error) {
			this._logService.error(`OpenAIResponsesCustomProvider: Error fetching models from ${this._config.name}:`, error);
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

		this._logService.info(`OpenAIResponsesCustomProvider: Starting request for model ${model.id}`);

		const baseUrl = this._config.baseUrl.replace(/\/$/, '');
		const url = `${baseUrl}/v1/responses`;

		// Check if this model supports thinking/reasoning
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? detectThinkingCapability({}, model.id);

		this._logService.info(`OpenAIResponsesCustomProvider: Converting ${messages.length} messages`);

		// Types for OpenAI Responses API
		interface InputTextContent { type: 'input_text'; text: string }
		interface FunctionCallContent { type: 'function_call'; id: string; name: string; arguments: string }
		interface FunctionCallOutputContent { type: 'function_call_output'; call_id: string; output: string }
		interface InputImageContent { type: 'input_image'; image_url: string }
		type ContentPart = InputTextContent | FunctionCallContent | FunctionCallOutputContent | InputImageContent;
		interface InputMessage { role: 'assistant' | 'user'; content: string | ContentPart[] }

		// Convert messages to OpenAI Responses format
		const input: InputMessage[] = [];
		let instructions: string | undefined;

		for (const message of messages as LanguageModelChatMessage[]) {
			if (message.role === LanguageModelChatMessageRole.System) {
				// System message becomes instructions - just extract text
				const textParts: string[] = [];
				if (message.content && Array.isArray(message.content)) {
					for (const p of message.content) {
						if (p && typeof p === 'object' && 'value' in p) {
							textParts.push(String((p as { value: unknown }).value || ''));
						}
					}
				}
				instructions = textParts.join('\n');
			} else {
				const role = message.role === LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
				const contentParts: ContentPart[] = [];

				if (message.content && Array.isArray(message.content)) {
					for (const part of message.content) {
						if (!part || typeof part !== 'object') {
							continue;
						}

						// Check for text part (has 'value' property that is a string)
						if ('value' in part && typeof (part as { value: unknown }).value === 'string') {
							const text = (part as { value: string }).value;
							if (text) {
								contentParts.push({ type: 'input_text', text });
							}
						}
						// Check for tool call part (has callId, name, input but no content array)
						else if ('callId' in part && 'name' in part && 'input' in part) {
							const toolCallPart = part as { callId?: string; name?: string; input?: unknown };
							contentParts.push({
								type: 'function_call',
								id: toolCallPart.callId || `call_${Date.now()}`,
								name: toolCallPart.name || '',
								arguments: JSON.stringify(toolCallPart.input || {})
							});
						}
						// Check for tool result part (has callId and content array)
						else if ('callId' in part && 'content' in part && Array.isArray((part as { content?: unknown }).content)) {
							const toolResultPart = part as { callId?: string; content?: Array<{ value?: unknown }> };
							const textContent = (toolResultPart.content || [])
								.filter((p): p is { value: unknown } => p && 'value' in p)
								.map(p => String(p.value || ''))
								.join('');
							contentParts.push({
								type: 'function_call_output',
								call_id: toolResultPart.callId || '',
								output: textContent
							});
						}
						// Check for image/data part
						else if ('data' in part && 'mimeType' in part) {
							const imagePart = part as { data?: Uint8Array; mimeType?: string };
							if (imagePart.data && imagePart.mimeType) {
								contentParts.push({
									type: 'input_image',
									image_url: `data:${imagePart.mimeType};base64,${Buffer.from(imagePart.data).toString('base64')}`
								});
							}
						}
					}
				}

				// Add message if it has content
				if (contentParts.length > 0) {
					// For user messages with simple text, use shorthand
					if (role === 'user' && contentParts.length === 1 && contentParts[0].type === 'input_text') {
						input.push({ role, content: contentParts[0].text });
					} else {
						input.push({ role, content: contentParts });
					}
				}
			}
		}

		this._logService.info(`OpenAIResponsesCustomProvider: Converted to ${input.length} input items`);

		// Build tools array if provided - OpenAI Responses format
		const tools = options.tools?.map(tool => ({
			type: 'function',
			name: tool.name,
			description: tool.description || '',
			parameters: tool.inputSchema || { type: 'object', properties: {} }
		}));

		// Build request body - OpenAI Responses API format
		const requestBody: Record<string, unknown> = {
			model: model.id,
			input,
			stream: true
		};

		if (instructions) {
			requestBody.instructions = instructions;
		}
		if (tools?.length) {
			requestBody.tools = tools;
		}

		// Enable reasoning for models that support it (o1, o3, etc.)
		if (hasThinking) {
			requestBody.reasoning = {
				effort: 'medium'
			};
		}

		const abortController = new AbortController();
		token.onCancellationRequested(() => abortController.abort());

		this._logService.info(`OpenAIResponsesCustomProvider: Sending request to ${url}`);
		this._logService.debug(`OpenAIResponsesCustomProvider: Request body: ${JSON.stringify(requestBody, null, 2)}`);

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

			this._logService.info(`OpenAIResponsesCustomProvider: Response status: ${response.status}`);

			if (!response.ok) {
				const errorText = await response.text().catch(() => '');
				this._logService.error(`OpenAIResponsesCustomProvider: Error response: ${errorText}`);
				let errorMessage = `OpenAI Responses API error: ${response.status}`;
				try {
					const errorData = JSON.parse(errorText);
					errorMessage = errorData.error?.message || errorMessage;
				} catch {
					if (errorText) {
						errorMessage = errorText;
					}
				}
				throw new Error(errorMessage);
			}

			await this._processStream(response, progress, token);
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return;
			}
			this._logService.error(`OpenAIResponsesCustomProvider: Request failed: ${(error as Error).message}`);
			throw error;
		}
	}

	/**
	 * Process OpenAI Responses API SSE stream
	 *
	 * Note: When proxying to Claude/Gemini with thinking enabled, we need to
	 * accumulate thinking text and capture any signature for multi-turn conversations.
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

		const pendingToolCalls: Map<string, { name: string; arguments: string }> = new Map();

		// Track accumulated thinking for proper signature handling (for Claude proxy scenarios)
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
						const event = JSON.parse(data);

						// Handle different event types in Responses API
						if (event.type === 'response.output_item.added') {
							if (event.item?.type === 'function_call') {
								pendingToolCalls.set(event.item.id, {
									name: event.item.name || '',
									arguments: ''
								});
							}
						} else if (event.type === 'response.output_text.delta') {
							// Non-thinking content - flush any accumulated thinking first
							flushThinking();
							if (event.delta) {
								progress.report(new LanguageModelTextPart(event.delta));
							}
						} else if (event.type === 'response.reasoning_summary_text.delta' ||
							event.type === 'response.reasoning.delta' ||
							event.type === 'response.thinking.delta') {
							// Accumulate thinking text
							const thinkingText = event.delta || '';
							if (!accumulatedThinking) {
								accumulatedThinking = { text: '' };
							}
							accumulatedThinking.text += thinkingText;

							// Stream thinking text for UI responsiveness
							if (thinkingText) {
								progress.report(new LanguageModelThinkingPart(thinkingText));
							}
						} else if (event.type === 'response.reasoning_summary.done' ||
							event.type === 'response.reasoning.done' ||
							event.type === 'response.thinking.done') {
							// Capture signature if present (for Claude proxy scenarios)
							if (event.signature && accumulatedThinking) {
								accumulatedThinking.signature = event.signature;
							}
							if (event.redacted_data && accumulatedThinking) {
								accumulatedThinking.redactedData = event.redacted_data;
							}
							// Don't flush yet - wait for non-thinking content or stream end
						} else if (event.type === 'response.function_call_arguments.delta') {
							const toolCall = pendingToolCalls.get(event.item_id);
							if (toolCall) {
								toolCall.arguments += event.delta || '';
							}
						} else if (event.type === 'response.function_call_arguments.done') {
							// Flush thinking before tool calls
							flushThinking();

							const toolCall = pendingToolCalls.get(event.item_id);
							try {
								const argsStr = toolCall?.arguments || event.arguments || '{}';
								const args = JSON.parse(argsStr);
								const callId = event.item_id || `${event.name || toolCall?.name || 'function'}_${Date.now()}`;
								progress.report(new LanguageModelToolCallPart(
									callId,
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
							flushThinking();
							progress.report(new LanguageModelTextPart(event.delta.text || ''));
						} else if (event.type === 'response.completed') {
							flushThinking();
							rl.close();
						} else if (event.type === 'response.failed') {
							const errorMsg = event.response?.error?.message || 'Request failed';
							rl.close();
							reject(new Error(errorMsg));
							return;
						} else if (event.choices?.[0]?.delta) {
							// Fallback: Handle standard OpenAI Chat Completions format
							flushThinking();
							const delta = event.choices[0].delta;
							if (delta.content) {
								progress.report(new LanguageModelTextPart(delta.content));
							}
							if (delta.tool_calls) {
								for (const tc of delta.tool_calls) {
									if (tc.function?.name) {
										const tcId = tc.id || `tc_${Date.now()}_${tc.index || 0}`;
										pendingToolCalls.set(tcId, {
											name: tc.function.name,
											arguments: tc.function.arguments || ''
										});
									} else if (tc.function?.arguments && tc.id) {
										const existing = pendingToolCalls.get(tc.id);
										if (existing) {
											existing.arguments += tc.function.arguments;
										}
									}
								}
							}
							if (event.choices[0].finish_reason === 'tool_calls' || event.choices[0].finish_reason === 'stop') {
								for (const [tcId, tc] of pendingToolCalls) {
									try {
										const args = JSON.parse(tc.arguments || '{}');
										progress.report(new LanguageModelToolCallPart(tcId, tc.name, args));
									} catch {
										// Invalid JSON
									}
								}
								pendingToolCalls.clear();
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
