/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { APIFormatLabels, generateProviderId, isValidAPIFormat } from '../customProviderTypes';

describe('customProviderTypes', function () {

	describe('isValidAPIFormat', function () {

		test('returns true for valid openai-chat format', function () {
			expect(isValidAPIFormat('openai-chat')).toBe(true);
		});

		test('returns true for valid openai-responses format', function () {
			expect(isValidAPIFormat('openai-responses')).toBe(true);
		});

		test('returns true for valid gemini format', function () {
			expect(isValidAPIFormat('gemini')).toBe(true);
		});

		test('returns true for valid claude format', function () {
			expect(isValidAPIFormat('claude')).toBe(true);
		});

		test('returns false for invalid format', function () {
			expect(isValidAPIFormat('invalid')).toBe(false);
		});

		test('returns false for empty string', function () {
			expect(isValidAPIFormat('')).toBe(false);
		});

		test('returns false for similar but incorrect format', function () {
			expect(isValidAPIFormat('openai')).toBe(false);
			expect(isValidAPIFormat('OpenAI-chat')).toBe(false);
			expect(isValidAPIFormat('GEMINI')).toBe(false);
		});
	});

	describe('generateProviderId', function () {

		test('generates id from simple name', function () {
			expect(generateProviderId('MyProvider')).toBe('custom-myprovider');
		});

		test('handles spaces in name', function () {
			expect(generateProviderId('My Custom Provider')).toBe('custom-my-custom-provider');
		});

		test('handles special characters', function () {
			expect(generateProviderId('Provider@123!')).toBe('custom-provider-123');
		});

		test('handles leading and trailing special characters', function () {
			expect(generateProviderId('---Provider---')).toBe('custom-provider');
		});

		test('handles consecutive special characters', function () {
			expect(generateProviderId('My***Provider')).toBe('custom-my-provider');
		});

		test('handles unicode characters', function () {
			expect(generateProviderId('我的Provider')).toBe('custom-provider');
		});

		test('handles numbers in name', function () {
			expect(generateProviderId('Provider123')).toBe('custom-provider123');
		});

		test('handles mixed case', function () {
			expect(generateProviderId('MyPROVIDER')).toBe('custom-myprovider');
		});

		test('handles empty string', function () {
			expect(generateProviderId('')).toBe('custom-');
		});

		test('handles name with only special characters', function () {
			expect(generateProviderId('!!@@##')).toBe('custom-');
		});
	});

	describe('APIFormatLabels', function () {

		test('has label for openai-chat', function () {
			expect(APIFormatLabels['openai-chat']).toBe('OpenAI Chat Completions');
		});

		test('has label for openai-responses', function () {
			expect(APIFormatLabels['openai-responses']).toBe('OpenAI Responses API');
		});

		test('has label for gemini', function () {
			expect(APIFormatLabels['gemini']).toBe('Google Gemini');
		});

		test('has label for claude', function () {
			expect(APIFormatLabels['claude']).toBe('Anthropic Claude');
		});

		test('has exactly 4 formats defined', function () {
			expect(Object.keys(APIFormatLabels)).toHaveLength(4);
		});
	});
});
