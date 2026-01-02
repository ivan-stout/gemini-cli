/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule, Argv } from 'yargs';
import { exportCommand } from './export.js';
import { initializeOutputListenersAndFlush } from '../../gemini.js';

export const notebookCommand: CommandModule = {
  command: 'notebook',
  describe: 'Manage Jupyter Notebook exports',
  builder: (yargs: Argv) =>
    yargs
      .middleware(() => initializeOutputListenersAndFlush())
      .command(exportCommand)
      .demandCommand(1, 'You need at least one command before continuing.')
      .version(false),
  handler: () => {
    // yargs will automatically show help if no subcommand is provided
  },
};
