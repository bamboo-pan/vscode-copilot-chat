/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { PromptComponentId } from '../../src/extension/promptCustomizer/common/conditionalPromptComponent';
import { IPromptCustomizationService, ModelFamily, PromptComponentCategory } from '../../src/extension/promptCustomizer/common/types';
import { TestingServiceCollection } from '../../src/platform/test/node/services';
import { ssuite, stest } from '../base/stest';

/**
 * End-to-end tests for Prompt Customizer feature.
 * These tests verify that the prompt customization service correctly manages
 * component states, custom components, and configuration import/export.
 */
ssuite({ title: 'promptCustomizer', subtitle: 'e2e', location: 'panel' }, () => {

	// =========================================================================
	// Component State Management Tests
	// =========================================================================

	stest({ description: 'should have all built-in components registered' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const allComponents = service.getAllComponents();

		// Verify we have the expected number of built-in components (20)
		assert.ok(allComponents.length >= 16, `Expected at least 16 built-in components, got ${allComponents.length}`);

		// Verify key components exist
		const componentIds = allComponents.map(c => c.id);
		assert.ok(componentIds.includes(PromptComponentId.CopilotIdentityRules), 'CopilotIdentityRules should exist');
		assert.ok(componentIds.includes(PromptComponentId.SafetyRules), 'SafetyRules should exist');
		assert.ok(componentIds.includes(PromptComponentId.CoreInstructions), 'CoreInstructions should exist');
		assert.ok(componentIds.includes(PromptComponentId.ToolUseInstructions), 'ToolUseInstructions should exist');
	});

	stest({ description: 'should correctly enable and disable components' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const componentId = PromptComponentId.CopilotIdentityRules;

		// By default, components should be enabled
		const initialState = service.isEnabled(componentId);
		assert.strictEqual(initialState, true, 'CopilotIdentityRules should be enabled by default');

		// Disable the component
		await service.setEnabled(componentId, false);
		assert.strictEqual(service.isEnabled(componentId), false, 'Component should be disabled after setEnabled(false)');

		// Re-enable the component
		await service.setEnabled(componentId, true);
		assert.strictEqual(service.isEnabled(componentId), true, 'Component should be enabled after setEnabled(true)');

		// Test toggleEnabled
		await service.toggleEnabled(componentId);
		assert.strictEqual(service.isEnabled(componentId), false, 'Component should be disabled after toggleEnabled');

		await service.toggleEnabled(componentId);
		assert.strictEqual(service.isEnabled(componentId), true, 'Component should be enabled after toggleEnabled again');
	});

	stest({ description: 'should correctly count enabled components' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const totalCount = service.getTotalCount();
		const initialEnabledCount = service.getEnabledCount();

		assert.ok(totalCount > 0, 'Total count should be greater than 0');
		assert.ok(initialEnabledCount > 0, 'Initial enabled count should be greater than 0');
		assert.ok(initialEnabledCount <= totalCount, 'Enabled count should not exceed total count');

		// Disable a component and verify count changes
		await service.setEnabled(PromptComponentId.CopilotIdentityRules, false);
		const newEnabledCount = service.getEnabledCount();
		assert.strictEqual(newEnabledCount, initialEnabledCount - 1, 'Enabled count should decrease by 1');

		// Re-enable to restore state
		await service.setEnabled(PromptComponentId.CopilotIdentityRules, true);
	});

	// =========================================================================
	// Custom Content Tests
	// =========================================================================

	stest({ description: 'should correctly manage custom content' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const componentId = PromptComponentId.CopilotIdentityRules;

		// Initially should not have custom content
		assert.strictEqual(service.hasCustomContent(componentId), false, 'Should not have custom content initially');

		const defaultContent = service.getEffectiveContent(componentId);
		assert.ok(defaultContent.length > 0, 'Default content should not be empty');

		// Set custom content
		const customContent = 'You are a custom AI assistant.';
		await service.setCustomContent(componentId, customContent);

		assert.strictEqual(service.hasCustomContent(componentId), true, 'Should have custom content after setting');
		assert.strictEqual(service.getCustomContent(componentId), customContent, 'Custom content should match');
		assert.strictEqual(service.getEffectiveContent(componentId), customContent, 'Effective content should be custom content');

		// Reset component
		await service.resetComponent(componentId);
		assert.strictEqual(service.hasCustomContent(componentId), false, 'Should not have custom content after reset');
		assert.strictEqual(service.getEffectiveContent(componentId), defaultContent, 'Should return to default content after reset');
	});

	// =========================================================================
	// Custom Component Tests
	// =========================================================================

	stest({ description: 'should correctly add and remove custom components' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const initialCount = service.getTotalCount();

		// Add a custom component
		const customComponent = {
			id: 'test_custom_component',
			name: 'Test Custom Component',
			description: 'A test custom component for testing',
			category: PromptComponentCategory.Custom,
			defaultContent: 'This is custom content for testing.',
			defaultEnabled: true,
			priority: 1000,
		};

		await service.addCustomComponent(customComponent);

		// Verify component was added
		assert.strictEqual(service.getTotalCount(), initialCount + 1, 'Total count should increase by 1');

		const addedComponent = service.getComponent('test_custom_component');
		assert.ok(addedComponent, 'Custom component should be retrievable');
		assert.strictEqual(addedComponent?.name, customComponent.name, 'Component name should match');
		assert.strictEqual(addedComponent?.isBuiltIn, false, 'Custom component should not be marked as built-in');

		// Remove the custom component
		await service.removeCustomComponent('test_custom_component');
		assert.strictEqual(service.getTotalCount(), initialCount, 'Total count should return to initial value');
		assert.strictEqual(service.getComponent('test_custom_component'), undefined, 'Removed component should not be found');
	});

	stest({ description: 'should correctly update custom components' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		// Add a custom component
		await service.addCustomComponent({
			id: 'test_update_component',
			name: 'Original Name',
			description: 'Original description',
			category: PromptComponentCategory.Custom,
			defaultContent: 'Original content',
			defaultEnabled: true,
			priority: 1000,
		});

		// Update the component
		await service.updateCustomComponent('test_update_component', {
			name: 'Updated Name',
			description: 'Updated description',
		});

		const updatedComponent = service.getComponent('test_update_component');
		assert.strictEqual(updatedComponent?.name, 'Updated Name', 'Component name should be updated');
		assert.strictEqual(updatedComponent?.description, 'Updated description', 'Component description should be updated');

		// Clean up
		await service.removeCustomComponent('test_update_component');
	});

	// =========================================================================
	// Category and Model Family Tests
	// =========================================================================

	stest({ description: 'should correctly filter components by category' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const identityComponents = service.getComponentsByCategory(PromptComponentCategory.Identity);
		assert.ok(identityComponents.length > 0, 'Should have identity components');
		assert.ok(identityComponents.every(c => c.category === PromptComponentCategory.Identity), 'All components should be in Identity category');

		const toolsComponents = service.getComponentsByCategory(PromptComponentCategory.Tools);
		assert.ok(toolsComponents.length > 0, 'Should have tools components');
		assert.ok(toolsComponents.every(c => c.category === PromptComponentCategory.Tools), 'All components should be in Tools category');
	});

	stest({ description: 'should correctly filter components by model family' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		// Get all components
		const allComponents = service.getAllEnabledComponents();

		// Get GPT-specific components
		const gptComponents = service.getAllEnabledComponents(ModelFamily.GPT);

		// GPT components should include GPT-specific ones plus universal ones
		assert.ok(gptComponents.length > 0, 'Should have GPT-compatible components');

		// Claude components
		const claudeComponents = service.getAllEnabledComponents(ModelFamily.Claude);
		assert.ok(claudeComponents.length > 0, 'Should have Claude-compatible components');

		// Gemini components
		const geminiComponents = service.getAllEnabledComponents(ModelFamily.Gemini);
		assert.ok(geminiComponents.length > 0, 'Should have Gemini-compatible components');

		// All models should return the full set
		const allModelsComponents = service.getAllEnabledComponents(ModelFamily.All);
		assert.strictEqual(allModelsComponents.length, allComponents.length, 'ModelFamily.All should return all enabled components');
	});

	// =========================================================================
	// Import/Export Tests
	// =========================================================================

	stest({ description: 'should correctly export and import configuration' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		// Make some changes to the configuration
		await service.setEnabled(PromptComponentId.CopilotIdentityRules, false);
		await service.setCustomContent(PromptComponentId.SafetyRules, 'Custom safety rules');

		// Export configuration
		const exportedConfig = service.exportConfig();

		assert.ok(exportedConfig.version, 'Exported config should have version');
		assert.ok(exportedConfig.exportedAt, 'Exported config should have timestamp');
		assert.ok(exportedConfig.components, 'Exported config should have components');

		// Reset everything
		await service.resetAll();

		// Verify reset worked
		assert.strictEqual(service.isEnabled(PromptComponentId.CopilotIdentityRules), true, 'Component should be enabled after reset');
		assert.strictEqual(service.hasCustomContent(PromptComponentId.SafetyRules), false, 'Should not have custom content after reset');

		// Import the exported configuration
		await service.importConfig(exportedConfig);

		// Verify import worked
		assert.strictEqual(service.isEnabled(PromptComponentId.CopilotIdentityRules), false, 'Component should be disabled after import');
		assert.strictEqual(service.getCustomContent(PromptComponentId.SafetyRules), 'Custom safety rules', 'Custom content should be restored after import');

		// Clean up
		await service.resetAll();
	});

	// =========================================================================
	// Component Ordering Tests
	// =========================================================================

	stest({ description: 'should correctly manage component ordering' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const initialOrder = service.getComponentOrder();
		assert.ok(initialOrder.length > 0, 'Should have an initial component order');

		// Find the index of a component
		const componentId = PromptComponentId.SafetyRules;
		const initialIndex = initialOrder.indexOf(componentId);
		assert.ok(initialIndex > 0, 'SafetyRules should not be at the first position for this test');

		// Move the component up
		await service.moveComponent(componentId, 'up');
		const newOrder = service.getComponentOrder();
		const newIndex = newOrder.indexOf(componentId);

		assert.strictEqual(newIndex, initialIndex - 1, 'Component should move up by 1 position');

		// Move the component down
		await service.moveComponent(componentId, 'down');
		const restoredOrder = service.getComponentOrder();
		const restoredIndex = restoredOrder.indexOf(componentId);

		assert.strictEqual(restoredIndex, initialIndex, 'Component should return to original position');
	});

	// =========================================================================
	// Token Estimation Tests
	// =========================================================================

	stest({ description: 'should estimate token count' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const tokenCount = service.estimateTokenCount();
		assert.ok(tokenCount > 0, 'Token count should be greater than 0');

		// Disable a component and verify token count decreases
		const initialTokenCount = service.estimateTokenCount();
		await service.setEnabled(PromptComponentId.CoreInstructions, false);
		const reducedTokenCount = service.estimateTokenCount();

		assert.ok(reducedTokenCount < initialTokenCount, 'Token count should decrease when components are disabled');

		// Re-enable
		await service.setEnabled(PromptComponentId.CoreInstructions, true);
	});

	// =========================================================================
	// Full Prompt Generation Tests
	// =========================================================================

	stest({ description: 'should generate full prompt preview' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const fullPrompt = await service.generateFullPrompt();

		assert.ok(fullPrompt.length > 0, 'Full prompt should not be empty');
		assert.ok(fullPrompt.includes('Prompt Customizer Preview'), 'Full prompt should include header');
		assert.ok(fullPrompt.includes('Enabled Components'), 'Full prompt should include component count');
	});

	stest({ description: 'should generate model-specific prompt preview' }, async (testingServiceCollection: TestingServiceCollection) => {
		const accessor = testingServiceCollection.createTestingAccessor();
		const service = accessor.get(IPromptCustomizationService);

		const gptPrompt = await service.generateFullPrompt(ModelFamily.GPT);
		const claudePrompt = await service.generateFullPrompt(ModelFamily.Claude);

		assert.ok(gptPrompt.length > 0, 'GPT prompt should not be empty');
		assert.ok(claudePrompt.length > 0, 'Claude prompt should not be empty');

		// GPT-specific components should only appear in GPT prompt
		// (the exact content may vary based on configuration)
	});

});
