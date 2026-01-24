/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { ToolCategory } from '../../tools/common/toolNames';
import { ISkillsManagementService, SkillInfo } from '../common/skillsManagementService';
import {
	IPromptCustomizationService,
	ModelFamily,
	ModelFamilyLabels,
	PromptComponentCategory,
	PromptComponentCategoryIcons,
	PromptComponentCategoryLabels,
	PromptComponentDefinition,
} from '../common/types';
import { AgentInfo, IAgentsManagementService } from './agentsManagementService';
import { IToolsManagementService, ToolInfo } from './toolsManagementService';

/**
 * Tree item representing a category header
 */
class CategoryTreeItem extends vscode.TreeItem {
	constructor(
		public readonly category: PromptComponentCategory,
		public readonly enabledCount: number,
		public readonly totalCount: number,
	) {
		super(PromptComponentCategoryLabels[category], vscode.TreeItemCollapsibleState.Expanded);
		this.iconPath = new vscode.ThemeIcon(PromptComponentCategoryIcons[category]);
		this.description = `[${enabledCount}/${totalCount}]`;
		this.contextValue = 'promptCategory';
	}
}

/**
 * Get human-readable label for supported models
 */
function getSupportedModelsLabel(supportedModels: ModelFamily[] | undefined): string {
	if (!supportedModels || supportedModels.length === 0 || supportedModels.includes(ModelFamily.All)) {
		return '';
	}
	return supportedModels.map(m => ModelFamilyLabels[m]).join(', ');
}

/**
 * Tree item representing a prompt component
 */
class ComponentTreeItem extends vscode.TreeItem {
	constructor(
		public readonly component: PromptComponentDefinition,
		public readonly isEnabled: boolean,
		public readonly hasCustomContent: boolean,
	) {
		super(component.name, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(component.icon ?? 'symbol-text');

		// Build description with model support info
		const parts: string[] = [];
		const modelsLabel = getSupportedModelsLabel(component.supportedModels);
		if (modelsLabel) {
			parts.push(`[${modelsLabel}]`);
		}
		if (hasCustomContent) {
			parts.push('✏️ (customized)');
		}
		this.description = parts.join(' ');

		// Build tooltip with full info
		let tooltipText = component.description;
		if (modelsLabel) {
			tooltipText += `\n\n⚠️ Only supported by: ${modelsLabel}`;
		}
		this.tooltip = tooltipText;

		this.contextValue = component.isBuiltIn ? 'promptComponent' : 'customPromptComponent';

		// Checkbox state
		this.checkboxState = isEnabled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;

		// Command to edit the component
		this.command = {
			command: 'promptCustomizer.editComponent',
			title: 'Edit Component',
			arguments: [component.id],
		};
	}
}

/**
 * Tree item representing the Skills category header
 */
class SkillsCategoryTreeItem extends vscode.TreeItem {
	constructor(
		public readonly enabledCount: number,
		public readonly totalCount: number,
	) {
		super('Skills', vscode.TreeItemCollapsibleState.Expanded);
		this.iconPath = new vscode.ThemeIcon('book');
		this.description = `[${enabledCount}/${totalCount}]`;
		this.contextValue = 'skillsCategory';
	}
}

/**
 * Tree item representing a skill file
 */
class SkillTreeItem extends vscode.TreeItem {
	constructor(
		public readonly skill: SkillInfo,
	) {
		super(skill.name, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(skill.source === 'personal' ? 'home' : 'folder');
		this.description = skill.source === 'personal' ? '(Personal)' : '(Workspace)';
		this.tooltip = skill.description || `Skill: ${skill.name}`;
		this.contextValue = 'skill';

		// Checkbox state
		this.checkboxState = skill.enabled
			? vscode.TreeItemCheckboxState.Checked
			: vscode.TreeItemCheckboxState.Unchecked;

		// Command to view the skill
		this.command = {
			command: 'promptCustomizer.viewSkill',
			title: 'View Skill',
			arguments: [skill],
		};
	}
}

/**
 * Tree item representing the Agents category header
 */
class AgentsCategoryTreeItem extends vscode.TreeItem {
	constructor(
		public readonly enabledCount: number,
		public readonly totalCount: number,
		public readonly readOnlyCount: number = 0,
	) {
		super('Agents', vscode.TreeItemCollapsibleState.Expanded);
		this.iconPath = new vscode.ThemeIcon('person');
		// Show read-only count separately if any
		if (readOnlyCount > 0) {
			this.description = totalCount > 0 ? `[${enabledCount}/${totalCount}] + ${readOnlyCount} read-only` : `${readOnlyCount} read-only`;
		} else {
			this.description = `[${enabledCount}/${totalCount}]`;
		}
		this.contextValue = 'agentsCategory';
	}
}

/**
 * Tree item representing a custom agent
 */
class AgentTreeItem extends vscode.TreeItem {
	constructor(
		public readonly agent: AgentInfo,
	) {
		super(agent.name, vscode.TreeItemCollapsibleState.None);

		// Use different icon and behavior for read-only agents
		if (agent.isReadOnly) {
			this.iconPath = new vscode.ThemeIcon('lock');
			this.description = '(Read Only)';
			this.tooltip = `${agent.description || `Agent: ${agent.name}`}\n\n🔒 This agent is read-only and cannot be disabled.`;
			this.contextValue = 'agentReadOnly';
			// No checkbox for read-only agents
		} else {
			this.iconPath = new vscode.ThemeIcon(agent.source === 'organization' ? 'organization' : 'file');
			this.description = agent.source === 'organization' ? '(Organization)' : '(Local)';
			this.tooltip = agent.description || `Agent: ${agent.name}`;
			this.contextValue = 'agent';
			// Checkbox state
			this.checkboxState = agent.enabled
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked;
		}

		// Command to view the agent
		this.command = {
			command: 'promptCustomizer.viewAgent',
			title: 'View Agent',
			arguments: [agent],
		};
	}
}

/**
 * Get tool category icon
 */
function getToolCategoryIcon(category: ToolCategory): string {
	switch (category) {
		// New fine-grained categories
		case ToolCategory.FileRead:
			return 'search';
		case ToolCategory.FileEdit:
			return 'edit';
		case ToolCategory.Terminal:
			return 'terminal';
		case ToolCategory.TaskManagement:
			return 'checklist';
		case ToolCategory.AgentTools:
			return 'hubot';
		// Existing categories
		case ToolCategory.JupyterNotebook:
			return 'notebook';
		case ToolCategory.WebInteraction:
			return 'globe';
		case ToolCategory.VSCodeInteraction:
			return 'symbol-misc';
		case ToolCategory.Testing:
			return 'beaker';
		case ToolCategory.RedundantButSpecific:
			return 'info';
		case ToolCategory.ReadOnly:
			return 'lock';
		case ToolCategory.Core:
		default:
			return 'tools';
	}
}

/**
 * Tree item representing the Tools category header
 */
class ToolsCategoryTreeItem extends vscode.TreeItem {
	constructor(
		public readonly enabledCount: number,
		public readonly totalCount: number,
	) {
		super('Tools', vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon('tools');
		this.description = `[${enabledCount}/${totalCount}]`;
		this.contextValue = 'toolsCategory';
	}
}

/**
 * Tree item representing a tool subcategory (e.g., Core, Jupyter Notebook, etc.)
 */
class ToolSubcategoryTreeItem extends vscode.TreeItem {
	constructor(
		public readonly toolCategory: ToolCategory,
		public readonly enabledCount: number,
		public readonly totalCount: number,
	) {
		super(toolCategory, vscode.TreeItemCollapsibleState.Collapsed);
		this.iconPath = new vscode.ThemeIcon(getToolCategoryIcon(toolCategory));

		// ReadOnly category has special display
		if (toolCategory === ToolCategory.ReadOnly) {
			this.description = `[${totalCount}]`;
			this.tooltip = 'These tools are read-only and cannot be enabled/disabled by the user.';
			this.contextValue = 'toolSubcategoryReadOnly';
		} else {
			this.description = `[${enabledCount}/${totalCount}]`;
			this.contextValue = 'toolSubcategory';
		}
	}
}

/**
 * Tree item representing a tool
 */
class ToolTreeItem extends vscode.TreeItem {
	constructor(
		public readonly tool: ToolInfo,
	) {
		super(tool.name, vscode.TreeItemCollapsibleState.None);

		// Use different icon for read-only tools
		if (tool.isReadOnly) {
			this.iconPath = new vscode.ThemeIcon('lock');
			this.description = '(Read Only)';
			this.tooltip = `${tool.description || `Tool: ${tool.name}`}\n\n🔒 This tool is read-only and cannot be enabled/disabled.`;
			this.contextValue = 'toolReadOnly';
			// No checkbox for read-only tools
		} else {
			this.iconPath = new vscode.ThemeIcon('symbol-method');
			this.tooltip = tool.description || `Tool: ${tool.name}`;
			this.contextValue = 'tool';
			// Checkbox state - regular tools can be enabled/disabled
			this.checkboxState = tool.enabled
				? vscode.TreeItemCheckboxState.Checked
				: vscode.TreeItemCheckboxState.Unchecked;
		}
	}
}

type TreeItem = CategoryTreeItem | ComponentTreeItem | SkillsCategoryTreeItem | SkillTreeItem | AgentsCategoryTreeItem | AgentTreeItem | ToolsCategoryTreeItem | ToolSubcategoryTreeItem | ToolTreeItem;

/**
 * Tree data provider for the Prompt Customizer view
 */
class PromptCustomizerTreeDataProvider extends Disposable implements vscode.TreeDataProvider<TreeItem> {
	private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<TreeItem | undefined | void>());
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _skillsService: ISkillsManagementService | undefined;
	private _agentsService: IAgentsManagementService | undefined;
	private _toolsService: IToolsManagementService | undefined;
	private _cachedSkills: SkillInfo[] = [];
	private _cachedAgents: AgentInfo[] = [];
	private _cachedTools: ToolInfo[] = [];

	constructor(
		private readonly _service: IPromptCustomizationService,
	) {
		super();

		// Refresh when configuration changes
		this._register(this._service.onDidChangeConfiguration(() => {
			this._onDidChangeTreeData.fire();
		}));
	}

	setSkillsService(skillsService: ISkillsManagementService): void {
		this._skillsService = skillsService;
		this._register(skillsService.onDidChangeConfiguration(() => {
			this._refreshSkills();
		}));
		this._refreshSkills();
	}

	setAgentsService(agentsService: IAgentsManagementService): void {
		this._agentsService = agentsService;
		this._register(agentsService.onDidChangeConfiguration(() => {
			this._refreshAgents();
		}));
		this._refreshAgents();
	}

	setToolsService(toolsService: IToolsManagementService): void {
		this._toolsService = toolsService;
		this._register(toolsService.onDidChangeConfiguration(() => {
			this._refreshTools();
		}));
		this._refreshTools();
	}

	private async _refreshSkills(): Promise<void> {
		if (this._skillsService) {
			this._cachedSkills = await this._skillsService.getAllSkills();
		}
		this._onDidChangeTreeData.fire();
	}

	private async _refreshAgents(): Promise<void> {
		if (this._agentsService) {
			this._cachedAgents = await this._agentsService.getAllAgents();
		}
		this._onDidChangeTreeData.fire();
	}

	private async _refreshTools(): Promise<void> {
		if (this._toolsService) {
			this._cachedTools = await this._toolsService.getAllTools();
		}
		this._onDidChangeTreeData.fire();
	}

	refresh(): void {
		this._refreshSkills();
		this._refreshAgents();
		this._refreshTools();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TreeItem): TreeItem[] | Promise<TreeItem[]> {
		if (!element) {
			// Root level: return categories + skills category + agents category + tools category
			return this._getRootItems();
		} else if (element instanceof CategoryTreeItem) {
			// Category level: return components in this category
			return this._getComponentsForCategory(element.category);
		} else if (element instanceof SkillsCategoryTreeItem) {
			// Skills category: return skills
			return this._getSkillItems();
		} else if (element instanceof AgentsCategoryTreeItem) {
			// Agents category: return agents
			return this._getAgentItems();
		} else if (element instanceof ToolsCategoryTreeItem) {
			// Tools category: return tool subcategories
			return this._getToolSubcategories();
		} else if (element instanceof ToolSubcategoryTreeItem) {
			// Tool subcategory: return tools in this subcategory
			return this._getToolsForCategory(element.toolCategory);
		}
		return [];
	}

	private async _getRootItems(): Promise<TreeItem[]> {
		const items: TreeItem[] = [];

		// Add prompt component categories
		items.push(...this._getCategories());

		// Add skills category if service is available
		if (this._skillsService) {
			const skills = await this._skillsService.getAllSkills();
			if (skills.length > 0) {
				const enabledCount = skills.filter(s => s.enabled).length;
				items.push(new SkillsCategoryTreeItem(enabledCount, skills.length));
			}
		}

		// Add agents category if service is available
		if (this._agentsService) {
			const agents = await this._agentsService.getAllAgents();
			if (agents.length > 0) {
				// Only count non-read-only agents for enabled/total
				const controllableAgents = agents.filter(a => !a.isReadOnly);
				const readOnlyCount = agents.filter(a => a.isReadOnly).length;
				const enabledCount = controllableAgents.filter(a => a.enabled).length;
				items.push(new AgentsCategoryTreeItem(enabledCount, controllableAgents.length, readOnlyCount));
			}
		}

		// Add tools category if service is available
		if (this._toolsService) {
			const tools = await this._toolsService.getAllTools();
			if (tools.length > 0) {
				const enabledCount = tools.filter(t => t.enabled).length;
				items.push(new ToolsCategoryTreeItem(enabledCount, tools.length));
			}
		}

		return items;
	}

	private _getCategories(): CategoryTreeItem[] {
		const categories: CategoryTreeItem[] = [];

		// Get all categories in order
		const categoryOrder: PromptComponentCategory[] = [
			PromptComponentCategory.Identity,
			PromptComponentCategory.Safety,
			PromptComponentCategory.Context,
			PromptComponentCategory.Tools,
			PromptComponentCategory.Formatting,
			PromptComponentCategory.Workflow,
			PromptComponentCategory.Custom,
		];

		for (const category of categoryOrder) {
			const components = this._service.getComponentsByCategory(category);
			if (components.length > 0) {
				const enabledCount = components.filter(c => this._service.isEnabled(c.id)).length;
				categories.push(new CategoryTreeItem(category, enabledCount, components.length));
			}
		}

		return categories;
	}

	private _getComponentsForCategory(category: PromptComponentCategory): ComponentTreeItem[] {
		const components = this._service.getComponentsByCategory(category);
		return components.map(component => new ComponentTreeItem(
			component,
			this._service.isEnabled(component.id),
			this._service.hasCustomContent(component.id),
		));
	}

	private _getSkillItems(): SkillTreeItem[] {
		return this._cachedSkills.map(skill => new SkillTreeItem(skill));
	}

	private _getAgentItems(): AgentTreeItem[] {
		return this._cachedAgents.map(agent => new AgentTreeItem(agent));
	}

	private _getToolSubcategories(): ToolSubcategoryTreeItem[] {
		// Group tools by category
		const categoryMap = new Map<ToolCategory, ToolInfo[]>();
		for (const tool of this._cachedTools) {
			const category = tool.category;
			if (!categoryMap.has(category)) {
				categoryMap.set(category, []);
			}
			categoryMap.get(category)!.push(tool);
		}

		// Create subcategory items sorted by category name
		const subcategories: ToolSubcategoryTreeItem[] = [];
		const sortedCategories = Array.from(categoryMap.keys()).sort((a, b) => {
			// Put Core first
			if (a === ToolCategory.Core) { return -1; }
			if (b === ToolCategory.Core) { return 1; }
			return a.localeCompare(b);
		});

		for (const category of sortedCategories) {
			const tools = categoryMap.get(category)!;
			const enabledCount = tools.filter(t => t.enabled).length;
			subcategories.push(new ToolSubcategoryTreeItem(category, enabledCount, tools.length));
		}

		return subcategories;
	}

	private _getToolsForCategory(category: ToolCategory): ToolTreeItem[] {
		return this._cachedTools
			.filter(tool => tool.category === category)
			.map(tool => new ToolTreeItem(tool));
	}

	/**
	 * Handle checkbox state change for components
	 */
	async handleComponentCheckboxChange(item: ComponentTreeItem, state: vscode.TreeItemCheckboxState): Promise<void> {
		const enabled = state === vscode.TreeItemCheckboxState.Checked;
		await this._service.setEnabled(item.component.id, enabled);
	}

	/**
	 * Handle checkbox state change for skills
	 */
	async handleSkillCheckboxChange(item: SkillTreeItem, state: vscode.TreeItemCheckboxState): Promise<void> {
		if (this._skillsService) {
			const enabled = state === vscode.TreeItemCheckboxState.Checked;
			await this._skillsService.setSkillEnabled(item.skill.id, enabled);
		}
	}

	/**
	 * Handle checkbox state change for agents
	 */
	async handleAgentCheckboxChange(item: AgentTreeItem, state: vscode.TreeItemCheckboxState): Promise<void> {
		// Ignore read-only agents - they cannot be enabled/disabled
		if (item.agent.isReadOnly) {
			return;
		}
		if (this._agentsService) {
			const enabled = state === vscode.TreeItemCheckboxState.Checked;
			await this._agentsService.setAgentEnabled(item.agent.id, enabled);
		}
	}

	/**
	 * Handle checkbox state change for tools
	 */
	async handleToolCheckboxChange(item: ToolTreeItem, state: vscode.TreeItemCheckboxState): Promise<void> {
		// Ignore read-only tools - they cannot be enabled/disabled
		if (item.tool.isReadOnly) {
			return;
		}
		if (this._toolsService) {
			const enabled = state === vscode.TreeItemCheckboxState.Checked;
			await this._toolsService.setToolEnabled(item.tool.id, enabled);
		}
	}
}

/**
 * Contribution that registers the Prompt Customizer TreeView
 */
export class PromptCustomizerTreeViewContribution extends Disposable implements IExtensionContribution {
	readonly id = 'promptCustomizerTreeView';

	private readonly _treeDataProvider: PromptCustomizerTreeDataProvider;
	private readonly _treeView: vscode.TreeView<TreeItem>;
	private readonly _service: IPromptCustomizationService;
	private readonly _skillsService: ISkillsManagementService;
	private readonly _agentsService: IAgentsManagementService;
	private readonly _toolsService: IToolsManagementService;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPromptCustomizationService service: IPromptCustomizationService,
		@ISkillsManagementService skillsService: ISkillsManagementService,
		@IAgentsManagementService agentsService: IAgentsManagementService,
		@IToolsManagementService toolsService: IToolsManagementService,
	) {
		super();
		this._service = service;
		this._skillsService = skillsService;
		this._agentsService = agentsService;
		this._toolsService = toolsService;

		// Create the tree data provider
		this._treeDataProvider = this._register(new PromptCustomizerTreeDataProvider(service));

		// Connect the skills service to the tree data provider
		this._treeDataProvider.setSkillsService(skillsService);

		// Connect the agents service to the tree data provider
		this._treeDataProvider.setAgentsService(agentsService);

		// Connect the tools service to the tree data provider
		this._treeDataProvider.setToolsService(toolsService);

		// Create the tree view
		this._treeView = this._register(vscode.window.createTreeView('promptCustomizer', {
			treeDataProvider: this._treeDataProvider,
			showCollapseAll: true,
			manageCheckboxStateManually: true,
		}));

		// Handle checkbox state changes
		this._register(this._treeView.onDidChangeCheckboxState(async e => {
			for (const [item, state] of e.items) {
				if (item instanceof ComponentTreeItem) {
					await this._treeDataProvider.handleComponentCheckboxChange(item, state);
				} else if (item instanceof SkillTreeItem) {
					await this._treeDataProvider.handleSkillCheckboxChange(item, state);
				} else if (item instanceof AgentTreeItem) {
					await this._treeDataProvider.handleAgentCheckboxChange(item, state);
				} else if (item instanceof ToolTreeItem) {
					await this._treeDataProvider.handleToolCheckboxChange(item, state);
				}
			}
		}));

		// Update title with statistics
		this._register(service.onDidChangeConfiguration(() => {
			this._updateTitle(service);
		}));
		this._updateTitle(service);

		// Register commands
		this._registerCommands();
	}

	private _updateTitle(service: IPromptCustomizationService): void {
		const enabled = service.getEnabledCount();
		const total = service.getTotalCount();
		const tokens = service.estimateTokenCount();
		this._treeView.description = `${enabled}/${total} enabled | ~${tokens} tokens`;
	}

	private _registerCommands(): void {
		// Show the prompt customizer view
		this._register(vscode.commands.registerCommand('promptCustomizer.showView', async () => {
			await vscode.commands.executeCommand('setContext', 'github.copilot.chat.showPromptCustomizer', true);
			await vscode.commands.executeCommand('promptCustomizer.focus');
		}));

		// Toggle component enabled/disabled
		this._register(vscode.commands.registerCommand('promptCustomizer.toggleComponent', async (componentId: string) => {
			await this._service.toggleEnabled(componentId);
		}));

		// Enable component
		this._register(vscode.commands.registerCommand('promptCustomizer.enableComponent', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				await this._service.setEnabled(item.component.id, true);
			}
		}));

		// Disable component
		this._register(vscode.commands.registerCommand('promptCustomizer.disableComponent', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				await this._service.setEnabled(item.component.id, false);
			}
		}));

		// Edit component content - use untitled document for editing
		this._register(vscode.commands.registerCommand('promptCustomizer.editComponent', async (arg: ComponentTreeItem | string) => {
			const componentId = typeof arg === 'string' ? arg : arg?.component?.id;
			if (!componentId) {
				return;
			}

			// Delegate to the openEditor command which handles editable documents
			await vscode.commands.executeCommand('promptCustomizer.openEditor', componentId);
		}));

		// View component content (read-only)
		this._register(vscode.commands.registerCommand('promptCustomizer.viewComponent', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				const content = this._service.getEffectiveContent(item.component.id);
				const doc = await vscode.workspace.openTextDocument({
					content: content,
					language: 'markdown',
				});
				await vscode.window.showTextDocument(doc, { preview: true });
			}
		}));

		// Reset component to default
		this._register(vscode.commands.registerCommand('promptCustomizer.resetComponent', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				const confirm = await vscode.window.showWarningMessage(
					`Reset "${item.component.name}" to default?`,
					{ modal: true },
					'Reset'
				);
				if (confirm === 'Reset') {
					await this._service.resetComponent(item.component.id);
				}
			}
		}));

		// Delete custom component
		this._register(vscode.commands.registerCommand('promptCustomizer.deleteComponent', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem && !item.component.isBuiltIn) {
				const confirm = await vscode.window.showWarningMessage(
					`Delete custom component "${item.component.name}"?`,
					{ modal: true },
					'Delete'
				);
				if (confirm === 'Delete') {
					await this._service.removeCustomComponent(item.component.id);
				}
			}
		}));

		// Move component up
		this._register(vscode.commands.registerCommand('promptCustomizer.moveUp', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				await this._service.moveComponent(item.component.id, 'up');
			}
		}));

		// Move component down
		this._register(vscode.commands.registerCommand('promptCustomizer.moveDown', async (item: ComponentTreeItem) => {
			if (item instanceof ComponentTreeItem) {
				await this._service.moveComponent(item.component.id, 'down');
			}
		}));

		// Refresh view
		this._register(vscode.commands.registerCommand('promptCustomizer.refresh', () => {
			this._treeDataProvider.refresh();
		}));

		// Add custom component
		this._register(vscode.commands.registerCommand('promptCustomizer.addCustomComponent', async () => {
			const name = await vscode.window.showInputBox({
				prompt: 'Enter component name',
				placeHolder: 'My Custom Component',
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

			const description = await vscode.window.showInputBox({
				prompt: 'Enter component description (optional)',
				placeHolder: 'Description of what this component does',
			}) || '';

			const id = `custom.${name.toLowerCase().replace(/\s+/g, '-')}.${Date.now()}`;

			// Create the component with empty content
			await this._service.addCustomComponent({
				id,
				name,
				description,
				category: PromptComponentCategory.Custom,
				defaultContent: '',
				defaultEnabled: true,
				priority: 1000,
			});

			// Show success message and open editor
			vscode.window.showInformationMessage(`Custom component "${name}" created. Opening editor...`);

			// Open the editor for the new component
			await vscode.commands.executeCommand('promptCustomizer.openEditor', id);
		}));

		// Enable all components in category
		this._register(vscode.commands.registerCommand('promptCustomizer.enableCategory', async (item: CategoryTreeItem) => {
			if (item instanceof CategoryTreeItem) {
				const components = this._service.getComponentsByCategory(item.category);
				for (const component of components) {
					await this._service.setEnabled(component.id, true);
				}
			}
		}));

		// Disable all components in category
		this._register(vscode.commands.registerCommand('promptCustomizer.disableCategory', async (item: CategoryTreeItem) => {
			if (item instanceof CategoryTreeItem) {
				const components = this._service.getComponentsByCategory(item.category);
				for (const component of components) {
					await this._service.setEnabled(component.id, false);
				}
			}
		}));

		// Preview full prompt
		this._register(vscode.commands.registerCommand('promptCustomizer.previewPrompt', async () => {
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

		// Export configuration
		this._register(vscode.commands.registerCommand('promptCustomizer.exportConfig', async () => {
			const config = this._service.exportConfig();
			const content = JSON.stringify(config, null, 2);

			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file('prompt-customization.json'),
				filters: {
					'JSON': ['json'],
				},
				title: 'Export Prompt Customization',
			});

			if (saveUri) {
				await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
				vscode.window.showInformationMessage(`Configuration exported to ${saveUri.fsPath}`);
			}
		}));

		// Import configuration
		this._register(vscode.commands.registerCommand('promptCustomizer.importConfig', async () => {
			const files = await vscode.window.showOpenDialog({
				canSelectMany: false,
				filters: {
					'JSON': ['json'],
				},
				title: 'Import Prompt Customization',
			});

			if (files && files.length > 0) {
				try {
					const content = await vscode.workspace.fs.readFile(files[0]);
					const config = JSON.parse(Buffer.from(content).toString('utf8'));
					await this._service.importConfig(config);
					vscode.window.showInformationMessage('Configuration imported successfully');
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to import configuration: ${error}`);
				}
			}
		}));

		// Reset all to defaults
		this._register(vscode.commands.registerCommand('promptCustomizer.resetAll', async () => {
			const confirm = await vscode.window.showWarningMessage(
				'Reset all components to their default settings? This will remove all custom content and reset enabled states.',
				{ modal: true },
				'Reset All'
			);
			if (confirm === 'Reset All') {
				await this._service.resetAll();
			}
		}));

		// View skill file
		this._register(vscode.commands.registerCommand('promptCustomizer.viewSkill', async (skill: SkillInfo) => {
			if (skill && skill.uri) {
				try {
					const doc = await vscode.workspace.openTextDocument(skill.uri);
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to open skill file: ${error}`);
				}
			}
		}));

		// Enable all skills
		this._register(vscode.commands.registerCommand('promptCustomizer.enableAllSkills', async (item: SkillsCategoryTreeItem) => {
			if (item instanceof SkillsCategoryTreeItem) {
				await this._skillsService.setAllSkillsEnabled(true);
			}
		}));

		// Disable all skills
		this._register(vscode.commands.registerCommand('promptCustomizer.disableAllSkills', async (item: SkillsCategoryTreeItem) => {
			if (item instanceof SkillsCategoryTreeItem) {
				await this._skillsService.setAllSkillsEnabled(false);
			}
		}));

		// View agent file
		this._register(vscode.commands.registerCommand('promptCustomizer.viewAgent', async (agent: AgentInfo) => {
			if (agent && agent.uri) {
				try {
					const doc = await vscode.workspace.openTextDocument(agent.uri);
					await vscode.window.showTextDocument(doc, { preview: true });
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to open agent file: ${error}`);
				}
			}
		}));

		// Enable all agents
		this._register(vscode.commands.registerCommand('promptCustomizer.enableAllAgents', async (item: AgentsCategoryTreeItem) => {
			if (item instanceof AgentsCategoryTreeItem) {
				await this._agentsService.setAllAgentsEnabled(true);
			}
		}));

		// Disable all agents
		this._register(vscode.commands.registerCommand('promptCustomizer.disableAllAgents', async (item: AgentsCategoryTreeItem) => {
			if (item instanceof AgentsCategoryTreeItem) {
				await this._agentsService.setAllAgentsEnabled(false);
			}
		}));

		// Enable all tools
		this._register(vscode.commands.registerCommand('promptCustomizer.enableAllTools', async (item: ToolsCategoryTreeItem) => {
			if (item instanceof ToolsCategoryTreeItem) {
				await this._toolsService.setAllToolsEnabled(true);
			}
		}));

		// Disable all tools
		this._register(vscode.commands.registerCommand('promptCustomizer.disableAllTools', async (item: ToolsCategoryTreeItem) => {
			if (item instanceof ToolsCategoryTreeItem) {
				await this._toolsService.setAllToolsEnabled(false);
			}
		}));

		// Enable all tools in a subcategory
		this._register(vscode.commands.registerCommand('promptCustomizer.enableToolSubcategory', async (item: ToolSubcategoryTreeItem) => {
			if (item instanceof ToolSubcategoryTreeItem) {
				await this._toolsService.setToolsCategoryEnabled(item.toolCategory, true);
			}
		}));

		// Disable all tools in a subcategory
		this._register(vscode.commands.registerCommand('promptCustomizer.disableToolSubcategory', async (item: ToolSubcategoryTreeItem) => {
			if (item instanceof ToolSubcategoryTreeItem) {
				await this._toolsService.setToolsCategoryEnabled(item.toolCategory, false);
			}
		}));
	}

	/**
	 * Refresh the tree view
	 */
	refresh(): void {
		this._treeDataProvider.refresh();
	}
}
