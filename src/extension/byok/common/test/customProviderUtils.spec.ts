/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { detectThinkingCapability, detectToolCallingCapability, detectVisionCapability } from '../customProviderUtils';

describe('customProviderUtils', () => {
	describe('detectVisionCapability', () => {
		it('should return true when capabilities.vision is true', () => {
			const model = { capabilities: { vision: true } };
			expect(detectVisionCapability(model, 'some-model')).toBe(true);
		});

		it('should return true when supported_input_types includes image', () => {
			const model = { supported_input_types: ['text', 'image'] };
			expect(detectVisionCapability(model, 'some-model')).toBe(true);
		});

		it('should return true when input_modalities includes image', () => {
			const model = { input_modalities: ['text', 'image'] };
			expect(detectVisionCapability(model, 'some-model')).toBe(true);
		});

		it('should return true for GPT-4o model', () => {
			expect(detectVisionCapability({}, 'gpt-4o')).toBe(true);
		});

		it('should return true for GPT-4-vision model', () => {
			expect(detectVisionCapability({}, 'gpt-4-vision-preview')).toBe(true);
		});

		it('should return true for Claude-3 models', () => {
			expect(detectVisionCapability({}, 'claude-3-opus-20240229')).toBe(true);
			expect(detectVisionCapability({}, 'claude-3-sonnet-20240229')).toBe(true);
			expect(detectVisionCapability({}, 'claude-3-haiku-20240307')).toBe(true);
		});

		it('should return true for Gemini models', () => {
			expect(detectVisionCapability({}, 'gemini-pro')).toBe(true);
			expect(detectVisionCapability({}, 'gemini-1.5-pro')).toBe(true);
			expect(detectVisionCapability({}, 'gemini-2.0-flash')).toBe(true);
		});

		it('should return false for text-only models', () => {
			expect(detectVisionCapability({}, 'gpt-3.5-turbo')).toBe(false);
		});
	});

	describe('detectToolCallingCapability', () => {
		it('should return true when capabilities.function_calling is true', () => {
			const model = { capabilities: { function_calling: true } };
			expect(detectToolCallingCapability(model, 'some-model')).toBe(true);
		});

		it('should return true when capabilities.tools is true', () => {
			const model = { capabilities: { tools: true } };
			expect(detectToolCallingCapability(model, 'some-model')).toBe(true);
		});

		it('should return false for embedding models', () => {
			expect(detectToolCallingCapability({}, 'text-embedding-ada-002')).toBe(false);
			expect(detectToolCallingCapability({}, 'text-embedding-3-small')).toBe(false);
		});

		it('should return false for audio models', () => {
			expect(detectToolCallingCapability({}, 'whisper-1')).toBe(false);
			expect(detectToolCallingCapability({}, 'tts-1')).toBe(false);
		});

		it('should return false for image generation models', () => {
			expect(detectToolCallingCapability({}, 'dall-e-3')).toBe(false);
			expect(detectToolCallingCapability({}, 'stable-diffusion-xl')).toBe(false);
		});

		it('should return true for chat models by default', () => {
			expect(detectToolCallingCapability({}, 'gpt-4')).toBe(true);
			expect(detectToolCallingCapability({}, 'claude-3-opus')).toBe(true);
		});
	});

	describe('detectThinkingCapability', () => {
		it('should return true when capabilities.thinking is true', () => {
			const model = { capabilities: { thinking: true } };
			expect(detectThinkingCapability(model, 'some-model')).toBe(true);
		});

		it('should return true when capabilities.reasoning is true', () => {
			const model = { capabilities: { reasoning: true } };
			expect(detectThinkingCapability(model, 'some-model')).toBe(true);
		});

		it('should return true for o1 models', () => {
			expect(detectThinkingCapability({}, 'o1-preview')).toBe(true);
			expect(detectThinkingCapability({}, 'o1-mini')).toBe(true);
		});

		it('should return true for o3 models', () => {
			expect(detectThinkingCapability({}, 'o3-mini')).toBe(true);
		});

		it('should return true for DeepSeek-R1 models', () => {
			expect(detectThinkingCapability({}, 'deepseek-r1')).toBe(true);
			expect(detectThinkingCapability({}, 'deepseek-r1-lite')).toBe(true);
		});

		it('should return true for Gemini models (all support thinking)', () => {
			expect(detectThinkingCapability({}, 'gemini-2.0-flash-thinking')).toBe(true);
			expect(detectThinkingCapability({}, 'gemini-pro')).toBe(true);
		});

		it('should return false for regular GPT models', () => {
			expect(detectThinkingCapability({}, 'gpt-4')).toBe(false);
			expect(detectThinkingCapability({}, 'gpt-3.5-turbo')).toBe(false);
		});

		it('should return false for regular Claude models', () => {
			expect(detectThinkingCapability({}, 'claude-3-opus')).toBe(false);
		});
	});
});
