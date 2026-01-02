/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notebookCommand } from './notebookCommand.js';
import { GeminiEventType } from '@google/gemini-cli-core';
import type { CommandContext } from './types.js';

// Mock dependencies
const mockGetConversation = vi.fn();
const mockSendMessageStream = vi.fn();
const mockConfig = {
  getGeminiClient: vi.fn().mockReturnValue({
    getChat: vi.fn().mockReturnValue({
      getChatRecordingService: vi.fn().mockReturnValue({
        getConversation: mockGetConversation,
      }),
    }),
    sendMessageStream: mockSendMessageStream,
  }),
};

const mockUi = {
  addItem: vi.fn(),
  setPendingItem: vi.fn(),
};

const mockContext = {
  services: {
    config: mockConfig,
  },
  ui: mockUi,
};

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{"cells": []}'),
}));

vi.mock('../../commands/notebook/converter.js', () => ({
  convertHistoryToNotebook: vi.fn().mockReturnValue({ cells: [] }),
}));

describe('notebookCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('export', () => {
    it('should export notebook successfully', async () => {
      const exportCmd = notebookCommand.subCommands!.find(
        (c) => c.name === 'export',
      )!;
      mockGetConversation.mockReturnValue({ messages: [] });

      await exportCmd.action!(
        mockContext as unknown as CommandContext,
        'test-export',
      );

      const { writeFile } = await import('node:fs/promises');
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test-export.ipynb'),
        expect.any(String),
        'utf8',
      );
      expect(mockUi.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Successfully exported'),
          type: 'user',
        }),
        expect.any(Number),
      );
    });

    it('should handle no conversation', async () => {
      const exportCmd = notebookCommand.subCommands!.find(
        (c) => c.name === 'export',
      )!;
      mockGetConversation.mockReturnValue(null);

      await exportCmd.action!(mockContext as unknown as CommandContext, '');

      expect(mockUi.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('No active conversation'),
          type: 'user',
        }),
        expect.any(Number),
      );
    });
  });

  describe('edit', () => {
    it('should require instruction', async () => {
      const editCmd = notebookCommand.subCommands!.find(
        (c) => c.name === 'edit',
      )!;
      await editCmd.action!(
        mockContext as unknown as CommandContext,
        'file.ipynb',
      );

      expect(mockUi.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Please provide'),
          type: 'user',
        }),
        expect.any(Number),
      );
    });

    it('should edit notebook successfully', async () => {
      const editCmd = notebookCommand.subCommands!.find(
        (c) => c.name === 'edit',
      )!;

      async function* mockStream() {
        yield { type: GeminiEventType.Content, value: '{"cells": []}' };
      }
      mockSendMessageStream.mockReturnValue(mockStream());

      await editCmd.action!(
        mockContext as unknown as CommandContext,
        'file.ipynb Add a cell',
      );

      const { writeFile } = await import('node:fs/promises');
      expect(mockUi.setPendingItem).toHaveBeenCalled();
      expect(mockSendMessageStream).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      expect(mockUi.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('Successfully edited'),
          type: 'user',
        }),
        expect.any(Number),
      );
    });
  });
});
