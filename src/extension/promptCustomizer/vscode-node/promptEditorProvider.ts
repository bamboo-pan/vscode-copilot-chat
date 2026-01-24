/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { promptComponentRegistry } from '../common/promptComponentRegistry';
import { IPromptCustomizationService } from '../common/types';

/**
 * URI scheme for prompt component editing (used for read-only preview)
 */
export const PROMPT_EDITOR_SCHEME = 'prompt-component';

/**
 * Rough estimate of tokens per character for prompt content
 */
const TOKENS_PER_CHAR_ESTIMATE = 0.25;

/**
 * Track open editor sessions to link untitled documents to component IDs
 */
interface EditorSession {
	componentId: string;
	componentName: string;
	originalContent: string; // Track original content to detect changes
}
const openEditorSessions = new Map<string, EditorSession>();

/**
 * Parse a prompt editor URI to extract the component ID
 */
export function parsePromptEditorUri(uri: vscode.Uri): { componentId: string } | undefined {
	if (uri.scheme !== PROMPT_EDITOR_SCHEME) {
		return undefined;
	}
	const componentId = uri.path.replace(/^\//, '');
	if (!componentId) {
		return undefined;
	}
	return { componentId };
}

/**
 * Create a URI for editing a prompt component
 */
export function createPromptEditorUri(componentId: string): vscode.Uri {
	return vscode.Uri.from({
		scheme: PROMPT_EDITOR_SCHEME,
		path: `/${componentId}`,
	});
}

/**
 * Generate document header with metadata
 */
function generateDocumentHeader(componentId: string, componentName: string, category: string, isCustomized: boolean): string {
	return [
		`<!-- Prompt Component: ${componentName} -->`,
		`<!-- ID: ${componentId} -->`,
		`<!-- Category: ${category} -->`,
		`<!-- Status: ${isCustomized ? 'Customized' : 'Default'} -->`,
		`<!-- `,
		`     💾 Use "Apply Changes" button in the toolbar to save`,
		`     📝 Edit the content below the separator line`,
		`     ⚠️ Do not edit metadata above the separator`,
		`-->`,
		``,
		`---`,
		``,
	].join('\n');
}

/**
 * Extract content from document text (content after the separator)
 */
function extractContentFromDocument(text: string): string | undefined {
	const separatorIndex = text.indexOf('\n---\n');
	if (separatorIndex < 0) {
		return undefined;
	}
	return text.substring(separatorIndex + 5).trim();
}

/**
 * Get session from document
 */
function getSessionFromDocument(doc: vscode.TextDocument): EditorSession | undefined {
	return openEditorSessions.get(doc.uri.toString());
}

/**
 * TextDocumentContentProvider for prompt component preview (read-only)
 */
export class PromptEditorContentProvider extends Disposable implements vscode.TextDocumentContentProvider {
	private readonly _onDidChange = this._register(new vscode.EventEmitter<vscode.Uri>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		private readonly _service: IPromptCustomizationService,
	) {
		super();
	}

	provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): string {
		const parsed = parsePromptEditorUri(uri);
		if (!parsed) {
			return '';
		}

		const component = this._service.getComponent(parsed.componentId);
		if (!component) {
			return `# Error\n\nComponent "${parsed.componentId}" not found.`;
		}

		return `<!-- Default content for: ${component.name} -->\n\n${component.defaultContent}`;
	}

	refresh(componentId: string): void {
		const uri = createPromptEditorUri(componentId);
		this._onDidChange.fire(uri);
	}
}

/**
 * Status bar item that shows token count for prompt component editors
 */
class PromptEditorStatusBar extends Disposable {
	private readonly _statusBarItem: vscode.StatusBarItem;

	constructor() {
		super();

		this._statusBarItem = this._register(
			vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		);
		this._statusBarItem.name = 'Prompt Component Info';

		this._register(vscode.window.onDidChangeActiveTextEditor(() => this._update()));
		this._register(vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document === vscode.window.activeTextEditor?.document) {
				this._update();
			}
		}));

		this._update();
	}

	private _update(): void {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			this._statusBarItem.hide();
			return;
		}

		const session = getSessionFromDocument(editor.document);
		if (!session) {
			this._statusBarItem.hide();
			return;
		}

		const text = editor.document.getText();
		const content = extractContentFromDocument(text) || text;

		const charCount = content.length;
		const lineCount = content.split('\n').length;
		const tokenCount = Math.round(charCount * TOKENS_PER_CHAR_ESTIMATE);

		this._statusBarItem.text = `$(symbol-text) ${charCount} chars | ~${tokenCount} tokens`;
		this._statusBarItem.tooltip = new vscode.MarkdownString([
			`### Prompt Component: ${session.componentName}`,
			``,
			`- **Characters**: ${charCount}`,
			`- **Lines**: ${lineCount}`,
			`- **Estimated Tokens**: ~${tokenCount}`,
			``,
			`_Token count is an estimate based on ~4 chars/token_`,
		].join('\n'));
		this._statusBarItem.show();
	}
}

/**
 * Code lens provider for prompt editor documents (untitled documents with sessions)
 */
class PromptEditorCodeLensProvider extends Disposable implements vscode.CodeLensProvider {
	private readonly _onDidChangeCodeLenses = this._register(new vscode.EventEmitter<void>());
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	constructor(
		private readonly _service: IPromptCustomizationService,
	) {
		super();

		this._register(this._service.onDidChangeConfiguration(() => {
			this._onDidChangeCodeLenses.fire();
		}));

		// Also refresh when text changes
		this._register(vscode.workspace.onDidChangeTextDocument(() => {
			this._onDidChangeCodeLenses.fire();
		}));
	}

	provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
		const session = getSessionFromDocument(document);
		if (!session) {
			return [];
		}

		const component = this._service.getComponent(session.componentId);
		if (!component) {
			return [];
		}

		const codeLenses: vscode.CodeLens[] = [];
		const range = new vscode.Range(0, 0, 0, 0);

		const isCustomized = this._service.hasCustomContent(session.componentId);
		const isEnabled = this._service.isEnabled(session.componentId);

		// Component name
		codeLenses.push(new vscode.CodeLens(range, {
			title: `$(symbol-text) ${component.name}`,
			command: '',
		}));

		// Apply Changes button (primary action)
		codeLenses.push(new vscode.CodeLens(range, {
			title: '$(save) Apply Changes',
			command: 'promptCustomizer.applyEditorChanges',
			tooltip: 'Save changes to this component',
		}));

		// Enabled/Disabled toggle
		codeLenses.push(new vscode.CodeLens(range, {
			title: isEnabled ? '$(check) Enabled' : '$(circle-slash) Disabled',
			command: 'promptCustomizer.toggleComponent',
			arguments: [session.componentId],
			tooltip: 'Click to toggle enabled/disabled',
		}));

		// Reset button
		codeLenses.push(new vscode.CodeLens(range, {
			title: '$(history) Reset to Default',
			command: 'promptCustomizer.resetFromEditor',
			tooltip: isCustomized
				? 'Reset this component to its default content and enabled state'
				: 'Reset this component to its default enabled state',
		}));

		// View Default button
		codeLenses.push(new vscode.CodeLens(range, {
			title: '$(diff) View Default',
			command: 'promptCustomizer.viewDefaultContent',
			arguments: [session.componentId],
			tooltip: 'View the default content for comparison',
		}));

		// Close button (without save prompt)
		codeLenses.push(new vscode.CodeLens(range, {
			title: '$(close) Close',
			command: 'promptCustomizer.closeEditor',
			tooltip: 'Close this editor without saving',
		}));

		// Token count
		const text = document.getText();
		const content = extractContentFromDocument(text) || '';
		const tokenCount = Math.round(content.length * TOKENS_PER_CHAR_ESTIMATE);
		codeLenses.push(new vscode.CodeLens(range, {
			title: `$(pulse) ~${tokenCount} tokens`,
			command: '',
			tooltip: 'Estimated token count for this component',
		}));

		return codeLenses;
	}
}

/**
 * Contribution that registers the Prompt Editor Provider
 */
export class PromptEditorProviderContribution extends Disposable implements IExtensionContribution {
	readonly id = 'promptEditorProvider';

	constructor(
		@IInstantiationService _instantiationService: IInstantiationService,
		@IPromptCustomizationService service: IPromptCustomizationService,
	) {
		super();

		// Create content provider for read-only preview
		const contentProvider = this._register(new PromptEditorContentProvider(service));
		this._register(vscode.workspace.registerTextDocumentContentProvider(
			PROMPT_EDITOR_SCHEME,
			contentProvider
		));

		// Create status bar
		this._register(new PromptEditorStatusBar());

		// Register code lens provider for untitled documents
		const codeLensProvider = this._register(new PromptEditorCodeLensProvider(service));
		this._register(vscode.languages.registerCodeLensProvider(
			{ scheme: 'untitled', language: 'markdown' },
			codeLensProvider
		));

		// Clean up sessions when documents are closed
		this._register(vscode.workspace.onDidCloseTextDocument(doc => {
			openEditorSessions.delete(doc.uri.toString());
		}));

		// Intercept save to apply changes (instead of showing "Save As" dialog)
		this._register(vscode.workspace.onWillSaveTextDocument(e => {
			const session = getSessionFromDocument(e.document);
			if (session) {
				// Check if content actually changed
				const currentContent = e.document.getText();
				if (currentContent !== session.originalContent) {
					// Apply changes instead of saving to file
					e.waitUntil(this._applyChangesFromDocument(e.document, session, service));
				}
				// Update original content to mark as "saved"
				session.originalContent = currentContent;
			}
		}));

		// Handle tab close - auto-close without prompting if no changes
		this._register(vscode.window.tabGroups.onDidChangeTabs(async e => {
			for (const tab of e.closed) {
				if (tab.input instanceof vscode.TabInputText) {
					const uri = tab.input.uri;
					const session = openEditorSessions.get(uri.toString());
					if (session) {
						// Session cleanup is handled by onDidCloseTextDocument
					}
				}
			}
		}));

		// Register command to open prompt editor
		this._register(vscode.commands.registerCommand('promptCustomizer.openEditor', async (componentId: string) => {
			const component = service.getComponent(componentId);
			if (!component) {
				vscode.window.showErrorMessage(`Component "${componentId}" not found.`);
				return;
			}

			const content = service.getEffectiveContent(componentId);
			const isCustomized = service.hasCustomContent(componentId);
			const header = generateDocumentHeader(componentId, component.name, component.category, isCustomized);
			const fullContent = header + content;

			const doc = await vscode.workspace.openTextDocument({
				content: fullContent,
				language: 'markdown',
			});

			openEditorSessions.set(doc.uri.toString(), {
				componentId: componentId,
				componentName: component.name,
				originalContent: fullContent, // Store original content to detect changes
			});

			await vscode.window.showTextDocument(doc, {
				preview: false,
				viewColumn: vscode.ViewColumn.Active,
			});
		}));

		// Register command to apply changes from editor
		this._register(vscode.commands.registerCommand('promptCustomizer.applyEditorChanges', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const session = getSessionFromDocument(editor.document);
			if (!session) {
				vscode.window.showWarningMessage('This is not a prompt component editor.');
				return;
			}

			await this._applyChangesToService(editor.document, session, service);
		}));

		// Register command to reset from editor
		this._register(vscode.commands.registerCommand('promptCustomizer.resetFromEditor', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const session = getSessionFromDocument(editor.document);
			if (!session) {
				return;
			}

			const component = service.getComponent(session.componentId);
			if (!component) {
				return;
			}

			const confirm = await vscode.window.showWarningMessage(
				`Reset "${component.name}" to default?`,
				{ modal: true },
				'Reset'
			);

			if (confirm === 'Reset') {
				await service.resetComponent(session.componentId);

				// Reload the document with default content
				const defaultContent = component.defaultContent;
				const isCustomized = false;
				const header = generateDocumentHeader(session.componentId, component.name, component.category, isCustomized);

				const edit = new vscode.WorkspaceEdit();
				const fullRange = new vscode.Range(
					editor.document.positionAt(0),
					editor.document.positionAt(editor.document.getText().length)
				);
				edit.replace(editor.document.uri, fullRange, header + defaultContent);
				await vscode.workspace.applyEdit(edit);

				vscode.window.showInformationMessage(`"${component.name}" has been reset to default.`);
			}
		}));

		// Register command to view default content
		this._register(vscode.commands.registerCommand('promptCustomizer.viewDefaultContent', async (componentId: string) => {
			// If called without argument, try to get from current editor
			if (!componentId) {
				const editor = vscode.window.activeTextEditor;
				if (editor) {
					const session = getSessionFromDocument(editor.document);
					if (session) {
						componentId = session.componentId;
					}
				}
			}

			if (!componentId) {
				return;
			}

			const component = service.getComponent(componentId);
			if (!component) {
				return;
			}

			const defaultContent = promptComponentRegistry.getDefaultContent(componentId);
			if (!defaultContent) {
				vscode.window.showInformationMessage('No default content available.');
				return;
			}

			const doc = await vscode.workspace.openTextDocument({
				content: `<!-- Default content for: ${component.name} -->\n<!-- This is read-only for comparison. -->\n\n${defaultContent}`,
				language: 'markdown',
			});
			await vscode.window.showTextDocument(doc, {
				preview: true,
				viewColumn: vscode.ViewColumn.Beside,
			});
		}));

		// Register command to close editor without save prompt
		this._register(vscode.commands.registerCommand('promptCustomizer.closeEditor', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				return;
			}

			const session = getSessionFromDocument(editor.document);
			if (!session) {
				return;
			}

			// Check if there are unsaved changes
			const currentContent = editor.document.getText();
			if (currentContent !== session.originalContent) {
				const choice = await vscode.window.showWarningMessage(
					'You have unsaved changes. Do you want to apply them before closing?',
					{ modal: true },
					'Apply & Close',
					'Discard & Close'
				);

				if (choice === 'Apply & Close') {
					await this._applyChangesToService(editor.document, session, service);
				} else if (choice !== 'Discard & Close') {
					return; // User cancelled
				}
			}

			// Close without save prompt
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
		}));
	}

	private async _applyChangesFromDocument(
		document: vscode.TextDocument,
		session: EditorSession,
		service: IPromptCustomizationService
	): Promise<vscode.TextEdit[]> {
		await this._applyChangesToService(document, session, service);
		// Return empty edits to prevent actual file save
		return [];
	}

	private async _applyChangesToService(
		document: vscode.TextDocument,
		session: EditorSession,
		service: IPromptCustomizationService
	): Promise<void> {
		const text = document.getText();
		const content = extractContentFromDocument(text);

		if (content === undefined) {
			vscode.window.showWarningMessage('Invalid document format. Cannot find separator line (---).');
			return;
		}

		const defaultContent = promptComponentRegistry.getDefaultContent(session.componentId);
		if (content === defaultContent?.trim()) {
			await service.resetComponent(session.componentId);
			vscode.window.showInformationMessage(`Component reset to default content.`);
		} else {
			await service.setCustomContent(session.componentId, content);
			vscode.window.showInformationMessage(`Component content saved.`);
		}
	}
}
