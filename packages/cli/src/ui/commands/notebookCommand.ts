/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
} from './types.js';
import { convertHistoryToNotebook } from '../../commands/notebook/converter.js';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { GeminiEventType } from '@google/gemini-cli-core';

const exportSubCommand: SlashCommand = {
  name: 'export',
  description: 'Export the current chat history to a Jupyter Notebook',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    const config = context.services.config;
    if (!config) return;

    const recordingService = config
      .getGeminiClient()
      .getChat()
      .getChatRecordingService();
    const conversation = recordingService.getConversation();

    if (!conversation) {
      context.ui.addItem({
        type: 'user', // System message
        content: [{ text: 'No active conversation found to export.' }],
      });
      return;
    }

    const notebook = convertHistoryToNotebook(conversation.messages);

    let filename = args.trim();
    if (!filename) {
      filename = 'session.ipynb';
    }
    if (!filename.endsWith('.ipynb')) {
      filename += '.ipynb';
    }

    const outputPath = path.resolve(process.cwd(), filename);

    try {
      await writeFile(outputPath, JSON.stringify(notebook, null, 2), 'utf8');
      context.ui.addItem({
        type: 'user',
        content: [{ text: `Successfully exported notebook to ${outputPath}` }],
      });
    } catch (e) {
      context.ui.addItem({
        type: 'user',
        content: [
          {
            text: `Failed to export notebook: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
      });
    }
  },
};

const editSubCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit a local notebook file using Gemini',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string) => {
    const config = context.services.config;
    if (!config) return;

    const trimmedArgs = args.trim();
    if (!trimmedArgs) {
      context.ui.addItem({
        type: 'user',
        content: [{ text: 'Usage: /notebook edit <filename> <instruction>' }],
      });
      return;
    }

    const firstSpaceIndex = trimmedArgs.indexOf(' ');
    let file = trimmedArgs;
    let instruction = '';

    if (firstSpaceIndex !== -1) {
      file = trimmedArgs.substring(0, firstSpaceIndex);
      instruction = trimmedArgs.substring(firstSpaceIndex + 1).trim();
    }

    if (!instruction) {
      context.ui.addItem({
        type: 'user',
        content: [{ text: 'Please provide an instruction for editing.' }],
      });
      return;
    }

    const filePath = path.resolve(process.cwd(), file);
    let notebookContent: string;
    try {
      notebookContent = await readFile(filePath, 'utf8');
      JSON.parse(notebookContent); // Validate JSON
    } catch (e) {
      context.ui.addItem({
        type: 'user',
        content: [
          {
            text: `Error reading notebook file: ${e instanceof Error ? e.message : String(e)}`,
          },
        ],
      });
      return;
    }

    context.ui.setPendingItem({
      type: 'user',
      content: [{ text: 'Editing notebook...' }],
    });

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

      try {
        JSON.parse(cleanedResponse);
      } catch {
        throw new Error('Received invalid JSON from Gemini.');
      }

      await writeFile(filePath, cleanedResponse, 'utf8');
      context.ui.setPendingItem(null);
      context.ui.addItem({
        type: 'user',
        content: [{ text: `Successfully edited notebook: ${filePath}` }],
      });
    } catch (error) {
      context.ui.setPendingItem(null);
      context.ui.addItem({
        type: 'user',
        content: [
          {
            text: `Error editing notebook: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      });
    }
  },
};

export const notebookCommand: SlashCommand = {
  name: 'notebook',
  description: 'Manage Jupyter Notebooks (export/edit)',
  kind: CommandKind.BUILT_IN,
  subCommands: [exportSubCommand, editSubCommand],
};
