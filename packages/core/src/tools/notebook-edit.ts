/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  ToolConfirmationOutcome,
} from './tools.js';
import { isNodeError, getErrorMessage } from '../utils/errors.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../config/config.js';
import { FileOperation } from '../telemetry/metrics.js';
import { logFileOperation } from '../telemetry/loggers.js';
import { FileOperationEvent } from '../telemetry/types.js';
import type { Node } from 'jsonc-parser';
import { applyEdits, findNodeAtLocation, parseTree } from 'jsonc-parser';
import type {
  ModifiableDeclarativeTool,
  ModifyContext,
} from './modifiable-tool.js';
import * as Diff from 'diff';
import { DEFAULT_DIFF_OPTIONS } from './diffOptions.js';
import { makeRelative, shortenPath } from '../utils/paths.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  ToolCallConfirmationDetails,
  ToolEditConfirmationDetails,
  ToolInvocation,
  ToolLocation,
  ToolResult,
} from './tools.js';

interface NotebookCell {
  id?: string;
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

/**
 * Parameters for the NotebookEdit tool
 */
export interface NotebookEditToolParams {
  /** Absolute path to the notebook file */
  absolute_path: string;
  /** Operation to perform on the notebook */
  operation:
    | 'add_cell'
    | 'edit_cell'
    | 'delete_cell'
    | 'move_cell'
    | 'clear_outputs';
  /** Index of the cell to operate on (0-based) */
  cell_index?: number;
  /** ID of the cell to operate on (alternative to cell_index) */
  cell_id?: string;
  /** Content for the new or edited cell */
  cell_content?: string;
  /** Type of cell to create */
  cell_type?: 'code' | 'markdown' | 'raw';
  /** Position to insert new cell (0-based, defaults to end) */
  position?: number;
  /** Source index for move operation */
  source_index?: number;
  /** Destination index for move operation */
  destination_index?: number;
  /**
   * Whether the edit was modified manually by the user.
   */
  modified_by_user?: boolean;
}

class NotebookEditToolInvocation extends BaseToolInvocation<
  NotebookEditToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: NotebookEditToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const filename = path.basename(this.params.absolute_path);
    return `${this.params.operation} on notebook ${filename}`;
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.params.absolute_path }];
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.config.getApprovalMode() === ApprovalMode.AUTO_EDIT) {
      return false;
    }

    let currentContent: string;
    try {
      currentContent = await fs.readFile(this.params.absolute_path, 'utf-8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        currentContent = '';
      } else {
        throw error;
      }
    }

    const root = parseTree(currentContent);
    if (!root && currentContent !== '') {
      console.log('Error: Invalid JSON in notebook file');
      return false;
    }

    const result = this.performOperation(currentContent, root!, this.params);
    if (result.error) {
      console.log(`Error: ${result.returnDisplay}`);
      return false;
    }

    const newContent = result.llmContent as string;
    const fileName = path.basename(this.params.absolute_path);
    const fileDiff = Diff.createPatch(
      fileName,
      currentContent,
      newContent,
      'Current',
      'Proposed',
      DEFAULT_DIFF_OPTIONS,
    );

    const confirmationDetails: ToolEditConfirmationDetails = {
      type: 'edit',
      title: `Confirm Edit: ${shortenPath(makeRelative(this.params.absolute_path, this.config.getTargetDir()))}`,
      fileName,
      filePath: this.params.absolute_path,
      fileDiff,
      originalContent: currentContent,
      newContent,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlways) {
          this.config.setApprovalMode(ApprovalMode.AUTO_EDIT);
        }
      },
    };
    return confirmationDetails;
  }

  async execute(): Promise<ToolResult> {
    try {
      // Validate file path
      if (!path.isAbsolute(this.params.absolute_path)) {
        const errorMsg = `Error: absolute_path must be an absolute path, got: ${this.params.absolute_path}`;
        return {
          llmContent: errorMsg,
          returnDisplay: errorMsg,
          error: {
            message: 'Invalid file path: must be absolute',
            type: ToolErrorType.INVALID_TOOL_PARAMS,
          },
        };
      }

      // Read and parse notebook
      let notebookContent: string;
      try {
        notebookContent = await fs.readFile(this.params.absolute_path, 'utf-8');
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          const errorMsg = `Error: Notebook file does not exist: ${this.params.absolute_path}`;
          return {
            llmContent: errorMsg,
            returnDisplay: errorMsg,
            error: {
              message: 'File not found',
              type: ToolErrorType.FILE_NOT_FOUND,
            },
          };
        }
        // Re-throw other read errors to be caught by the outer catch block
        throw error;
      }

      const root = parseTree(notebookContent);
      if (!root) {
        const errorMsg = `Error: Invalid JSON in notebook file`;
        return {
          llmContent: errorMsg,
          returnDisplay: errorMsg,
          error: {
            message: 'Invalid notebook JSON',
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }

      // Perform the requested operation
      const result = this.performOperation(notebookContent, root, this.params);
      if (result.error) {
        return result;
      }

      const updatedNotebookContent = result.llmContent as string;

      await fs.writeFile(
        this.params.absolute_path,
        updatedNotebookContent,
        'utf-8',
      );

      // Log the operation
      const lines = updatedNotebookContent.split('\n').length;
      logFileOperation(
        this.config,
        new FileOperationEvent(
          NotebookEditTool.Name,
          FileOperation.UPDATE,
          lines,
          'application/json',
          '.ipynb',
          'jupyter',
        ),
      );

      const fileName = path.basename(this.params.absolute_path);
      const successMsg = `Successfully performed ${this.params.operation} on notebook ${fileName}.`;
      return {
        llmContent: successMsg,
        returnDisplay: successMsg,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const errorMsg = `Error performing notebook operation: ${errorMessage}`;
      return {
        llmContent: errorMsg,
        returnDisplay: errorMsg,
        error: {
          message: errorMessage,
          type:
            isNodeError(error) && error.code === 'EACCES'
              ? ToolErrorType.PERMISSION_DENIED
              : ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }

  performOperation(
    originalContent: string,
    root: Node,
    params: NotebookEditToolParams,
  ): ToolResult {
    const {
      operation,
      cell_index,
      cell_id,
      cell_content,
      cell_type: _cell_type,
      position,
      source_index: _source_index,
      destination_index: _destination_index,
    } = params;

    switch (operation) {
      case 'add_cell':
        return this.addCell(
          originalContent,
          root,
          cell_content,
          _cell_type as 'code' | 'markdown' | 'raw',
          position,
        );

      case 'edit_cell':
        return this.editCell(
          originalContent,
          root,
          cell_index,
          cell_id,
          cell_content,
        );

      case 'delete_cell':
        return this.deleteCell(originalContent, root, cell_index, cell_id);

      case 'move_cell':
        return this.moveCell(
          originalContent,
          root,
          params.source_index,
          params.destination_index,
        );

      case 'clear_outputs':
        return this.clearOutputs(originalContent, root);

      default:
        return {
          llmContent: `Unsupported notebook operation: ${operation}`,
          returnDisplay: `Unsupported notebook operation: ${operation}`,
          error: {
            message: `Unsupported notebook operation: ${operation}`,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
    }
  }

  private addCell(
    originalContent: string,
    root: Node,
    content?: string,
    cellType: 'code' | 'markdown' | 'raw' = 'code',
    position?: number,
  ): ToolResult {
    const cellsNode = findNodeAtLocation(root, ['cells']);
    if (!cellsNode || cellsNode.type !== 'array' || !cellsNode.children) {
      return {
        llmContent: 'Invalid notebook structure: "cells" array not found',
        returnDisplay: 'Invalid notebook structure: "cells" array not found',
        error: {
          message: 'Invalid notebook structure: "cells" array not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const newCell: NotebookCell = {
      id: this.generateCellId(),
      cell_type: cellType,
      source: content ? content.split('\n').map((line) => line + '\n') : [''],
      metadata: {},
    };

    if (cellType === 'code') {
      newCell.outputs = [];
      newCell.execution_count = null;
    }

    const insertPosition =
      position !== undefined ? position : cellsNode.children.length;

    if (insertPosition < 0 || insertPosition > cellsNode.children.length) {
      return {
        llmContent: `Invalid position ${insertPosition}. Must be between 0 and ${cellsNode.children.length}`,
        returnDisplay: `Invalid position ${insertPosition}. Must be between 0 and ${cellsNode.children.length}`,
        error: {
          message: `Invalid position ${insertPosition}. Must be between 0 and ${cellsNode.children.length}`,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const newCellText = JSON.stringify(newCell, null, 2);
    const isLastCell = insertPosition === cellsNode.children.length;

    let insertOffset: number;
    let textToInsert: string;

    if (cellsNode.children.length === 0) {
      insertOffset = cellsNode.offset + 1;
      textToInsert = newCellText;
    } else if (isLastCell) {
      const lastCell = cellsNode.children[cellsNode.children.length - 1];
      insertOffset = lastCell.offset + lastCell.length;
      textToInsert = ',\n' + newCellText;
    } else {
      const nextCell = cellsNode.children[insertPosition];
      insertOffset = nextCell.offset;
      textToInsert = newCellText + ',\n';
    }

    const edits = [
      {
        offset: insertOffset,
        length: 0,
        content: textToInsert,
      },
    ];

    const updatedContent = applyEdits(originalContent, edits);

    return {
      llmContent: updatedContent,
      returnDisplay: 'Cell added successfully',
    };
  }

  private editCell(
    originalContent: string,
    root: Node,
    cellIndex?: number,
    cellId?: string,
    content?: string,
  ): ToolResult {
    const cellsNode = findNodeAtLocation(root, ['cells']);
    if (!cellsNode || cellsNode.type !== 'array' || !cellsNode.children) {
      return {
        llmContent: 'Invalid notebook structure: "cells" array not found',
        returnDisplay: 'Invalid notebook structure: "cells" array not found',
        error: {
          message: 'Invalid notebook structure: "cells" array not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    let targetCellNode: Node | undefined;

    if (cellId) {
      targetCellNode = cellsNode.children.find((cell) => {
        const idNode = findNodeAtLocation(cell, ['id']);
        return idNode?.value === cellId;
      });
    } else if (cellIndex !== undefined) {
      if (cellIndex < 0 || cellIndex >= cellsNode.children.length) {
        return {
          llmContent: `Invalid cell index ${cellIndex}. Must be between 0 and ${
            cellsNode.children.length - 1
          }`,
          returnDisplay: `Invalid cell index ${cellIndex}. Must be between 0 and ${
            cellsNode.children.length - 1
          }`,
          error: {
            message: `Invalid cell index ${cellIndex}. Must be between 0 and ${
              cellsNode.children.length - 1
            }`,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }
      targetCellNode = cellsNode.children[cellIndex];
    } else {
      return {
        llmContent:
          'Either cell_index or cell_id must be provided for edit operation',
        returnDisplay:
          'Either cell_index or cell_id must be provided for edit operation',
        error: {
          message:
            'Either cell_index or cell_id must be provided for edit operation',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (!targetCellNode) {
      return {
        llmContent: 'Cell not found',
        returnDisplay: 'Cell not found',
        error: {
          message: 'Cell not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const sourceNode = findNodeAtLocation(targetCellNode, ['source']);
    if (!sourceNode || sourceNode.type !== 'array' || !sourceNode.children) {
      return {
        llmContent: 'Invalid cell structure: "source" not found',
        returnDisplay: 'Invalid cell structure: "source" not found',
        error: {
          message: 'Invalid cell structure: "source" not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const oldSource = sourceNode.children.map((node) =>
      JSON.parse(
        originalContent.substring(node.offset, node.offset + node.length),
      ),
    );
    const newSource = content ? content.split('\n') : [''];

    const edits = [];
    const minLength = Math.min(oldSource.length, newSource.length);

    for (let i = 0; i < minLength; i++) {
      if (
        oldSource[i] !==
        newSource[i] + (i < newSource.length - 1 ? '\n' : '')
      ) {
        const sourceLineNode = sourceNode.children[i];
        edits.push({
          offset: sourceLineNode.offset,
          length: sourceLineNode.length,
          content: JSON.stringify(
            newSource[i] + (i < newSource.length - 1 ? '\n' : ''),
          ),
        });
      }
    }

    if (newSource.length > oldSource.length) {
      const lastLineNode = sourceNode.children[sourceNode.children.length - 1];
      const insertOffset = lastLineNode.offset + lastLineNode.length;
      const linesToAdd = newSource
        .slice(oldSource.length)
        .map((line, i, arr) =>
          JSON.stringify(line + (i < arr.length - 1 ? '\n' : '')),
        )
        .join(',\n');
      edits.push({
        offset: insertOffset,
        length: 0,
        content: ',\n' + linesToAdd,
      });
    } else if (oldSource.length > newSource.length) {
      const startNode = sourceNode.children[newSource.length];
      const endNode = sourceNode.children[oldSource.length - 1];
      const deleteOffset = startNode.offset;
      const deleteLength = endNode.offset + endNode.length - deleteOffset;
      edits.push({
        offset: deleteOffset,
        length: deleteLength,
        content: '',
      });
    }

    const updatedContent = applyEdits(originalContent, edits);

    return {
      llmContent: updatedContent,
      returnDisplay: 'Cell edited successfully',
    };
  }

  private deleteCell(
    originalContent: string,
    root: Node,
    cellIndex?: number,
    cellId?: string,
  ): ToolResult {
    const cellsNode = findNodeAtLocation(root, ['cells']);
    if (!cellsNode || cellsNode.type !== 'array' || !cellsNode.children) {
      return {
        llmContent: 'Invalid notebook structure: "cells" array not found',
        returnDisplay: 'Invalid notebook structure: "cells" array not found',
        error: {
          message: 'Invalid notebook structure: "cells" array not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    if (cellsNode.children.length === 1) {
      return {
        llmContent: 'Cannot delete the last cell in the notebook',
        returnDisplay: 'Cannot delete the last cell in the notebook',
        error: {
          message: 'Cannot delete the last cell in the notebook',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    let targetIndex = -1;

    if (cellId) {
      targetIndex = cellsNode.children.findIndex((cell) => {
        const idNode = findNodeAtLocation(cell, ['id']);
        return idNode?.value === cellId;
      });
    } else if (cellIndex !== undefined) {
      if (cellIndex < 0 || cellIndex >= cellsNode.children.length) {
        return {
          llmContent: `Invalid cell index ${cellIndex}. Must be between 0 and ${
            cellsNode.children.length - 1
          }`,
          returnDisplay: `Invalid cell index ${cellIndex}. Must be between 0 and ${
            cellsNode.children.length - 1
          }`,
          error: {
            message: `Invalid cell index ${cellIndex}. Must be between 0 and ${
              cellsNode.children.length - 1
            }`,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }
      targetIndex = cellIndex;
    } else {
      return {
        llmContent:
          'Either cell_index or cell_id must be provided for delete operation',
        returnDisplay:
          'Either cell_index or cell_id must be provided for delete operation',
        error: {
          message:
            'Either cell_index or cell_id must be provided for delete operation',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (targetIndex === -1) {
      return {
        llmContent: 'Cell not found',
        returnDisplay: 'Cell not found',
        error: {
          message: 'Cell not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const targetCellNode = cellsNode.children[targetIndex];
    const isLastCell = targetIndex === cellsNode.children.length - 1;

    let deleteOffset = targetCellNode.offset;
    let deleteLength = targetCellNode.length;

    if (!isLastCell) {
      const nextCell = cellsNode.children[targetIndex + 1];
      deleteLength = nextCell.offset - targetCellNode.offset;
    } else {
      // If it's the last cell, we need to remove the preceding comma
      const prevCell = cellsNode.children[targetIndex - 1];
      deleteOffset = prevCell.offset + prevCell.length;
      deleteLength =
        targetCellNode.offset + targetCellNode.length - deleteOffset;
    }

    const edits = [
      {
        offset: deleteOffset,
        length: deleteLength,
        content: '',
      },
    ];

    const updatedContent = applyEdits(originalContent, edits);

    return {
      llmContent: updatedContent,
      returnDisplay: 'Cell deleted successfully',
    };
  }

  private moveCell(
    originalContent: string,
    root: Node,
    sourceIndex?: number,
    destinationIndex?: number,
  ): ToolResult {
    const cellsNode = findNodeAtLocation(root, ['cells']);
    if (!cellsNode || cellsNode.type !== 'array' || !cellsNode.children) {
      return {
        llmContent: 'Invalid notebook structure: "cells" array not found',
        returnDisplay: 'Invalid notebook structure: "cells" array not found',
        error: {
          message: 'Invalid notebook structure: "cells" array not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    if (sourceIndex === undefined || destinationIndex === undefined) {
      return {
        llmContent:
          'source_index and destination_index must be provided for move operation',
        returnDisplay:
          'source_index and destination_index must be provided for move operation',
        error: {
          message:
            'source_index and destination_index must be provided for move operation',
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    if (
      sourceIndex < 0 ||
      sourceIndex >= cellsNode.children.length ||
      destinationIndex < 0 ||
      destinationIndex > cellsNode.children.length
    ) {
      return {
        llmContent: `Invalid index. Must be between 0 and ${cellsNode.children.length}`,
        returnDisplay: `Invalid index. Must be between 0 and ${cellsNode.children.length}`,
        error: {
          message: `Invalid index. Must be between 0 and ${cellsNode.children.length}`,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const sourceCellNode = cellsNode.children[sourceIndex];
    const sourceCellText = originalContent.substring(
      sourceCellNode.offset,
      sourceCellNode.offset + sourceCellNode.length,
    );

    // First, delete the source cell
    const isLastCell = sourceIndex === cellsNode.children.length - 1;
    let deleteOffset = sourceCellNode.offset;
    let deleteLength = sourceCellNode.length;

    if (!isLastCell) {
      const nextCell = cellsNode.children[sourceIndex + 1];
      deleteLength = nextCell.offset - sourceCellNode.offset;
    } else {
      const prevCell = cellsNode.children[sourceIndex - 1];
      deleteOffset = prevCell.offset + prevCell.length;
      deleteLength =
        sourceCellNode.offset + sourceCellNode.length - deleteOffset;
    }

    const deleteEdit = {
      offset: deleteOffset,
      length: deleteLength,
      content: '',
    };

    const contentAfterDelete = applyEdits(originalContent, [deleteEdit]);
    const rootAfterDelete = parseTree(contentAfterDelete);
    if (!rootAfterDelete) {
      return {
        llmContent: 'Error parsing notebook after delete',
        returnDisplay: 'Error parsing notebook after delete',
        error: {
          message: 'Error parsing notebook after delete',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const cellsNodeAfterDelete = findNodeAtLocation(rootAfterDelete, ['cells']);
    if (
      !cellsNodeAfterDelete ||
      cellsNodeAfterDelete.type !== 'array' ||
      !cellsNodeAfterDelete.children
    ) {
      return {
        llmContent: 'Invalid notebook structure after delete',
        returnDisplay: 'Invalid notebook structure after delete',
        error: {
          message: 'Invalid notebook structure after delete',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    // Now, add the cell to the destination
    const isLastCellInsert =
      destinationIndex === cellsNodeAfterDelete.children.length;
    let insertOffset: number;
    let textToInsert: string;

    if (cellsNodeAfterDelete.children.length === 0) {
      insertOffset = cellsNodeAfterDelete.offset + 1;
      textToInsert = sourceCellText;
    } else if (isLastCellInsert) {
      const lastCell =
        cellsNodeAfterDelete.children[cellsNodeAfterDelete.children.length - 1];
      insertOffset = lastCell.offset + lastCell.length;
      textToInsert = ',\n' + sourceCellText;
    } else {
      const nextCell = cellsNodeAfterDelete.children[destinationIndex];
      insertOffset = nextCell.offset;
      textToInsert = sourceCellText + ',\n';
    }

    const insertEdit = {
      offset: insertOffset,
      length: 0,
      content: textToInsert,
    };

    const updatedContent = applyEdits(contentAfterDelete, [insertEdit]);

    return {
      llmContent: updatedContent,
      returnDisplay: 'Cell moved successfully',
    };
  }

  private clearOutputs(originalContent: string, root: Node): ToolResult {
    const cellsNode = findNodeAtLocation(root, ['cells']);
    if (!cellsNode || cellsNode.type !== 'array' || !cellsNode.children) {
      return {
        llmContent: 'Invalid notebook structure: "cells" array not found',
        returnDisplay: 'Invalid notebook structure: "cells" array not found',
        error: {
          message: 'Invalid notebook structure: "cells" array not found',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    const edits = [];
    for (const cellNode of cellsNode.children) {
      const cellTypeNode = findNodeAtLocation(cellNode, ['cell_type']);
      if (cellTypeNode?.value === 'code') {
        const outputsNode = findNodeAtLocation(cellNode, ['outputs']);
        if (outputsNode) {
          edits.push({
            offset: outputsNode.offset,
            length: outputsNode.length,
            content: '[]',
          });
        }

        const executionCountNode = findNodeAtLocation(cellNode, [
          'execution_count',
        ]);
        if (executionCountNode) {
          edits.push({
            offset: executionCountNode.offset,
            length: executionCountNode.length,
            content: 'null',
          });
        }
      }
    }

    const updatedContent = applyEdits(originalContent, edits);

    return {
      llmContent: updatedContent,
      returnDisplay: 'Outputs cleared successfully',
    };
  }

  private generateCellId(): string {
    // Generate a cryptographically secure unique ID (similar to Jupyter's format)
    return randomBytes(4).toString('hex');
  }
}

export class NotebookEditTool
  extends BaseDeclarativeTool<NotebookEditToolParams, ToolResult>
  implements ModifiableDeclarativeTool<NotebookEditToolParams>
{
  static readonly Name = 'notebook_edit';

  constructor(private config: Config) {
    super(
      NotebookEditTool.Name,
      'Notebook Edit',
      'Edit Jupyter notebook files by adding, editing, deleting, moving cells, or clearing outputs. Use this tool for all Jupyter notebook (.ipynb) file modifications to ensure proper JSON structure and data integrity.',
      Kind.Edit,
      {
        type: 'object' as const,
        properties: {
          absolute_path: {
            type: 'string' as const,
            description: 'Absolute path to the notebook file',
          },
          operation: {
            type: 'string' as const,
            enum: [
              'add_cell',
              'edit_cell',
              'delete_cell',
              'move_cell',
              'clear_outputs',
            ],
            description: 'Operation to perform on the notebook',
          },
          cell_index: {
            type: 'number' as const,
            description: 'Index of the cell to operate on (0-based)',
          },
          cell_id: {
            type: 'string' as const,
            description:
              'ID of the cell to operate on (alternative to cell_index)',
          },
          cell_content: {
            type: 'string' as const,
            description: 'Content for the new or edited cell',
          },
          cell_type: {
            type: 'string' as const,
            enum: ['code', 'markdown', 'raw'],
            description: 'Type of cell to create (default: code)',
          },
          position: {
            type: 'number' as const,
            description:
              'Position to insert new cell (0-based, defaults to end)',
          },
          source_index: {
            type: 'number' as const,
            description: 'Source index for move operation',
          },
          destination_index: {
            type: 'number' as const,
            description: 'Destination index for move operation',
          },
        },
        required: ['absolute_path', 'operation'],
      },
    );
  }

  protected createInvocation(
    params: NotebookEditToolParams,
  ): ToolInvocation<NotebookEditToolParams, ToolResult> {
    return new NotebookEditToolInvocation(this.config, params);
  }

  getModifyContext(_: AbortSignal): ModifyContext<NotebookEditToolParams> {
    return {
      getFilePath: (params: NotebookEditToolParams) => params.absolute_path,
      getCurrentContent: async (
        params: NotebookEditToolParams,
      ): Promise<string> => {
        try {
          return await fs.readFile(params.absolute_path, 'utf-8');
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      getProposedContent: async (
        params: NotebookEditToolParams,
      ): Promise<string> => {
        try {
          const currentContent = await fs.readFile(
            params.absolute_path,
            'utf-8',
          );
          const root = parseTree(currentContent);
          if (!root) {
            return '';
          }
          const invocation = new NotebookEditToolInvocation(
            this.config,
            params,
          );
          const result = (
            invocation as NotebookEditToolInvocation
          ).performOperation(currentContent, root, params);
          return result.llmContent as string;
        } catch (err) {
          if (!isNodeError(err) || err.code !== 'ENOENT') throw err;
          return '';
        }
      },
      createUpdatedParams: (
        _oldContent: string,
        modifiedProposedContent: string,
        originalParams: NotebookEditToolParams,
      ): NotebookEditToolParams => ({
        ...originalParams,
        cell_content: modifiedProposedContent,
        modified_by_user: true,
      }),
    };
  }
}
