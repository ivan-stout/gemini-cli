/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { ToolInvocation, ToolLocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolErrorType } from './tool-error.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import type { Config } from '../config/config.js';
import { GeminiEventType } from '../core/turn.js';
import { NOTEBOOK_EDIT_TOOL_NAME } from './tool-names.js';

/**
 * Parameters for the Notebook Edit tool
 */
export interface NotebookEditToolParams {
  /**
   * The path to the .ipynb file to modify
   */
  file_path: string;

  /**
   * The instruction for the edit
   */
  instruction: string;
}

class NotebookEditToolInvocation
  extends BaseToolInvocation<NotebookEditToolParams, ToolResult>
  implements ToolInvocation<NotebookEditToolParams, ToolResult>
{
  private readonly resolvedPath: string;

  constructor(
    private readonly config: Config,
    params: NotebookEditToolParams,
    messageBus?: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
    this.resolvedPath = path.resolve(
      this.config.getTargetDir(),
      this.params.file_path,
    );
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.resolvedPath }];
  }

  getDescription(): string {
    const relativePath = makeRelative(
      this.params.file_path,
      this.config.getTargetDir(),
    );
    return `Edit notebook ${shortenPath(relativePath)}: ${this.params.instruction}`;
  }

  /**
   * Executes the notebook edit operation.
   */
  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const fileSystem = this.config.getFileSystemService();
      let notebookContent: string;

      try {
        notebookContent = await fileSystem.readTextFile(this.resolvedPath);
        JSON.parse(notebookContent); // Validate it's JSON
      } catch (e) {
        const errorMsg = `Error reading notebook file: ${e instanceof Error ? e.message : String(e)}`;
        return {
          llmContent: errorMsg,
          returnDisplay: errorMsg,
          error: {
            message: errorMsg,
            type: ToolErrorType.FILE_NOT_FOUND,
          },
        };
      }

      const prompt =
        `You are an expert Jupyter Notebook assistant.
The user wants to edit the following notebook based on an instruction.
You must return the COMPLETE, VALID JSON of the updated notebook.
Do not output any markdown formatting (like ` +
        '```' +
        `json), just the raw JSON string.

User Instruction: ${this.params.instruction}

Notebook Content:
${notebookContent}`;

      const geminiClient = this.config.getGeminiClient();
      const responseStream = geminiClient.sendMessageStream(
        [{ text: prompt }],
        signal,
        'notebook-edit-tool-' + Date.now(),
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

      await fileSystem.writeTextFile(this.resolvedPath, cleanedResponse);

      const successMsg = `Successfully edited notebook: ${this.params.file_path}`;
      return {
        llmContent: successMsg,
        returnDisplay: successMsg,
      };
    } catch (error) {
      const errorMsg = `Error editing notebook: ${error instanceof Error ? error.message : String(error)}`;
      return {
        llmContent: errorMsg,
        returnDisplay: errorMsg,
        error: {
          message: errorMsg,
          type: ToolErrorType.FILE_WRITE_FAILURE,
        },
      };
    }
  }
}

/**
 * Implementation of the Notebook Edit tool
 */
export class NotebookEditTool extends BaseDeclarativeTool<
  NotebookEditToolParams,
  ToolResult
> {
  static readonly Name = NOTEBOOK_EDIT_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      NotebookEditTool.Name,
      'Notebook Edit',
      `Edits a Jupyter Notebook (.ipynb) file using natural language instructions. This tool is specialized for notebook structures and ensures the resulting file is valid JSON.`,
      Kind.Edit,
      {
        properties: {
          file_path: {
            description: 'The path to the .ipynb file to modify.',
            type: 'string',
          },
          instruction: {
            description:
              'The natural language instruction for the change (e.g., "Add a cell at the end that imports pandas").',
            type: 'string',
          },
        },
        required: ['file_path', 'instruction'],
        type: 'object',
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: NotebookEditToolParams,
  ): string | null {
    if (!params.file_path) {
      return "The 'file_path' parameter must be non-empty.";
    }
    if (!params.instruction) {
      return "The 'instruction' parameter must be non-empty.";
    }

    const resolvedPath = path.resolve(
      this.config.getTargetDir(),
      params.file_path,
    );
    const workspaceContext = this.config.getWorkspaceContext();
    if (!workspaceContext.isPathWithinWorkspace(resolvedPath)) {
      const directories = workspaceContext.getDirectories();
      return `File path must be within one of the workspace directories: ${directories.join(', ')}`;
    }

    return null;
  }

  protected createInvocation(
    params: NotebookEditToolParams,
    messageBus?: MessageBus,
    toolName?: string,
    displayName?: string,
  ): ToolInvocation<NotebookEditToolParams, ToolResult> {
    return new NotebookEditToolInvocation(
      this.config,
      params,
      messageBus ?? this.messageBus,
      toolName ?? this.name,
      displayName ?? this.displayName,
    );
  }
}
