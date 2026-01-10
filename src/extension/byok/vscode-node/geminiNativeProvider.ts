/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GenerateContentParameters, GoogleGenAI, Tool, Type } from '@google/genai';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IResponseDelta, OpenAiFunctionTool } from '../../../platform/networking/common/fetch';
import { APIUsage } from '../../../platform/networking/common/openai';
import { IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
import { toErrorMessage } from '../../../util/common/errorMessage';
import { RecordedProgress } from '../../../util/common/progressRecorder';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { BYOKAuthType, BYOKKnownModels, byokKnownModelsToAPIInfo, BYOKModelCapabilities, BYOKModelProvider, LMResponsePart } from '../common/byokProvider';
import { toGeminiFunction as toGeminiFunctionDeclaration, ToolJsonSchema } from '../common/geminiFunctionDeclarationConverter';
import { apiMessageToGeminiMessage, geminiMessagesToRawMessagesForLogging } from '../common/geminiMessageConverter';
import { IBYOKStorageService } from './byokStorageService';
import { BYOK_OFFICIAL_URLS, configureBYOKProviderWithCustomUrl, showConfigurationMenu } from './byokUIService';

export class GeminiNativeBYOKLMProvider implements BYOKModelProvider<LanguageModelChatInformation> {
	public static readonly providerName = 'Gemini';
	public static readonly officialBaseUrl = BYOK_OFFICIAL_URLS.Gemini;
	public readonly authType: BYOKAuthType = BYOKAuthType.GlobalApiKey;
	private _genAIClient: GoogleGenAI | undefined;
	private _genAIClientApiKey: string | undefined;
	private _genAIClientBaseUrl: string | undefined;
	private _apiKey: string | undefined;
	private _isCustomUrl: boolean = false;

	constructor(
		private readonly _knownModels: BYOKKnownModels | undefined,
		private readonly _byokStorageService: IBYOKStorageService,
		@ILogService private readonly _logService: ILogService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) { }

	/**
	 * Get the base URL from configuration or use official URL
	 */
	private _getBaseUrl(): string {
		const customUrl = this._configurationService.getConfig(ConfigKey.BYOKGoogleBaseUrl);
		if (customUrl && customUrl.trim()) {
			this._isCustomUrl = true;
			return customUrl.trim().replace(/\/+$/, ''); // Normalize by removing trailing slashes
		}
		this._isCustomUrl = false;
		return GeminiNativeBYOKLMProvider.officialBaseUrl;
	}

	/**
	 * Check if using a custom URL
	 */
	public isUsingCustomUrl(): boolean {
		return this._isCustomUrl;
	}

	private _isInvalidApiKeyError(error: unknown): boolean {
		if (!error) {
			return false;
		}

		const message = typeof error === 'string' ? error : (error as Error).message;
		if (typeof message !== 'string') {
			return false;
		}

		const lower = message.toLowerCase();
		return lower.includes('api key not valid') || lower.includes('api_key_invalid') || lower.includes('api key invalid');
	}

	private async _getOrReadApiKey(): Promise<string | undefined> {
		if (!this._apiKey) {
			this._apiKey = await this._byokStorageService.getAPIKey(GeminiNativeBYOKLMProvider.providerName, undefined, this._isCustomUrl);
		}
		return this._apiKey;
	}

	private _ensureClient(apiKey: string): GoogleGenAI {
		const baseUrl = this._getBaseUrl();
		if (!this._genAIClient || this._genAIClientApiKey !== apiKey || this._genAIClientBaseUrl !== baseUrl) {
			// Create client with custom base URL if configured
			if (this._isCustomUrl) {
				this._genAIClient = new GoogleGenAI({
					apiKey,
					httpOptions: {
						baseUrl: baseUrl
					}
				});
			} else {
				this._genAIClient = new GoogleGenAI({ apiKey });
			}
			this._genAIClientApiKey = apiKey;
			this._genAIClientBaseUrl = baseUrl;
		}
		return this._genAIClient;
	}

	/**
	 * Infer model capabilities based on model ID patterns for unknown models.
	 * This provides reasonable defaults when the model is not in the known models list.
	 */
	private _inferModelCapabilities(modelId: string, displayName: string | undefined): BYOKModelCapabilities {
		const normalized = modelId.toLowerCase();

		// Determine if the model supports vision (most Gemini models support vision)
		const supportsVision = normalized.includes('gemini-1.5') ||
			normalized.includes('gemini-2') ||
			normalized.includes('gemini-pro-vision') ||
			normalized.includes('gemini-flash');

		// Determine if the model supports extended thinking
		// Gemini 2.0+ models with "thinking" or flash series support thinking
		const supportsThinking = normalized.includes('thinking') ||
			normalized.includes('gemini-2') ||
			normalized.includes('gemini-exp');

		// Infer token limits based on model series
		let maxInputTokens = 1000000; // Gemini models typically have large context windows
		let maxOutputTokens = 8192;

		if (normalized.includes('gemini-1.5-pro')) {
			maxInputTokens = 2000000;
			maxOutputTokens = 8192;
		} else if (normalized.includes('gemini-1.5-flash')) {
			maxInputTokens = 1000000;
			maxOutputTokens = 8192;
		} else if (normalized.includes('gemini-2')) {
			maxInputTokens = 1000000;
			maxOutputTokens = 8192;
		} else if (normalized.includes('gemini-pro')) {
			maxInputTokens = 32000;
			maxOutputTokens = 2048;
		}

		// Use display name if available, otherwise extract a readable name from model ID
		const name = displayName && displayName.trim() ? displayName : modelId.replace('models/', '');

		return {
			maxInputTokens,
			maxOutputTokens,
			name,
			toolCalling: true,
			vision: supportsVision,
			thinking: supportsThinking
		};
	}

	private async getAllModels(apiKey: string): Promise<BYOKKnownModels> {
		const client = this._ensureClient(apiKey);
		try {
			const models = await client.models.list();
			const modelList: Record<string, BYOKModelCapabilities> = {};

			for await (const model of models) {
				const modelId = model.name;
				if (!modelId) {
					continue; // Skip models without names
				}

				if (this._knownModels && this._knownModels[modelId]) {
					modelList[modelId] = this._knownModels[modelId];
				} else {
					// Infer capabilities for models we don't know
					modelList[modelId] = this._inferModelCapabilities(modelId, model.displayName);
				}
			}
			return modelList;
		} catch (error) {
			this._logService.error(error, `Error fetching available ${GeminiNativeBYOKLMProvider.providerName} models`);
			throw new Error(toErrorMessage(error, true));
		}
	}

	async updateAPIKey(): Promise<void> {
		const currentBaseUrl = this._getBaseUrl();
		const hasExistingConfig = await this._byokStorageService.getAPIKey(GeminiNativeBYOKLMProvider.providerName, undefined, this._isCustomUrl) !== undefined;

		if (hasExistingConfig) {
			const action = await showConfigurationMenu(GeminiNativeBYOKLMProvider.providerName, currentBaseUrl);
			if (!action) {
				return;
			}

			if (action === 'view') {
				return;
			} else if (action === 'reset') {
				await this._configurationService.setConfig(ConfigKey.BYOKGoogleBaseUrl, '');
				await this._byokStorageService.deleteAPIKey(GeminiNativeBYOKLMProvider.providerName, this.authType, undefined, true);
				this._apiKey = undefined;
				this._genAIClient = undefined;
				this._genAIClientApiKey = undefined;
				this._genAIClientBaseUrl = undefined;
				this._isCustomUrl = false;
				return;
			}
		}

		const result = await configureBYOKProviderWithCustomUrl(
			GeminiNativeBYOKLMProvider.providerName,
			currentBaseUrl !== GeminiNativeBYOKLMProvider.officialBaseUrl ? currentBaseUrl : undefined,
			async (baseUrl, apiKey) => {
				try {
					let testClient: GoogleGenAI;
					if (baseUrl !== GeminiNativeBYOKLMProvider.officialBaseUrl) {
						testClient = new GoogleGenAI({
							apiKey,
							httpOptions: { baseUrl }
						});
					} else {
						testClient = new GoogleGenAI({ apiKey });
					}
					const models = await testClient.models.list();
					let count = 0;
					for await (const _ of models) {
						count++;
					}
					return { success: true, modelCount: count };
				} catch (error) {
					return { success: false, error: error instanceof Error ? error.message : String(error) };
				}
			}
		);

		if (result.cancelled) {
			return;
		}

		if (result.baseUrl && result.baseUrl !== GeminiNativeBYOKLMProvider.officialBaseUrl) {
			await this._configurationService.setConfig(ConfigKey.BYOKGoogleBaseUrl, result.baseUrl);
		} else {
			await this._configurationService.setConfig(ConfigKey.BYOKGoogleBaseUrl, '');
		}

		if (result.apiKey) {
			this._apiKey = result.apiKey;
			await this._byokStorageService.storeAPIKey(
				GeminiNativeBYOKLMProvider.providerName,
				result.apiKey,
				this.authType,
				undefined,
				result.isCustomUrl
			);
		}

		this._genAIClient = undefined;
		this._genAIClientApiKey = undefined;
		this._genAIClientBaseUrl = undefined;
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: CancellationToken): Promise<LanguageModelChatInformation[]> {
		// Update base URL check
		this._getBaseUrl();

		if (!this._apiKey) { // If we don't have the API key it might just be in storage, so we try to read it first
			const storedKey = await this._byokStorageService.getAPIKey(GeminiNativeBYOKLMProvider.providerName, undefined, this._isCustomUrl);
			// Normalize empty strings to undefined - the || undefined ensures that if trim() returns an empty string,
			// we store undefined instead, so subsequent if (this._apiKey) checks treat it as "no key"
			this._apiKey = storedKey?.trim() || undefined;
		}
		try {
			if (this._apiKey) {
				const models = await this.getAllModels(this._apiKey);
				return byokKnownModelsToAPIInfo(
					this._isCustomUrl ? `${GeminiNativeBYOKLMProvider.providerName} (Custom)` : GeminiNativeBYOKLMProvider.providerName,
					models
				);
			} else if (options.silent && !this._apiKey) {
				return [];
			} else { // Not silent, and no api key = good to prompt user for api key
				await this.updateAPIKey();
				if (this._apiKey) {
					const models = await this.getAllModels(this._apiKey);
					return byokKnownModelsToAPIInfo(
						this._isCustomUrl ? `${GeminiNativeBYOKLMProvider.providerName} (Custom)` : GeminiNativeBYOKLMProvider.providerName,
						models
					);
				} else {
					return [];
				}
			}
		} catch (error) {
			if (this._isInvalidApiKeyError(error)) {
				if (options.silent) {
					return [];
				}
				await this.updateAPIKey();
				if (this._apiKey) {
					try {
						const models = await this.getAllModels(this._apiKey);
						return byokKnownModelsToAPIInfo(
							this._isCustomUrl ? `${GeminiNativeBYOKLMProvider.providerName} (Custom)` : GeminiNativeBYOKLMProvider.providerName,
							models
						);
					} catch (retryError) {
						this._logService.error(`Error after re-prompting for API key: ${toErrorMessage(retryError, true)}`);
					}
				}
			}
			return [];
		}
	}

	async provideLanguageModelChatResponse(model: LanguageModelChatInformation, messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Promise<void> {
		const apiKey = await this._getOrReadApiKey();
		if (!apiKey) {
			this._logService.error(`BYOK: No API key configured for provider ${GeminiNativeBYOKLMProvider.providerName}`);
			throw new Error(`BYOK: No API key configured for provider ${GeminiNativeBYOKLMProvider.providerName}. Use the Copilot "Manage BYOK" command to add one.`);
		}
		this._ensureClient(apiKey);

		// Convert the messages from the API format into messages that we can use against Gemini
		const { contents, systemInstruction } = apiMessageToGeminiMessage(messages as LanguageModelChatMessage[]);

		const requestId = generateUuid();
		const pendingLoggedChatRequest = this._requestLogger.logChatRequest(
			'GeminiNativeBYOK',
			{
				model: model.id,
				modelMaxPromptTokens: model.maxInputTokens,
				urlOrRequestMetadata: 'https://generativelanguage.googleapis.com',
			},
			{
				model: model.id,
				messages: geminiMessagesToRawMessagesForLogging(contents, systemInstruction),
				ourRequestId: requestId,
				location: ChatLocation.Other,
				body: {
					tools: options.tools?.map((tool): OpenAiFunctionTool => ({
						type: 'function',
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.inputSchema
						}
					}))
				}
			});

		// Convert VS Code tools to Gemini function declarations
		const tools: Tool[] = (options.tools ?? []).length > 0 ? [{
			functionDeclarations: (options.tools ?? []).map(tool => {
				if (!tool.inputSchema) {
					return {
						name: tool.name,
						description: tool.description,
						parameters: {
							type: Type.OBJECT,
							properties: {},
							required: []
						}
					};
				}

				// Transform the input schema to match Gemini's expectations
				const finalTool = toGeminiFunctionDeclaration(tool.name, tool.description, tool.inputSchema as ToolJsonSchema);
				finalTool.description = tool.description || finalTool.description;
				return finalTool;
			})
		}] : [];

		// Bridge VS Code cancellation token to Gemini abortSignal for early network termination
		const abortController = new AbortController();
		const cancelSub = token.onCancellationRequested(() => {
			abortController.abort();
			this._logService.trace('Gemini request aborted via VS Code cancellation token');
		});

		const params: GenerateContentParameters = {
			model: model.id,
			contents: contents,
			config: {
				systemInstruction: systemInstruction,
				tools: tools.length > 0 ? tools : undefined,
				maxOutputTokens: model.maxOutputTokens,
				thinkingConfig: {
					includeThoughts: true,
				},
				abortSignal: abortController.signal
			}
		};

		const wrappedProgress = new RecordedProgress(progress);

		try {
			const result = await this._makeRequest(wrappedProgress, params, token);
			if (result.ttft) {
				pendingLoggedChatRequest.markTimeToFirstToken(result.ttft);
			}
			pendingLoggedChatRequest.resolve({
				type: ChatFetchResponseType.Success,
				requestId,
				serverRequestId: requestId,
				usage: result.usage,
				resolvedModel: model.id,
				value: ['value'],
			}, wrappedProgress.items.map((i): IResponseDelta => {
				return {
					text: i instanceof LanguageModelTextPart ? i.value : '',
					copilotToolCalls: i instanceof LanguageModelToolCallPart ? [{
						name: i.name,
						arguments: JSON.stringify(i.input),
						id: i.callId
					}] : undefined,
				};
			}));
		} catch (err) {
			this._logService.error(`BYOK GeminiNative error: ${toErrorMessage(err, true)}`);
			pendingLoggedChatRequest.resolve({
				type: token.isCancellationRequested ? ChatFetchResponseType.Canceled : ChatFetchResponseType.Unknown,
				requestId,
				serverRequestId: requestId,
				reason: token.isCancellationRequested ? 'cancelled' : toErrorMessage(err)
			}, wrappedProgress.items.map((i): IResponseDelta => {
				return {
					text: i instanceof LanguageModelTextPart ? i.value : '',
					copilotToolCalls: i instanceof LanguageModelToolCallPart ? [{
						name: i.name,
						arguments: JSON.stringify(i.input),
						id: i.callId
					}] : undefined,
				};
			}));
			throw err;
		} finally {
			cancelSub.dispose();
		}
	}

	async provideTokenCount(model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number> {
		// Simple estimation for approximate token count - actual token count would require Gemini's tokenizer
		return Math.ceil(text.toString().length / 4);
	}

	private async _makeRequest(progress: Progress<LMResponsePart>, params: GenerateContentParameters, token: CancellationToken): Promise<{ ttft: number | undefined; usage: APIUsage | undefined }> {
		if (!this._genAIClient) {
			throw new Error('Gemini client is not initialized');
		}

		const start = Date.now();
		let ttft: number | undefined;

		try {
			const stream = await this._genAIClient.models.generateContentStream(params);

			let usage: APIUsage | undefined;
			let pendingThinkingSignature: string | undefined;

			for await (const chunk of stream) {
				if (token.isCancellationRequested) {
					break;
				}

				if (ttft === undefined) {
					ttft = Date.now() - start;
				}

				this._logService.trace(`Gemini chunk: ${JSON.stringify(chunk)}`);

				// Process the streaming response chunks
				if (chunk.candidates && chunk.candidates.length > 0) {
					// choose the primary candidate
					const candidate = chunk.candidates[0];

					if (candidate.content && candidate.content.parts) {
						for (const part of candidate.content.parts) {
							// First, capture thought signature from this part (if present)
							if ('thoughtSignature' in part && part.thoughtSignature) {
								pendingThinkingSignature = part.thoughtSignature as string;
							}
							// Now handle the actual content parts
							if ('thought' in part && part.thought === true && part.text) {
								// Handle thinking/reasoning content from Gemini API
								progress.report(new LanguageModelThinkingPart(part.text));
							} else if (part.text) {
								progress.report(new LanguageModelTextPart(part.text));
							} else if (part.functionCall && part.functionCall.name) {
								// Gemini 3 includes thought signatures for function calling
								// If we have a pending signature, emit it as a thinking part with metadata.signature
								if (pendingThinkingSignature) {
									const thinkingPart = new LanguageModelThinkingPart('', undefined, { signature: pendingThinkingSignature });
									progress.report(thinkingPart);
									pendingThinkingSignature = undefined;
								}

								progress.report(new LanguageModelToolCallPart(
									generateUuid(),
									part.functionCall.name,
									part.functionCall.args || {}
								));
							}
						}
					}
				}

				// Extract usage information if available in the chunk
				if (chunk.usageMetadata) {
					const promptTokens = chunk.usageMetadata.promptTokenCount || -1;
					const completionTokens = chunk.usageMetadata.candidatesTokenCount || -1;

					usage = {
						// Use -1 as a sentinel value to indicate that the token count is unavailable
						completion_tokens: completionTokens,
						prompt_tokens: promptTokens,
						total_tokens: chunk.usageMetadata.totalTokenCount ||
							(promptTokens !== -1 && completionTokens !== -1 ? promptTokens + completionTokens : -1),
						prompt_tokens_details: {
							cached_tokens: chunk.usageMetadata.cachedContentTokenCount || 0,
						}
					};
				}
			}

			return { ttft, usage };
		} catch (error) {
			if ((error as any)?.name === 'AbortError' || token.isCancellationRequested) {
				this._logService.trace('Gemini streaming aborted');
				return { ttft, usage: undefined };
			}
			this._logService.error(`Gemini streaming error: ${toErrorMessage(error, true)}`);
			throw error;
		}
	}
}