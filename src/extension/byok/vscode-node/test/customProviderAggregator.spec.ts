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
import { CustomProviderAggregator } from '../customProviderAggregator';

describe('CustomProviderAggregator', () => {
	const disposables = new DisposableStore();
	let accessor: ITestingServicesAccessor;
	let instaService: IInstantiationService;
	let mockByokStorageService: IBYOKStorageService;
	let mockFetcherService: IFetcherService;

	beforeEach(() => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		testingServiceCollection.define(IBlockedExtensionService, new SyncDescriptor(BlockedExtensionService));

		// Create mock fetcher service
		mockFetcherService = {
			fetch: vi.fn()
		} as unknown as IFetcherService;
		testingServiceCollection.set(IFetcherService, mockFetcherService);

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
	});

	afterEach(() => {
		disposables.clear();
		vi.restoreAllMocks();
	});

	function createAggregator(): CustomProviderAggregator {
		return instaService.createInstance(
			CustomProviderAggregator,
			mockByokStorageService
		);
	}

	describe('addProvider', () => {
		it('should add OpenAI provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			};

			aggregator.addProvider('custom-openai', config);

			expect(aggregator.hasProvider('custom-openai')).toBe(true);
			expect(aggregator.getProviderIds()).toContain('custom-openai');
		});

		it('should add Claude provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'Claude',
				baseUrl: 'https://api.anthropic.com',
				apiFormat: 'claude'
			};

			aggregator.addProvider('custom-claude', config);

			expect(aggregator.hasProvider('custom-claude')).toBe(true);
		});

		it('should add Gemini provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'Gemini',
				baseUrl: 'https://generativelanguage.googleapis.com',
				apiFormat: 'gemini'
			};

			aggregator.addProvider('custom-gemini', config);

			expect(aggregator.hasProvider('custom-gemini')).toBe(true);
		});

		it('should add OpenAI Responses provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'OpenAI Responses',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-responses'
			};

			aggregator.addProvider('custom-openai-responses', config);

			expect(aggregator.hasProvider('custom-openai-responses')).toBe(true);
		});

		it('should not add duplicate provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			};

			aggregator.addProvider('custom-openai', config);
			aggregator.addProvider('custom-openai', config); // Attempt to add duplicate

			expect(aggregator.getProviderIds().length).toBe(1);
		});
	});

	describe('removeProvider', () => {
		it('should remove existing provider', () => {
			const aggregator = createAggregator();
			const config: CustomProviderConfig = {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			};

			aggregator.addProvider('custom-openai', config);
			expect(aggregator.hasProvider('custom-openai')).toBe(true);

			aggregator.removeProvider('custom-openai');
			expect(aggregator.hasProvider('custom-openai')).toBe(false);
		});

		it('should handle removing non-existent provider gracefully', () => {
			const aggregator = createAggregator();

			// Should not throw
			expect(() => aggregator.removeProvider('non-existent')).not.toThrow();
		});
	});

	describe('mixed providers', () => {
		it('should support multiple providers with different formats', () => {
			const aggregator = createAggregator();

			// Add providers of different formats
			aggregator.addProvider('custom-openai', {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			});

			aggregator.addProvider('custom-claude', {
				name: 'Claude',
				baseUrl: 'https://api.anthropic.com',
				apiFormat: 'claude'
			});

			aggregator.addProvider('custom-gemini', {
				name: 'Gemini',
				baseUrl: 'https://generativelanguage.googleapis.com',
				apiFormat: 'gemini'
			});

			aggregator.addProvider('custom-openai-responses', {
				name: 'OpenAI Responses',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-responses'
			});

			// Verify all providers are added
			expect(aggregator.getProviderIds()).toHaveLength(4);
			expect(aggregator.hasProvider('custom-openai')).toBe(true);
			expect(aggregator.hasProvider('custom-claude')).toBe(true);
			expect(aggregator.hasProvider('custom-gemini')).toBe(true);
			expect(aggregator.hasProvider('custom-openai-responses')).toBe(true);
		});

		it('should get provider by ID', () => {
			const aggregator = createAggregator();

			aggregator.addProvider('custom-openai', {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			});

			const provider = aggregator.getProvider('custom-openai');
			expect(provider).toBeDefined();
			expect(provider?.providerName).toBe('OpenAI');
		});

		it('should return undefined for non-existent provider', () => {
			const aggregator = createAggregator();

			const provider = aggregator.getProvider('non-existent');
			expect(provider).toBeUndefined();
		});
	});

	describe('provideLanguageModelChatInformation', () => {
		it('should aggregate models from multiple providers', async () => {
			// Mock responses for different providers
			const openAIModelsResponse = {
				json: vi.fn().mockResolvedValue({
					data: [{ id: 'gpt-4', context_length: 128000 }]
				})
			};
			const claudeModelsResponse = {
				json: vi.fn().mockResolvedValue({
					data: [{ id: 'claude-3-opus', context_length: 200000 }]
				})
			};

			// Setup fetch to return different responses based on URL
			mockFetcherService.fetch = vi.fn().mockImplementation((url: string) => {
				if (url.includes('openai.com')) {
					return Promise.resolve(openAIModelsResponse);
				} else if (url.includes('anthropic.com')) {
					return Promise.resolve(claudeModelsResponse);
				}
				return Promise.reject(new Error('Unknown URL'));
			});

			const aggregator = createAggregator();

			aggregator.addProvider('custom-openai', {
				name: 'OpenAI',
				baseUrl: 'https://api.openai.com',
				apiFormat: 'openai-chat'
			});

			aggregator.addProvider('custom-claude', {
				name: 'Claude',
				baseUrl: 'https://api.anthropic.com',
				apiFormat: 'claude'
			});

			// Wait a bit for the async model fetching to complete
			await new Promise(resolve => setTimeout(resolve, 100));

			const models = await aggregator.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			// Should have models from both providers
			expect(models.length).toBeGreaterThan(0);
		});

		it('should return empty array when no providers are configured', async () => {
			const aggregator = createAggregator();

			const models = await aggregator.provideLanguageModelChatInformation(
				{ silent: true },
				{ isCancellationRequested: false, onCancellationRequested: vi.fn() }
			);

			expect(models).toEqual([]);
		});
	});

	describe('fireModelChange', () => {
		it('should emit model change event', () => {
			const aggregator = createAggregator();
			const listener = vi.fn();

			aggregator.onDidChangeLanguageModelChatInformation(listener);
			aggregator.fireModelChange();

			// Give async operations time to complete
			return new Promise<void>(resolve => {
				setTimeout(() => {
					expect(listener).toHaveBeenCalled();
					resolve();
				}, 100);
			});
		});
	});
});
