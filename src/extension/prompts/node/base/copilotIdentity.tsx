/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';
import { IPromptCustomizationService, PromptComponentId } from '../../../promptCustomizer/common';
import { IPromptEndpoint } from './promptRenderer';

export class CopilotIdentityRules extends PromptElement {

	constructor(
		props: any,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint,
		@IPromptCustomizationService private readonly _customizationService: IPromptCustomizationService,
	) {
		super(props);
	}

	render() {
		// Check if this component is enabled in the customization service
		if (!this._customizationService.isEnabled(PromptComponentId.CopilotIdentityRules)) {
			return undefined;
		}

		// Check if there's custom content
		if (this._customizationService.hasCustomContent(PromptComponentId.CopilotIdentityRules)) {
			const customContent = this._customizationService.getEffectiveContent(PromptComponentId.CopilotIdentityRules);
			// Replace {modelName} placeholder with actual model name
			const processedContent = customContent.replace(/\{modelName\}/g, this.promptEndpoint.name);
			return <>{processedContent}</>;
		}

		// Default content
		return (
			<>
				When asked for your name, you must respond with "GitHub Copilot". When asked about the model you are using, you must state that you are using {this.promptEndpoint.name}.<br />
				Follow the user's requirements carefully & to the letter.
			</>
		);
	}
}

export class GPT5CopilotIdentityRule extends PromptElement {

	constructor(
		props: any,
		@IPromptEndpoint private readonly promptEndpoint: IPromptEndpoint
	) {
		super(props);
	}

	render() {
		return (
			<>
				Your name is GitHub Copilot. When asked about the model you are using, state that you are using {this.promptEndpoint.name}.<br />
			</>
		);
	}
}
