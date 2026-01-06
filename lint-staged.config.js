/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const ESLint = require('eslint').ESLint;

const removeIgnoredFiles = async (files) => {
	const eslint = new ESLint();
	const isIgnored = await Promise.all(
		files.map((file) => {
			return eslint.isPathIgnored(file);
		})
	);
	const filteredFiles = files.filter((_, i) => !isIgnored[i]);
	return filteredFiles;
};

module.exports = {
	'!({.esbuild.ts,test/simulation/fixtures/**,test/scenarios/**,.vscode/extensions/**,**/vscode.proposed.*})*{.ts,.js,.tsx}': async (files) => {
		const filesToLint = await removeIgnoredFiles(files);
		if (filesToLint.length === 0) {
			return [];
		}
		return [
			`npm run tsfmt -- ${filesToLint.join(' ')}`,
			`npx tsx node_modules/eslint/bin/eslint.js --max-warnings=0 --no-warn-ignored ${filesToLint.join(' ')}`
		];
	},
};
