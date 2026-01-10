/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, LanguageModelChatInformation } from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKAuthType, BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';
import { BaseOpenAICompatibleLMProvider } from './baseOpenAICompatibleProvider';
import { IBYOKStorageService } from './byokStorageService';
import { BYOK_OFFICIAL_URLS, configureBYOKProviderWithCustomUrl, showConfigurationMenu } from './byokUIService';

export class OAIBYOKLMProvider extends BaseOpenAICompatibleLMProvider {
	public static readonly providerName = 'OpenAI';
	public static readonly officialBaseUrl = BYOK_OFFICIAL_URLS.OpenAI;
	private _isCustomUrl: boolean = false;

	constructor(
		knownModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super(
			BYOKAuthType.GlobalApiKey,
			OAIBYOKLMProvider.providerName,
			OAIBYOKLMProvider.officialBaseUrl,
			knownModels,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
		);
	}

	/**
	 * Override to support custom URL from configuration
	 */
	protected override getBaseUrl(): string {
		const customUrl = this._configurationService.getConfig(ConfigKey.BYOKOpenAIBaseUrl);
		if (customUrl && customUrl.trim()) {
			this._isCustomUrl = true;
			return customUrl.trim().replace(/\/+$/, ''); // Normalize by removing trailing slashes
		}
		this._isCustomUrl = false;
		return OAIBYOKLMProvider.officialBaseUrl;
	}

	/**
	 * Check if using a custom URL
	 */
	public isUsingCustomUrl(): boolean {
		return this._isCustomUrl;
	}

	protected override async getModelInfo(modelId: string, apiKey: string | undefined, modelCapabilities?: BYOKModelCapabilities): Promise<IChatModelInformation> {
		const modelInfo = await super.getModelInfo(modelId, apiKey, modelCapabilities);
		modelInfo.supported_endpoints = [
			ModelSupportedEndpoint.ChatCompletions,
			ModelSupportedEndpoint.Responses
		];

		return modelInfo;
	}

	override async provideLanguageModelChatInformation(options: { silent: boolean }, token: CancellationToken): Promise<LanguageModelChatInformation[]> {
		// Trigger base URL check first
		this.getBaseUrl();

		const models = await super.provideLanguageModelChatInformation(options, token);

		// Add custom suffix if using custom URL
		if (this._isCustomUrl && models.length > 0) {
			return models.map(model => ({
				...model,
				vendor: `${OAIBYOKLMProvider.providerName} (Custom)`
			}));
		}
		return models;
	}

	override async updateAPIKey(): Promise<void> {
		const currentBaseUrl = this.getBaseUrl();
		const hasExistingConfig = this._apiKey !== undefined;

		if (hasExistingConfig) {
			const action = await showConfigurationMenu(OAIBYOKLMProvider.providerName, currentBaseUrl);
			if (!action) {
				return;
			}

			if (action === 'view') {
				return;
			} else if (action === 'reset') {
				await this._configurationService.setConfig(ConfigKey.BYOKOpenAIBaseUrl, '');
				this._apiKey = undefined;
				this._isCustomUrl = false;
				// Also delete API key from storage
				await this._byokStorageService.deleteAPIKey(OAIBYOKLMProvider.providerName, this.authType, undefined, true);
				return;
			}
		}

		const result = await configureBYOKProviderWithCustomUrl(
			OAIBYOKLMProvider.providerName,
			currentBaseUrl !== OAIBYOKLMProvider.officialBaseUrl ? currentBaseUrl : undefined,
			async (baseUrl, apiKey) => {
				try {
					const response = await this._fetcherService.fetch(`${baseUrl}/models`, {
						method: 'GET',
						headers: {
							'Authorization': `Bearer ${apiKey}`,
							'Content-Type': 'application/json'
						}
					});
					const data = await response.json();
					if (data.error) {
						return { success: false, error: data.error.message || 'API error' };
					}
					return { success: true, modelCount: data.data?.length || 0 };
				} catch (error) {
					return { success: false, error: error instanceof Error ? error.message : String(error) };
				}
			}
		);

		if (result.cancelled) {
			return;
		}

		if (result.baseUrl && result.baseUrl !== OAIBYOKLMProvider.officialBaseUrl) {
			await this._configurationService.setConfig(ConfigKey.BYOKOpenAIBaseUrl, result.baseUrl);
		} else {
			await this._configurationService.setConfig(ConfigKey.BYOKOpenAIBaseUrl, '');
		}

		if (result.apiKey) {
			this._apiKey = result.apiKey;
			await this._byokStorageService.storeAPIKey(
				OAIBYOKLMProvider.providerName,
				result.apiKey,
				this.authType,
				undefined,
				result.isCustomUrl
			);
		}
	}
}
