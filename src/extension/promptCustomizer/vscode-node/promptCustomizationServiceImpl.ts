/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { builtInComponents, registerBuiltInComponents } from '../common/builtInComponents';
import { promptComponentRegistry } from '../common/promptComponentRegistry';
import { ISkillsManagementService } from '../common/skillsManagementService';
import {
	IPromptCustomizationService,
	isComponentSupportedByModel,
	ModelFamily,
	PROMPT_CUSTOMIZATION_CONFIG_VERSION,
	PromptComponentCategory,
	PromptComponentDefinition,
	PromptComponentState,
	PromptCustomizationConfig,
	PromptCustomizationExport,
} from '../common/types';
import { IAgentsManagementService } from './agentsManagementService';
import { IToolsManagementService } from './toolsManagementService';

/**
 * Storage key for prompt customization settings in global state
 */
const PROMPT_CUSTOMIZATION_STORAGE_KEY = 'github.copilot.chat.promptCustomization';

/**
 * Rough estimate of tokens per character for prompt content
 */
const TOKENS_PER_CHAR_ESTIMATE = 0.25;

/**
 * Implementation of the Prompt Customization Service
 */
export class PromptCustomizationServiceImpl extends Disposable implements IPromptCustomizationService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event;

	private _config: PromptCustomizationConfig;
	private _initialized = false;

	constructor(
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
		@ILogService private readonly logService: ILogService,
		@IToolsManagementService private readonly toolsManagementService: IToolsManagementService,
		@ISkillsManagementService private readonly skillsManagementService: ISkillsManagementService,
		@IAgentsManagementService private readonly agentsManagementService: IAgentsManagementService,
	) {
		super();

		// Initialize with empty config
		this._config = this._getDefaultConfig();

		// Register built-in components if not already registered
		if (promptComponentRegistry.size === 0) {
			registerBuiltInComponents();
		}

		// Load configuration from global state
		this._loadConfiguration();

		this._initialized = true;
	}

	private _getDefaultConfig(): PromptCustomizationConfig {
		const components: Record<string, PromptComponentState> = {};
		for (const component of builtInComponents) {
			components[component.id] = { enabled: component.defaultEnabled };
		}
		return {
			version: PROMPT_CUSTOMIZATION_CONFIG_VERSION,
			components,
			customComponents: [],
			componentOrder: undefined,
		};
	}

	private _loadConfiguration(): void {
		try {
			const stored = this.extensionContext.globalState.get<Partial<PromptCustomizationConfig>>(PROMPT_CUSTOMIZATION_STORAGE_KEY);
			this.logService.debug(`[PromptCustomizer] Loading configuration from globalState: ${stored ? 'found' : 'not found'}`);
			if (stored) {
				// Merge stored config with defaults
				this._config = {
					...this._getDefaultConfig(),
					...stored,
					components: {
						...this._getDefaultConfig().components,
						...stored.components,
					},
				};

				// Log the loaded component states
				const enabledCount = Object.entries(this._config.components).filter(([_, s]) => s.enabled).length;
				const totalCount = Object.keys(this._config.components).length;
				this.logService.debug(`[PromptCustomizer] Loaded ${enabledCount}/${totalCount} enabled components`);

				// Register custom components from stored config
				if (stored.customComponents) {
					for (const customComponent of stored.customComponents) {
						if (!promptComponentRegistry.has(customComponent.id)) {
							promptComponentRegistry.register({
								...customComponent,
								isBuiltIn: false,
							});
						}
					}
				}
			}
		} catch (error) {
			this.logService.error('Failed to load prompt customization configuration', error);
		}
	}

	private async _saveConfiguration(): Promise<void> {
		try {
			await this.extensionContext.globalState.update(PROMPT_CUSTOMIZATION_STORAGE_KEY, this._config);
			if (this._initialized) {
				this._onDidChangeConfiguration.fire();
			}
		} catch (error) {
			this.logService.error('Failed to save prompt customization configuration', error);
			throw error;
		}
	}

	// ============================================================================
	// Component State Management
	// ============================================================================

	isEnabled(componentId: string): boolean {
		const state = this._config.components[componentId];
		if (state !== undefined) {
			this.logService.debug(`[PromptCustomizer] isEnabled(${componentId}): ${state.enabled} (from config)`);
			return state.enabled;
		}
		// Fall back to default from registry
		const component = promptComponentRegistry.get(componentId);
		const result = component?.defaultEnabled ?? false;
		this.logService.debug(`[PromptCustomizer] isEnabled(${componentId}): ${result} (fallback to default)`);
		return result;
	}

	async setEnabled(componentId: string, enabled: boolean): Promise<void> {
		if (!this._config.components[componentId]) {
			this._config.components[componentId] = { enabled };
		} else {
			this._config.components[componentId].enabled = enabled;
		}
		await this._saveConfiguration();
	}

	async toggleEnabled(componentId: string): Promise<void> {
		const currentEnabled = this.isEnabled(componentId);
		await this.setEnabled(componentId, !currentEnabled);
	}

	// ============================================================================
	// Content Management
	// ============================================================================

	getEffectiveContent(componentId: string): string {
		// First check for custom content
		const customContent = this.getCustomContent(componentId);
		if (customContent !== undefined) {
			return customContent;
		}
		// Fall back to default content from registry
		return promptComponentRegistry.getDefaultContent(componentId) ?? '';
	}

	getCustomContent(componentId: string): string | undefined {
		return this._config.components[componentId]?.customContent;
	}

	async setCustomContent(componentId: string, content: string): Promise<void> {
		if (!this._config.components[componentId]) {
			const component = promptComponentRegistry.get(componentId);
			this._config.components[componentId] = {
				enabled: component?.defaultEnabled ?? false,
				customContent: content,
			};
		} else {
			this._config.components[componentId].customContent = content;
		}
		await this._saveConfiguration();
	}

	hasCustomContent(componentId: string): boolean {
		return this._config.components[componentId]?.customContent !== undefined;
	}

	// ============================================================================
	// Reset Functionality
	// ============================================================================

	async resetComponent(componentId: string): Promise<void> {
		const component = promptComponentRegistry.get(componentId);
		if (component) {
			this._config.components[componentId] = {
				enabled: component.defaultEnabled,
				// Remove custom content by not including it
			};
			await this._saveConfiguration();
		}
	}

	async resetAll(): Promise<void> {
		// Reset prompt components to default
		this._config = this._getDefaultConfig();
		await this._saveConfiguration();

		// Reset all tools to enabled
		await this.toolsManagementService.setAllToolsEnabled(true);

		// Reset all skills to enabled
		await this.skillsManagementService.setAllSkillsEnabled(true);

		// Reset all agents to enabled (only non-read-only agents)
		await this.agentsManagementService.setAllAgentsEnabled(true);

		this.logService.info('[PromptCustomizer] Reset all settings to default (components, tools, skills, agents)');
	}

	// ============================================================================
	// Custom Component Management
	// ============================================================================

	async addCustomComponent(component: Omit<PromptComponentDefinition, 'isBuiltIn'>): Promise<void> {
		const fullComponent: PromptComponentDefinition = {
			...component,
			isBuiltIn: false,
		};

		// Add to registry
		promptComponentRegistry.register(fullComponent);

		// Add to config
		this._config.customComponents.push(fullComponent);
		this._config.components[component.id] = { enabled: true };

		await this._saveConfiguration();
	}

	async removeCustomComponent(componentId: string): Promise<void> {
		const component = promptComponentRegistry.get(componentId);
		if (component && !component.isBuiltIn) {
			// Remove from registry
			promptComponentRegistry.unregister(componentId);

			// Remove from config
			this._config.customComponents = this._config.customComponents.filter(c => c.id !== componentId);
			delete this._config.components[componentId];

			// Remove from order if present
			if (this._config.componentOrder) {
				this._config.componentOrder = this._config.componentOrder.filter(id => id !== componentId);
			}

			await this._saveConfiguration();
		}
	}

	async updateCustomComponent(componentId: string, updates: Partial<Omit<PromptComponentDefinition, 'id' | 'isBuiltIn'>>): Promise<void> {
		const componentIndex = this._config.customComponents.findIndex(c => c.id === componentId);
		if (componentIndex !== -1) {
			this._config.customComponents[componentIndex] = {
				...this._config.customComponents[componentIndex],
				...updates,
			};

			// Update registry
			promptComponentRegistry.register(this._config.customComponents[componentIndex]);

			await this._saveConfiguration();
		}
	}

	// ============================================================================
	// Ordering
	// ============================================================================

	async moveComponent(componentId: string, direction: 'up' | 'down'): Promise<void> {
		const order = this.getComponentOrder();
		const currentIndex = order.indexOf(componentId);

		if (currentIndex === -1) {
			return;
		}

		const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;

		if (newIndex < 0 || newIndex >= order.length) {
			return;
		}

		// Swap positions
		[order[currentIndex], order[newIndex]] = [order[newIndex], order[currentIndex]];

		this._config.componentOrder = order;
		await this._saveConfiguration();
	}

	getComponentOrder(): string[] {
		// Get all component IDs from registry
		const allRegisteredIds = new Set(promptComponentRegistry.getAll().map(c => c.id));

		if (this._config.componentOrder && this._config.componentOrder.length > 0) {
			// Start with saved order
			const result = [...this._config.componentOrder];

			// Add any new components that are not in the saved order
			for (const id of allRegisteredIds) {
				if (!result.includes(id)) {
					result.push(id);
				}
			}

			// Filter out any IDs that no longer exist in registry
			return result.filter(id => allRegisteredIds.has(id));
		}

		// Return default order based on priority
		return promptComponentRegistry.getAllSorted().map(c => c.id);
	}

	// ============================================================================
	// Import/Export
	// ============================================================================

	exportConfig(): PromptCustomizationExport {
		// Get disabled IDs from each management service
		const disabledTools = Array.from(this.toolsManagementService.getDisabledToolNames());
		const disabledAgents = Array.from(this.agentsManagementService.getDisabledAgentIds());
		// Skills uses the same storage key pattern
		const disabledSkills = this.extensionContext.globalState.get<string[]>('promptCustomizer.disabledSkills', []);
		// Use skillsManagementService to ensure consistent behavior with other services
		void this.skillsManagementService.getAllSkills(); // Warm up cache if needed

		return {
			version: PROMPT_CUSTOMIZATION_CONFIG_VERSION,
			exportedAt: new Date().toISOString(),
			components: { ...this._config.components },
			customComponents: [...this._config.customComponents],
			componentOrder: this._config.componentOrder ? [...this._config.componentOrder] : undefined,
			disabledTools: disabledTools.length > 0 ? disabledTools : undefined,
			disabledSkills: disabledSkills.length > 0 ? disabledSkills : undefined,
			disabledAgents: disabledAgents.length > 0 ? disabledAgents : undefined,
		};
	}

	async importConfig(config: PromptCustomizationExport): Promise<void> {
		// Validate version
		if (config.version !== PROMPT_CUSTOMIZATION_CONFIG_VERSION) {
			this.logService.warn(`Importing config with version ${config.version}, expected ${PROMPT_CUSTOMIZATION_CONFIG_VERSION}`);
		}

		// Import custom components
		for (const customComponent of config.customComponents) {
			if (!promptComponentRegistry.has(customComponent.id)) {
				promptComponentRegistry.register({
					...customComponent,
					isBuiltIn: false,
				});
			}
		}

		// Update config
		this._config = {
			version: PROMPT_CUSTOMIZATION_CONFIG_VERSION,
			components: { ...this._getDefaultConfig().components, ...config.components },
			customComponents: config.customComponents,
			componentOrder: config.componentOrder,
		};

		await this._saveConfiguration();

		// Import disabled Tools if present
		if (config.disabledTools && config.disabledTools.length > 0) {
			// First enable all tools, then disable the ones in the list
			await this.toolsManagementService.setAllToolsEnabled(true);
			for (const toolId of config.disabledTools) {
				await this.toolsManagementService.setToolEnabled(toolId, false);
			}
			this.logService.info(`Imported ${config.disabledTools.length} disabled tools`);
		}

		// Import disabled Skills if present
		if (config.disabledSkills && config.disabledSkills.length > 0) {
			// Store directly using the same storage key as SkillsManagementService
			await this.extensionContext.globalState.update('promptCustomizer.disabledSkills', config.disabledSkills);
			this.logService.info(`Imported ${config.disabledSkills.length} disabled skills`);
		}

		// Import disabled Agents if present
		if (config.disabledAgents && config.disabledAgents.length > 0) {
			// First enable all agents, then disable the ones in the list
			await this.agentsManagementService.setAllAgentsEnabled(true);
			for (const agentId of config.disabledAgents) {
				await this.agentsManagementService.setAgentEnabled(agentId, false);
			}
			this.logService.info(`Imported ${config.disabledAgents.length} disabled agents`);
		}
	}

	// ============================================================================
	// Query Methods
	// ============================================================================

	getAllEnabledComponents(modelFamily?: ModelFamily): PromptComponentDefinition[] {
		const order = this.getComponentOrder();
		const enabledIds = new Set(
			Object.entries(this._config.components)
				.filter(([_, state]) => state.enabled)
				.map(([id, _]) => id)
		);

		// Add components that are enabled by default but not in config
		for (const component of promptComponentRegistry.getAll()) {
			if (component.defaultEnabled && !this._config.components[component.id]) {
				enabledIds.add(component.id);
			}
		}

		let components = order
			.filter(id => enabledIds.has(id))
			.map(id => promptComponentRegistry.get(id))
			.filter((c): c is PromptComponentDefinition => c !== undefined);

		// Filter by model family if provided
		if (modelFamily && modelFamily !== ModelFamily.All) {
			components = components.filter(c => isComponentSupportedByModel(c, modelFamily));
		}

		return components;
	}

	getAllComponents(): PromptComponentDefinition[] {
		const order = this.getComponentOrder();
		return order
			.map(id => promptComponentRegistry.get(id))
			.filter((c): c is PromptComponentDefinition => c !== undefined);
	}

	getComponentsByCategory(category: PromptComponentCategory, modelFamily?: ModelFamily): PromptComponentDefinition[] {
		let components = this.getAllComponents().filter(c => c.category === category);

		// Filter by model family if provided
		if (modelFamily && modelFamily !== ModelFamily.All) {
			components = components.filter(c => isComponentSupportedByModel(c, modelFamily));
		}

		return components;
	}

	getComponent(componentId: string): PromptComponentDefinition | undefined {
		return promptComponentRegistry.get(componentId);
	}

	// ============================================================================
	// Statistics
	// ============================================================================

	getEnabledCount(modelFamily?: ModelFamily): number {
		return this.getAllEnabledComponents(modelFamily).length;
	}

	getTotalCount(): number {
		return promptComponentRegistry.size;
	}

	estimateTokenCount(modelFamily?: ModelFamily): number {
		const enabledComponents = this.getAllEnabledComponents(modelFamily);
		let totalChars = 0;

		for (const component of enabledComponents) {
			const content = this.getEffectiveContent(component.id);
			totalChars += content.length;
		}

		return Math.round(totalChars * TOKENS_PER_CHAR_ESTIMATE);
	}

	// ============================================================================
	// Preview
	// ============================================================================

	async generateFullPrompt(modelFamily?: ModelFamily): Promise<string> {
		const enabledComponents = this.getAllEnabledComponents(modelFamily);
		const parts: string[] = [];

		// Add header with statistics
		const totalTokens = this.estimateTokenCount(modelFamily);
		const enabledCount = this.getEnabledCount(modelFamily);
		const totalCount = this.getTotalCount();

		parts.push('# Prompt Customizer - Full Preview');
		parts.push('');
		parts.push(`**Enabled Components:** ${enabledCount}/${totalCount}`);
		parts.push(`**Estimated Tokens:** ~${totalTokens.toLocaleString()}`);
		parts.push('');

		// Add Skills/Agents/Tools summary
		parts.push('## Summary');
		parts.push('');

		// Skills summary
		const allSkills = await this.skillsManagementService.getAllSkills();
		const enabledSkills = allSkills.filter(s => s.enabled);
		parts.push(`**Skills:** ${enabledSkills.length}/${allSkills.length} enabled`);
		if (allSkills.length > 0 && enabledSkills.length < allSkills.length) {
			const disabledSkillNames = allSkills.filter(s => !s.enabled).map(s => s.name);
			parts.push(`  - Disabled: ${disabledSkillNames.join(', ')}`);
		}

		// Agents summary
		const allAgents = await this.agentsManagementService.getAllAgents();
		const controllableAgents = allAgents.filter(a => !a.isReadOnly);
		const readOnlyAgents = allAgents.filter(a => a.isReadOnly);
		const enabledAgents = controllableAgents.filter(a => a.enabled);
		if (readOnlyAgents.length > 0) {
			parts.push(`**Agents:** ${enabledAgents.length}/${controllableAgents.length} enabled + ${readOnlyAgents.length} read-only`);
		} else {
			parts.push(`**Agents:** ${enabledAgents.length}/${controllableAgents.length} enabled`);
		}
		if (controllableAgents.length > 0 && enabledAgents.length < controllableAgents.length) {
			const disabledAgentNames = controllableAgents.filter(a => !a.enabled).map(a => a.name);
			parts.push(`  - Disabled: ${disabledAgentNames.join(', ')}`);
		}

		// Tools summary
		const allTools = await this.toolsManagementService.getAllTools();
		const controllableTools = allTools.filter(t => !t.isReadOnly);
		const enabledTools = controllableTools.filter(t => t.enabled);
		parts.push(`**Tools:** ${enabledTools.length}/${controllableTools.length} enabled`);
		if (controllableTools.length > 0 && enabledTools.length < controllableTools.length) {
			const disabledToolNames = controllableTools.filter(t => !t.enabled).map(t => t.name).slice(0, 10);
			const remaining = controllableTools.filter(t => !t.enabled).length - disabledToolNames.length;
			let disabledText = disabledToolNames.join(', ');
			if (remaining > 0) {
				disabledText += `, ... and ${remaining} more`;
			}
			parts.push(`  - Disabled: ${disabledText}`);
		}

		parts.push('');
		parts.push('---');
		parts.push('');

		// Add each enabled component
		for (const component of enabledComponents) {
			const content = this.getEffectiveContent(component.id);
			if (content.trim()) {
				const isCustomized = this.hasCustomContent(component.id);
				const statusBadge = isCustomized ? ' ✏️ (customized)' : '';
				const tokenEstimate = Math.round(content.length * TOKENS_PER_CHAR_ESTIMATE);

				parts.push(`## ${component.name}${statusBadge}`);
				parts.push(`*Category: ${component.category} | ~${tokenEstimate} tokens*`);
				parts.push('');
				parts.push(content);
				parts.push('');
				parts.push('---');
				parts.push('');
			}
		}

		return parts.join('\n');
	}
}
