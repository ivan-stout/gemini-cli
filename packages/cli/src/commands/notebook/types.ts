/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview TypeScript definitions for Jupyter Notebook Format v4.5
 * @see https://nbformat.readthedocs.io/en/latest/format_description.html
 */

export interface NotebookRoot {
  cells: NotebookCell[];
  metadata: NotebookMetadata;
  nbformat: number;
  nbformat_minor: number;
}

export type NotebookCell = MarkdownCell | CodeCell | RawCell;

export interface BaseCell {
  /**
   * String identifying the type of cell.
   */
  cell_type: 'markdown' | 'code' | 'raw';

  /**
   * Cell-level metadata.
   */
  metadata: CellMetadata;

  /**
   * The cell's content.
   * Jupyter recommends an array of strings, each ending with \n,
   * to strictly support line-based diffs.
   */
  source: string[];
}

export interface MarkdownCell extends BaseCell {
  cell_type: 'markdown';
}

export interface CodeCell extends BaseCell {
  cell_type: 'code';

  /**
   * The execution count.
   * null: Not yet executed.
   * number: Order of execution.
   */
  execution_count: number | null;

  /**
   * Outputs of the code cell.
   * For CLI exports, this will typically be empty.
   */
  outputs: Output[];
}

export interface RawCell extends BaseCell {
  cell_type: 'raw';
}

/**
 * Output interfaces.
 * Even though we export empty outputs initially,
 * defining these ensures future extensibility.
 */
export type Output = ExecuteResult | DisplayData | StreamOutput | ErrorOutput;

export interface BaseOutput {
  output_type: string;
}

export interface StreamOutput extends BaseOutput {
  output_type: 'stream';
  name: 'stdout' | 'stderr';
  text: string[];
}

export interface ExecuteResult extends BaseOutput {
  output_type: 'execute_result';
  execution_count: number | null;
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface DisplayData extends BaseOutput {
  output_type: 'display_data';
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface ErrorOutput extends BaseOutput {
  output_type: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

export type MimeBundle = Record<string, string | string[] | object>;

/**
 * Metadata Interfaces
 */
export interface NotebookMetadata {
  kernelspec: KernelSpec;
  language_info: LanguageInfo;
  [key: string]: unknown; // Allow extensibility
}

export interface CellMetadata {
  collapsed?: boolean;
  autoscroll?: boolean | 'auto';
  name?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface KernelSpec {
  display_name: string;
  name: string;
  language?: string;
}

export interface LanguageInfo {
  codemirror_mode?: string | object;
  file_extension?: string;
  mimetype?: string;
  name: string;
  pygments_lexer?: string;
  version?: string;
}
