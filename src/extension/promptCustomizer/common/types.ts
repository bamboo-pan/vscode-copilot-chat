/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';

/**
 * Categories for organizing Prompt components
 */
export enum PromptComponentCategory {
	Identity = 'identity',
	Safety = 'safety',
	Context = 'context',
	Tools = 'tools',
	Formatting = 'formatting',
	Workflow = 'workflow',
	Custom = 'custom',
}

/**
 * Display names for component categories
 */
export const PromptComponentCategoryLabels: Record<PromptComponentCategory, string> = {
	[PromptComponentCategory.Identity]: 'Identity & Safety',
	[PromptComponentCategory.Safety]: 'Safety',
	[PromptComponentCategory.Context]: 'Context & Environment',
	[PromptComponentCategory.Tools]: 'Tools Instructions',
	[PromptComponentCategory.Formatting]: 'Output Formatting',
	[PromptComponentCategory.Workflow]: 'Workflow',
	[PromptComponentCategory.Custom]: 'Custom',
};

/**
 * Icons for component categories
 */
export const PromptComponentCategoryIcons: Record<PromptComponentCategory, string> = {
	[PromptComponentCategory.Identity]: 'account',
	[PromptComponentCategory.Safety]: 'shield',
	[PromptComponentCategory.Context]: 'info',
	[PromptComponentCategory.Tools]: 'tools',
	[PromptComponentCategory.Formatting]: 'output',
	[PromptComponentCategory.Workflow]: 'list-ordered',
	[PromptComponentCategory.Custom]: 'star',
};

/**
 * Model family identifiers for model-specific components
 */
export enum ModelFamily {
	/** All models */
	All = 'all',
	/** OpenAI GPT models (GPT-4, GPT-4.1, GPT-5, etc.) */
	GPT = 'gpt',
	/** Anthropic Claude models */
	Claude = 'claude',
	/** Google Gemini models */
	Gemini = 'gemini',
	/** xAI Grok models */
	Grok = 'grok',
}

/**
 * Display names for model families
 */
export const ModelFamilyLabels: Record<ModelFamily, string> = {
	[ModelFamily.All]: 'All Models',
	[ModelFamily.GPT]: 'OpenAI GPT',
	[ModelFamily.Claude]: 'Anthropic Claude',
	[ModelFamily.Gemini]: 'Google Gemini',
	[ModelFamily.Grok]: 'xAI Grok',
};

/**
 * Definition of a Prompt component
 */
export interface PromptComponentDefinition {
	/** Unique identifier for the component */
	readonly id: string;
	/** Display name */
	readonly name: string;
	/** Description of what this component does */
	readonly description: string;
	/** Category for grouping */
	readonly category: PromptComponentCategory;
	/** Default content of the component */
	readonly defaultContent: string;
	/** Whether this component is enabled by default */
	readonly defaultEnabled: boolean;
	/** Priority for ordering (lower number = higher priority) */
	readonly priority: number;
	/** Tools that must be available for this component to be relevant */
	readonly requiredTools?: string[];
	/** Whether this is a built-in component (cannot be deleted) */
	readonly isBuiltIn: boolean;
	/** Icon for the component */
	readonly icon?: string;
	/**
	 * Model families that support this component.
	 * If undefined or contains ModelFamily.All, component works with all models.
	 * If specific models are listed, component only works with those models.
	 */
	readonly supportedModels?: ModelFamily[];
}

/**
 * State of a component in user's configuration
 */
export interface PromptComponentState {
	/** Whether the component is enabled */
	enabled: boolean;
	/** Custom content override (undefined means use default) */
	customContent?: string;
}

/**
 * Complete configuration for prompt customization
 */
export interface PromptCustomizationConfig {
	/** Version for migration purposes */
	version: string;
	/** State of each component by ID */
	components: Record<string, PromptComponentState>;
	/** User-defined custom components */
	customComponents: PromptComponentDefinition[];
	/** Custom ordering of components (array of IDs) */
	componentOrder?: string[];
}

/**
 * Export format for configuration files
 */
export interface PromptCustomizationExport {
	/** Format version */
	version: string;
	/** Export timestamp */
	exportedAt: string;
	/** Component states */
	components: Record<string, PromptComponentState>;
	/** Custom components */
	customComponents: PromptComponentDefinition[];
	/** Component order */
	componentOrder?: string[];
	/** Disabled tool IDs (optional, for backward compatibility) */
	disabledTools?: string[];
	/** Disabled skill IDs (optional, for backward compatibility) */
	disabledSkills?: string[];
	/** Disabled agent IDs (optional, for backward compatibility) */
	disabledAgents?: string[];
}

/**
 * Service for managing prompt customization
 */
export interface IPromptCustomizationService {
	readonly _serviceBrand: undefined;

	// Events
	readonly onDidChangeConfiguration: Event<void>;

	// Component state management
	isEnabled(componentId: string): boolean;
	setEnabled(componentId: string, enabled: boolean): Promise<void>;
	toggleEnabled(componentId: string): Promise<void>;

	// Content management
	getEffectiveContent(componentId: string): string;
	getCustomContent(componentId: string): string | undefined;
	setCustomContent(componentId: string, content: string): Promise<void>;
	hasCustomContent(componentId: string): boolean;

	// Reset functionality
	resetComponent(componentId: string): Promise<void>;
	resetAll(): Promise<void>;

	// Custom component management
	addCustomComponent(component: Omit<PromptComponentDefinition, 'isBuiltIn'>): Promise<void>;
	removeCustomComponent(componentId: string): Promise<void>;
	updateCustomComponent(componentId: string, updates: Partial<Omit<PromptComponentDefinition, 'id' | 'isBuiltIn'>>): Promise<void>;

	// Ordering
	moveComponent(componentId: string, direction: 'up' | 'down'): Promise<void>;
	getComponentOrder(): string[];

	// Import/Export
	exportConfig(): PromptCustomizationExport;
	importConfig(config: PromptCustomizationExport): Promise<void>;

	// Query methods
	/**
	 * Get all enabled components, optionally filtered by model family.
	 * @param modelFamily - If provided, only returns components that support this model family
	 */
	getAllEnabledComponents(modelFamily?: ModelFamily): PromptComponentDefinition[];
	getAllComponents(): PromptComponentDefinition[];
	/**
	 * Get components by category, optionally filtered by model family.
	 * @param category - The category to filter by
	 * @param modelFamily - If provided, only returns components that support this model family
	 */
	getComponentsByCategory(category: PromptComponentCategory, modelFamily?: ModelFamily): PromptComponentDefinition[];
	getComponent(componentId: string): PromptComponentDefinition | undefined;

	// Statistics
	getEnabledCount(modelFamily?: ModelFamily): number;
	getTotalCount(): number;
	estimateTokenCount(modelFamily?: ModelFamily): number;

	// Preview
	/**
	 * Generate a full prompt preview.
	 * @param modelFamily - If provided, only includes components that support this model family
	 */
	generateFullPrompt(modelFamily?: ModelFamily): Promise<string>;
}

export const IPromptCustomizationService = createServiceIdentifier<IPromptCustomizationService>('IPromptCustomizationService');

/**
 * Default configuration version
 */
export const PROMPT_CUSTOMIZATION_CONFIG_VERSION = '1.0';

/**
 * Check if a component supports a given model family.
 * Returns true if:
 * - supportedModels is undefined or empty (supports all models)
 * - supportedModels includes ModelFamily.All
 * - supportedModels includes the specified model family
 */
export function isComponentSupportedByModel(component: PromptComponentDefinition, modelFamily: ModelFamily): boolean {
	if (!component.supportedModels || component.supportedModels.length === 0) {
		return true;
	}
	if (component.supportedModels.includes(ModelFamily.All)) {
		return true;
	}
	return component.supportedModels.includes(modelFamily);
}

/**
 * Detect the ModelFamily from a model name string.
 * @param modelName - The model name (e.g., "claude-sonnet-4", "gpt-4", "gemini-2")
 * @returns The detected ModelFamily, or ModelFamily.All if unknown
 */
export function detectModelFamily(modelName: string | undefined): ModelFamily {
	if (!modelName) {
		return ModelFamily.All;
	}

	const lowerName = modelName.toLowerCase();

	// Claude/Anthropic models
	if (lowerName.includes('claude') || lowerName.includes('anthropic')) {
		return ModelFamily.Claude;
	}

	// GPT/OpenAI models
	if (lowerName.includes('gpt') || lowerName.includes('o1') || lowerName.includes('o3') || lowerName.includes('o4-mini') || lowerName.includes('openai')) {
		return ModelFamily.GPT;
	}

	// Gemini/Google models
	if (lowerName.includes('gemini') || lowerName.includes('google')) {
		return ModelFamily.Gemini;
	}

	// Grok/xAI models
	if (lowerName.includes('grok') || lowerName.includes('xai')) {
		return ModelFamily.Grok;
	}

	return ModelFamily.All;
}
