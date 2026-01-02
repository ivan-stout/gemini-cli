/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

// Mock core before importing converter
vi.mock('@google/gemini-cli-core', () => ({
  partListUnionToString: (parts: unknown) => {
    if (Array.isArray(parts)) {
      return parts.map((p: { text?: string }) => p.text || '').join('');
    }
    return String(parts);
  },
}));

import { convertHistoryToNotebook } from './converter.js';
import { type MessageRecord } from '@google/gemini-cli-core';

describe('converter', () => {
  it('should convert simple history to notebook', () => {
    const history: MessageRecord[] = [
      {
        id: '1',
        type: 'user',
        content: [{ text: 'Hello' }],
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        type: 'gemini',
        content: [{ text: 'Hi there! How can I help?' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const notebook = convertHistoryToNotebook(history);

    expect(notebook.cells).toHaveLength(2);
    expect(notebook.cells[0].cell_type).toBe('markdown');
    expect(notebook.cells[0].source).toEqual(['**User:**\n', '\n', 'Hello']);
    expect(notebook.cells[1].cell_type).toBe('markdown');
    expect(notebook.cells[1].source).toEqual(['Hi there! How can I help?']);
  });

  it('should handle code blocks in model response', () => {
    const history: MessageRecord[] = [
      {
        id: '1',
        type: 'gemini',
        content: [
          {
            text: 'Here is some code:\n```python\nprint("hello")\n```\nAnd some more text.',
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const notebook = convertHistoryToNotebook(history);

    // Should be: [Markdown, Code, Markdown]
    expect(notebook.cells).toHaveLength(3);
    expect(notebook.cells[0].cell_type).toBe('markdown');
    expect(notebook.cells[0].source).toEqual(['Here is some code:']);
    expect(notebook.cells[1].cell_type).toBe('code');
    expect(notebook.cells[1].source).toEqual(['print("hello")\n']);
    expect(notebook.cells[2].cell_type).toBe('markdown');
    expect(notebook.cells[2].source).toEqual(['And some more text.']);
  });

  it('should handle bash blocks with magic command', () => {
    const history: MessageRecord[] = [
      {
        id: '1',
        type: 'gemini',
        content: [{ text: 'Run this:\n```bash\nls -l\n```' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const notebook = convertHistoryToNotebook(history);

    expect(notebook.cells).toHaveLength(2);
    expect(notebook.cells[1].cell_type).toBe('code');
    expect(notebook.cells[1].source).toEqual(['%%bash\n', 'ls -l\n']);
  });

  it('should handle unknown languages as markdown blocks', () => {
    const history: MessageRecord[] = [
      {
        id: '1',
        type: 'gemini',
        content: [{ text: 'Config:\n```json\n{"a": 1}\n```' }],
        timestamp: new Date().toISOString(),
      },
    ];

    const notebook = convertHistoryToNotebook(history);

    expect(notebook.cells).toHaveLength(2);
    expect(notebook.cells[1].cell_type).toBe('markdown');
    expect(notebook.cells[1].source).toEqual([
      '```json\n',
      '{"a": 1}\n',
      '```',
    ]);
  });

  it('should handle multiple code blocks', () => {
    const history: MessageRecord[] = [
      {
        id: '1',
        type: 'gemini',
        content: [
          {
            text: 'One:\n```python\n1\n```\nTwo:\n```python\n2\n```',
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const notebook = convertHistoryToNotebook(history);

    expect(notebook.cells).toHaveLength(4);
    expect(notebook.cells[0].source).toEqual(['One:']);
    expect(notebook.cells[1].source).toEqual(['1\n']);
    expect(notebook.cells[2].source).toEqual(['Two:']);
    expect(notebook.cells[3].source).toEqual(['2\n']);
  });
});
