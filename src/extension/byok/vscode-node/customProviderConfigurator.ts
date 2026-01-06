/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickInputButtons, QuickPickItem, window } from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { BYOKAuthType } from '../common/byokProvider';
import { APIFormat, APIFormatLabels, CustomProviderConfig, generateProviderId } from '../common/customProviderTypes';
import { IBYOKStorageService } from './byokStorageService';

type BackButtonClick = { back: true };

function isBackButtonClick(value: unknown): value is BackButtonClick {
	return typeof value === 'object' && (value as BackButtonClick)?.back === true;
}

interface ProviderQuickPickItem extends QuickPickItem {
	providerId?: string;
	action?: 'add' | 'edit' | 'delete';
}

interface APIFormatQuickPickItem extends QuickPickItem {
	format: APIFormat;
}

export class CustomProviderConfigurator {
	constructor(
		private readonly _configurationService: IConfigurationService,
		private readonly _byokStorageService: IBYOKStorageService
	) { }

	/**
	 * Main entry point - shows provider list or adds new provider
	 */
	async configure(): Promise<{ providerId: string; config: CustomProviderConfig } | undefined> {
		while (true) {
			// Re-read providers on each iteration to reflect any changes
			const providers = this._getProviderConfigs();
			const items: ProviderQuickPickItem[] = [];

			// Add existing providers
			for (const [providerId, config] of Object.entries(providers)) {
				items.push({
					label: config.name,
					description: providerId,
					detail: `${APIFormatLabels[config.apiFormat]} • ${config.baseUrl}`,
					providerId,
					action: 'edit'
				});
			}

			// Add separator and actions
			if (items.length > 0) {
				items.push({ label: '', kind: -1 }); // Separator
			}

			items.push({
				label: '$(add) Add New Custom Provider',
				detail: 'Configure a new custom model provider',
				action: 'add'
			});

			const quickPick = window.createQuickPick<ProviderQuickPickItem>();
			quickPick.title = 'Custom Providers';
			quickPick.placeholder = 'Select a provider to edit or add a new one';
			quickPick.items = items;
			quickPick.ignoreFocusOut = true;

			const selected = await new Promise<ProviderQuickPickItem | undefined>((resolve) => {
				const disposableStore = new DisposableStore();

				disposableStore.add(quickPick.onDidAccept(() => {
					resolve(quickPick.selectedItems[0]);
					quickPick.hide();
				}));

				disposableStore.add(quickPick.onDidHide(() => {
					resolve(undefined);
					disposableStore.dispose();
				}));

				quickPick.show();
			});

			if (!selected) {
				return undefined;
			}

			if (selected.action === 'add') {
				const result = await this._configureNewProvider();
				if (result) {
					// Re-read latest config before updating
					const currentProviders = this._getProviderConfigs();
					const updatedProviders = { ...currentProviders, [result.providerId]: result.config };
					await this._configurationService.setConfig(ConfigKey.CustomProviders, updatedProviders);
					return { providerId: result.providerId, config: result.config };
				}
			} else if (selected.action === 'edit' && selected.providerId) {
				const result = await this._editProvider(selected.providerId, providers[selected.providerId]);
				if (result) {
					if (result.action === 'selectModel') {
						// Return the providerId so caller can open model selector for this provider
						return { providerId: selected.providerId, config: result.config, selectModel: true } as any;
					}
					// Re-read latest config before updating
					const currentProviders = this._getProviderConfigs();
					if (result.action === 'update') {
						const updatedProviders = { ...currentProviders, [selected.providerId]: result.config };
						await this._configurationService.setConfig(ConfigKey.CustomProviders, updatedProviders);
					} else if (result.action === 'delete') {
						const updatedProviders = { ...currentProviders };
						delete updatedProviders[selected.providerId];
						await this._configurationService.setConfig(ConfigKey.CustomProviders, updatedProviders);
						// Also delete the API key
						await this._byokStorageService.deleteAPIKey(selected.providerId, BYOKAuthType.GlobalApiKey);
					}
				}
			}
		}
	}

	/**
	 * Direct add flow - skips the list and goes straight to adding
	 */
	async addProvider(): Promise<{ providerId: string; config: CustomProviderConfig } | undefined> {
		const result = await this._configureNewProvider();
		if (result) {
			const providers = this._getProviderConfigs();
			const updatedProviders = { ...providers, [result.providerId]: result.config };
			await this._configurationService.setConfig(ConfigKey.CustomProviders, updatedProviders);
			return { providerId: result.providerId, config: result.config };
		}
		return undefined;
	}

	private _getProviderConfigs(): Record<string, CustomProviderConfig> {
		return this._configurationService.getConfig(ConfigKey.CustomProviders);
	}

	private async _configureNewProvider(): Promise<{ providerId: string; config: CustomProviderConfig } | undefined> {
		// Step 1: Provider Name
		const providerName = await this._createInputBox({
			title: 'Add Custom Provider (1/4) - Name',
			prompt: 'Enter a display name for this provider',
			placeHolder: 'e.g., My Local LLM',
			validateInput: (value) => {
				if (!value.trim()) {
					return 'Provider name cannot be empty';
				}
				const providerId = generateProviderId(value);
				const existingProviders = this._getProviderConfigs();
				if (existingProviders[providerId]) {
					return 'A provider with this name already exists';
				}
				return null;
			}
		});

		if (!providerName || isBackButtonClick(providerName)) {
			return undefined;
		}

		// Step 2: Base URL
		const baseUrl = await this._createInputBox({
			title: 'Add Custom Provider (2/4) - Base URL',
			prompt: 'Enter the base URL for the provider API',
			placeHolder: 'e.g., http://localhost:8000 or https://api.example.com',
			validateInput: (value) => {
				if (!value.trim()) {
					return 'Base URL cannot be empty';
				}
				// Simple URL validation that works without the URL constructor
				const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
				if (!urlPattern.test(value.trim())) {
					return 'Please enter a valid URL (e.g., http://localhost:8000 or https://api.example.com)';
				}
				return null;
			}
		});

		if (!baseUrl || isBackButtonClick(baseUrl)) {
			return undefined;
		}

		// Step 3: API Format
		const apiFormat = await this._selectAPIFormat();
		if (!apiFormat || isBackButtonClick(apiFormat)) {
			return undefined;
		}

		// Step 4: API Token
		const apiToken = await this._createInputBox({
			title: 'Add Custom Provider (4/4) - API Token',
			prompt: 'Enter the API token for authentication',
			placeHolder: 'API Token',
			password: true,
			validateInput: (value) => {
				if (!value.trim()) {
					return 'API token cannot be empty';
				}
				return null;
			}
		});

		if (!apiToken || isBackButtonClick(apiToken)) {
			return undefined;
		}

		const providerId = generateProviderId(providerName);
		const config: CustomProviderConfig = {
			name: providerName.trim(),
			baseUrl: baseUrl.trim().replace(/\/$/, ''), // Remove trailing slash
			apiFormat
		};

		// Store the API key
		await this._byokStorageService.storeAPIKey(providerId, apiToken.trim(), BYOKAuthType.GlobalApiKey);

		return { providerId, config };
	}

	private async _editProvider(
		providerId: string,
		existingConfig: CustomProviderConfig
	): Promise<{ action: 'update' | 'delete' | 'selectModel'; config: CustomProviderConfig } | undefined> {
		interface EditActionQuickPickItem extends QuickPickItem {
			action: 'selectModel' | 'updateUrl' | 'updateFormat' | 'updateToken' | 'delete';
		}

		const options: EditActionQuickPickItem[] = [
			{
				label: '$(list-selection) Select Models',
				detail: 'Choose models from this provider to use',
				action: 'selectModel'
			},
			{
				label: '$(link) Update Base URL',
				detail: `Current: ${existingConfig.baseUrl}`,
				action: 'updateUrl'
			},
			{
				label: '$(symbol-enum) Change API Format',
				detail: `Current: ${APIFormatLabels[existingConfig.apiFormat]}`,
				action: 'updateFormat'
			},
			{
				label: '$(key) Update API Token',
				detail: 'Change the API token for this provider',
				action: 'updateToken'
			},
			{
				label: '$(trash) Delete Provider',
				detail: 'Remove this provider and its configuration',
				action: 'delete'
			}
		];

		const quickPick = window.createQuickPick<EditActionQuickPickItem>();
		quickPick.title = `Edit Provider: ${existingConfig.name}`;
		quickPick.placeholder = 'Choose an action';
		quickPick.items = options;
		quickPick.ignoreFocusOut = true;
		quickPick.buttons = [QuickInputButtons.Back];

		const selected = await new Promise<EditActionQuickPickItem | BackButtonClick | undefined>((resolve) => {
			const disposableStore = new DisposableStore();

			disposableStore.add(quickPick.onDidTriggerButton(button => {
				if (button === QuickInputButtons.Back) {
					resolve({ back: true });
					quickPick.hide();
				}
			}));

			disposableStore.add(quickPick.onDidAccept(() => {
				resolve(quickPick.selectedItems[0]);
				quickPick.hide();
			}));

			disposableStore.add(quickPick.onDidHide(() => {
				resolve(undefined);
				disposableStore.dispose();
			}));

			quickPick.show();
		});

		if (!selected || isBackButtonClick(selected)) {
			return undefined;
		}

		switch (selected.action) {
			case 'selectModel': {
				// Return selectModel action - the caller will handle opening model selector
				return { action: 'selectModel', config: existingConfig };
			}
			case 'updateUrl': {
				const newUrl = await this._createInputBox({
					title: `Update Base URL - ${existingConfig.name}`,
					prompt: 'Enter the new base URL',
					placeHolder: existingConfig.baseUrl,
					value: existingConfig.baseUrl,
					validateInput: (value) => {
						if (!value.trim()) {
							return 'Base URL cannot be empty';
						}
						// Simple URL validation that works without the URL constructor
						const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
						if (!urlPattern.test(value.trim())) {
							return 'Please enter a valid URL (e.g., http://localhost:8000 or https://api.example.com)';
						}
						return null;
					}
				});
				if (newUrl && !isBackButtonClick(newUrl)) {
					return {
						action: 'update',
						config: { ...existingConfig, baseUrl: newUrl.trim().replace(/\/$/, '') }
					};
				}
				break;
			}
			case 'updateFormat': {
				const newFormat = await this._selectAPIFormat(existingConfig.apiFormat);
				if (newFormat && !isBackButtonClick(newFormat)) {
					return {
						action: 'update',
						config: { ...existingConfig, apiFormat: newFormat }
					};
				}
				break;
			}
			case 'updateToken': {
				const newToken = await this._createInputBox({
					title: `Update API Token - ${existingConfig.name}`,
					prompt: 'Enter the new API token',
					placeHolder: 'New API Token',
					password: true,
					validateInput: (value) => {
						if (!value.trim()) {
							return 'API token cannot be empty';
						}
						return null;
					}
				});
				if (newToken && !isBackButtonClick(newToken)) {
					await this._byokStorageService.storeAPIKey(providerId, newToken.trim(), BYOKAuthType.GlobalApiKey);
					return { action: 'update', config: existingConfig };
				}
				break;
			}
			case 'delete': {
				const confirm = await window.showWarningMessage(
					`Are you sure you want to delete the provider "${existingConfig.name}"?`,
					{ modal: true },
					'Delete'
				);
				if (confirm === 'Delete') {
					return { action: 'delete', config: existingConfig };
				}
				break;
			}
		}

		return undefined;
	}

	private async _selectAPIFormat(currentFormat?: APIFormat): Promise<APIFormat | BackButtonClick | undefined> {
		const items: APIFormatQuickPickItem[] = [
			{
				label: APIFormatLabels['openai-chat'],
				description: currentFormat === 'openai-chat' ? '(current)' : undefined,
				detail: 'Standard OpenAI Chat Completions API format',
				format: 'openai-chat'
			},
			{
				label: APIFormatLabels['openai-responses'],
				description: currentFormat === 'openai-responses' ? '(current)' : undefined,
				detail: 'OpenAI Responses API format',
				format: 'openai-responses'
			},
			{
				label: APIFormatLabels['gemini'],
				description: currentFormat === 'gemini' ? '(current)' : undefined,
				detail: 'Google Gemini API format',
				format: 'gemini'
			},
			{
				label: APIFormatLabels['claude'],
				description: currentFormat === 'claude' ? '(current)' : undefined,
				detail: 'Anthropic Claude Messages API format',
				format: 'claude'
			}
		];

		const quickPick = window.createQuickPick<APIFormatQuickPickItem>();
		quickPick.title = 'Add Custom Provider (3/4) - API Format';
		quickPick.placeholder = 'Select the API format used by this provider';
		quickPick.items = items;
		quickPick.ignoreFocusOut = true;
		quickPick.buttons = [QuickInputButtons.Back];

		return new Promise<APIFormat | BackButtonClick | undefined>((resolve) => {
			const disposableStore = new DisposableStore();

			disposableStore.add(quickPick.onDidTriggerButton(button => {
				if (button === QuickInputButtons.Back) {
					resolve({ back: true });
					quickPick.hide();
				}
			}));

			disposableStore.add(quickPick.onDidAccept(() => {
				const selected = quickPick.selectedItems[0];
				resolve(selected?.format);
				quickPick.hide();
			}));

			disposableStore.add(quickPick.onDidHide(() => {
				resolve(undefined);
				disposableStore.dispose();
			}));

			quickPick.show();
		});
	}

	private _createInputBox(options: {
		title: string;
		prompt: string;
		placeHolder: string;
		value?: string;
		password?: boolean;
		validateInput?: (value: string) => string | null;
	}): Promise<string | BackButtonClick | undefined> {
		const disposableStore = new DisposableStore();
		const inputBox = disposableStore.add(window.createInputBox());
		inputBox.ignoreFocusOut = true;
		inputBox.title = options.title;
		inputBox.prompt = options.prompt;
		inputBox.placeholder = options.placeHolder;
		inputBox.value = options.value || '';
		inputBox.password = options.password || false;
		inputBox.buttons = [QuickInputButtons.Back];

		return new Promise<string | BackButtonClick | undefined>(resolve => {
			disposableStore.add(inputBox.onDidTriggerButton(button => {
				if (button === QuickInputButtons.Back) {
					resolve({ back: true });
					disposableStore.dispose();
				}
			}));

			disposableStore.add(inputBox.onDidAccept(async () => {
				const value = inputBox.value;
				if (options.validateInput) {
					const validation = options.validateInput(value);
					if (validation) {
						inputBox.validationMessage = validation;
						return;
					}
				}
				resolve(value);
				disposableStore.dispose();
			}));

			disposableStore.add(inputBox.onDidHide(() => {
				resolve(undefined);
				disposableStore.dispose();
			}));

			inputBox.show();
		});
	}
}
