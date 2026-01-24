/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it } from 'vitest';
import { PromptComponentRegistry } from '../../common/promptComponentRegistry';
import { PromptComponentCategory, PromptComponentDefinition } from '../../common/types';

describe('PromptComponentRegistry', () => {
	let registry: PromptComponentRegistry;

	const createTestComponent = (overrides: Partial<PromptComponentDefinition> = {}): PromptComponentDefinition => ({
		id: 'testComponent',
		name: 'Test Component',
		description: 'A test component',
		category: PromptComponentCategory.Tools,
		defaultContent: 'Test content',
		defaultEnabled: true,
		priority: 100,
		isBuiltIn: true,
		...overrides,
	});

	beforeEach(() => {
		registry = new PromptComponentRegistry();
	});

	describe('register', () => {
		it('should register a component', () => {
			const component = createTestComponent();
			registry.register(component);

			expect(registry.has(component.id)).toBe(true);
			expect(registry.get(component.id)).toEqual(component);
		});

		it('should overwrite existing component with same id', () => {
			const component1 = createTestComponent({ name: 'First' });
			const component2 = createTestComponent({ name: 'Second' });

			registry.register(component1);
			registry.register(component2);

			expect(registry.get('testComponent')?.name).toBe('Second');
			expect(registry.size).toBe(1);
		});

		it('should fire onDidChange event when component is registered', () => {
			let eventFired = false;
			registry.onDidChange(() => { eventFired = true; });

			registry.register(createTestComponent());

			expect(eventFired).toBe(true);
		});
	});

	describe('registerAll', () => {
		it('should register multiple components at once', () => {
			const components = [
				createTestComponent({ id: 'comp1' }),
				createTestComponent({ id: 'comp2' }),
				createTestComponent({ id: 'comp3' }),
			];

			registry.registerAll(components);

			expect(registry.size).toBe(3);
			expect(registry.has('comp1')).toBe(true);
			expect(registry.has('comp2')).toBe(true);
			expect(registry.has('comp3')).toBe(true);
		});

		it('should only fire onDidChange once for batch registration', () => {
			let eventCount = 0;
			registry.onDidChange(() => { eventCount++; });

			registry.registerAll([
				createTestComponent({ id: 'comp1' }),
				createTestComponent({ id: 'comp2' }),
			]);

			expect(eventCount).toBe(1);
		});
	});

	describe('unregister', () => {
		it('should remove a registered component', () => {
			registry.register(createTestComponent());

			const result = registry.unregister('testComponent');

			expect(result).toBe(true);
			expect(registry.has('testComponent')).toBe(false);
		});

		it('should return false when unregistering non-existent component', () => {
			const result = registry.unregister('nonExistent');

			expect(result).toBe(false);
		});

		it('should fire onDidChange when component is unregistered', () => {
			registry.register(createTestComponent());
			let eventFired = false;
			registry.onDidChange(() => { eventFired = true; });

			registry.unregister('testComponent');

			expect(eventFired).toBe(true);
		});
	});

	describe('getByCategory', () => {
		it('should return components filtered by category', () => {
			registry.registerAll([
				createTestComponent({ id: 'tool1', category: PromptComponentCategory.Tools }),
				createTestComponent({ id: 'tool2', category: PromptComponentCategory.Tools }),
				createTestComponent({ id: 'format1', category: PromptComponentCategory.Formatting }),
			]);

			const toolComponents = registry.getByCategory(PromptComponentCategory.Tools);

			expect(toolComponents).toHaveLength(2);
			expect(toolComponents.every(c => c.category === PromptComponentCategory.Tools)).toBe(true);
		});

		it('should return empty array for category with no components', () => {
			registry.register(createTestComponent({ category: PromptComponentCategory.Tools }));

			const result = registry.getByCategory(PromptComponentCategory.Custom);

			expect(result).toHaveLength(0);
		});
	});

	describe('getBuiltIn and getCustom', () => {
		it('should correctly separate built-in and custom components', () => {
			registry.registerAll([
				createTestComponent({ id: 'builtin1', isBuiltIn: true }),
				createTestComponent({ id: 'builtin2', isBuiltIn: true }),
				createTestComponent({ id: 'custom1', isBuiltIn: false }),
			]);

			expect(registry.getBuiltIn()).toHaveLength(2);
			expect(registry.getCustom()).toHaveLength(1);
		});
	});

	describe('getAllSorted', () => {
		it('should return components sorted by priority', () => {
			registry.registerAll([
				createTestComponent({ id: 'low', priority: 300 }),
				createTestComponent({ id: 'high', priority: 100 }),
				createTestComponent({ id: 'medium', priority: 200 }),
			]);

			const sorted = registry.getAllSorted();

			expect(sorted[0].id).toBe('high');
			expect(sorted[1].id).toBe('medium');
			expect(sorted[2].id).toBe('low');
		});
	});

	describe('getDefaultContent', () => {
		it('should return default content for registered component', () => {
			registry.register(createTestComponent({ defaultContent: 'Expected content' }));

			const content = registry.getDefaultContent('testComponent');

			expect(content).toBe('Expected content');
		});

		it('should return undefined for non-existent component', () => {
			const content = registry.getDefaultContent('nonExistent');

			expect(content).toBeUndefined();
		});
	});

	describe('getCategories', () => {
		it('should return unique categories with registered components', () => {
			registry.registerAll([
				createTestComponent({ id: 'tool1', category: PromptComponentCategory.Tools }),
				createTestComponent({ id: 'tool2', category: PromptComponentCategory.Tools }),
				createTestComponent({ id: 'format1', category: PromptComponentCategory.Formatting }),
				createTestComponent({ id: 'identity1', category: PromptComponentCategory.Identity }),
			]);

			const categories = registry.getCategories();

			expect(categories).toHaveLength(3);
			expect(categories).toContain(PromptComponentCategory.Tools);
			expect(categories).toContain(PromptComponentCategory.Formatting);
			expect(categories).toContain(PromptComponentCategory.Identity);
		});
	});

	describe('clear', () => {
		it('should remove all components', () => {
			registry.registerAll([
				createTestComponent({ id: 'comp1' }),
				createTestComponent({ id: 'comp2' }),
			]);

			registry.clear();

			expect(registry.size).toBe(0);
		});

		it('should fire onDidChange when cleared', () => {
			registry.register(createTestComponent());
			let eventFired = false;
			registry.onDidChange(() => { eventFired = true; });

			registry.clear();

			expect(eventFired).toBe(true);
		});
	});
});
