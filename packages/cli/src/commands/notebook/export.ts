/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule, Argv } from 'yargs';
import { writeToStderr, writeToStdout , sessionId as currentSessionId } from '@google/gemini-cli-core';
import { SessionSelector, RESUME_LATEST } from '../../utils/sessionUtils.js';
import { convertHistoryToNotebook } from './converter.js';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  loadCliConfig,
  isDebugMode,
  type CliArgs,
} from '../../config/config.js';
import { loadSettings } from '../../config/settings.js';

export const exportCommand: CommandModule = {
  command: 'export',
  describe: 'Export chat history to a Jupyter Notebook (.ipynb)',
  builder: (yargs: Argv) =>
    yargs
      .option('out', {
        alias: 'o',
        type: 'string',
        description: 'Output filename',
        default: 'session.ipynb',
      })
      .option('id', {
        type: 'string',
        description:
          'Session ID or index to export. Defaults to the latest session.',
        default: RESUME_LATEST,
      }),
  handler: async (argv) => {
    const out = argv['out'] as string;
    const id = argv['id'] as string;

    const settings = loadSettings();
    const config = await loadCliConfig(settings.merged, currentSessionId, {
      ...argv,
      debug: isDebugMode(argv as unknown as CliArgs),
    } as unknown as CliArgs);

    try {
      const sessionSelector = new SessionSelector(config);
      const { sessionData, displayInfo } =
        await sessionSelector.resolveSession(id);

      writeToStdout(`Exporting ${displayInfo}...
`);

      const notebook = convertHistoryToNotebook(sessionData.messages);
      const outputPath = resolve(process.cwd(), out);

      await writeFile(outputPath, JSON.stringify(notebook, null, 2), 'utf8');

      writeToStdout(`Successfully exported to ${outputPath}
`);
    } catch (error) {
      writeToStderr(
        `Failed to export notebook: ${error instanceof Error ? error.message : String(error)}
`,
      );
      process.exit(1);
    }
  },
};
