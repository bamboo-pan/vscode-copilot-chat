/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessage, LanguageModelChatMessage2, LanguageModelResponsePart2, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { BYOKAuthType, BYOKModelProvider } from '../common/byokProvider';
import { IBYOKStorageService } from './byokStorageService';
import { CustomProviderConfigurator } from './customProviderConfigurator';

/**
 * A virtual provider for the "Customize..." menu item.
 * This provider doesn't provide any models itself - it exists solely to enable
 * the managementCommand to be triggered when users click "Customize..." in Add Models.
 */
export class CustomizeMenuProvider implements BYOKModelProvider<LanguageModelChatInformation> {
	static readonly providerName: string = 'customize';
	public readonly authType: BYOKAuthType = BYOKAuthType.PerModelDeployment;

	private _addProviderCallback: ((providerId: string, config: any) => void) | undefined;

	constructor(
		private readonly _byokStorageService: IBYOKStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._logService.info('BYOK: CustomizeMenuProvider initialized');
	}

	/**
	 * Set the callback to be called when a new provider is added
	 */
	setAddProviderCallback(callback: (providerId: string, config: any) => void): void {
		this._addProviderCallback = callback;
	}

	/**
	 * This is the key method - when user clicks "Customize..." in Add Models,
	 * VS Code calls this with silent: false, giving us a chance to show UI
	 */
	async provideLanguageModelChatInformation(options: { silent: boolean }, _token: CancellationToken): Promise<LanguageModelChatInformation[]> {
		// If silent mode, don't show any UI - just return empty (no models from this provider)
		if (options.silent) {
			return [];
		}

		// Non-silent mode = user explicitly clicked "Customize..."
		// Show the configuration wizard
		this._logService.info('BYOK: CustomizeMenuProvider.provideLanguageModelChatInformation called with silent=false, showing wizard');

		const configurator = new CustomProviderConfigurator(this._configurationService, this._byokStorageService);
		const result = await configurator.addProvider();

		if (result && this._addProviderCallback) {
			this._addProviderCallback(result.providerId, result.config);
			this._logService.info(`BYOK: Custom provider '${result.config.name}' added via Customize menu`);
		}

		// Always return empty - this provider itself doesn't provide models
		// The new custom provider will be registered separately
		return [];
	}

	/**
	 * This should never be called since we never provide any models
	 */
	async provideLanguageModelChatResponse(
		_model: LanguageModelChatInformation,
		_messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>,
		_options: ProvideLanguageModelChatResponseOptions,
		_progress: Progress<LanguageModelResponsePart2>,
		_token: CancellationToken
	): Promise<void> {
		throw new Error('CustomizeMenuProvider does not provide chat responses');
	}

	/**
	 * This should never be called since we never provide any models
	 */
	async provideTokenCount(
		_model: LanguageModelChatInformation,
		_text: string | LanguageModelChatMessage | LanguageModelChatMessage2,
		_token: CancellationToken
	): Promise<number> {
		throw new Error('CustomizeMenuProvider does not provide token counts');
	}

	/**
	 * Called when user clicks on "Customize..." in Add Models
	 * Opens the custom provider configuration wizard
	 */
	async updateAPIKey(): Promise<void> {
		this._logService.info('BYOK: CustomizeMenuProvider.updateAPIKey called - opening configuration wizard');

		const configurator = new CustomProviderConfigurator(this._configurationService, this._byokStorageService);
		const result = await configurator.addProvider();

		if (result && this._addProviderCallback) {
			this._addProviderCallback(result.providerId, result.config);
			this._logService.info(`BYOK: Custom provider '${result.config.name}' added via Customize menu`);
		}
	}
}
