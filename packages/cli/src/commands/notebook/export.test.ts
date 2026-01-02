/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportCommand } from './export.js';
import { type ArgumentsCamelCase } from 'yargs';

// Mock dependencies
vi.mock('@google/gemini-cli-core', () => ({
  writeToStderr: vi.fn(),
  writeToStdout: vi.fn(),
  sessionId: 'test-session',
}));

vi.mock('../../utils/sessionUtils.js', () => ({
  SessionSelector: vi.fn().mockImplementation(() => ({
    resolveSession: vi.fn().mockResolvedValue({
      sessionData: { messages: [] },
      displayInfo: 'Session 1: test',
    }),
  })),
  RESUME_LATEST: 'latest',
}));

vi.mock('./converter.js', () => ({
  convertHistoryToNotebook: vi.fn().mockReturnValue({ cells: [] }),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/config.js', () => ({
  loadCliConfig: vi.fn().mockResolvedValue({}),
  isDebugMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings: vi.fn(() => ({ merged: {} })),
}));

describe('export command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should have correct command definition', () => {
    expect(exportCommand.command).toBe('export');
    expect(exportCommand.describe).toBe(
      'Export chat history to a Jupyter Notebook (.ipynb)',
    );
  });

  it('should handle export successfully', async () => {
    const argv = {
      out: 'test.ipynb',
      id: 'latest',
    };

    if (typeof exportCommand.handler === 'function') {
      await exportCommand.handler(argv as unknown as ArgumentsCamelCase);
    }

    const { writeToStdout } = await import('@google/gemini-cli-core');
    const { writeFile } = await import('node:fs/promises');

    expect(writeToStdout).toHaveBeenCalledWith(
      expect.stringContaining('Exporting Session 1: test'),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('test.ipynb'),
      expect.any(String),
      'utf8',
    );
    expect(writeToStdout).toHaveBeenCalledWith(
      expect.stringContaining('Successfully exported'),
    );
  });
});
