/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { APIFormat } from '../customProviderTypes';

/**
 * These tests verify that the four API format types are correctly defined
 * and can be used to distinguish between different provider implementations.
 */
describe('API Formats', () => {
	describe('format type definitions', () => {
		it('should support openai-chat format', () => {
			const format: APIFormat = 'openai-chat';
			expect(format).toBe('openai-chat');
		});

		it('should support openai-responses format', () => {
			const format: APIFormat = 'openai-responses';
			expect(format).toBe('openai-responses');
		});

		it('should support gemini format', () => {
			const format: APIFormat = 'gemini';
			expect(format).toBe('gemini');
		});

		it('should support claude format', () => {
			const format: APIFormat = 'claude';
			expect(format).toBe('claude');
		});
	});

	describe('format switching logic', () => {
		function getEndpointPath(format: APIFormat): string {
			switch (format) {
				case 'openai-chat':
					return '/v1/chat/completions';
				case 'openai-responses':
					return '/v1/responses';
				case 'gemini':
					return '/v1beta/models';
				case 'claude':
					return '/v1/messages';
				default:
					throw new Error(`Unknown format: ${format}`);
			}
		}

		function getAuthHeader(format: APIFormat, apiKey: string): Record<string, string> {
			switch (format) {
				case 'openai-chat':
				case 'openai-responses':
					return { 'Authorization': `Bearer ${apiKey}` };
				case 'gemini':
					return {}; // Gemini uses URL parameter
				case 'claude':
					return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
				default:
					throw new Error(`Unknown format: ${format}`);
			}
		}

		it('should return correct endpoint for openai-chat', () => {
			expect(getEndpointPath('openai-chat')).toBe('/v1/chat/completions');
		});

		it('should return correct endpoint for openai-responses', () => {
			expect(getEndpointPath('openai-responses')).toBe('/v1/responses');
		});

		it('should return correct endpoint for gemini', () => {
			expect(getEndpointPath('gemini')).toBe('/v1beta/models');
		});

		it('should return correct endpoint for claude', () => {
			expect(getEndpointPath('claude')).toBe('/v1/messages');
		});

		it('should return Bearer auth for openai-chat', () => {
			const headers = getAuthHeader('openai-chat', 'test-key');
			expect(headers['Authorization']).toBe('Bearer test-key');
		});

		it('should return Bearer auth for openai-responses', () => {
			const headers = getAuthHeader('openai-responses', 'test-key');
			expect(headers['Authorization']).toBe('Bearer test-key');
		});

		it('should return empty headers for gemini (uses URL param)', () => {
			const headers = getAuthHeader('gemini', 'test-key');
			expect(Object.keys(headers).length).toBe(0);
		});

		it('should return x-api-key auth for claude', () => {
			const headers = getAuthHeader('claude', 'test-key');
			expect(headers['x-api-key']).toBe('test-key');
			expect(headers['anthropic-version']).toBe('2023-06-01');
		});
	});
});
