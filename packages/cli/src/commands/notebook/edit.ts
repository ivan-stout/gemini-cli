/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule, Argv } from 'yargs';
import {
  writeToStderr,
  writeToStdout,
  sessionId,
  GeminiEventType,
} from '@google/gemini-cli-core';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  loadCliConfig,
  isDebugMode,
  type CliArgs,
} from '../../config/config.js';
import { loadSettings } from '../../config/settings.js';

export const editCommand: CommandModule = {
  command: 'edit <file>',
  describe: 'Edit a notebook using natural language instructions',
  builder: (yargs: Argv) =>
    yargs
      .positional('file', {
        describe: 'Path to the .ipynb file',
        type: 'string',
        demandOption: true,
      })
      .option('instruction', {
        alias: 'i',
        type: 'string',
        description: 'Instruction for the edit',
        demandOption: true,
      })
      .option('out', {
        alias: 'o',
        type: 'string',
        description: 'Output filename (defaults to overwriting input)',
      }),
  handler: async (argv) => {
    const file = argv['file'] as string;
    const instruction = argv['instruction'] as string;
    const out = (argv['out'] as string) || file;

    const settings = loadSettings();
    const config = await loadCliConfig(settings.merged, sessionId, {
      ...argv,
      debug: isDebugMode(argv as unknown as CliArgs),
    } as unknown as CliArgs);

    await config.initialize();

    // Auth check
    const authType = settings.merged.security?.auth?.selectedType;
    if (authType) {
      await config.refreshAuth(authType);
    }

    const filePath = resolve(process.cwd(), file);
    let notebookContent: string;
    try {
      notebookContent = await readFile(filePath, 'utf8');
      // Validate it's JSON
      JSON.parse(notebookContent);
    } catch (e) {
      writeToStderr(
        `Error reading notebook file: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(1);
    }

    writeToStdout('Sending notebook to Gemini for editing...\n');

    const prompt =
      `You are an expert Jupyter Notebook assistant.
The user wants to edit the following notebook based on an instruction.
You must return the COMPLETE, VALID JSON of the updated notebook.
Do not output any markdown formatting (like ` +
      '```' +
      `json), just the raw JSON string.

User Instruction: ${instruction}

Notebook Content:
${notebookContent}`;

    const geminiClient = config.getGeminiClient();
    const abortController = new AbortController();

    try {
      const responseStream = geminiClient.sendMessageStream(
        [{ text: prompt }],
        abortController.signal,
        'notebook-edit-' + Date.now(),
      );

      let fullResponse = '';
      for await (const event of responseStream) {
        if (event.type === GeminiEventType.Content) {
          fullResponse += event.value;
        } else if (event.type === GeminiEventType.Error) {
          throw event.value.error;
        }
      }

      // Clean up markdown code blocks if present (despite instruction)
      let cleanedResponse = fullResponse.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse
          .replace(/^```json\s*/, '')
          .replace(/\s*```$/, '');
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse
          .replace(/^```\s*/, '')
          .replace(/\s*```$/, '');
      }

      // Validate JSON
      try {
        JSON.parse(cleanedResponse);
      } catch {
        throw new Error('Received invalid JSON from Gemini. Please try again.');
      }

      const outputPath = resolve(process.cwd(), out);
      await writeFile(outputPath, cleanedResponse, 'utf8');
      writeToStdout(`Successfully edited notebook. Saved to ${outputPath}\n`);
    } catch (error) {
      writeToStderr(
        `Error editing notebook: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  },
};
