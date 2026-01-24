/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	builtInComponents,
	getDefaultComponentStates,
	getDefaultEnabledComponentIds,
} from '../../common/builtInComponents';
import { ModelFamily, PromptComponentCategory } from '../../common/types';

describe('builtInComponents', () => {
	describe('component definitions', () => {
		it('should have unique IDs for all components', () => {
			const ids = builtInComponents.map(c => c.id);
			const uniqueIds = new Set(ids);

			expect(uniqueIds.size).toBe(ids.length);
		});

		it('should have all required properties for each component', () => {
			for (const component of builtInComponents) {
				expect(component.id).toBeTruthy();
				expect(component.name).toBeTruthy();
				expect(component.description).toBeTruthy();
				expect(component.defaultContent).toBeTruthy();
				expect(Object.values(PromptComponentCategory)).toContain(component.category);
				expect(typeof component.defaultEnabled).toBe('boolean');
				expect(typeof component.priority).toBe('number');
				expect(component.isBuiltIn).toBe(true);
			}
		});

		it('should have unique priorities for stable ordering', () => {
			const priorities = builtInComponents.map(c => c.priority);
			const uniquePriorities = new Set(priorities);

			expect(uniquePriorities.size).toBe(priorities.length);
		});

		it('should include expected core components', () => {
			const ids = builtInComponents.map(c => c.id);

			expect(ids).toContain('copilotIdentityRules');
			expect(ids).toContain('safetyRules');
			expect(ids).toContain('notebookInstructions');
			expect(ids).toContain('fileLinkification');
			expect(ids).toContain('outputFormatting');
		});

		it('should have all categories represented', () => {
			const categories = new Set(builtInComponents.map(c => c.category));

			expect(categories).toContain(PromptComponentCategory.Identity);
			expect(categories).toContain(PromptComponentCategory.Safety);
			expect(categories).toContain(PromptComponentCategory.Tools);
			expect(categories).toContain(PromptComponentCategory.Formatting);
			expect(categories).toContain(PromptComponentCategory.Workflow);
		});

		it('should have valid supportedModels values when specified', () => {
			const validModels = Object.values(ModelFamily);

			for (const component of builtInComponents) {
				if (component.supportedModels) {
					expect(Array.isArray(component.supportedModels)).toBe(true);
					for (const model of component.supportedModels) {
						expect(validModels).toContain(model);
					}
				}
			}
		});

		it('should have GPT-only components marked correctly', () => {
			const structuredWorkflow = builtInComponents.find(c => c.id === 'structuredWorkflow');
			const communicationGuidelines = builtInComponents.find(c => c.id === 'communicationGuidelines');
			const applyPatch = builtInComponents.find(c => c.id === 'applyPatchInstructions');

			expect(structuredWorkflow?.supportedModels).toEqual([ModelFamily.GPT]);
			expect(communicationGuidelines?.supportedModels).toEqual([ModelFamily.GPT]);
			expect(applyPatch?.supportedModels).toEqual([ModelFamily.GPT]);
		});
	});

	describe('getDefaultEnabledComponentIds', () => {
		it('should return only components with defaultEnabled=true', () => {
			const enabledIds = getDefaultEnabledComponentIds();
			const enabledComponents = builtInComponents.filter(c => c.defaultEnabled);

			expect(enabledIds.length).toBe(enabledComponents.length);

			for (const id of enabledIds) {
				const component = builtInComponents.find(c => c.id === id);
				expect(component?.defaultEnabled).toBe(true);
			}
		});

		it('should include core identity and safety components', () => {
			const enabledIds = getDefaultEnabledComponentIds();

			expect(enabledIds).toContain('copilotIdentityRules');
			expect(enabledIds).toContain('safetyRules');
		});

		it('should not include workflow components by default', () => {
			const enabledIds = getDefaultEnabledComponentIds();

			expect(enabledIds).not.toContain('structuredWorkflow');
			expect(enabledIds).not.toContain('communicationGuidelines');
		});
	});

	describe('getDefaultComponentStates', () => {
		it('should return state for all built-in components', () => {
			const states = getDefaultComponentStates();

			expect(Object.keys(states).length).toBe(builtInComponents.length);

			for (const component of builtInComponents) {
				expect(states[component.id]).toBeDefined();
				expect(states[component.id].enabled).toBe(component.defaultEnabled);
			}
		});

		it('should have enabled=true for core components', () => {
			const states = getDefaultComponentStates();

			expect(states['copilotIdentityRules'].enabled).toBe(true);
			expect(states['safetyRules'].enabled).toBe(true);
			expect(states['outputFormatting'].enabled).toBe(true);
		});

		it('should have enabled=false for optional workflow components', () => {
			const states = getDefaultComponentStates();

			expect(states['structuredWorkflow'].enabled).toBe(false);
			expect(states['communicationGuidelines'].enabled).toBe(false);
			expect(states['codesearchModeInstructions'].enabled).toBe(false);
		});
	});
});
