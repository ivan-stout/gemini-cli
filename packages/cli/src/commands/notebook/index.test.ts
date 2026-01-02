/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../gemini.js', () => ({
  initializeOutputListenersAndFlush: vi.fn(),
}));

// Mock subcommands to avoid loading their dependencies
vi.mock('./export.js', () => ({
  exportCommand: { command: 'export' },
}));

vi.mock('./edit.js', () => ({
  editCommand: { command: 'edit <file>' },
}));

import { notebookCommand } from './index.js';
import { type Argv } from 'yargs';

describe('notebook command', () => {
  it('should have correct command definition', () => {
    expect(notebookCommand.command).toBe('notebook');
    expect(notebookCommand.describe).toBe('Manage Jupyter Notebook exports');
    expect(typeof notebookCommand.builder).toBe('function');
  });

  it('should register export and edit subcommands', () => {
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
    expect(commandNames).toContain('edit <file>');
  });
});
