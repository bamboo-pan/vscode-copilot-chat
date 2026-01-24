/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Types
export {
	IPromptCustomizationService, ModelFamily,
	ModelFamilyLabels,
	PROMPT_CUSTOMIZATION_CONFIG_VERSION,
	PromptComponentCategory,
	PromptComponentCategoryIcons,
	PromptComponentCategoryLabels,
	PromptComponentDefinition,
	PromptComponentState,
	PromptCustomizationConfig,
	PromptCustomizationExport, detectModelFamily, isComponentSupportedByModel
} from './types';

// Registry
export { PromptComponentRegistry, promptComponentRegistry } from './promptComponentRegistry';

// Built-in components
export {
	builtInComponents,
	getDefaultComponentStates,
	getDefaultEnabledComponentIds,
	registerBuiltInComponents
} from './builtInComponents';

// Conditional rendering / Component IDs
export {
	PromptComponentId,
	PromptComponentIdType
} from './conditionalPromptComponent';

// Skills management
export {
	ISkillsManagementService,
	SkillInfo,
	SkillsManagementService
} from './skillsManagementService';

