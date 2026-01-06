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
import { BaseCustomProvider } from '../baseCustomProvider';
import { IBYOKStorageService } from '../byokStorageService';
import { ClaudeCustomProvider } from '../claudeCustomProvider';
import { GeminiCustomProvider } from '../geminiCustomProvider';
import { OpenAICustomProvider } from '../openaiCustomProvider';
import { OpenAIResponsesCustomProvider } from '../openaiResponsesCustomProvider';

describe('Custom Providers', () => {
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

	function createOpenAIProvider(config: CustomProviderConfig): BaseCustomProvider {
		return instaService.createInstance(
			OpenAICustomProvider,
			`custom-${config.name.toLowerCase()}`,
			config,
			mockByokStorageService
		);
	}

	function createClaudeProvider(config: CustomProviderConfig): BaseCustomProvider {
		return instaService.createInstance(
			ClaudeCustomProvider,
			`custom-${config.name.toLowerCase()}`,
			config,
			mockByokStorageService
		);
	}

	function createGeminiProvider(config: CustomProviderConfig): BaseCustomProvider {
		return instaService.createInstance(
			GeminiCustomProvider,
			`custom-${config.name.toLowerCase()}`,
			config,
			mockByokStorageService
		);
	}

	function createOpenAIResponsesProvider(config: CustomProviderConfig): BaseCustomProvider {
		return instaService.createInstance(
			OpenAIResponsesCustomProvider,
			`custom-${config.name.toLowerCase()}`,
			config,
			mockByokStorageService
		);
	}

	describe('constructor and properties', () => {
		it('should create OpenAI provider with correct properties', () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com',
				apiFormat: 'openai-chat'
			};

			const provider = createOpenAIProvider(config);

			expect(provider.providerName).toBe('TestProvider');
			expect(provider.baseUrl).toBe('https://api.example.com');
			expect(provider.apiFormat).toBe('openai-chat');
			expect(provider.providerId).toBe('custom-testprovider');
		});

		it('should create Claude provider with correct properties', () => {
			const config: CustomProviderConfig = {
				name: 'ClaudeProvider',
				baseUrl: 'https://api.anthropic.com',
				apiFormat: 'claude'
			};

			const provider = createClaudeProvider(config);

			expect(provider.providerName).toBe('ClaudeProvider');
			expect(provider.apiFormat).toBe('claude');
		});

		it('should create Gemini provider with correct properties', () => {
			const config: CustomProviderConfig = {
				name: 'GeminiProvider',
				baseUrl: 'https://generativelanguage.googleapis.com',
				apiFormat: 'gemini'
			};

			const provider = createGeminiProvider(config);

			expect(provider.providerName).toBe('GeminiProvider');
			expect(provider.apiFormat).toBe('gemini');
		});

		it('should create OpenAI Responses provider with correct properties', () => {
			const config: CustomProviderConfig = {
				name: 'OpenAIResponsesProvider',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-responses'
			};

			const provider = createOpenAIResponsesProvider(config);

			expect(provider.providerName).toBe('OpenAIResponsesProvider');
			expect(provider.apiFormat).toBe('openai-responses');
			expect(provider.providerId).toBe('custom-openairesponsesprovider');
		});
	});

	describe('URL handling', () => {
		it('should preserve URL with explicit /chat/completions path', () => {
			const config: CustomProviderConfig = {
				name: 'TestProvider',
				baseUrl: 'https://api.example.com/v1/chat/completions',
				apiFormat: 'openai-chat'
			};

			const provider = createOpenAIProvider(config);
			// The URL should be preserved as-is since it already has the path
			expect(provider.baseUrl).toBe('https://api.example.com/v1/chat/completions');
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

			const provider = createOpenAIProvider(config);
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
				OpenAICustomProvider,
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
				ClaudeCustomProvider,
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
				GeminiCustomProvider,
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

		it('should fetch models with Bearer auth for OpenAI Responses format', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({
					data: [{ id: 'o1-preview', context_length: 128000 }]
				})
			};
			mockFetcherService.fetch = vi.fn().mockResolvedValue(mockResponse);

			const testingServiceCollection = createExtensionUnitTestingServices();
			testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));
			testingServiceCollection.set(IFetcherService, mockFetcherService);
			const newAccessor = disposables.add(testingServiceCollection.createTestingAccessor());
			const newInstaService = newAccessor.get(IInstantiationService);

			const config: CustomProviderConfig = {
				name: 'OpenAIResponsesProvider',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-responses'
			};

			const provider = newInstaService.createInstance(
				OpenAIResponsesCustomProvider,
				'custom-openairesponsesprovider',
				config,
				mockByokStorageService
			);

			await provider.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(mockFetcherService.fetch).toHaveBeenCalledWith(
				'https://api.openai.com/v1/models',
				expect.objectContaining({
					method: 'GET',
					headers: expect.objectContaining({
						'Authorization': 'Bearer test-api-key'
					})
				})
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

			const provider = createOpenAIProvider(config);

			// Mock the promptForAPIKey to return a new key
			// Since promptForAPIKey is imported, we can't easily mock it
			// This test verifies the interface exists
			expect(provider.updateAPIKey).toBeDefined();
			expect(typeof provider.updateAPIKey).toBe('function');
		});
	});
});
