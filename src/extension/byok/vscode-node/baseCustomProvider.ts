/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, Event, EventEmitter, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { BYOKAuthType, BYOKKnownModels, BYOKModelProvider } from '../common/byokProvider';
import { APIFormat, CustomProviderConfig } from '../common/customProviderTypes';
import { detectThinkingCapability, detectToolCallingCapability, detectVisionCapability, filterModelsByAPIFormat, modelsToAPIInfo } from '../common/customProviderUtils';
import { IBYOKStorageService } from './byokStorageService';
import { promptForAPIKey } from './byokUIService';

/**
 * Abstract base class for custom providers.
 * Provides shared functionality for API key management, model discovery, and event handling.
 */
export abstract class BaseCustomProvider implements BYOKModelProvider<LanguageModelChatInformation> {
	public readonly authType: BYOKAuthType = BYOKAuthType.GlobalApiKey;
	protected _apiKey: string | undefined;
	protected _cachedModels: BYOKKnownModels | undefined;

	private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation: Event<void> = this._onDidChangeLanguageModelChatInformation.event;

	constructor(
		public readonly providerId: string,
		protected readonly _config: CustomProviderConfig,
		protected readonly _byokStorageService: IBYOKStorageService,
		protected readonly _fetcherService: IFetcherService,
		protected readonly _logService: ILogService
	) {
		this._logService.info(`${this.constructor.name}: Created provider '${this._config.name}' (${providerId})`);
	}

	/**
	 * Notify VS Code that the model list has changed
	 */
	fireModelChange(): void {
		this._logService.info(`${this.constructor.name}: Firing model change event for '${this._config.name}'`);
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
	 * Fetch available models from the provider endpoint.
	 * Must be implemented by each format-specific provider.
	 */
	protected abstract _fetchModels(apiKey: string): Promise<BYOKKnownModels>;

	/**
	 * Parse model capabilities from API response.
	 * Uses shared utility functions for capability detection.
	 */
	protected _parseModelCapabilities(model: Record<string, unknown>, modelId: string): {
		name: string;
		maxInputTokens: number;
		maxOutputTokens: number;
		toolCalling: boolean;
		vision: boolean;
		thinking: boolean;
	} {
		return {
			name: (model.display_name || model.displayName || model.name || modelId) as string,
			maxInputTokens: (model.context_length || model.inputTokenLimit || 128000) as number,
			maxOutputTokens: (model.max_output_tokens || model.outputTokenLimit || 16000) as number,
			toolCalling: detectToolCallingCapability(model, modelId),
			vision: detectVisionCapability(model, modelId),
			thinking: detectThinkingCapability(model, modelId)
		};
	}

	/**
	 * Convert models to API info format.
	 * Filters models to only include those that match the provider's API format.
	 */
	protected _modelsToAPIInfo(models: BYOKKnownModels): LanguageModelChatInformation[] {
		const originalCount = Object.keys(models).length;
		const originalModelIds = Object.keys(models);

		// Filter models to only include those matching the API format
		const filteredModels = filterModelsByAPIFormat(models, this._config.apiFormat);
		const filteredCount = Object.keys(filteredModels).length;
		const filteredModelIds = Object.keys(filteredModels);

		// Log filtering details for visibility
		const excludedModels = originalModelIds.filter(id => !filteredModelIds.includes(id));
		this._logService.info(
			`${this.constructor.name}: Model filtering for '${this._config.name}' (format: ${this._config.apiFormat})\n` +
			`  - Total models from API: ${originalCount}\n` +
			`  - Models matching format: ${filteredCount}\n` +
			`  - Included: [${filteredModelIds.join(', ')}]\n` +
			`  - Excluded: [${excludedModels.join(', ')}]`
		);

		return modelsToAPIInfo(filteredModels, this._config, this.providerId);
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
			this._logService.error(`${this.constructor.name}: Error fetching models for ${this._config.name}:`, error);
			return [];
		}
	}

	/**
	 * Provide language model chat response.
	 * Must be implemented by each format-specific provider.
	 */
	abstract provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void>;

	/**
	 * Provide token count for a message.
	 * Default implementation uses a simple heuristic.
	 */
	async provideTokenCount(
		_model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage | LanguageModelChatMessage2,
		_token: CancellationToken
	): Promise<number> {
		// Default fallback: estimate based on character count
		const content = typeof text === 'string' ? text : '';
		return Math.ceil(content.length / 4);
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
