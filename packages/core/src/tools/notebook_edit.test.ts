/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { NotebookEditTool } from './notebook_edit.js';
import { GeminiEventType } from '../core/turn.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { StandardFileSystemService } from '../services/fileSystemService.js';
import type { Config } from '../config/config.js';

describe('NotebookEditTool', () => {
  let tool: NotebookEditTool;
  let tempDir: string;
  let rootDir: string;
  let mockConfig: Config;
  let mockSendMessageStream: Mock;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-edit-test-'));
    rootDir = path.join(tempDir, 'root');
    fs.mkdirSync(rootDir);

    mockSendMessageStream = vi.fn();
    const mockGeminiClient = {
      sendMessageStream: mockSendMessageStream,
    };

    mockConfig = {
      getTargetDir: () => rootDir,
      getWorkspaceContext: () => new WorkspaceContext(rootDir),
      getFileSystemService: () => new StandardFileSystemService(),
      getGeminiClient: () => mockGeminiClient,
    } as unknown as Config;

    tool = new NotebookEditTool(mockConfig);
  });

  it('should have correct name and description', () => {
    expect(tool.name).toBe('notebook_edit');
    expect(tool.displayName).toBe('Notebook Edit');
  });

  it('should validate missing file_path', () => {
    const error = tool.validateToolParams({
      file_path: '',
      instruction: 'Add cell',
    });
    expect(error).toContain('file_path');
  });

  it('should execute successfully', async () => {
    const notebookPath = path.join(rootDir, 'test.ipynb');
    const initialContent = JSON.stringify({
      cells: [],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });
    fs.writeFileSync(notebookPath, initialContent);

    const updatedContent = JSON.stringify({
      cells: [{ cell_type: 'code', source: ['print(1)'] }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    });

    async function* mockStream() {
      yield { type: GeminiEventType.Content, value: updatedContent };
    }
    mockSendMessageStream.mockReturnValue(mockStream());

    const params = { file_path: 'test.ipynb', instruction: 'Add a code cell' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('Successfully edited notebook');
    const savedContent = fs.readFileSync(notebookPath, 'utf8');
    expect(JSON.parse(savedContent)).toEqual(JSON.parse(updatedContent));
  });

  it('should handle invalid JSON from model', async () => {
    const notebookPath = path.join(rootDir, 'test.ipynb');
    const initialContent = JSON.stringify({ cells: [] });
    fs.writeFileSync(notebookPath, initialContent);

    async function* mockStream() {
      yield { type: GeminiEventType.Content, value: 'Invalid JSON content' };
    }
    mockSendMessageStream.mockReturnValue(mockStream());

    const params = { file_path: 'test.ipynb', instruction: 'Break it' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Received invalid JSON');
  });

  it('should handle file not found', async () => {
    const params = { file_path: 'nonexistent.ipynb', instruction: 'Edit' };
    const invocation = tool.build(params);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('Error reading notebook file');
  });
});
