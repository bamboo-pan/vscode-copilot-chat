/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { getToolName, isInternalTool, toolCategories, ToolCategory, ToolName } from '../../tools/common/toolNames';

/**
 * VS Code Core tools that are provided by the core runtime, not registered via vscode.lm.registerTool().
 * These tools need to be manually added to the UI tool list since they don't appear in vscode.lm.tools.
 */
const VSCODE_CORE_TOOLS: ReadonlyArray<{ name: ToolName; description: string }> = [
	{
		name: ToolName.CoreManageTodoList,
		description: 'Manage a structured todo list to track progress and plan tasks throughout your coding session.',
	},
	{
		name: ToolName.CoreRunSubagent,
		description: 'Launch a new agent to handle complex, multi-step tasks autonomously.',
	},
];

/**
 * Tool information for display in the tree view
 */
export interface ToolInfo {
	/** Tool name (ToolName enum value) */
	id: string;
	/** Human-readable name */
	name: string;
	/** Tool description */
	description: string;
	/** Tool category */
	category: ToolCategory;
	/** Whether the tool is currently enabled */
	enabled: boolean;
	/** Whether this is a core tool that cannot be disabled */
	isCore: boolean;
	/** Tool tags */
	tags: readonly string[];
	/** Whether this tool is read-only (cannot be enabled/disabled) */
	isReadOnly: boolean;
}

/**
 * Core tools list - currently empty to allow users full control.
 * Users can disable any tool at their own discretion.
 */
export const CORE_REQUIRED_TOOLS: readonly ToolName[] = [] as const;

export const IToolsManagementService = createServiceIdentifier<IToolsManagementService>('IToolsManagementService');

export interface IToolsManagementService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when tool configuration changes
	 */
	readonly onDidChangeConfiguration: Event<void>;

	/**
	 * Get all available tools
	 */
	getAllTools(): Promise<ToolInfo[]>;

	/**
	 * Get tools grouped by category
	 */
	getToolsByCategory(category: ToolCategory): Promise<ToolInfo[]>;

	/**
	 * Check if a tool is enabled
	 */
	isToolEnabled(toolId: string): boolean;

	/**
	 * Set whether a tool is enabled
	 */
	setToolEnabled(toolId: string, enabled: boolean): Promise<void>;

	/**
	 * Enable or disable all tools at once
	 */
	setAllToolsEnabled(enabled: boolean): Promise<void>;

	/**
	 * Enable or disable all tools in a specific category
	 */
	setToolsCategoryEnabled(category: ToolCategory, enabled: boolean): Promise<void>;

	/**
	 * Check if a tool is a core required tool
	 */
	isCoreRequiredTool(toolId: string): boolean;

	/**
	 * Get all enabled tool names
	 */
	getEnabledToolNames(): Set<string>;

	/**
	 * Get all disabled tool names (for filtering)
	 */
	getDisabledToolNames(): Set<string>;
}

const STORAGE_KEY = 'promptCustomizer.disabledTools';

export class ToolsManagementService extends Disposable implements IToolsManagementService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event;

	private _disabledToolIds: Set<string>;
	private _cachedTools: Map<string, vscode.LanguageModelToolInformation> = new Map();

	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super();
		this._disabledToolIds = this._loadConfiguration();
	}

	private _loadConfiguration(): Set<string> {
		const stored = this._extensionContext.globalState.get<string[]>(STORAGE_KEY, []);
		return new Set(stored);
	}

	private async _saveConfiguration(): Promise<void> {
		const disabledArray = Array.from(this._disabledToolIds);
		await this._extensionContext.globalState.update(STORAGE_KEY, disabledArray);
		this._onDidChangeConfiguration.fire();
	}

	async getAllTools(): Promise<ToolInfo[]> {
		// Use vscode.lm.tools directly to avoid circular dependency with IToolsService
		const tools = vscode.lm.tools;
		const result: ToolInfo[] = [];
		const processedToolNames = new Set<string>();

		// Update cached tools
		this._cachedTools.clear();
		for (const tool of tools) {
			this._cachedTools.set(tool.name, tool);
		}

		for (const tool of tools) {
			// Get the normalized tool name using the same function as ToolsService
			const normalizedName = getToolName(tool.name);

			// Skip internal tools - they should not be shown in the UI
			// Internal tools are not sent to the model and are not user-controllable
			if (isInternalTool(normalizedName)) {
				continue;
			}

			const category = toolCategories[normalizedName as ToolName] ?? ToolCategory.Core;
			const isCore = this.isCoreRequiredTool(normalizedName);
			const isReadOnly = category === ToolCategory.ReadOnly;

			result.push({
				id: normalizedName,
				name: this._formatToolName(normalizedName),
				description: tool.description || '',
				category,
				enabled: this.isToolEnabled(normalizedName),
				isCore,
				tags: tool.tags,
				isReadOnly,
			});
			processedToolNames.add(normalizedName);
		}

		// Add VS Code Core tools that are not registered via vscode.lm.registerTool()
		// These tools are provided by VS Code core runtime and need to be manually included
		for (const coreTool of VSCODE_CORE_TOOLS) {
			if (!processedToolNames.has(coreTool.name)) {
				const category = toolCategories[coreTool.name] ?? ToolCategory.Core;
				result.push({
					id: coreTool.name,
					name: this._formatToolName(coreTool.name),
					description: coreTool.description,
					category,
					enabled: this.isToolEnabled(coreTool.name),
					isCore: false,
					tags: [],
					isReadOnly: false,
				});
			}
		}

		// Sort by category and name
		result.sort((a, b) => {
			if (a.category !== b.category) {
				return a.category.localeCompare(b.category);
			}
			return a.name.localeCompare(b.name);
		});

		return result;
	}

	async getToolsByCategory(category: ToolCategory): Promise<ToolInfo[]> {
		const allTools = await this.getAllTools();
		return allTools.filter(tool => tool.category === category);
	}

	isToolEnabled(toolId: string): boolean {
		return !this._disabledToolIds.has(toolId);
	}

	/**
	 * Check if a tool is in the "Read Only" category
	 * These tools cannot be enabled/disabled by the user
	 */
	isReadOnly(toolId: string): boolean {
		const category = toolCategories[toolId as ToolName];
		return category === ToolCategory.ReadOnly;
	}

	async setToolEnabled(toolId: string, enabled: boolean): Promise<void> {
		// Prevent changing read-only tools
		if (this.isReadOnly(toolId)) {
			return;
		}

		if (enabled) {
			this._disabledToolIds.delete(toolId);
		} else {
			this._disabledToolIds.add(toolId);
		}

		await this._saveConfiguration();
	}

	isCoreRequiredTool(toolId: string): boolean {
		return CORE_REQUIRED_TOOLS.includes(toolId as ToolName);
	}

	getEnabledToolNames(): Set<string> {
		const enabled = new Set<string>();
		for (const tool of this._cachedTools.keys()) {
			if (this.isToolEnabled(tool)) {
				enabled.add(tool);
			}
		}
		return enabled;
	}

	getDisabledToolNames(): Set<string> {
		// Return a copy to prevent external modification
		return new Set(this._disabledToolIds);
	}

	async setAllToolsEnabled(enabled: boolean): Promise<void> {
		const tools = await this.getAllTools();
		for (const tool of tools) {
			// Skip read-only tools
			if (tool.isReadOnly) {
				continue;
			}
			if (enabled) {
				this._disabledToolIds.delete(tool.id);
			} else {
				this._disabledToolIds.add(tool.id);
			}
		}
		await this._saveConfiguration();
	}

	async setToolsCategoryEnabled(category: ToolCategory, enabled: boolean): Promise<void> {
		// Cannot enable/disable ReadOnly category
		if (category === ToolCategory.ReadOnly) {
			return;
		}
		const tools = await this.getToolsByCategory(category);
		for (const tool of tools) {
			if (enabled) {
				this._disabledToolIds.delete(tool.id);
			} else {
				this._disabledToolIds.add(tool.id);
			}
		}
		await this._saveConfiguration();
	}

	/**
	 * Format tool name for display (convert snake_case to Title Case)
	 */
	private _formatToolName(toolName: string): string {
		return toolName
			.split('_')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}
}
