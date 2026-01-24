/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { INativeEnvService } from '../../../platform/env/common/envService';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { FileType } from '../../../vscodeTypes';

/**
 * Information about a skill file
 */
export interface SkillInfo {
	/** Unique identifier for the skill (based on file path) */
	readonly id: string;
	/** Display name of the skill */
	readonly name: string;
	/** Optional description extracted from the skill file */
	readonly description?: string;
	/** Source: personal (~/.copilot/skills) or workspace (.github/skills) */
	readonly source: 'personal' | 'workspace';
	/** URI to the skill file */
	readonly uri: URI;
	/** Whether the skill is enabled */
	enabled: boolean;
}

export const ISkillsManagementService = createServiceIdentifier<ISkillsManagementService>('ISkillsManagementService');

export interface ISkillsManagementService {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when skills configuration changes
	 */
	readonly onDidChangeConfiguration: Event<void>;

	/**
	 * Get all available skills from personal and workspace folders
	 */
	getAllSkills(): Promise<SkillInfo[]>;

	/**
	 * Check if a skill is enabled
	 * @param skillId The skill ID
	 */
	isSkillEnabled(skillId: string): boolean;

	/**
	 * Set the enabled state of a skill
	 * @param skillId The skill ID
	 * @param enabled Whether to enable or disable
	 */
	setSkillEnabled(skillId: string, enabled: boolean): Promise<void>;

	/**
	 * Enable or disable all skills at once
	 * @param enabled Whether to enable or disable all skills
	 */
	setAllSkillsEnabled(enabled: boolean): Promise<void>;

	/**
	 * Get enabled skill URIs (for prompt rendering)
	 */
	getEnabledSkillUris(): Promise<URI[]>;
}

// Skill folder locations
const WORKSPACE_SKILL_FOLDERS = ['.github/skills', '.claude/skills'];
const PERSONAL_SKILL_FOLDERS = ['.copilot/skills', '.claude/skills'];
// Backup folder for disabled skills (only for personal .claude/skills)
const PERSONAL_SKILL_BACKUP_FOLDER = '.claude/skills_back';
const USE_AGENT_SKILLS_SETTING = 'chat.useAgentSkills';
const INSTRUCTION_FILE_EXTENSION = '.instructions.md';

// Storage key for disabled skills
const DISABLED_SKILLS_STORAGE_KEY = 'promptCustomizer.disabledSkills';

declare const TextDecoder: {
	decode(input: Uint8Array): string;
	new(): TextDecoder;
};

export class SkillsManagementService extends Disposable implements ISkillsManagementService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event;

	private _disabledSkillIds: Set<string> = new Set();
	private _cachedSkills: SkillInfo[] | undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeEnvService private readonly envService: INativeEnvService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@ILogService private readonly logService: ILogService,
		@IVSCodeExtensionContext private readonly extensionContext: IVSCodeExtensionContext,
	) {
		super();

		// Load initial disabled skills from storage
		this._loadDisabledSkills();

		// Listen for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(USE_AGENT_SKILLS_SETTING)) {
				this._cachedSkills = undefined;
				this._onDidChangeConfiguration.fire();
			}
		}));

		// Listen for workspace changes
		this._register(this.workspaceService.onDidChangeWorkspaceFolders(() => {
			this._cachedSkills = undefined;
			this._onDidChangeConfiguration.fire();
		}));
	}

	private _loadDisabledSkills(): void {
		const disabledSkills = this.extensionContext.globalState.get<string[]>(DISABLED_SKILLS_STORAGE_KEY);
		this._disabledSkillIds = new Set(Array.isArray(disabledSkills) ? disabledSkills : []);
	}

	private async _saveDisabledSkills(): Promise<void> {
		const disabledArray = Array.from(this._disabledSkillIds);
		await this.extensionContext.globalState.update(DISABLED_SKILLS_STORAGE_KEY, disabledArray);
	}

	public async getAllSkills(): Promise<SkillInfo[]> {
		if (this._cachedSkills) {
			return this._cachedSkills;
		}

		// Check if skills are enabled globally
		if (!this.configurationService.getNonExtensionConfig<boolean>(USE_AGENT_SKILLS_SETTING)) {
			this._cachedSkills = [];
			return [];
		}

		const skills: SkillInfo[] = [];

		// Collect personal skills (enabled)
		for (const folder of PERSONAL_SKILL_FOLDERS) {
			const folderUri = extUriBiasedIgnorePathCase.joinPath(this.envService.userHome, folder);
			await this._collectSkillsFromFolder(folderUri, 'personal', skills, true);
		}

		// Collect disabled skills from backup folder
		const backupFolderUri = extUriBiasedIgnorePathCase.joinPath(this.envService.userHome, PERSONAL_SKILL_BACKUP_FOLDER);
		await this._collectSkillsFromFolder(backupFolderUri, 'personal', skills, false);

		// Collect workspace skills
		for (const workspaceFolder of this.workspaceService.getWorkspaceFolders()) {
			for (const folder of WORKSPACE_SKILL_FOLDERS) {
				const folderUri = extUriBiasedIgnorePathCase.joinPath(workspaceFolder, folder);
				await this._collectSkillsFromFolder(folderUri, 'workspace', skills, true);
			}
		}

		// Remove duplicates by ID
		const uniqueSkills = new Map<string, SkillInfo>();
		for (const skill of skills) {
			if (!uniqueSkills.has(skill.id)) {
				uniqueSkills.set(skill.id, skill);
			}
		}

		this._cachedSkills = Array.from(uniqueSkills.values());
		return this._cachedSkills;
	}

	private async _collectSkillsFromFolder(folderUri: URI, source: 'personal' | 'workspace', skills: SkillInfo[], isEnabledFolder: boolean): Promise<void> {
		try {
			const stat = await this.fileSystemService.stat(folderUri);
			if (stat.type !== FileType.Directory) {
				return;
			}

			// Read skill subdirectories
			const entries = await this.fileSystemService.readDirectory(folderUri);
			for (const [name, type] of entries) {
				if (type === FileType.Directory) {
					// Look for SKILL.md or *.instructions.md in the skill folder
					const skillDir = extUriBiasedIgnorePathCase.joinPath(folderUri, name);
					const skill = await this._parseSkillFolder(skillDir, name, source, isEnabledFolder);
					if (skill) {
						skills.push(skill);
					}
				}
			}
		} catch (e) {
			// Folder doesn't exist, ignore
			this.logService.debug(`Skills folder not found: ${folderUri.toString()}`);
		}
	}

	private async _parseSkillFolder(folderUri: URI, name: string, source: 'personal' | 'workspace', isEnabledFolder: boolean): Promise<SkillInfo | undefined> {
		try {
			// Look for SKILL.md first (primary skill file)
			const skillMdUri = extUriBiasedIgnorePathCase.joinPath(folderUri, 'SKILL.md');
			let mainFileUri: URI | undefined;
			let description: string | undefined;

			try {
				const stat = await this.fileSystemService.stat(skillMdUri);
				if (stat.type === FileType.File) {
					mainFileUri = skillMdUri;
					// Try to extract description from SKILL.md
					description = await this._extractDescription(skillMdUri);
				}
			} catch {
				// SKILL.md doesn't exist, look for .instructions.md files
			}

			if (!mainFileUri) {
				// Look for *.instructions.md files
				const entries = await this.fileSystemService.readDirectory(folderUri);
				for (const [fileName, type] of entries) {
					if (type === FileType.File && fileName.endsWith(INSTRUCTION_FILE_EXTENSION)) {
						mainFileUri = extUriBiasedIgnorePathCase.joinPath(folderUri, fileName);
						break;
					}
				}
			}

			if (!mainFileUri) {
				return undefined;
			}

			const id = `${source}:${name}`;
			// For personal skills, use folder location to determine enabled state
			// For workspace skills, use _disabledSkillIds as before
			const enabled = source === 'personal' ? isEnabledFolder : !this._disabledSkillIds.has(id);
			return {
				id,
				name,
				description,
				source,
				uri: mainFileUri,
				enabled,
			};
		} catch (e) {
			this.logService.debug(`Failed to parse skill folder: ${folderUri.toString()}`);
			return undefined;
		}
	}

	private async _extractDescription(fileUri: URI): Promise<string | undefined> {
		try {
			const content = await this.fileSystemService.readFile(fileUri);
			const text = new TextDecoder().decode(content);

			// Look for a description in YAML frontmatter or first paragraph
			const lines = text.split('\n');
			for (let i = 0; i < Math.min(lines.length, 10); i++) {
				const line = lines[i].trim();
				if (line.startsWith('description:')) {
					return line.substring('description:'.length).trim();
				}
				// Skip frontmatter delimiters and empty lines
				if (line === '---' || line === '' || line.startsWith('#')) {
					continue;
				}
				// Return first non-empty, non-header line as description
				if (line && !line.startsWith('<')) {
					return line.length > 100 ? line.substring(0, 100) + '...' : line;
				}
			}
		} catch {
			// Ignore errors
		}
		return undefined;
	}

	public isSkillEnabled(skillId: string): boolean {
		return !this._disabledSkillIds.has(skillId);
	}

	public async setSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
		// Try to move skill folder for personal .claude/skills
		const skill = this._cachedSkills?.find(s => s.id === skillId);
		if (skill && skill.source === 'personal') {
			const moved = await this._moveSkillFolder(skill.name, enabled);
			if (moved) {
				this.logService.info(`Skill folder moved: ${skill.name}, enabled=${enabled}`);
			}
		}

		if (enabled) {
			this._disabledSkillIds.delete(skillId);
		} else {
			this._disabledSkillIds.add(skillId);
		}

		// Update cached skills if available
		if (this._cachedSkills) {
			const cachedSkill = this._cachedSkills.find(s => s.id === skillId);
			if (cachedSkill) {
				cachedSkill.enabled = enabled;
			}
		}

		await this._saveDisabledSkills();
		this._onDidChangeConfiguration.fire();
	}

	/**
	 * Move skill folder between skills/ and skills_back/ directories
	 * @param skillName The name of the skill folder
	 * @param enabled If true, move from skills_back to skills; if false, move from skills to skills_back
	 * @returns true if move succeeded, false if failed or not applicable
	 */
	private async _moveSkillFolder(skillName: string, enabled: boolean): Promise<boolean> {
		const skillsDir = extUriBiasedIgnorePathCase.joinPath(this.envService.userHome, '.claude/skills');
		const backupDir = extUriBiasedIgnorePathCase.joinPath(this.envService.userHome, PERSONAL_SKILL_BACKUP_FOLDER);

		const sourceFolder = enabled
			? extUriBiasedIgnorePathCase.joinPath(backupDir, skillName)
			: extUriBiasedIgnorePathCase.joinPath(skillsDir, skillName);

		const targetFolder = enabled
			? extUriBiasedIgnorePathCase.joinPath(skillsDir, skillName)
			: extUriBiasedIgnorePathCase.joinPath(backupDir, skillName);

		try {
			// Check if source folder exists
			const sourceStat = await this.fileSystemService.stat(sourceFolder);
			if (sourceStat.type !== FileType.Directory) {
				return false;
			}

			// Ensure backup directory exists
			if (!enabled) {
				try {
					await this.fileSystemService.stat(backupDir);
				} catch {
					// Create backup directory
					await this.fileSystemService.createDirectory(backupDir);
				}
			}

			// Move the folder (rename is essentially a move operation)
			await this.fileSystemService.rename(sourceFolder, targetFolder, { overwrite: false });
			return true;
		} catch (e) {
			this.logService.debug(`Failed to move skill folder ${skillName}: ${e}`);
			return false;
		}
	}

	public async getEnabledSkillUris(): Promise<URI[]> {
		const skills = await this.getAllSkills();
		return skills.filter(s => s.enabled).map(s => s.uri);
	}

	public async setAllSkillsEnabled(enabled: boolean): Promise<void> {
		const skills = await this.getAllSkills();
		for (const skill of skills) {
			if (skill.enabled !== enabled) {
				await this.setSkillEnabled(skill.id, enabled);
			}
		}
	}
}
