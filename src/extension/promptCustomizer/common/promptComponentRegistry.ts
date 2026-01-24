/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { PromptComponentCategory, PromptComponentDefinition } from './types';

/**
 * Registry for managing all available Prompt components.
 * Built-in components are registered here, and custom components can be added at runtime.
 */
export class PromptComponentRegistry extends Disposable {
	private readonly _components = new Map<string, PromptComponentDefinition>();
	private readonly _onDidChange = this._register(new Emitter<void>());

	/**
	 * Event that fires when the registry changes
	 */
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/**
	 * Register a new component
	 */
	register(component: PromptComponentDefinition): void {
		if (this._components.has(component.id)) {
			console.warn(`PromptComponentRegistry: Component with id '${component.id}' already registered. Overwriting.`);
		}
		this._components.set(component.id, component);
		this._onDidChange.fire();
	}

	/**
	 * Register multiple components at once
	 */
	registerAll(components: PromptComponentDefinition[]): void {
		for (const component of components) {
			this._components.set(component.id, component);
		}
		this._onDidChange.fire();
	}

	/**
	 * Unregister a component by ID
	 */
	unregister(id: string): boolean {
		const deleted = this._components.delete(id);
		if (deleted) {
			this._onDidChange.fire();
		}
		return deleted;
	}

	/**
	 * Get a component by ID
	 */
	get(id: string): PromptComponentDefinition | undefined {
		return this._components.get(id);
	}

	/**
	 * Check if a component exists
	 */
	has(id: string): boolean {
		return this._components.has(id);
	}

	/**
	 * Get all registered components
	 */
	getAll(): PromptComponentDefinition[] {
		return Array.from(this._components.values());
	}

	/**
	 * Get all built-in components
	 */
	getBuiltIn(): PromptComponentDefinition[] {
		return this.getAll().filter(c => c.isBuiltIn);
	}

	/**
	 * Get all custom (non-built-in) components
	 */
	getCustom(): PromptComponentDefinition[] {
		return this.getAll().filter(c => !c.isBuiltIn);
	}

	/**
	 * Get components by category
	 */
	getByCategory(category: PromptComponentCategory): PromptComponentDefinition[] {
		return this.getAll().filter(c => c.category === category);
	}

	/**
	 * Get all unique categories that have at least one component
	 */
	getCategories(): PromptComponentCategory[] {
		const categories = new Set<PromptComponentCategory>();
		for (const component of this._components.values()) {
			categories.add(component.category);
		}
		return Array.from(categories);
	}

	/**
	 * Get the default content for a component
	 */
	getDefaultContent(id: string): string | undefined {
		return this._components.get(id)?.defaultContent;
	}

	/**
	 * Get components sorted by priority
	 */
	getAllSorted(): PromptComponentDefinition[] {
		return this.getAll().sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Get the count of registered components
	 */
	get size(): number {
		return this._components.size;
	}

	/**
	 * Clear all components (mainly for testing)
	 */
	clear(): void {
		this._components.clear();
		this._onDidChange.fire();
	}
}

/**
 * Singleton instance of the prompt component registry
 */
export const promptComponentRegistry = new PromptComponentRegistry();
