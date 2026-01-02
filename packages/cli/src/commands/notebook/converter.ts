/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type MessageRecord,
  partListUnionToString,
} from '@google/gemini-cli-core';
import {
  type NotebookRoot,
  type NotebookCell,
  type MarkdownCell,
  type CodeCell,
  type NotebookMetadata,
} from './types.js';

/**
 * Regex to identify code blocks.
 * Captures:
 * Group 1: Language identifier (optional) e.g., 'python', 'ts'
 * Group 2: The code content
 * Flags: 'g' for global search to iterate through the string.
 */
const CODE_BLOCK_REGEX = /```(\w*)\n([\s\S]*?)```/g;

export function convertHistoryToNotebook(
  history: MessageRecord[],
): NotebookRoot {
  const cells: NotebookCell[] = [];

  // Iterate through every turn in the conversation history
  for (const message of history) {
    // Convert complex content parts to a single string representation
    const text = partListUnionToString(message.content);

    if (message.type === 'user') {
      // User turns are typically strictly text.
      // We add a visual indicator that this was a user prompt
      cells.push(createMarkdownCell(`**User:**\n\n${text}`));
    } else if (message.type === 'gemini') {
      // Model turns can be complex mixtures of text and code.
      const modelCells = parseModelResponse(text);
      cells.push(...modelCells);
    }
    // We ignore system messages (info, error, warning) for the notebook export
  }

  return {
    cells,
    metadata: createDefaultMetadata(),
    nbformat: 4,
    nbformat_minor: 5,
  };
}

/**
 * Parses the text of a model response into a sequence of Notebook Cells.
 */
function parseModelResponse(text: string): NotebookCell[] {
  const cells: NotebookCell[] = [];

  // We maintain an index to track where the last match ended.
  // This allows us to capture the text *between* code blocks.
  let lastIndex = 0;
  let match;

  // Reset regex state for the new string
  CODE_BLOCK_REGEX.lastIndex = 0;

  // Iterate over all code blocks found in the text
  while ((match = CODE_BLOCK_REGEX.exec(text)) !== null) {
    // 1. Capture text BEFORE the code block (The "Reasoning" preamble)
    const preText = text.substring(lastIndex, match.index).trim();
    if (preText) {
      cells.push(createMarkdownCell(preText));
    }

    // 2. Capture the Code Block (The "Action")
    const language = match[1].toLowerCase();
    const code = match[2];

    if (isExecutableLanguage(language)) {
      // If Python, pure code cell.
      cells.push(createCodeCell(code));
    } else if (isShellLanguage(language)) {
      // If Bash, wrap in magic command.
      cells.push(createCodeCell(`%%bash\n${code}`));
    } else {
      // If unsupported language (e.g., JSON output, SQL), keep as Markdown
      // to prevent execution errors in a Python kernel.
      // We reconstruct the code block formatting.
      const formattedCode = code.endsWith('\n') ? code : code + '\n';
      cells.push(
        createMarkdownCell(`\`\`\`${language}\n${formattedCode}\`\`\``),
      );
    }

    // Update lastIndex to the end of the current match
    lastIndex = CODE_BLOCK_REGEX.lastIndex;
  }

  // 3. Capture text AFTER the last code block (The "Explanation" postscript)
  const postText = text.substring(lastIndex).trim();
  if (postText) {
    cells.push(createMarkdownCell(postText));
  }

  // If no code blocks were found, the entire text is a markdown cell
  if (cells.length === 0 && text.trim()) {
    cells.push(createMarkdownCell(text));
  }

  return cells;
}

// --- Helper Functions ---

function isExecutableLanguage(lang: string): boolean {
  return ['python', 'py', 'ipython'].includes(lang);
}

function isShellLanguage(lang: string): boolean {
  return ['bash', 'sh', 'shell', 'zsh'].includes(lang);
}

function createMarkdownCell(content: string): MarkdownCell {
  return {
    cell_type: 'markdown',
    metadata: {},
    source: splitLines(content),
  };
}

function createCodeCell(code: string): CodeCell {
  return {
    cell_type: 'code',
    execution_count: null, // Critical: Null means "not yet run"
    metadata: {},
    outputs: [],
    source: splitLines(code),
  };
}

/**
 * Splits string into array of strings strictly preserving newlines.
 * This complies with Jupyter v4 best practices for git diffing.
 */
function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // If it's the last line and it's empty, it means the text ended with a newline.
    // In this case, we don't add a new empty string, as the previous line already got a \n.
    if (i === lines.length - 1 && line === '') {
      break;
    }
    result.push(i < lines.length - 1 ? line + '\n' : line);
  }
  return result;
}

function createDefaultMetadata(): NotebookMetadata {
  return {
    kernelspec: {
      display_name: 'Python 3',
      language: 'python',
      name: 'python3',
    },
    language_info: {
      codemirror_mode: {
        name: 'ipython',
        version: 3,
      },
      file_extension: '.py',
      mimetype: 'text/x-python',
      name: 'python',
      nbconvert_exporter: 'python',
      pygments_lexer: 'ipython3',
      version: '3.x',
    },
  };
}
