/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../gemini.js', () => ({
  initializeOutputListenersAndFlush: vi.fn(),
}));

vi.mock('@google/gemini-cli-core', () => ({
  writeToStderr: vi.fn(),
  writeToStdout: vi.fn(),
  sessionId: 'test-session',
}));

// Mock config and settings to avoid deep imports into broken core parts
vi.mock('../../config/config.js', () => ({
  loadCliConfig: vi.fn(),
  isDebugMode: vi.fn(),
}));

vi.mock('../../config/settings.js', () => ({
  loadSettings: vi.fn(() => ({ merged: {} })),
}));

import { notebookCommand } from './index.js';
import { type Argv } from 'yargs';

describe('notebook command', () => {
  it('should have correct command definition', () => {
    expect(notebookCommand.command).toBe('notebook');
    expect(notebookCommand.describe).toBe('Manage Jupyter Notebook exports');
    expect(typeof notebookCommand.builder).toBe('function');
  });

  it('should register export subcommand', () => {
    const mockYargs = {
      command: vi.fn().mockReturnThis(),
      demandCommand: vi.fn().mockReturnThis(),
      version: vi.fn().mockReturnThis(),
      middleware: vi.fn().mockReturnThis(),
    };

    (notebookCommand.builder as (y: Argv) => Argv)(
      mockYargs as unknown as Argv,
    );

    expect(mockYargs.command).toHaveBeenCalled();
    const commandCalls = mockYargs.command.mock.calls;
    const commandNames = commandCalls.map((call) => call[0].command);
    expect(commandNames).toContain('export');
  });
});
