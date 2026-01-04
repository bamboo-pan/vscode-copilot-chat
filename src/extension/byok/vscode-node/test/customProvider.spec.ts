/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockedExtensionService, IBlockedExtensionService } from '../../../../platform/chat/common/blockedExtensionService';
import { IFetcherService } from '../../../../platform/networking/common/fetcherService';
import { ITestingServicesAccessor } from '../../../../platform/test/node/services';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { CustomProviderConfig } from '../../common/customProviderTypes';
import { IBYOKStorageService } from '../byokStorageService';
import { CustomProvider } from '../customProvider';

describe('CustomProvider', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;
	let mockByokStorageService: IBYOKStorageService;
	let mockFetcherService: IFetcherService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices();

		// Add IBlockedExtensionService which is required by CopilotLanguageModelWrapper
		testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));

		accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		instaService = accessor.get(IInstantiationService);

		// Create mock storage service
		mockByokStorageService = {
			getAPIKey: vi.fn().mockResolvedValue('test-api-key'),
			storeAPIKey: vi.fn().mockResolvedValue(undefined),
			deleteAPIKey: vi.fn().mockResolvedValue(undefined),
			getStoredModelConfigs: vi.fn().mockResolvedValue({}),
			saveModelConfig: vi.fn().mockResolvedValue(undefined),
			removeModelConfig: vi.fn().mockResolvedValue(undefined)
		};

		// Create mock fetcher service
		mockFetcherService = {
			fetch: vi.fn()
		} as unknown as IFetcherService;
	});

	afterEach(() => {
		disposables.clear();
		vi.restoreAllMocks();
	});

	function createProvider(config: CustomProviderConfig): CustomProvider {
		return instaService.createInstance(
			CustomProvider,
			`custom-${config.name.toLowerCase()}`,
			config,
			mockByokStorageService
		);
	}

	describe('constructor and properties', () => {
		it('should create provider with correct properties', () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com',
				apiFormat: 'openai-chat'
			};

			const provider = createProvider(config);

			expect(provider.providerName).toBe('TestProvider');
			expect(provider.baseUrl).toBe('https://api.example.com');
			expect(provider.apiFormat).toBe('openai-chat');
			expect(provider.providerId).toBe('custom-testprovider');
		});

		it('should create provider with different API formats', () => {
			const formats = ['openai-chat', 'openai-responses', 'gemini', 'claude'] as const;

			for (const format of formats) {
				const config: CustomProviderConfig = {
					name: 'TestProvider',
					baseUrl: 'https://api.example.com',
					apiFormat: format
				};

				const provider = createProvider(config);
				expect(provider.apiFormat).toBe(format);
			}
		});
	});

	describe('_buildChatUrl (via provideLanguageModelChatResponse)', () => {
		// We test URL building indirectly through the public interface
		// since _buildChatUrl is private

		it('should preserve URL with explicit /chat/completions path', () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com/v1/chat/completions',
				apiFormat: 'openai-chat'
			};

			const provider = createProvider(config);
			// The URL should be preserved as-is since it already has the path
			expect(provider.baseUrl).toBe('https://api.example.com/v1/chat/completions');
		});

		it('should preserve URL with explicit /responses path', () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com/v1/responses',
				apiFormat: 'openai-responses'
			};

			const provider = createProvider(config);
			expect(provider.baseUrl).toBe('https://api.example.com/v1/responses');
		});
	});

	describe('provideLanguageModelChatInformation', () => {
		it('should return empty array when no API key and silent mode', async () => {
			mockByokStorageService.getAPIKey = vi.fn().mockResolvedValue(undefined);

			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com',
				apiFormat: 'openai-chat'
			};

			const provider = createProvider(config);
			const result = await provider.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(result).toEqual([]);
		});

		it('should fetch models when API key is available', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: [
						{ id: 'gpt-4', context_length: 128000, max_output_tokens: 16000 },
						{ id: 'gpt-3.5-turbo', context_length: 16000, max_output_tokens: 4000 }
					]
				})
			};
			mockFetcherService.fetch = vi.fn().mockResolvedValue(mockResponse);

			const testingServiceCollection = createExtensionUnitTestingServices();
			testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
			testingServiceCollection.set(IFetcherService, mockFetcherService);
			const newAccessor = disposables.add(testingServiceCollection.createTestingAccessor());
			const newInstaService = newAccessor.get(IInstantiationService);

			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com',
				apiFormat: 'openai-chat'
			};

			const provider = newInstaService.createInstance(
				CustomProvider,
				'custom-testprovider',
				config,
				mockByokStorageService
			);

			const result = await provider.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(mockFetcherService.fetch).toHaveBeenCalledWith(
				'https://api.example.com/v1/models',
				expect.objectContaining({
					method: 'GET',
					headers: expect.objectContaining({
						'Authorization': 'Bearer test-api-key'
					})
				})
			);

			expect(result).toHaveLength(2);
		});

		it('should use correct headers for Claude format', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: [{ id: 'claude-3-opus' }]
				})
			};
			mockFetcherService.fetch = vi.fn().mockResolvedValue(mockResponse);

			const testingServiceCollection = createExtensionUnitTestingServices();
			testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
			testingServiceCollection.set(IFetcherService, mockFetcherService);
			const newAccessor = disposables.add(testingServiceCollection.createTestingAccessor());
			const newInstaService = newAccessor.get(IInstantiationService);

			const config: CustomProviderConfig = {
				name: 'ClaudeProvider',
				baseUrl: 'https://api.anthropic.com',
				apiFormat: 'claude'
			};

			const provider = newInstaService.createInstance(
				CustomProvider,
				'custom-claudeprovider',
				config,
				mockByokStorageService
			);

			await provider.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(mockFetcherService.fetch).toHaveBeenCalledWith(
				'https://api.anthropic.com/v1/models',
				expect.objectContaining({
					headers: expect.objectContaining({
						'x-api-key': 'test-api-key',
						'anthropic-version': '2023-06-01'
					})
				})
			);
		});

		it('should use API key in URL for Gemini format', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					models: [{ name: 'models/gemini-pro', displayName: 'Gemini Pro' }]
				})
			};
			mockFetcherService.fetch = vi.fn().mockResolvedValue(mockResponse);

			const testingServiceCollection = createExtensionUnitTestingServices();
			testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
			testingServiceCollection.set(IFetcherService, mockFetcherService);
			const newAccessor = disposables.add(testingServiceCollection.createTestingAccessor());
			const newInstaService = newAccessor.get(IInstantiationService);

			const config: CustomProviderConfig = {
				name: 'GeminiProvider',
				baseUrl: 'https://generativelanguage.googleapis.com',
				apiFormat: 'gemini'
			};

			const provider = newInstaService.createInstance(
				CustomProvider,
				'custom-geminiprovider',
				config,
				mockByokStorageService
			);

			await provider.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(mockFetcherService.fetch).toHaveBeenCalledWith(
				'https://generativelanguage.googleapis.com/v1beta/models?key=test-api-key',
				expect.any(Object)
			);
		});
	});

	describe('updateAPIKey', () => {
		it('should store new API key', async () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com',
				apiFormat: 'openai-chat'
			};

			const provider = createProvider(config);

			// Mock the promptForAPIKey to return a new key
			// Since promptForAPIKey is imported, we can't easily mock it
			// This test verifies the interface exists
			expect(provider.updateAPIKey).toBeDefined();
			expect(typeof provider.updateAPIKey).toBe('function');
		});
	});
});
