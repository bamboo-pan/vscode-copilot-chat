/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import * as vscode from 'vscode';
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelDataPart, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { CustomDataPartMimeTypes } from '../../../platform/endpoint/common/endpointTypes';
import { ILogService } from '../../../platform/log/common/logService';
import { ContextManagementResponse, getContextManagementFromConfig } from '../../../platform/networking/common/anthropic';
import { IResponseDelta, OpenAiFunctionTool } from '../../../platform/networking/common/fetch';
import { APIUsage } from '../../../platform/networking/common/openai';
import { IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { toErrorMessage } from '../../../util/common/errorMessage';
import { RecordedProgress } from '../../../util/common/progressRecorder';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { anthropicMessagesToRawMessagesForLogging, apiMessageToAnthropicMessage } from '../common/anthropicMessageConverter';
import { BYOKAuthType, BYOKKnownModels, byokKnownModelsToAPIInfo, BYOKModelCapabilities, BYOKModelProvider, LMResponsePart } from '../common/byokProvider';
import { IBYOKStorageService } from './byokStorageService';
import { BYOK_OFFICIAL_URLS, configureBYOKProviderWithCustomUrl, showConfigurationMenu } from './byokUIService';

export class AnthropicLMProvider implements BYOKModelProvider<LanguageModelChatInformation> {
	public static readonly providerName = 'Anthropic';
	public static readonly officialBaseUrl = BYOK_OFFICIAL_URLS.Anthropic;
	public readonly authType: BYOKAuthType = BYOKAuthType.GlobalApiKey;
	private _anthropicAPIClient: Anthropic | undefined;
	private _apiKey: string | undefined;
	private _isCustomUrl: boolean = false;
	constructor(
		private readonly _knownModels: BYOKKnownModels | undefined,
		private readonly _byokStorageService: IBYOKStorageService,
		@ILogService private readonly _logService: ILogService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _experimentationService: IExperimentationService
	) { }

	/**
	 * Get the base URL from configuration or use official URL
	 */
	private _getBaseUrl(): string {
		const customUrl = this._configurationService.getConfig(ConfigKey.BYOKAnthropicBaseUrl);
		if (customUrl && customUrl.trim()) {
			this._isCustomUrl = true;
			return customUrl.trim().replace(/\/+$/, ''); // Normalize by removing trailing slashes
		}
		this._isCustomUrl = false;
		return AnthropicLMProvider.officialBaseUrl;
	}

	/**
	 * Check if using a custom URL
	 */
	public isUsingCustomUrl(): boolean {
		return this._isCustomUrl;
	}

	private _getThinkingBudget(modelId: string, maxOutputTokens: number): number | undefined {
		const configuredBudget = this._configurationService.getExperimentBasedConfig(ConfigKey.AnthropicThinkingBudget, this._experimentationService);
		if (!configuredBudget || configuredBudget === 0) {
			return undefined;
		}

		// Check known models first, then infer capabilities for unknown models
		const modelCapabilities = this._knownModels?.[modelId];
		const modelSupportsThinking = modelCapabilities?.thinking ?? this._inferSupportsThinking(modelId);
		if (!modelSupportsThinking) {
			return undefined;
		}
		const normalizedBudget = configuredBudget < 1024 ? 1024 : configuredBudget;
		return Math.min(32000, maxOutputTokens - 1, normalizedBudget);
	}

	/**
	 * Infer if a model supports extended thinking based on model ID patterns.
	 * Claude 3.5 Sonnet, Claude 3.7, and Claude 4 series models support thinking.
	 */
	private _inferSupportsThinking(modelId: string): boolean {
		const normalized = modelId.toLowerCase();
		// Claude 3.5+ and 3.7 models
		if (normalized.includes('claude-3-5') || normalized.includes('claude-3-7')) {
			return true;
		}
		// Claude 4 series - match both specific variants and generic claude-4 pattern
		if (normalized.includes('claude-sonnet-4') ||
			normalized.includes('claude-opus-4') ||
			normalized.includes('claude-haiku-4') ||
			normalized.includes('claude-4')) {
			return true;
		}
		return false;
	}

	/**
	 * Checks if a model supports memory based on its model ID.
	 * Memory is supported by:
	 * - Claude Sonnet 4.5 (claude-sonnet-4-5-*)
	 * - Claude Sonnet 4 (claude-sonnet-4-*)
	 * - Claude Haiku 4.5 (claude-haiku-4-5-*)
	 * - Claude Opus 4.1 (claude-opus-4-1-*)
	 * - Claude Opus 4 (claude-opus-4-*)
	 * TODO: Save these model capabilities in the knownModels object instead of hardcoding them here
	 */
	private _enableMemory(modelId: string): boolean {
		const normalized = modelId.toLowerCase();
		return normalized.startsWith('claude-sonnet-4-5') ||
			normalized.startsWith('claude-sonnet-4') ||
			normalized.startsWith('claude-haiku-4-5') ||
			normalized.startsWith('claude-opus-4-1') ||
			normalized.startsWith('claude-opus-4');
	}

	/**
	 * Infer model capabilities based on model ID patterns for unknown models.
	 * This provides reasonable defaults when the model is not in the known models list.
	 */
	private _inferModelCapabilities(modelId: string, displayName: string | undefined): BYOKModelCapabilities {
		const normalized = modelId.toLowerCase();

		// Determine if the model supports vision (Claude 3+ and Claude 4 models typically support vision)
		const supportsVision = normalized.includes('claude-3') ||
			normalized.includes('claude-sonnet-4') ||
			normalized.includes('claude-opus-4') ||
			normalized.includes('claude-haiku-4') ||
			normalized.includes('claude-4');

		// Determine if the model supports extended thinking
		const supportsThinking = this._inferSupportsThinking(modelId);

		// Infer token limits based on model series
		let maxInputTokens = 100000;
		let maxOutputTokens = 16000;

		if (normalized.includes('claude-3-5') || normalized.includes('claude-3-7')) {
			maxInputTokens = 200000;
			maxOutputTokens = 8192;
		} else if (normalized.includes('claude-sonnet-4') || normalized.includes('claude-opus-4') || normalized.includes('claude-4')) {
			maxInputTokens = 200000;
			maxOutputTokens = 16000;
		}

		// Use display_name if available, otherwise fall back to model ID
		const name = displayName && displayName.trim() ? displayName : modelId;

		return {
			maxInputTokens,
			maxOutputTokens,
			name,
			toolCalling: true,
			vision: supportsVision,
			thinking: supportsThinking
		};
	}

	// Filters the byok known models based on what the anthropic API knows as well
	private async getAllModels(apiKey: string): Promise<BYOKKnownModels> {
		const baseUrl = this._getBaseUrl();
		if (!this._anthropicAPIClient) {
			this._anthropicAPIClient = new Anthropic({ apiKey, baseURL: baseUrl });
		}
		try {
			const response = await this._anthropicAPIClient.models.list();
			const modelList: Record<string, BYOKModelCapabilities> = {};
			for (const model of response.data) {
				if (this._knownModels && this._knownModels[model.id]) {
					modelList[model.id] = this._knownModels[model.id];
				} else {
					// Infer capabilities for models we don't know
					modelList[model.id] = this._inferModelCapabilities(model.id, model.display_name);
				}
			}
			return modelList;
		} catch (error) {
			this._logService.error(error, `Error fetching available ${AnthropicLMProvider.providerName} models`);
			throw new Error(error.message ? error.message : error);
		}
	}

	async updateAPIKey(): Promise<void> {
		// Check if using custom URL - if so, use multi-step configuration
		const currentBaseUrl = this._getBaseUrl();
		const hasExistingConfig = await this._byokStorageService.getAPIKey(AnthropicLMProvider.providerName, undefined, this._isCustomUrl) !== undefined;

		if (hasExistingConfig) {
			// Show configuration menu for existing configurations
			const action = await showConfigurationMenu(AnthropicLMProvider.providerName, currentBaseUrl);
			if (!action) {
				return;
			}

			if (action === 'view') {
				// Just refresh models - the caller will handle displaying
				return;
			} else if (action === 'reset') {
				// Reset to default
				await this._configurationService.setConfig(ConfigKey.BYOKAnthropicBaseUrl, '');
				await this._byokStorageService.deleteAPIKey(AnthropicLMProvider.providerName, this.authType, undefined, true);
				this._apiKey = undefined;
				this._anthropicAPIClient = undefined;
				this._isCustomUrl = false;
				return;
			}
			// Fall through to 'modify'
		}

		// Use multi-step configuration wizard
		const result = await configureBYOKProviderWithCustomUrl(
			AnthropicLMProvider.providerName,
			currentBaseUrl !== AnthropicLMProvider.officialBaseUrl ? currentBaseUrl : undefined,
			async (baseUrl, apiKey) => {
				try {
					const testClient = new Anthropic({ apiKey, baseURL: baseUrl });
					const response = await testClient.models.list();
					return { success: true, modelCount: response.data.length };
				} catch (error) {
					return { success: false, error: error instanceof Error ? error.message : String(error) };
				}
			}
		);

		if (result.cancelled) {
			return;
		}

		// Save configuration
		if (result.baseUrl && result.baseUrl !== AnthropicLMProvider.officialBaseUrl) {
			await this._configurationService.setConfig(ConfigKey.BYOKAnthropicBaseUrl, result.baseUrl);
		} else {
			await this._configurationService.setConfig(ConfigKey.BYOKAnthropicBaseUrl, '');
		}

		if (result.apiKey) {
			this._apiKey = result.apiKey;
			await this._byokStorageService.storeAPIKey(
				AnthropicLMProvider.providerName,
				result.apiKey,
				this.authType,
				undefined,
				result.isCustomUrl
			);
		}

		this._anthropicAPIClient = undefined; // Reset client to use new configuration
	}

	async updateAPIKeyViaCmd(envVarName: string, action: 'update' | 'remove' = 'update', modelId?: string): Promise<void> {
		if (action === 'remove') {
			this._apiKey = undefined;
			this._anthropicAPIClient = undefined;
			await this._byokStorageService.deleteAPIKey(AnthropicLMProvider.providerName, this.authType, modelId, this._isCustomUrl);
			this._logService.info(`BYOK: API key removed for provider ${AnthropicLMProvider.providerName}`);
			return;
		}

		const apiKey = process.env[envVarName];
		if (!apiKey) {
			throw new Error(`BYOK: Environment variable ${envVarName} not found or empty for API key management`);
		}

		this._apiKey = apiKey;
		await this._byokStorageService.storeAPIKey(AnthropicLMProvider.providerName, apiKey, this.authType, modelId, this._isCustomUrl);
		this._anthropicAPIClient = undefined;
		this._logService.info(`BYOK: API key updated for provider ${AnthropicLMProvider.providerName} from environment variable ${envVarName}`);
	}

	async provideLanguageModelChatInformation(options: { silent: boolean }, token: CancellationToken): Promise<LanguageModelChatInformation[]> {
		if (!this._apiKey) { // If we don't have the API key it might just be in storage, so we try to read it first
			this._apiKey = await this._byokStorageService.getAPIKey(AnthropicLMProvider.providerName, undefined, this._isCustomUrl);
		}
		try {
			if (this._apiKey) {
				const models = await this.getAllModels(this._apiKey);
				// Add custom suffix if using custom URL
				return byokKnownModelsToAPIInfo(
					this._isCustomUrl ? `${AnthropicLMProvider.providerName} (Custom)` : AnthropicLMProvider.providerName,
					models
				);
			} else if (options.silent && !this._apiKey) {
				return [];
			} else { // Not silent, and no api key = good to prompt user for api key
				await this.updateAPIKey();
				if (this._apiKey) {
					const models = await this.getAllModels(this._apiKey);
					return byokKnownModelsToAPIInfo(
						this._isCustomUrl ? `${AnthropicLMProvider.providerName} (Custom)` : AnthropicLMProvider.providerName,
						models
					);
				} else {
					return [];
				}
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('invalid x-api-key')) {
				if (options.silent) {
					return [];
				}
				await this.updateAPIKey();
				if (this._apiKey) {
					try {
						const models = await this.getAllModels(this._apiKey);
						return byokKnownModelsToAPIInfo(
							this._isCustomUrl ? `${AnthropicLMProvider.providerName} (Custom)` : AnthropicLMProvider.providerName,
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
		if (!this._anthropicAPIClient) {
			return;
		}
		// Convert the messages from the API format into messages that we can use against anthropic
		const { system, messages: convertedMessages } = apiMessageToAnthropicMessage(messages as LanguageModelChatMessage[]);

		const requestId = generateUuid();
		const pendingLoggedChatRequest = this._requestLogger.logChatRequest(
			'AnthropicBYOK',
			{
				model: model.id,
				modelMaxPromptTokens: model.maxInputTokens,
				urlOrRequestMetadata: this._anthropicAPIClient.baseURL,
			},
			{
				model: model.id,
				messages: anthropicMessagesToRawMessagesForLogging(convertedMessages, system),
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
				},
			});

		let hasMemoryTool = false;

		// Build tools array, handling both standard tools and native Anthropic tools
		const tools: Anthropic.Beta.BetaToolUnion[] = (options.tools ?? []).map(tool => {

			// Handle native Anthropic memory tool
			if (tool.name === 'memory' && this._enableMemory(model.id)) {
				hasMemoryTool = true;
				return {
					name: 'memory',
					type: 'memory_20250818'
				} as Anthropic.Beta.BetaMemoryTool20250818;
			}

			if (!tool.inputSchema) {
				return {
					name: tool.name,
					description: tool.description,
					input_schema: {
						type: 'object',
						properties: {},
						required: []
					}
				};
			}

			return {
				name: tool.name,
				description: tool.description,
				input_schema: {
					type: 'object',
					properties: (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
					required: (tool.inputSchema as { required?: string[] }).required ?? [],
					$schema: (tool.inputSchema as { $schema?: unknown }).$schema
				}
			};
		});

		// Check if web search is enabled and append web_search tool if not already present.
		// We need to do this because there is no local web_search tool definition we can replace.
		const webSearchEnabled = this._configurationService.getExperimentBasedConfig(ConfigKey.AnthropicWebSearchToolEnabled, this._experimentationService);
		if (webSearchEnabled && !tools.some(tool => tool.name === 'web_search')) {
			const maxUses = this._configurationService.getConfig(ConfigKey.AnthropicWebSearchMaxUses);
			const allowedDomains = this._configurationService.getConfig(ConfigKey.AnthropicWebSearchAllowedDomains);
			const blockedDomains = this._configurationService.getConfig(ConfigKey.AnthropicWebSearchBlockedDomains);
			const userLocation = this._configurationService.getConfig(ConfigKey.AnthropicWebSearchUserLocation);

			const webSearchTool: Anthropic.Beta.BetaWebSearchTool20250305 = {
				name: 'web_search',
				type: 'web_search_20250305',
				max_uses: maxUses
			};

			// Add domain filtering if configured
			// Cannot use both allowed and blocked domains simultaneously
			if (allowedDomains && allowedDomains.length > 0) {
				webSearchTool.allowed_domains = allowedDomains;
			} else if (blockedDomains && blockedDomains.length > 0) {
				webSearchTool.blocked_domains = blockedDomains;
			}

			// Add user location if configured
			// Note: All fields are optional according to Anthropic docs
			if (userLocation && (userLocation.city || userLocation.region || userLocation.country || userLocation.timezone)) {
				webSearchTool.user_location = {
					type: 'approximate',
					...userLocation
				};
			}

			tools.push(webSearchTool);
		}

		const thinkingBudget = this._getThinkingBudget(model.id, model.maxOutputTokens);

		// Build context management configuration
		const contextManagement = getContextManagementFromConfig(
			this._configurationService,
			this._experimentationService,
			thinkingBudget,
			model.maxInputTokens
		);

		// Build betas array for beta API features
		const betas: string[] = [];
		if (thinkingBudget) {
			betas.push('interleaved-thinking-2025-05-14');
		}
		if (hasMemoryTool || contextManagement) {
			betas.push('context-management-2025-06-27');
		}

		const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
			model: model.id,
			messages: convertedMessages,
			max_tokens: model.maxOutputTokens,
			stream: true,
			system: [system],
			tools: tools.length > 0 ? tools : undefined,
			thinking: thinkingBudget ? {
				type: 'enabled',
				budget_tokens: thinkingBudget
			} : undefined,
			context_management: contextManagement as any,
		};

		const wrappedProgress = new RecordedProgress(progress);

		try {
			const result = await this._makeRequest(wrappedProgress, params, betas, token);
			if (result.ttft) {
				pendingLoggedChatRequest.markTimeToFirstToken(result.ttft);
			}
			const responseDeltas: IResponseDelta[] = wrappedProgress.items.map((i): IResponseDelta => {
				if (i instanceof LanguageModelTextPart) {
					return { text: i.value };
				} else if (i instanceof LanguageModelToolCallPart) {
					return {
						text: '',
						copilotToolCalls: [{
							name: i.name,
							arguments: JSON.stringify(i.input),
							id: i.callId
						}]
					};
				} else if (i instanceof LanguageModelToolResultPart) {
					// Handle tool results - extract text from content
					const resultText = i.content.map(c => c instanceof LanguageModelTextPart ? c.value : '').join('');
					return {
						text: `[Tool Result ${i.callId}]: ${resultText}`
					};
				} else {
					return { text: '' };
				}
			});
			// TODO: @bhavyaus - Add telemetry tracking for context editing (contextEditingApplied, contextEditingClearedTokens, contextEditingEditCount) like messagesApi.ts does
			if (result.contextManagement) {
				responseDeltas.push({
					text: '',
					contextManagement: result.contextManagement
				});
			}
			pendingLoggedChatRequest.resolve({
				type: ChatFetchResponseType.Success,
				requestId,
				serverRequestId: requestId,
				usage: result.usage,
				value: ['value'],
				resolvedModel: model.id
			}, responseDeltas);
		} catch (err) {
			this._logService.error(`BYOK Anthropic error: ${toErrorMessage(err, true)}`);
			pendingLoggedChatRequest.resolve({
				type: ChatFetchResponseType.Unknown,
				requestId,
				serverRequestId: requestId,
				reason: err.message
			}, wrappedProgress.items.map((i): IResponseDelta => {
				if (i instanceof LanguageModelTextPart) {
					return { text: i.value };
				} else if (i instanceof LanguageModelToolCallPart) {
					return {
						text: '',
						copilotToolCalls: [{
							name: i.name,
							arguments: JSON.stringify(i.input),
							id: i.callId
						}]
					};
				} else if (i instanceof LanguageModelToolResultPart) {
					// Handle tool results - extract text from content
					const resultText = i.content.map(c => c instanceof LanguageModelTextPart ? c.value : '').join('');
					return {
						text: `[Tool Result ${i.callId}]: ${resultText}`
					};
				} else {
					return { text: '' };
				}
			}));
			throw err;
		}
	}

	async provideTokenCount(model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token: CancellationToken): Promise<number> {
		// Simple estimation - actual token count would require Claude's tokenizer
		return Math.ceil(text.toString().length / 4);
	}

	private async _makeRequest(progress: RecordedProgress<LMResponsePart>, params: Anthropic.Beta.Messages.MessageCreateParamsStreaming, betas: string[], token: CancellationToken): Promise<{ ttft: number | undefined; usage: APIUsage | undefined; contextManagement: ContextManagementResponse | undefined }> {
		if (!this._anthropicAPIClient) {
			return { ttft: undefined, usage: undefined, contextManagement: undefined };
		}
		const start = Date.now();
		let ttft: number | undefined;

		const stream = await this._anthropicAPIClient.beta.messages.create({
			...params,
			...(betas.length > 0 && { betas })
		});

		let pendingToolCall: {
			toolId?: string;
			name?: string;
			jsonInput?: string;
		} | undefined;
		let pendingThinking: {
			thinking?: string;
			signature?: string;
		} | undefined;
		let pendingRedactedThinking: {
			data: string;
		} | undefined;
		let pendingServerToolCall: {
			toolId?: string;
			name?: string;
			jsonInput?: string;
			type?: string;
		} | undefined;
		let usage: APIUsage | undefined;
		let contextManagementResponse: ContextManagementResponse | undefined;

		let hasText = false;
		for await (const chunk of stream) {
			if (token.isCancellationRequested) {
				break;
			}

			if (ttft === undefined) {
				ttft = Date.now() - start;
			}
			this._logService.trace(`chunk: ${JSON.stringify(chunk)}`);

			if (chunk.type === 'content_block_start') {
				if ('content_block' in chunk && chunk.content_block.type === 'tool_use') {
					pendingToolCall = {
						toolId: chunk.content_block.id,
						name: chunk.content_block.name,
						jsonInput: ''
					};
				} else if ('content_block' in chunk && chunk.content_block.type === 'server_tool_use') {
					// Handle server-side tool use (e.g., web_search)
					pendingServerToolCall = {
						toolId: chunk.content_block.id,
						name: chunk.content_block.name,
						jsonInput: '',
						type: chunk.content_block.name
					};
					progress.report(new LanguageModelTextPart('\n'));

				} else if ('content_block' in chunk && chunk.content_block.type === 'thinking') {
					pendingThinking = {
						thinking: '',
						signature: ''
					};
				} else if ('content_block' in chunk && chunk.content_block.type === 'redacted_thinking') {
					const redactedBlock = chunk.content_block as Anthropic.Messages.RedactedThinkingBlock;
					pendingRedactedThinking = {
						data: redactedBlock.data
					};
				} else if ('content_block' in chunk && chunk.content_block.type === 'web_search_tool_result') {
					if (!pendingServerToolCall || !pendingServerToolCall.toolId) {
						continue;
					}

					const resultBlock = chunk.content_block as Anthropic.Messages.WebSearchToolResultBlock;
					// Handle potential error in web search
					if (!Array.isArray(resultBlock.content)) {
						this._logService.error(`Web search error: ${(resultBlock.content as Anthropic.Messages.WebSearchToolResultError).error_code}`);
						continue;
					}

					const results = resultBlock.content.map((result: Anthropic.Messages.WebSearchResultBlock) => ({
						type: 'web_search_result',
						url: result.url,
						title: result.title,
						page_age: result.page_age,
						encrypted_content: result.encrypted_content
					}));

					// Format according to Anthropic's web_search_tool_result specification
					const toolResult = {
						type: 'web_search_tool_result',
						tool_use_id: pendingServerToolCall.toolId,
						content: results
					};

					const searchResults = JSON.stringify(toolResult, null, 2);

					// TODO: @bhavyaus - instead of just pushing text, create a specialized WebSearchResult part
					progress.report(new LanguageModelToolResultPart(
						pendingServerToolCall.toolId!,
						[new LanguageModelTextPart(searchResults)]
					));
					pendingServerToolCall = undefined;
				}
				continue;
			}

			if (chunk.type === 'content_block_delta') {
				if (chunk.delta.type === 'text_delta') {
					progress.report(new LanguageModelTextPart(chunk.delta.text || ''));
					hasText ||= chunk.delta.text?.length > 0;
				} else if (chunk.delta.type === 'citations_delta') {
					if ('citation' in chunk.delta) {
						// TODO: @bhavyaus - instead of just pushing text, create a specialized Citation part
						const citation = chunk.delta.citation as Anthropic.Messages.CitationsWebSearchResultLocation;
						if (citation.type === 'web_search_result_location') {
							// Format citation according to Anthropic specification
							const citationData = {
								type: 'web_search_result_location',
								url: citation.url,
								title: citation.title,
								encrypted_index: citation.encrypted_index,
								cited_text: citation.cited_text
							};

							// Format citation as readable blockquote with source link
							const referenceText = `\n> "${citation.cited_text}" — [${vscode.l10n.t('Source')}](${citation.url})\n\n`;

							// Report formatted reference text to user
							progress.report(new LanguageModelTextPart(referenceText));

							// Store the citation data in the correct format for multi-turn conversations
							progress.report(new LanguageModelToolResultPart(
								'citation',
								[new LanguageModelTextPart(JSON.stringify(citationData, null, 2))]
							));
						}
					}
				} else if (chunk.delta.type === 'thinking_delta') {
					if (pendingThinking) {
						pendingThinking.thinking = (pendingThinking.thinking || '') + (chunk.delta.thinking || '');
						progress.report(new LanguageModelThinkingPart(chunk.delta.thinking || ''));
					}
				} else if (chunk.delta.type === 'signature_delta') {
					// Accumulate signature
					if (pendingThinking) {
						pendingThinking.signature = (pendingThinking.signature || '') + (chunk.delta.signature || '');
					}
				} else if (chunk.delta.type === 'input_json_delta' && pendingToolCall) {
					pendingToolCall.jsonInput = (pendingToolCall.jsonInput || '') + (chunk.delta.partial_json || '');

					try {
						// Try to parse the accumulated JSON to see if it's complete
						const parsedJson = JSON.parse(pendingToolCall.jsonInput);
						progress.report(new LanguageModelToolCallPart(
							pendingToolCall.toolId!,
							pendingToolCall.name!,
							parsedJson
						));
						pendingToolCall = undefined;
					} catch {
						// JSON is not complete yet, continue accumulating
						continue;
					}
				} else if (chunk.delta.type === 'input_json_delta' && pendingServerToolCall) {
					pendingServerToolCall.jsonInput = (pendingServerToolCall.jsonInput || '') + (chunk.delta.partial_json || '');
				}
			}

			if (chunk.type === 'content_block_stop') {
				if (pendingToolCall) {
					try {
						const parsedJson = JSON.parse(pendingToolCall.jsonInput || '{}');
						progress.report(
							new LanguageModelToolCallPart(
								pendingToolCall.toolId!,
								pendingToolCall.name!,
								parsedJson
							)
						);
					} catch (e) {
						console.error('Failed to parse tool call JSON:', e);
					}
					pendingToolCall = undefined;
				} else if (pendingThinking) {
					if (pendingThinking.signature) {
						const finalThinkingPart = new LanguageModelThinkingPart('');
						finalThinkingPart.metadata = {
							signature: pendingThinking.signature,
							_completeThinking: pendingThinking.thinking
						};
						progress.report(finalThinkingPart);
					}
					pendingThinking = undefined;
				} else if (pendingRedactedThinking) {
					pendingRedactedThinking = undefined;
				}
			}

			if (chunk.type === 'message_start') {
				// TODO final output tokens: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":46}}
				usage = {
					completion_tokens: -1,
					prompt_tokens: chunk.message.usage.input_tokens + (chunk.message.usage.cache_creation_input_tokens ?? 0) + (chunk.message.usage.cache_read_input_tokens ?? 0),
					total_tokens: -1,
					prompt_tokens_details: {
						cached_tokens: chunk.message.usage.cache_read_input_tokens ?? 0,
						cache_creation_input_tokens: chunk.message.usage.cache_creation_input_tokens
					} as any
				};
			} else if (usage && chunk.type === 'message_delta') {
				if (chunk.usage.output_tokens) {
					usage.completion_tokens = chunk.usage.output_tokens;
					usage.total_tokens = usage.prompt_tokens + chunk.usage.output_tokens;
				}
				// Handle context management response
				if ('context_management' in chunk && chunk.context_management) {
					contextManagementResponse = chunk.context_management as ContextManagementResponse;
					const totalClearedTokens = contextManagementResponse.applied_edits.reduce(
						(sum, edit) => sum + (edit.cleared_input_tokens || 0),
						0
					);
					this._logService.info(`BYOK Anthropic context editing applied: cleared ${totalClearedTokens} tokens across ${contextManagementResponse.applied_edits.length} edits`);
					// Emit context management via LanguageModelDataPart so it flows through to toolCallingLoop
					progress.report(new LanguageModelDataPart(
						new TextEncoder().encode(JSON.stringify(contextManagementResponse)),
						CustomDataPartMimeTypes.ContextManagement
					));
				}
			}
		}

		return { ttft, usage, contextManagement: contextManagementResponse };
	}
}
