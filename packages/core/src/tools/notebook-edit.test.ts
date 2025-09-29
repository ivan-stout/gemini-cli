/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vol, fs as memfs } from 'memfs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotebookEditTool } from './notebook-edit.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';

// Mock fs
vi.mock('node:fs', () => memfs);
vi.mock('node:fs/promises', () => memfs.promises);

// Mock crypto
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn(() => ({ toString: () => 'mockedid' })),
  randomUUID: vi.fn(() => 'mocked-uuid'),
}));

// Mock telemetry
vi.mock('../telemetry/loggers.js', () => ({
  logFileOperation: vi.fn(),
}));

vi.mock('../telemetry/types.js', () => ({
  FileOperationEvent: vi.fn(),
}));

vi.mock('../telemetry/metrics.js', () => ({
  FileOperation: { UPDATE: 'update' },
}));

describe('NotebookEditTool', () => {
  let tool: NotebookEditTool;
  const testNotebookPath = '/test/path/notebook.ipynb';

  const baseNotebook = {
    cells: [
      {
        id: 'cell1',
        cell_type: 'code',
        source: ["print('Hello, World!')\n"],
        metadata: {},
        execution_count: null,
        outputs: [],
      },
      {
        id: 'cell2',
        cell_type: 'markdown',
        source: ['# Title\n'],
        metadata: {},
      },
    ],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
    },
    nbformat: 4,
    nbformat_minor: 4,
  };

  beforeEach(() => {
    vol.reset();
    vol.fromJSON({
      [testNotebookPath]: JSON.stringify(baseNotebook, null, 2),
    });
    const mockConfig = {
      getTargetDir: () => '/test',
    };
    tool = new NotebookEditTool(mockConfig as unknown as Config);
    vi.clearAllMocks();
  });

  describe('Parameter validation', () => {
    it('should return error for relative file path', async () => {
      const invocation = tool.build({
        absolute_path: 'relative/path.ipynb',
        operation: 'add_cell',
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result).toMatchObject({
        error: {
          type: ToolErrorType.INVALID_TOOL_PARAMS,
          message: expect.stringContaining('must be absolute'),
        },
      });
    });

    it('should return error for non-existent file', async () => {
      const invocation = tool.build({
        absolute_path: '/test/path/non-existent-notebook.ipynb',
        operation: 'add_cell',
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result).toMatchObject({
        error: {
          type: ToolErrorType.FILE_NOT_FOUND,
          message: expect.stringContaining('File not found'),
        },
      });
    });

    it('should return error for invalid JSON', async () => {
      vol.writeFileSync('/test/path/invalid.ipynb', 'invalid json');
      const invocation = tool.build({
        absolute_path: '/test/path/invalid.ipynb',
        operation: 'add_cell',
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result).toMatchObject({
        error: {
          type: ToolErrorType.EXECUTION_FAILED,
          message: expect.stringContaining('Invalid notebook JSON'),
        },
      });
    });
  });

  describe('add_cell operation', () => {
    it('should add a code cell at the end by default', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'add_cell',
        cell_content: "print('New cell')",
        cell_type: 'code',
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully performed add_cell');

      const writtenContent = vol.readFileSync(testNotebookPath, 'utf-8');
      expect(writtenContent).toContain("print('New cell')");
    });

    it('should add a markdown cell at specified position', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'add_cell',
        cell_content: '## New Header',
        cell_type: 'markdown',
        position: 1,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();

      const writtenContent = vol.readFileSync(testNotebookPath, 'utf-8');
      expect(writtenContent).toContain('## New Header');
    });
  });

  describe('edit_cell operation', () => {
    it('should edit cell by index', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'edit_cell',
        cell_index: 0,
        cell_content: "print('Edited content')",
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully performed edit_cell');

      const writtenContent = vol.readFileSync(testNotebookPath, 'utf-8');
      expect(writtenContent).toContain("print('Edited content')");
    });

    it('should edit cell by ID', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'edit_cell',
        cell_id: 'cell1',
        cell_content: "print('Edited by ID')",
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();

      const writtenContent = vol.readFileSync(testNotebookPath, 'utf-8');
      expect(writtenContent).toContain("print('Edited by ID')");
    });
  });

  describe('delete_cell operation', () => {
    it('should delete cell by index', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'delete_cell',
        cell_index: 1,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully performed delete_cell');

      const writtenContent = vol.readFileSync(testNotebookPath, 'utf-8');
      expect(writtenContent).not.toContain('# Title');
    });

    it('should prevent deleting the last cell', async () => {
      const singleCellNotebook = {
        ...baseNotebook,
        cells: [baseNotebook.cells[0]],
      };
      vol.writeFileSync(
        testNotebookPath,
        JSON.stringify(singleCellNotebook, null, 2),
      );

      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'delete_cell',
        cell_index: 0,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toMatchObject({
        type: ToolErrorType.EXECUTION_FAILED,
        message: 'Cannot delete the last cell in the notebook',
      });
    });
  });

  describe('move_cell operation', () => {
    it('should move a cell from source to destination', async () => {
      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'move_cell',
        source_index: 0,
        destination_index: 1,
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Successfully performed move_cell');

      const writtenContent = vol
        .readFileSync(testNotebookPath, 'utf-8')
        .toString('utf-8');
      const notebook = JSON.parse(writtenContent);
      expect(notebook.cells[1].id).toBe('cell1');
    });
  });

  describe('clear_outputs operation', () => {
    it('should clear the outputs of all code cells', async () => {
      const notebookWithOutputs = {
        ...baseNotebook,
        cells: [
          {
            ...baseNotebook.cells[0],
            outputs: [{ data: { 'text/plain': 'Hello' } }],
            execution_count: 1,
          },
          baseNotebook.cells[1],
        ],
      };
      vol.writeFileSync(
        testNotebookPath,
        JSON.stringify(notebookWithOutputs, null, 2),
      );

      const invocation = tool.build({
        absolute_path: testNotebookPath,
        operation: 'clear_outputs',
      });

      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(
        'Successfully performed clear_outputs',
      );

      const writtenContent = vol
        .readFileSync(testNotebookPath, 'utf-8')
        .toString('utf-8');
      const notebook = JSON.parse(writtenContent);
      expect(notebook.cells[0].outputs).toEqual([]);
      expect(notebook.cells[0].execution_count).toBeNull();
    });
  });
});
