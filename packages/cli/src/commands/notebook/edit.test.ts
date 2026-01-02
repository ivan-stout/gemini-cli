/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted for shared mocks
const mocks = vi.hoisted(() => {
  const sendMessageStream = vi.fn();
  const getGeminiClient = vi.fn().mockReturnValue({
    sendMessageStream,
  });
  return {
    sendMessageStream,
    getGeminiClient,
    initialize: vi.fn(),
    refreshAuth: vi.fn(),
  };
});

// Fully mock core
vi.mock('@google/gemini-cli-core', () => ({
  writeToStderr: vi.fn(),
  writeToStdout: vi.fn(),
  sessionId: 'test-session',
  GeminiEventType: {
    Content: 'content',
    Error: 'error',
  },
}));

vi.mock('../../config/config.js', () => ({
  loadCliConfig: vi.fn().mockResolvedValue({
    initialize: mocks.initialize,
    refreshAuth: mocks.refreshAuth,
    getGeminiClient: mocks.getGeminiClient,
  }),
  isDebugMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings: vi.fn(() => ({
    merged: { security: { auth: { selectedType: 'test-auth' } } },
  })),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{"cells": []}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { editCommand } from './edit.js';
import { type ArgumentsCamelCase } from 'yargs';
import { GeminiEventType } from '@google/gemini-cli-core';

describe('edit command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct command definition', () => {
    expect(editCommand.command).toBe('edit <file>');
    expect(editCommand.describe).toBe(
      'Edit a notebook using natural language instructions',
    );
  });

  it('should handle edit successfully', async () => {
    const argv = {
      file: 'test.ipynb',
      instruction: 'Add a cell',
      out: 'edited.ipynb',
    };

    // Mock stream response
    async function* mockStream() {
      yield {
        type: GeminiEventType.Content,
        value: '{"cells": [{"cell_type": "code"}]}',
      };
    }
    mocks.sendMessageStream.mockReturnValue(mockStream());

    if (typeof editCommand.handler === 'function') {
      await editCommand.handler(argv as unknown as ArgumentsCamelCase);
    }

    const { writeToStdout } = await import('@google/gemini-cli-core');
    const { writeFile } = await import('node:fs/promises');

    expect(mocks.initialize).toHaveBeenCalled();
    expect(mocks.refreshAuth).toHaveBeenCalled();
    expect(writeToStdout).toHaveBeenCalledWith(
      expect.stringContaining('Sending notebook'),
    );
    expect(mocks.sendMessageStream).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('edited.ipynb'),
      '{"cells": [{"cell_type": "code"}]}',
      'utf8',
    );
    expect(writeToStdout).toHaveBeenCalledWith(
      expect.stringContaining('Successfully edited'),
    );
  });

  it('should handle invalid JSON from model', async () => {
    const argv = {
      file: 'test.ipynb',
      instruction: 'Break it',
    };

    async function* mockStream() {
      yield { type: GeminiEventType.Content, value: 'Invalid JSON' };
    }
    mocks.sendMessageStream.mockReturnValue(mockStream());

    // Mock process.exit to catch it
    // Mock process.exit to catch it
    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as unknown as (
        code?: string | number | null,
      ) => never);

    if (typeof editCommand.handler === 'function') {
      await editCommand.handler(argv as unknown as ArgumentsCamelCase);
    }

    const { writeToStderr } = await import('@google/gemini-cli-core');
    expect(writeToStderr).toHaveBeenCalledWith(
      expect.stringContaining('Received invalid JSON'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});
