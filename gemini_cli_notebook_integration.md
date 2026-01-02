# Gemini CLI Notebook Integration

**Spec:** Technical Specification & Contribution Guide: Gemini CLI Notebook
Integration **Branch:** `notebook-wrapper-integration` **Goal:** Implement
`gemini notebook export` to serialize chat history into Jupyter Notebooks
(`.ipynb`).

## Phase 1: Foundation & Types

- [x] **Project Setup**
  - [x] Checkout branch `notebook-wrapper-integration`.
  - [x] Create directory structure: `packages/cli/src/commands/notebook/`.
  - [x] Create placeholder files: `index.ts`, `export.ts`, `types.ts`,
        `converter.ts`.

- [x] **Type Definitions (`types.ts`)**
  - [x] Define `NotebookRoot` interface (cells, metadata, nbformat 4.5).
  - [x] Define `NotebookCell` union type (`MarkdownCell | CodeCell | RawCell`).
  - [x] Define `MarkdownCell` interface.
  - [x] Define `CodeCell` interface (ensure `execution_count` can be null).
  - [x] Define `Output` interfaces (Stream, ExecuteResult, Error, DisplayData).
  - [x] Define `KernelSpec` and `LanguageInfo` metadata interfaces.

## Phase 2: Core Logic (The Converter)

- [x] **Converter Implementation (`converter.ts`)**
  - [x] Implement `CODE_BLOCK_REGEX` for identifying code blocks.
  - [x] Implement `splitLines` utility to strictly preserve `\n` for git-diff
        friendliness.
  - [x] Implement `createDefaultMetadata` returning Python 3 kernel spec.
  - [x] **Parsing Logic:**
    - [x] Implement `convertHistoryToNotebook` main loop.
    - [x] Implement `parseModelResponse` to handle interleaved text and code.
    - [x] Implement language detection (`isExecutableLanguage` vs
          `isShellLanguage`).
    - [x] Implement logic to wrap Shell commands in `%%bash` magic.
    - [x] Implement logic to fallback unknown languages to Markdown code blocks.

## Phase 3: Command & I/O

- [x] **Export Command (`export.ts`)**
  - [x] Define commander command `export` with options:
    - [x] `-o, --out <filename>` (default: `session.ipynb`).
    - [x] `--id <sessionId>` (optional).
  - [x] Implement Session Retrieval:
    - [x] Import/Utilize `getLatestSession` and `getSessionById` from core
          utils. (Note: used SessionSelector)
    - [x] Handle "No history found" case gracefully.
  - [x] Implement File I/O:
    - [x] Resolve output path relative to `process.cwd()`.
    - [x] Serialize JSON with `null, 2` indentation.
    - [x] Write file to disk.

- [x] **Registration (`index.ts`)**
  - [x] Create `notebookCommand` registry function.
  - [x] Register `export` subcommand.
  - [x] Wire up to main CLI entry point (if necessary, though likely handled by
        parent).

## Phase 4: Testing & Verification

- [x] **Unit Tests (`converter.test.ts`)**
  - [x] **Happy Path:** Standard User Text -> Model Python Code.
  - [x] **Complex Path:** Interleaved Text -> Code -> Text responses.
  - [x] **Shell Support:** Verify `bash`/`sh` blocks get `%%bash` magic.
  - [x] **Safety:** Verify unknown languages (e.g., SQL/JSON) remain as Markdown
        blocks.
  - [x] **Edge Cases:** Empty history, unclosed code blocks.

- [x] **Integration/Manual Verification**
  - [x] Run `gemini notebook export`.
  - [x] Open generated `.ipynb` in VS Code.
  - [x] Open generated `.ipynb` in JupyterLab (if available).
  - [x] Verify execution of Python cells.

## Notes & Constraints

- **Zero Python Dependencies:** Logic must be pure TypeScript.
- **Strict Typing:** No `any` types in the converter.
- **Spec:** Jupyter Notebook v4.5 compliance.
