/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';

/**
 * Information about a custom agent
 */
export interface AgentInfo {
	/** Unique identifier for the agent (based on name) */
	readonly id: string;
	/** Display name of the agent */
	readonly name: string;
	/** Description of the agent */
	readonly description: string;
	/** Source: organization, local (bundled), or workspace */
	readonly source: 'organization' | 'local' | 'workspace';
	/** URI to the agent file */
	readonly uri: URI;
	/** Whether the agent is enabled */
	enabled: boolean;
	/** Whether the agent is read-only (cannot be disabled) */
	readonly isReadOnly: boolean;
}

/**
 * Structure of a chatAgent contribution in package.json
 */
interface ChatAgentContribution {
	name: string;
	path: string;
	description?: string;
}

export const IAgentsManagementService = createServiceIdentifier<IAgentsManagementService>('IAgentsManagementService');

export interface IAgentsManagementService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when agents configuration changes
	 */
	readonly onDidChangeConfiguration: Event<void>;

	/**
	 * Register agents from a provider (called by the provider when agents are fetched)
	 * @param agents The agents to register
	 */
	registerAgents(agents: Array<{ name: string; description: string; uri: URI }>): void;

	/**
	 * Get all available agents
	 */
	getAllAgents(): Promise<AgentInfo[]>;

	/**
	 * Check if an agent is enabled
	 * @param agentId The agent ID
	 */
	isAgentEnabled(agentId: string): boolean;

	/**
	 * Set the enabled state of an agent
	 * @param agentId The agent ID
	 * @param enabled Whether to enable or disable
	 */
	setAgentEnabled(agentId: string, enabled: boolean): Promise<void>;

	/**
	 * Enable or disable all agents at once
	 * @param enabled Whether to enable or disable all agents
	 */
	setAllAgentsEnabled(enabled: boolean): Promise<void>;

	/**
	 * Get the set of disabled agent IDs (for filtering in provider)
	 */
	getDisabledAgentIds(): ReadonlySet<string>;
}

// Storage key for disabled agents
const DISABLED_AGENTS_STORAGE_KEY = 'promptCustomizer.disabledAgents';

export class AgentsManagementService extends Disposable implements IAgentsManagementService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event;

	private _disabledAgentIds: Set<string> = new Set();
	private _registeredAgents: AgentInfo[] = [];
	private _localAgents: AgentInfo[] = [];

	constructor(
		@ILogService private readonly logService: ILogService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
	) {
		super();

		// Load initial disabled agents from storage
		this._loadDisabledAgents();

		// Load local agents from package.json chatAgents contribution
		this._loadLocalAgents();
	}

	private _loadDisabledAgents(): void {
		const disabledAgents = this.extensionContext.globalState.get<string[]>(DISABLED_AGENTS_STORAGE_KEY);
		this._disabledAgentIds = new Set(Array.isArray(disabledAgents) ? disabledAgents : []);
	}

	private _loadLocalAgents(): void {
		try {
			// Get the extension's package.json
			const extension = vscode.extensions.getExtension('github.copilot-chat');
			if (!extension) {
				this.logService.trace('[AgentsManagementService] Extension not found');
				return;
			}

			const packageJson = extension.packageJSON;
			const chatAgents = packageJson?.contributes?.chatAgents as ChatAgentContribution[] | undefined;

			if (!chatAgents || !Array.isArray(chatAgents)) {
				this.logService.trace('[AgentsManagementService] No chatAgents contributions found');
				return;
			}

			this._localAgents = chatAgents.map(agent => {
				const id = this._getAgentId(agent.name);
				const uri = vscode.Uri.joinPath(extension.extensionUri, agent.path);
				return {
					id,
					name: agent.name,
					description: agent.description || '',
					source: 'local' as const,
					uri: URI.from(uri),
					enabled: true, // Always enabled for read-only agents
					isReadOnly: true, // Local agents are read-only
				};
			});

			this.logService.trace(`[AgentsManagementService] Loaded ${this._localAgents.length} local agents from package.json`);
		} catch (error) {
			this.logService.error(`[AgentsManagementService] Error loading local agents: ${error}`);
		}
	}

	private async _saveDisabledAgents(): Promise<void> {
		const disabledArray = Array.from(this._disabledAgentIds);
		await this.extensionContext.globalState.update(DISABLED_AGENTS_STORAGE_KEY, disabledArray);
	}

	private _getAgentId(name: string): string {
		return `agent:${name.toLowerCase().replace(/\s+/g, '-')}`;
	}

	public registerAgents(agents: Array<{ name: string; description: string; uri: URI }>): void {
		this._registeredAgents = agents.map(agent => {
			const id = this._getAgentId(agent.name);
			return {
				id,
				name: agent.name,
				description: agent.description || '',
				source: 'organization' as const,
				uri: agent.uri,
				enabled: !this._disabledAgentIds.has(id),
				isReadOnly: false, // Organization agents can be disabled
			};
		});
		this._onDidChangeConfiguration.fire();
	}

	public async getAllAgents(): Promise<AgentInfo[]> {
		// Combine local agents and registered (organization) agents
		const allAgents = [...this._localAgents, ...this._registeredAgents];

		// Update enabled state based on current disabled IDs
		for (const agent of allAgents) {
			agent.enabled = !this._disabledAgentIds.has(agent.id);
		}

		// Deduplicate by ID (prefer organization agents over local)
		const agentMap = new Map<string, AgentInfo>();
		for (const agent of allAgents) {
			if (!agentMap.has(agent.id)) {
				agentMap.set(agent.id, agent);
			}
		}

		return Array.from(agentMap.values());
	}

	public isAgentEnabled(agentId: string): boolean {
		return !this._disabledAgentIds.has(agentId);
	}

	public async setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
		// Check if agent is read-only
		const cachedAgent = this._registeredAgents.find(a => a.id === agentId)
			|| this._localAgents.find(a => a.id === agentId);
		if (cachedAgent?.isReadOnly) {
			// Read-only agents cannot be disabled
			return;
		}

		if (enabled) {
			this._disabledAgentIds.delete(agentId);
		} else {
			this._disabledAgentIds.add(agentId);
		}

		// Update cached agents if available
		if (cachedAgent) {
			cachedAgent.enabled = enabled;
		}

		await this._saveDisabledAgents();
		this._onDidChangeConfiguration.fire();
	}

	public async setAllAgentsEnabled(enabled: boolean): Promise<void> {
		// Include both local and registered agents
		const allAgents = [...this._localAgents, ...this._registeredAgents];

		for (const agent of allAgents) {
			// Skip read-only agents
			if (agent.isReadOnly) {
				continue;
			}
			if (agent.enabled !== enabled) {
				if (enabled) {
					this._disabledAgentIds.delete(agent.id);
				} else {
					this._disabledAgentIds.add(agent.id);
				}
				agent.enabled = enabled;
			}
		}

		await this._saveDisabledAgents();
		this._onDidChangeConfiguration.fire();
	}

	public getDisabledAgentIds(): ReadonlySet<string> {
		return this._disabledAgentIds;
	}
}
