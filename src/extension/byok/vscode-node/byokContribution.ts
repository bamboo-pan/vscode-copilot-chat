/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { commands, LanguageModelChatInformation, lm } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ICAPIClientService } from '../../../platform/endpoint/common/capiClient';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelProvider, isBYOKEnabled } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { CustomProviderConfig } from '../common/customProviderTypes';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { CustomOAIModelConfigurator } from './customOAIModelConfigurator';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { CustomProviderAggregator } from './customProviderAggregator';
import { CustomProviderConfigurator } from './customProviderConfigurator';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, BYOKModelProvider<LanguageModelChatInformation>> = new Map();
	private _customProviderAggregator: CustomProviderAggregator | undefined;
	private _byokProvidersRegistered = false;

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ICAPIClientService private readonly _capiClientService: ICAPIClientService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService authService: IAuthenticationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		// Initialize storage service FIRST before registering commands that use it
		this._byokStorageService = new BYOKStorageService(extensionContext);

		this._register(commands.registerCommand('github.copilot.chat.manageBYOK', async (vendor: string) => {
			// Handle custom provider configuration
			if (vendor === 'customize') {
				this._logService.info('BYOK: manageBYOK called with customize vendor');
				const configurator = new CustomProviderConfigurator(this._configurationService, this._byokStorageService);
				const result = await configurator.addProvider();
				if (result) {
					this._registerCustomProvider(result.providerId, result.config);
					this._logService.info(`BYOK: Custom provider '${result.config.name}' added successfully`);
				}
				return;
			}

			const provider = this._providers.get(vendor);

			// Show quick pick for Azure and CustomOAI providers
			if (provider && (vendor === AzureBYOKModelProvider.providerName.toLowerCase() || vendor === CustomOAIBYOKModelProvider.providerName.toLowerCase())) {
				const configurator = new CustomOAIModelConfigurator(this._configurationService, vendor, provider);
				await configurator.configureModelOrUpdateAPIKey();
			} else if (provider) {
				// For all other providers, directly go to API key management
				await provider.updateAPIKey();
			}
		}));

		this._register(commands.registerCommand('github.copilot.chat.manageBYOKAPIKey', async (vendor: string, envVarName: string, action?: 'update' | 'remove', modelId?: string) => {
			const provider = this._providers.get(vendor);
			if (!provider) {
				this._logService.error(`BYOK: Provider ${vendor} not found`);
				return;
			}

			try {
				if (provider.updateAPIKeyViaCmd) {
					await provider.updateAPIKeyViaCmd(envVarName, action ?? 'update', modelId);
				} else {
					this._logService.error(`BYOK: Provider ${vendor} does not support API key management via command`);
				}
			} catch (error) {
				this._logService.error(`BYOK: Failed to ${action || 'update'} API key for provider ${vendor}${modelId ? ` and model ${modelId}` : ''}`, error);
				throw error;
			}
		}));

		// Register command for custom provider configuration
		this._register(commands.registerCommand('github.copilot.chat.customizeProvider', async () => {
			this._logService.info('BYOK: customizeProvider command invoked');
			try {
				const configurator = new CustomProviderConfigurator(this._configurationService, this._byokStorageService);
				const result = await configurator.addProvider();
				if (result) {
					// Register the newly added provider
					this._registerCustomProvider(result.providerId, result.config);
					this._logService.info(`BYOK: Custom provider '${result.config.name}' added successfully`);
				}
			} catch (error) {
				this._logService.error('BYOK: Error in customizeProvider command', error);
				throw error;
			}
		}));

		// Register command to manage custom providers
		this._register(commands.registerCommand('github.copilot.chat.manageCustomProviders', async () => {
			const configurator = new CustomProviderConfigurator(this._configurationService, this._byokStorageService);
			const result = await configurator.configure() as { providerId: string; config: CustomProviderConfig; selectModel?: boolean } | undefined;
			// Refresh custom providers after configuration changes
			this._refreshCustomProviders();

			// If user selected "Select Models", show model picker for that provider
			if (result?.selectModel && result.providerId && this._customProviderAggregator) {
				const provider = this._customProviderAggregator.getProvider(result.providerId);
				if (provider) {
					await this._showModelsForProvider(result.providerId, provider);
				}
			}
		}));

		this._register(authService.onDidAuthenticationChange(() => {
			this._authChange(authService, this._instantiationService);
		}));
	}

	private async _authChange(authService: IAuthenticationService, instantiationService: IInstantiationService) {
		if (authService.copilotToken && isBYOKEnabled(authService.copilotToken, this._capiClientService) && !this._byokProvidersRegistered) {
			this._byokProvidersRegistered = true;
			// Update known models list from CDN so all providers have the same list
			const knownModels = await this.fetchKnownModelList(this._fetcherService);
			this._providers.set(OllamaLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OllamaLMProvider, this._configurationService.getConfig(ConfigKey.OllamaEndpoint), this._byokStorageService));
			this._providers.set(AnthropicLMProvider.providerName.toLowerCase(), instantiationService.createInstance(AnthropicLMProvider, knownModels[AnthropicLMProvider.providerName], this._byokStorageService));
			this._providers.set(GeminiNativeBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(GeminiNativeBYOKLMProvider, knownModels[GeminiNativeBYOKLMProvider.providerName], this._byokStorageService));
			this._providers.set(XAIBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(XAIBYOKLMProvider, knownModels[XAIBYOKLMProvider.providerName], this._byokStorageService));
			this._providers.set(OAIBYOKLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OAIBYOKLMProvider, knownModels[OAIBYOKLMProvider.providerName], this._byokStorageService));
			this._providers.set(OpenRouterLMProvider.providerName.toLowerCase(), instantiationService.createInstance(OpenRouterLMProvider, this._byokStorageService));
			this._providers.set(AzureBYOKModelProvider.providerName.toLowerCase(), instantiationService.createInstance(AzureBYOKModelProvider, this._byokStorageService));
			this._providers.set(CustomOAIBYOKModelProvider.providerName.toLowerCase(), instantiationService.createInstance(CustomOAIBYOKModelProvider, this._byokStorageService));

			// Create the Custom Providers aggregator for the 'custom' vendor
			this._customProviderAggregator = instantiationService.createInstance(
				CustomProviderAggregator,
				this._byokStorageService
			);
			this._providers.set('custom', this._customProviderAggregator);

			for (const [providerName, provider] of this._providers) {
				this._store.add(lm.registerLanguageModelChatProvider(providerName, provider));
			}

			// Register custom providers from configuration into the aggregator
			this._registerCustomProvidersFromConfig();
		}
	}

	/**
	 * Register a single custom provider into the aggregator
	 */
	private _registerCustomProvider(providerId: string, config: CustomProviderConfig): void {
		// Check if already registered
		if (this._customProviderAggregator?.hasProvider(providerId)) {
			this._logService.warn(`BYOK: Custom provider '${providerId}' is already registered`);
			return;
		}

		// Add to the aggregator which will create the appropriate provider
		if (this._customProviderAggregator) {
			this._customProviderAggregator.addProvider(providerId, config);
			this._logService.info(`BYOK: Registered custom provider '${config.name}' (${providerId}) into aggregator`);
		} else {
			this._logService.warn(`BYOK: Cannot register custom provider '${providerId}' - aggregator not initialized`);
		}
	}

	/**
	 * Register all custom providers from configuration
	 */
	private _registerCustomProvidersFromConfig(): void {
		const customProviders = this._configurationService.getConfig(ConfigKey.CustomProviders);

		for (const [providerId, config] of Object.entries(customProviders)) {
			this._registerCustomProvider(providerId, config);
		}
	}

	/**
	 * Refresh custom providers - unregister removed ones and register new ones
	 */
	private _refreshCustomProviders(): void {
		if (!this._customProviderAggregator) {
			this._logService.warn('BYOK: Cannot refresh custom providers - aggregator not initialized');
			return;
		}

		const customProviders = this._configurationService.getConfig(ConfigKey.CustomProviders);
		const currentProviderIds = new Set(Object.keys(customProviders));
		const existingProviderIds = this._customProviderAggregator.getProviderIds();

		// Unregister providers that are no longer in config
		for (const providerId of existingProviderIds) {
			if (!currentProviderIds.has(providerId)) {
				this._customProviderAggregator.removeProvider(providerId);
				this._logService.info(`BYOK: Removed custom provider '${providerId}' from aggregator`);
			}
		}

		// Register new providers or refresh existing ones
		for (const [providerId, config] of Object.entries(customProviders)) {
			if (!this._customProviderAggregator.hasProvider(providerId)) {
				this._registerCustomProvider(providerId, config);
			} else {
				// Trigger model refresh for existing providers
				const provider = this._customProviderAggregator.getProvider(providerId);
				if (provider) {
					provider.fireModelChange();
				}
			}
		}

		// Trigger aggregator to update its model list
		this._customProviderAggregator.fireModelChange();
	}

	/**
	 * Show a model picker for the specified provider
	 */
	private async _showModelsForProvider(providerId: string, provider: BYOKModelProvider<LanguageModelChatInformation>): Promise<void> {
		const { window, CancellationTokenSource } = await import('vscode');

		const tokenSource = new CancellationTokenSource();
		try {
			// Get models from the provider
			const models = await provider.provideLanguageModelChatInformation({ silent: false }, tokenSource.token);

			if (!models || models.length === 0) {
				window.showWarningMessage(`No models available from provider "${providerId}". Please check your API key and endpoint.`);
				return;
			}

			// Show quick pick with available models
			const items = models.map(model => ({
				label: model.name || model.id,
				description: model.id,
				detail: `Max tokens: ${model.maxInputTokens?.toLocaleString() || 'N/A'} input, ${model.maxOutputTokens?.toLocaleString() || 'N/A'} output`,
				model
			}));

			const selected = await window.showQuickPick(items, {
				title: `Models from ${providerId}`,
				placeHolder: 'Select a model to use in Chat'
			});

			if (selected) {
				// Show info message with instructions on how to use the model
				window.showInformationMessage(
					`Model "${selected.label}" is available. Use the model picker in Chat (click the model name at the top) to select it.`,
					'Open Chat'
				).then(action => {
					if (action === 'Open Chat') {
						commands.executeCommand('workbench.panel.chat.view.copilot.focus');
					}
				});
			}
		} catch (error) {
			this._logService.error(`BYOK: Error fetching models for provider ${providerId}:`, error);
			window.showErrorMessage(`Failed to fetch models: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			tokenSource.dispose();
		}
	}

	private async fetchKnownModelList(fetcherService: IFetcherService): Promise<Record<string, BYOKKnownModels>> {
		const data = await (await fetcherService.fetch('https://main.vscode-cdn.net/extensions/copilotChat.json', { method: 'GET' })).json();
		// Use this for testing with changes from a local file. Don't check in
		// const data = JSON.parse((await this._fileSystemService.readFile(URI.file('/Users/roblou/code/vscode-engineering/chat/copilotChat.json'))).toString());
		let knownModels: Record<string, BYOKKnownModels>;
		if (data.version !== 1) {
			this._logService.warn('BYOK: Copilot Chat known models list is not in the expected format. Defaulting to empty list.');
			knownModels = {};
		} else {
			knownModels = data.modelInfo;
		}
		this._logService.info('BYOK: Copilot Chat known models list fetched successfully.');
		return knownModels;
	}
}