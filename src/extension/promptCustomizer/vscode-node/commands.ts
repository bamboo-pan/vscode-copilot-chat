/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import {
	IPromptCustomizationService,
	ModelFamily,
	ModelFamilyLabels,
	PromptComponentCategory,
	PromptCustomizationExport,
} from '../common/types';

// Command IDs
export const COMMAND_IDS = {
	open: 'promptCustomizer.open',
	editComponent: 'promptCustomizer.editComponent',
	viewDefaultContent: 'promptCustomizer.viewDefaultContent',
	resetComponent: 'promptCustomizer.resetComponent',
	resetAll: 'promptCustomizer.resetAll',
	previewPrompt: 'promptCustomizer.previewPrompt',
	exportConfig: 'promptCustomizer.exportConfig',
	importConfig: 'promptCustomizer.importConfig',
	addCustomComponent: 'promptCustomizer.addCustomComponent',
	deleteCustomComponent: 'promptCustomizer.deleteCustomComponent',
	refresh: 'promptCustomizer.refresh',
} as const;

/**
 * Contribution that registers Prompt Customizer commands
 */
export class PromptCustomizerCommandsContribution extends Disposable implements IExtensionContribution {
	readonly id = 'promptCustomizerCommands';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPromptCustomizationService private readonly _service: IPromptCustomizationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._registerCommands();
	}

	private _registerCommands(): void {
		// Open Prompt Customizer
		this._register(vscode.commands.registerCommand(COMMAND_IDS.open, () => {
			vscode.commands.executeCommand('promptCustomizer.focus');
		}));

		// Edit Component
		this._register(vscode.commands.registerCommand(COMMAND_IDS.editComponent, async (componentId: string) => {
			await this._editComponent(componentId);
		}));

		// View Default Content
		this._register(vscode.commands.registerCommand(COMMAND_IDS.viewDefaultContent, async (componentId: string) => {
			await this._viewDefaultContent(componentId);
		}));

		// Reset Component
		this._register(vscode.commands.registerCommand(COMMAND_IDS.resetComponent, async (componentId: string) => {
			const component = this._service.getComponent(componentId);
			if (!component) {
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Reset "${component.name}" to default?`,
				{ modal: true },
				'Reset'
			);

			if (confirm === 'Reset') {
				await this._service.resetComponent(componentId);
				vscode.window.showInformationMessage(`"${component.name}" has been reset to default.`);
			}
		}));

		// Reset All
		this._register(vscode.commands.registerCommand(COMMAND_IDS.resetAll, async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Reset all prompt components to default? This will remove all customizations.',
				{ modal: true },
				'Reset All'
			);

			if (confirm === 'Reset All') {
				await this._service.resetAll();
				vscode.window.showInformationMessage('All prompt components have been reset to default.');
			}
		}));

		// Preview Full Prompt
		this._register(vscode.commands.registerCommand(COMMAND_IDS.previewPrompt, async () => {
			// Let user select which model to preview for
			const modelOptions = [
				{ label: '$(globe) All Models', description: 'Show all enabled components', value: ModelFamily.All },
				{ label: '$(hubot) OpenAI GPT', description: 'GPT-4, GPT-5, etc.', value: ModelFamily.GPT },
				{ label: '$(sparkle) Anthropic Claude', description: 'Claude Sonnet, Opus, etc.', value: ModelFamily.Claude },
				{ label: '$(star) Google Gemini', description: 'Gemini 2, etc.', value: ModelFamily.Gemini },
				{ label: '$(zap) xAI Grok', description: 'Grok models', value: ModelFamily.Grok },
			];

			const selected = await vscode.window.showQuickPick(modelOptions, {
				placeHolder: 'Select model family to preview prompt for',
				title: 'Preview Prompt for Model',
			});

			if (!selected) {
				return;
			}

			const modelFamily = selected.value;
			const content = await this._service.generateFullPrompt(modelFamily);

			// Add model info to the header
			const modelInfo = modelFamily === ModelFamily.All
				? '(All Models)'
				: `(${ModelFamilyLabels[modelFamily]})`;

			const doc = await vscode.workspace.openTextDocument({
				content: content.replace('# Prompt Customizer - Full Preview', `# Prompt Customizer - Full Preview ${modelInfo}`),
				language: 'markdown',
			});
			await vscode.window.showTextDocument(doc, { preview: true });
		}));

		// Export Configuration
		this._register(vscode.commands.registerCommand(COMMAND_IDS.exportConfig, async () => {
			const config = this._service.exportConfig();
			const content = JSON.stringify(config, null, 2);

			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file('prompt-customizer-config.json'),
				filters: { 'JSON': ['json'] },
				title: 'Export Prompt Customizer Configuration',
			});

			if (saveUri) {
				await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
				vscode.window.showInformationMessage(`Configuration exported to ${saveUri.fsPath}`);
			}
		}));

		// Import Configuration
		this._register(vscode.commands.registerCommand(COMMAND_IDS.importConfig, async () => {
			const fileUris = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectMany: false,
				filters: { 'JSON': ['json'] },
				title: 'Import Prompt Customizer Configuration',
			});

			if (!fileUris || fileUris.length === 0) {
				return;
			}

			try {
				const content = await vscode.workspace.fs.readFile(fileUris[0]);
				const config = JSON.parse(Buffer.from(content).toString('utf8')) as PromptCustomizationExport;

				const confirm = await vscode.window.showWarningMessage(
					'Import this configuration? This will overwrite your current settings.',
					{ modal: true },
					'Import'
				);

				if (confirm === 'Import') {
					await this._service.importConfig(config);
					vscode.window.showInformationMessage('Configuration imported successfully.');
				}
			} catch (error) {
				this._logService.error('Failed to import configuration', error);
				vscode.window.showErrorMessage('Failed to import configuration. Please check the file format.');
			}
		}));

		// Add Custom Component
		this._register(vscode.commands.registerCommand(COMMAND_IDS.addCustomComponent, async () => {
			await this._addCustomComponent();
		}));

		// Delete Custom Component
		this._register(vscode.commands.registerCommand(COMMAND_IDS.deleteCustomComponent, async (componentId: string) => {
			const component = this._service.getComponent(componentId);
			if (!component || component.isBuiltIn) {
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Delete custom component "${component.name}"?`,
				{ modal: true },
				'Delete'
			);

			if (confirm === 'Delete') {
				await this._service.removeCustomComponent(componentId);
				vscode.window.showInformationMessage(`"${component.name}" has been deleted.`);
			}
		}));

		// Refresh
		this._register(vscode.commands.registerCommand(COMMAND_IDS.refresh, () => {
			vscode.commands.executeCommand('workbench.actions.treeView.promptCustomizer.refresh');
		}));
	}

	private async _editComponent(componentId: string): Promise<void> {
		const component = this._service.getComponent(componentId);
		if (!component) {
			return;
		}

		const currentContent = this._service.getEffectiveContent(componentId);

		// Create a text document with the component content
		const content = `# ${component.name}\n\n${currentContent}`;

		const doc = await vscode.workspace.openTextDocument({
			content,
			language: 'markdown',
		});

		await vscode.window.showTextDocument(doc);

		// Show save instructions
		vscode.window.showInformationMessage(
			`Edit the content below the header. Use "Save As" to save changes, then run "Prompt Customizer: Apply Edited Content" command.`,
			'Got it'
		);
	}

	private async _viewDefaultContent(componentId: string): Promise<void> {
		const component = this._service.getComponent(componentId);
		if (!component) {
			return;
		}

		const doc = await vscode.workspace.openTextDocument({
			content: `# ${component.name} (Default)\n\n${component.defaultContent}`,
			language: 'markdown',
		});
		await vscode.window.showTextDocument(doc, { preview: true });
	}

	private async _addCustomComponent(): Promise<void> {
		// Get component name
		const name = await vscode.window.showInputBox({
			prompt: 'Enter a name for the custom component',
			placeHolder: 'My Custom Instructions',
			validateInput: (value) => {
				if (!value || value.trim().length === 0) {
					return 'Name is required';
				}
				return undefined;
			},
		});

		if (!name) {
			return;
		}

		// Generate ID from name
		const id = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');

		// Get description
		const description = await vscode.window.showInputBox({
			prompt: 'Enter a description for the component',
			placeHolder: 'Custom instructions for...',
		});

		if (description === undefined) {
			return;
		}

		// Get initial content
		const content = await vscode.window.showInputBox({
			prompt: 'Enter the initial content (you can edit it later)',
			placeHolder: 'Enter your custom instructions here...',
		});

		if (content === undefined) {
			return;
		}

		// Add the component
		await this._service.addCustomComponent({
			id,
			name,
			description: description || 'Custom component',
			category: PromptComponentCategory.Custom,
			defaultContent: content || '',
			defaultEnabled: true,
			priority: 1000 + Date.now() % 1000, // Unique priority
		});

		vscode.window.showInformationMessage(`Custom component "${name}" has been created.`);
	}
}
