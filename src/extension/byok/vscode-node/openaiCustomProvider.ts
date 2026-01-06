/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';
import { BYOKKnownModels, resolveModelInfo } from '../common/byokProvider';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { detectThinkingCapability } from '../common/customProviderUtils';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { BaseCustomProvider } from './baseCustomProvider';
import { IBYOKStorageService } from './byokStorageService';

/**
 * Custom provider for OpenAI Chat Completions API format.
 * Uses the /v1/chat/completions endpoint with Bearer token authentication.
 */
export class OpenAICustomProvider extends BaseCustomProvider {
	private readonly _lmWrapper: CopilotLanguageModelWrapper;

	constructor(
		providerId: string,
		config: CustomProviderConfig,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super(providerId, config, byokStorageService, fetcherService, logService);
		this._lmWrapper = this._instantiationService.createInstance(CopilotLanguageModelWrapper);
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

			this._logService.info(`OpenAICustomProvider: Fetched ${Object.keys(models).length} models from ${this._config.name}`);
		} catch (error) {
			this._logService.error(`OpenAICustomProvider: Error fetching models from ${this._config.name}:`, error);
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

		// Get thinking capability from cached models
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? detectThinkingCapability({}, model.id);

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
			this._apiKey,
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
	 * Build the chat completions URL
	 */
	private _buildChatUrl(): string {
		const url = this._config.baseUrl.replace(/\/$/, '');

		// Check if URL already has an explicit API path
		if (url.includes('/chat/completions')) {
			return url;
		}

		return `${url}/v1/chat/completions`;
	}

	override async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage | LanguageModelChatMessage2,
		_token: CancellationToken
	): Promise<number> {
		// Get thinking capability from cached models
		const cachedModelInfo = this._cachedModels?.[model.id];
		const hasThinking = cachedModelInfo?.thinking ?? detectThinkingCapability({}, model.id);

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
}
