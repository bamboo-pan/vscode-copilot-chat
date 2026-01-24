/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';
import { IPromptCustomizationService, PromptComponentId } from '../../../promptCustomizer/common';

export class SafetyRules extends PromptElement {
	constructor(
		props: any,
		@IPromptCustomizationService private readonly _customizationService: IPromptCustomizationService,
	) {
		super(props);
	}

	render() {
		// Check if this component is enabled in the customization service
		if (!this._customizationService.isEnabled(PromptComponentId.SafetyRules)) {
			return undefined;
		}

		// Check if there's custom content
		if (this._customizationService.hasCustomContent(PromptComponentId.SafetyRules)) {
			const customContent = this._customizationService.getEffectiveContent(PromptComponentId.SafetyRules);
			return <>{customContent}</>;
		}

		// Default content
		return (
			<>
				Follow Microsoft content policies.<br />
				Avoid content that violates copyrights.<br />
				If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."<br />
				Keep your answers short and impersonal.<br />
			</>
		);
	}
}

export class Gpt5SafetyRule extends PromptElement {
	render() {
		return (
			<>
				Follow Microsoft content policies.<br />
				Avoid content that violates copyrights.<br />
				If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, or violent, only respond with "Sorry, I can't assist with that."<br />
			</>
		);
	}
}

export class LegacySafetyRules extends PromptElement {
	render() {
		return (
			<>
				Follow Microsoft content policies.<br />
				Avoid content that violates copyrights.<br />
				If you are asked to generate content that is harmful, hateful, racist, sexist, lewd, violent, or completely irrelevant to software engineering, only respond with "Sorry, I can't assist with that."<br />
				Keep your answers short and impersonal.<br />
			</>
		);
	}
}
