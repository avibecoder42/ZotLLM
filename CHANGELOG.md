# Changelog

All notable changes, newest first.

## 0.9.0 – 2026-10-23

### New
- **Word and LibreOffice documents:** ZotLLM now also reads Word files (.docx) and LibreOffice documents (.odt) stored
  as attachments in Zotero – the main text with headings, lists and tables; footnotes and endnotes follow at the end of
  their page or of the document. For tracked changes, the current state counts; headers, footers, comments and indexes
  are left out. The old Word format (.doc) is not supported.
  - **Page numbers** come from the page breaks Word or LibreOffice recorded when the document was last saved,
    including a different first page number. Without them (e.g. a Google Docs export), citations read "o. S." (n.p.).
  - Word attachments already in your library are picked up at the next sync with Zotero and read in the next indexing
    run; existing settings are extended automatically.
  - Citations of Word documents offer "Show in Zotero" instead of "Open PDF", because Zotero does not display Word files
    itself.

## 0.8.1 – 2026-10-21

First public release.

- **Ask:** questions about your knowledge corpora, answered only from the retrieved passages. Every citation opens the
  passage and its page; "Open PDF" jumps there in Zotero. "Passages only" searches without a language model.
- **Literature review:** an editable search strategy, screening, one evaluation sheet per text (stored as a Zotero
  note), an editable outline, section-by-section writing, and a check of every citation and verbatim quotation against
  the sources. Output as Markdown, Word (live Zotero fields), LaTeX or a Zotero note, with a search-method appendix.
- **Search without a language model** across your library and all groups: copy references and in-text citations in
  your Zotero citation style, export selections as Word, BibTeX, RIS or Markdown, add them to a corpus or a Zotero
  collection, or ask about exactly these items.
- **Projects** bundle corpora, chats and literature reviews; export and import as `.zllm` files, archive.
- **Language models:** Claude, ChatGPT (OpenAI), Gemini, DeepSeek and local models via Ollama. API keys stay in the
  operating system's key store.
- **Built-in embeddings** (llama.cpp) with a curated catalog of 12 models, checksum-verified downloads, a short benchmark
  on your own computer and a comparison mode; Ollama and cloud embeddings are also supported.
- **Indexing for large libraries:** printed page numbers, resumable runs, a queue, background mode in stages, duplicate
  detection across libraries, citations that follow deleted duplicates, backups.
- **Zotero plugin** with context menus; MCP server for Claude Desktop.
- Interface and manual in English and German.
