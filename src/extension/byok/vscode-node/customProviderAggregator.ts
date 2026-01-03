/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource, Event, EventEmitter, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKAuthType, BYOKModelProvider } from '../common/byokProvider';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { IBYOKStorageService } from './byokStorageService';
import { CustomProvider } from './customProvider';

interface ModelProviderMapping {
	model: LanguageModelChatInformation;
	provider: CustomProvider;
	providerId: string;
}

/**
 * Aggregates multiple custom providers into a single VS Code language model provider.
 * This solves the problem where VS Code only shows models from one provider when
 * multiple providers are registered with the same vendor name.
 */
export class CustomProviderAggregator implements BYOKModelProvider<LanguageModelChatInformation> {
	public readonly authType: BYOKAuthType = BYOKAuthType.GlobalApiKey;

	private readonly _providers: Map<string, CustomProvider> = new Map();
	private _modelProviderMap: Map<string, ModelProviderMapping> = new Map();

	private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation: Event<void> = this._onDidChangeLanguageModelChatInformation.event;

	constructor(
		private readonly _byokStorageService: IBYOKStorageService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		this._logService.info('CustomProviderAggregator: Created');
	}

	/**
	 * Add a custom provider to the aggregator
	 */
	addProvider(providerId: string, config: CustomProviderConfig): void {
		if (this._providers.has(providerId)) {
			this._logService.warn(`CustomProviderAggregator: Provider '${providerId}' already exists`);
			return;
		}

		const provider = this._instantiationService.createInstance(
			CustomProvider,
			providerId,
			config,
			this._byokStorageService
		);

		// Listen to provider's model changes
		provider.onDidChangeLanguageModelChatInformation(() => {
			this._rebuildModelMap();
			this._onDidChangeLanguageModelChatInformation.fire();
		});

		this._providers.set(providerId, provider);
		this._logService.info(`CustomProviderAggregator: Added provider '${config.name}' (${providerId})`);

		// Rebuild model map and notify
		this._rebuildModelMapAsync();
	}

	/**
	 * Remove a custom provider from the aggregator
	 */
	removeProvider(providerId: string): void {
		const provider = this._providers.get(providerId);
		if (provider) {
			this._providers.delete(providerId);
			// Remove models from this provider
			for (const [modelId, mapping] of this._modelProviderMap) {
				if (mapping.providerId === providerId) {
					this._modelProviderMap.delete(modelId);
				}
			}
			this._onDidChangeLanguageModelChatInformation.fire();
			this._logService.info(`CustomProviderAggregator: Removed provider '${providerId}'`);
		}
	}

	/**
	 * Check if a provider exists
	 */
	hasProvider(providerId: string): boolean {
		return this._providers.has(providerId);
	}

	/**
	 * Get a specific provider
	 */
	getProvider(providerId: string): CustomProvider | undefined {
		return this._providers.get(providerId);
	}

	/**
	 * Get all provider IDs
	 */
	getProviderIds(): string[] {
		return Array.from(this._providers.keys());
	}

	/**
	 * Rebuild the model-to-provider mapping asynchronously
	 */
	private async _rebuildModelMapAsync(): Promise<void> {
		await this._rebuildModelMap();
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	/**
	 * Rebuild the model-to-provider mapping
	 */
	private async _rebuildModelMap(): Promise<void> {
		this._modelProviderMap.clear();
		const tokenSource = new CancellationTokenSource();

		for (const [providerId, provider] of this._providers) {
			try {
				const models = await provider.provideLanguageModelChatInformation({ silent: true }, tokenSource.token);
				if (models) {
					for (const model of models) {
						// Use a unique key that includes the provider ID to avoid conflicts
						const uniqueModelId = `${providerId}:${model.id}`;
						this._modelProviderMap.set(uniqueModelId, {
							model: { ...model, id: uniqueModelId },
							provider,
							providerId
						});
					}
				}
			} catch (e) {
				this._logService.warn(`CustomProviderAggregator: Failed to get models from '${providerId}': ${e}`);
			}
		}

		tokenSource.dispose();
		this._logService.info(`CustomProviderAggregator: Model map rebuilt with ${this._modelProviderMap.size} models`);
	}

	/**
	 * Trigger model change event
	 */
	fireModelChange(): void {
		this._rebuildModelMapAsync();
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		// Rebuild model map if empty
		if (this._modelProviderMap.size === 0 && this._providers.size > 0) {
			await this._rebuildModelMap();
		}

		return Array.from(this._modelProviderMap.values()).map(m => m.model);
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		const mapping = this._modelProviderMap.get(model.id);
		if (!mapping) {
			throw new Error(`CustomProviderAggregator: Unknown model '${model.id}'`);
		}

		// Extract the original model ID (without provider prefix)
		const originalModelId = model.id.split(':').slice(1).join(':');
		const originalModel = { ...model, id: originalModelId };

		return mapping.provider.provideLanguageModelChatResponse(
			originalModel,
			messages,
			options,
			progress,
			token
		);
	}

	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatMessage | LanguageModelChatMessage2,
		token: CancellationToken
	): Promise<number> {
		const mapping = this._modelProviderMap.get(model.id);
		if (!mapping) {
			// Fallback to a simple estimate
			const content = typeof text === 'string' ? text : '';
			return Math.ceil(content.length / 4);
		}

		// Extract the original model ID (without provider prefix)
		const originalModelId = model.id.split(':').slice(1).join(':');
		const originalModel = { ...model, id: originalModelId };

		return mapping.provider.provideTokenCount(originalModel, text, token);
	}

	async updateAPIKey(): Promise<void> {
		// This method is not directly used for the aggregator
		// Individual providers manage their own API keys
		const { window } = await import('vscode');
		window.showInformationMessage('Use "Manage Custom Providers" to configure API keys for individual providers.');
	}
}
