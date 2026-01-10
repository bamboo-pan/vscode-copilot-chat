/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { InputBoxOptions, QuickInputButtons, QuickPickItem, window } from 'vscode';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';

type BackButtonClick = { back: true };
export function isBackButtonClick(value: unknown): value is BackButtonClick {
	return typeof value === 'object' && (value as BackButtonClick)?.back === true;
}

/**
 * Official base URLs for BYOK providers
 */
export const BYOK_OFFICIAL_URLS: Record<string, string> = {
	Anthropic: 'https://api.anthropic.com',
	OpenAI: 'https://api.openai.com/v1',
	Gemini: 'https://generativelanguage.googleapis.com'
};

/**
 * Providers that support custom URL configuration
 */
export const BYOK_CUSTOM_URL_PROVIDERS = ['Anthropic', 'OpenAI', 'Gemini'];

export interface BYOKConfigurationResult {
	cancelled: boolean;
	baseUrl?: string;
	apiKey?: string;
	isCustomUrl?: boolean;
}

// Helper function for creating an input box with a back button
function createInputBoxWithBackButton(options: InputBoxOptions, hideBackButton?: boolean): Promise<string | BackButtonClick | undefined> {
	const disposableStore = new DisposableStore();
	const inputBox = disposableStore.add(window.createInputBox());
	inputBox.ignoreFocusOut = true;
	inputBox.title = options.title;
	inputBox.password = options.password || false;
	inputBox.prompt = options.prompt;
	inputBox.placeholder = options.placeHolder;
	inputBox.value = options.value || '';
	inputBox.buttons = hideBackButton ? [] : [QuickInputButtons.Back];

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
					// Show validation message but don't hide
					inputBox.validationMessage = (await validation) || undefined;
					return;
				}
			}
			resolve(value);
			disposableStore.dispose();
		}));

		disposableStore.add(inputBox.onDidHide(() => {
			// This resolves undefined if the input box is dismissed without accepting
			resolve(undefined);
			disposableStore.dispose();
		}));

		inputBox.show();
	});
}


export async function promptForAPIKey(contextName: string, reconfigure: boolean = false): Promise<string | undefined> {
	const prompt = reconfigure ? `Enter new ${contextName} API Key or leave blank to delete saved key` : `Enter ${contextName} API Key`;
	const title = reconfigure ? `Reconfigure ${contextName} API Key - Preview` : `Enter ${contextName} API Key - Preview`;

	const result = await createInputBoxWithBackButton({
		prompt: prompt,
		title: title,
		placeHolder: `${contextName} API Key`,
		ignoreFocusOut: true,
		password: true,
		validateInput: (value) => {
			// Allow empty input only when reconfiguring (to delete the key)
			return (value.trim().length > 0 || reconfigure) ? null : 'API Key cannot be empty';
		}
	}, true);

	if (isBackButtonClick(result)) {
		return undefined;
	}

	// Trim the input to normalize whitespace-only input to empty string.
	// Prevents whitespace-only strings from being stored as API keys
	return result?.trim();
}

/**
 * Normalize URL by removing trailing slashes
 */
export function normalizeUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

/**
 * Validate URL format
 */
export function validateUrlFormat(url: string): string | null {
	const trimmed = url.trim();
	if (!trimmed) {
		return 'URL cannot be empty';
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			return 'URL must use http or https protocol';
		}
		return null;
	} catch {
		return 'Invalid URL format';
	}
}

/**
 * Step 1: Prompt for base URL
 */
export async function promptForBaseUrl(
	providerName: string,
	currentUrl?: string
): Promise<string | BackButtonClick | undefined> {
	const officialUrl = BYOK_OFFICIAL_URLS[providerName] || '';
	const defaultValue = currentUrl || officialUrl;

	const result = await createInputBoxWithBackButton({
		title: `Configure ${providerName} API Base URL - Preview`,
		prompt: `Enter the API base URL (leave as default for official API)`,
		placeHolder: officialUrl,
		value: defaultValue,
		ignoreFocusOut: true,
		validateInput: (value) => validateUrlFormat(value)
	}, true); // Hide back button for first step

	if (result === undefined || isBackButtonClick(result)) {
		return result;
	}

	return normalizeUrl(result);
}

/**
 * Step 2: Prompt for API Key with back button
 */
export async function promptForAPIKeyWithBack(
	providerName: string,
	isCustomUrl: boolean
): Promise<string | BackButtonClick | undefined> {
	const urlType = isCustomUrl ? 'Custom' : 'Official';
	const result = await createInputBoxWithBackButton({
		title: `Enter ${providerName} API Key (${urlType}) - Preview`,
		prompt: `Enter your ${providerName} API Key`,
		placeHolder: `${providerName} API Key`,
		ignoreFocusOut: true,
		password: true,
		validateInput: (value) => {
			return value.trim().length > 0 ? null : 'API Key cannot be empty';
		}
	}, false); // Show back button

	return result;
}

/**
 * Configuration menu for existing configurations
 */
interface ConfigMenuOption extends QuickPickItem {
	action: 'view' | 'modify' | 'reset';
}

export async function showConfigurationMenu(
	providerName: string,
	currentUrl: string
): Promise<'view' | 'modify' | 'reset' | undefined> {
	const officialUrl = BYOK_OFFICIAL_URLS[providerName] || '';
	const isCustom = currentUrl !== officialUrl && currentUrl !== '';

	const items: ConfigMenuOption[] = [
		{
			label: '$(list-unordered) View Available Models',
			description: 'Show models available with current configuration',
			action: 'view'
		},
		{
			label: '$(edit) Modify Configuration',
			description: isCustom ? `Current URL: ${currentUrl}` : 'Using official API',
			action: 'modify'
		},
		{
			label: '$(refresh) Reset to Default',
			description: `Reset to official URL: ${officialUrl}`,
			action: 'reset'
		}
	];

	const selected = await window.showQuickPick(items, {
		title: `${providerName} Configuration`,
		placeHolder: 'Select an action'
	});

	return selected?.action;
}

/**
 * Multi-step configuration wizard for BYOK providers with custom URL support
 */
export async function configureBYOKProviderWithCustomUrl(
	providerName: string,
	currentBaseUrl?: string,
	validateConnection?: (baseUrl: string, apiKey: string) => Promise<{ success: boolean; modelCount?: number; error?: string }>
): Promise<BYOKConfigurationResult> {
	const officialUrl = BYOK_OFFICIAL_URLS[providerName] || '';

	// Step 1: Get base URL
	let baseUrl: string | undefined;
	let step = 1;

	while (true) {
		if (step === 1) {
			const urlResult = await promptForBaseUrl(providerName, currentBaseUrl);
			if (urlResult === undefined) {
				return { cancelled: true };
			}
			if (isBackButtonClick(urlResult)) {
				return { cancelled: true };
			}
			baseUrl = urlResult;
			step = 2;
		}

		if (step === 2) {
			const isCustomUrl = baseUrl !== officialUrl;
			const apiKeyResult = await promptForAPIKeyWithBack(providerName, isCustomUrl);

			if (apiKeyResult === undefined) {
				return { cancelled: true };
			}
			if (isBackButtonClick(apiKeyResult)) {
				step = 1;
				continue;
			}

			const apiKey = apiKeyResult.trim();

			// Step 3: Validate connection if validator provided
			if (validateConnection) {
				const validating = window.setStatusBarMessage(`$(loading~spin) Validating ${providerName} configuration...`);
				try {
					const result = await Promise.race([
						validateConnection(baseUrl!, apiKey),
						new Promise<{ success: false; error: string }>((resolve) =>
							setTimeout(() => resolve({ success: false, error: 'Connection timed out (5s)' }), 5000)
						)
					]);

					validating.dispose();

					if (result.success) {
						void window.showInformationMessage(
							`✓ Connected to ${providerName}! Found ${result.modelCount ?? 'multiple'} models.`
						);
						return {
							cancelled: false,
							baseUrl: baseUrl,
							apiKey: apiKey,
							isCustomUrl: baseUrl !== officialUrl
						};
					} else {
						const retry = await window.showErrorMessage(
							`Failed to connect: ${result.error}`,
							'Retry',
							'Cancel'
						);
						if (retry === 'Retry') {
							continue; // Stay on step 2
						}
						return { cancelled: true };
					}
				} catch (error) {
					validating.dispose();
					const errorMessage = error instanceof Error ? error.message : String(error);
					const retry = await window.showErrorMessage(
						`Connection error: ${errorMessage}`,
						'Retry',
						'Cancel'
					);
					if (retry === 'Retry') {
						continue;
					}
					return { cancelled: true };
				}
			}

			// No validator provided, just return the configuration
			return {
				cancelled: false,
				baseUrl: baseUrl,
				apiKey: apiKey,
				isCustomUrl: baseUrl !== officialUrl
			};
		}
	}
}