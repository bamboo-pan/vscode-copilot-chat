/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { registerBuiltInComponents } from '../common/builtInComponents';
import { PromptCustomizerTreeViewContribution } from './promptCustomizerTreeView';
import { PromptEditorProviderContribution } from './promptEditorProvider';

/**
 * Main contribution that initializes the Prompt Customizer feature
 */
export class PromptCustomizerContribution extends Disposable implements IExtensionContribution {
	readonly id = 'promptCustomizer';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		// Register built-in components
		registerBuiltInComponents();

		// Register the service
		// Note: The service should be registered in the service collection before this contribution is created

		// Create and register the editor provider contribution
		this._register(this.instantiationService.createInstance(PromptEditorProviderContribution));

		// Create and register the tree view contribution
		// Note: TreeView contribution already registers all commands, so we don't need PromptCustomizerCommandsContribution
		this._register(this.instantiationService.createInstance(PromptCustomizerTreeViewContribution));
	}
}
