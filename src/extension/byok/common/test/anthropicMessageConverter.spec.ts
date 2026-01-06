/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { expect, suite, test } from 'vitest';
import { LanguageModelChatMessage, LanguageModelThinkingPart, LanguageModelToolCallPart } from '../../../../vscodeTypes';
import { anthropicMessagesToRawMessages, apiMessageToAnthropicMessage } from '../anthropicMessageConverter';

suite('anthropicMessagesToRawMessages', function () {

	test('converts simple text messages', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: 'Hello world'
			},
			{
				role: 'assistant',
				content: 'Hi there!'
			}
		];
		const system: TextBlockParam = { type: 'text', text: 'You are a helpful assistant' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('handles empty system message', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: 'Hello'
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('converts messages with content blocks', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Look at this image:' },
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/jpeg',
							data: 'fake-base64-data'
						}
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: 'System prompt' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('converts tool use messages', function () {
		const messages: MessageParam[] = [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'I will use a tool:' },
					{
						type: 'tool_use',
						id: 'call_123',
						name: 'get_weather',
						input: { location: 'London' }
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('converts tool result messages', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'call_123',
						content: 'The weather in London is sunny'
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('converts tool result with content blocks', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'call_456',
						content: [
							{ type: 'text', text: 'Here is the chart:' },
							{
								type: 'image',
								source: {
									type: 'base64',
									media_type: 'image/png',
									data: 'chart-data'
								}
							}
						]
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('handles cache control blocks', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'text',
						text: 'Cached content',
						cache_control: { type: 'ephemeral' }
					}
				]
			}
		];
		const system: TextBlockParam = {
			type: 'text',
			text: 'System with cache',
			cache_control: { type: 'ephemeral' }
		};

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('includes thinking blocks in conversion to raw messages', function () {
		const messages: MessageParam[] = [
			{
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: 'Let me think...', signature: '' },
					{ type: 'text', text: 'Here is my response' }
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('handles url-based images', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'image',
						source: {
							type: 'url',
							url: 'https://example.com/image.jpg'
						}
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});

	test('handles empty tool result content', function () {
		const messages: MessageParam[] = [
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'call_empty',
						content: []
					}
				]
			}
		];
		const system: TextBlockParam = { type: 'text', text: '' };

		const result = anthropicMessagesToRawMessages(messages, system);

		expect(result).toMatchSnapshot();
	});
});

suite('apiMessageToAnthropicMessage', function () {

	test('injects redacted_thinking block when thinkingEnabled and assistant has tool_use but no thinking', function () {
		// Simulates the case after context summarization where thinking blocks are stripped
		// but tool_use blocks remain
		const assistantMsg = LanguageModelChatMessage.Assistant('');
		assistantMsg.content = [
			new LanguageModelToolCallPart('call_123', 'read_file', { path: '/test.ts' }),
		];
		const messages = [assistantMsg];

		const result = apiMessageToAnthropicMessage(messages, { thinkingEnabled: true });

		// Should have one assistant message
		expect(result.messages.length).toBe(1);
		expect(result.messages[0].role).toBe('assistant');

		const content = result.messages[0].content;
		expect(Array.isArray(content)).toBe(true);

		// First block should be redacted_thinking placeholder
		const firstBlock = (content as any[])[0];
		expect(firstBlock.type).toBe('redacted_thinking');
		expect(firstBlock.data).toBe('');

		// Second block should be the tool_use
		const secondBlock = (content as any[])[1];
		expect(secondBlock.type).toBe('tool_use');
		expect(secondBlock.name).toBe('read_file');
	});

	test('does not inject thinking block when thinkingEnabled is false', function () {
		const assistantMsg = LanguageModelChatMessage.Assistant('');
		assistantMsg.content = [
			new LanguageModelToolCallPart('call_123', 'read_file', { path: '/test.ts' }),
		];
		const messages = [assistantMsg];

		const result = apiMessageToAnthropicMessage(messages, { thinkingEnabled: false });

		const content = result.messages[0].content;
		expect(Array.isArray(content)).toBe(true);

		// Should only have tool_use, no thinking block
		expect((content as any[]).length).toBe(1);
		expect((content as any[])[0].type).toBe('tool_use');
	});

	test('does not inject thinking block when assistant already has thinking blocks', function () {
		const thinkingPart = new LanguageModelThinkingPart('my thinking');
		thinkingPart.metadata = {
			_completeThinking: 'my thinking',
			signature: 'sig123',
		};

		const assistantMsg = LanguageModelChatMessage.Assistant('');
		// Use type assertion because the content setter accepts thinking parts at runtime
		// even though the static type doesn't include them
		(assistantMsg as any).content = [
			thinkingPart,
			new LanguageModelToolCallPart('call_123', 'read_file', { path: '/test.ts' }),
		];
		const messages = [assistantMsg];

		const result = apiMessageToAnthropicMessage(messages, { thinkingEnabled: true });

		const content = result.messages[0].content;
		expect(Array.isArray(content)).toBe(true);

		// Should have real thinking block first, then tool_use
		expect((content as any[])[0].type).toBe('thinking');
		expect((content as any[])[0].thinking).toBe('my thinking');
		expect((content as any[])[1].type).toBe('tool_use');
	});

	test('does not inject thinking block for user messages', function () {
		// User messages with tool_result should not get thinking blocks
		const messages = [
			LanguageModelChatMessage.User('Hello'),
		];

		const result = apiMessageToAnthropicMessage(messages, { thinkingEnabled: true });

		const content = result.messages[0].content;
		expect(Array.isArray(content)).toBe(true);

		// Should only have text, no thinking block
		expect((content as any[])[0].type).toBe('text');
	});
});