# Changelog

All notable changes, newest first.

## 1.0.0 – 2026-10-29

### New
- **CSL editor** (new tab, Ctrl+7): find, adapt and install citation styles. This is a first version and still in
  development – feedback, bug reports and contributions are welcome as
  [issues](https://github.com/avibecoder42/ZotLLM/issues) or pull requests.
  - Search the roughly 10,000 styles on zotero.org (the list is only loaded when you search – about 300 KB once,
    afterwards only when it has changed), open styles installed in Zotero or import a .csl file.
  - Other styles are adopted as a copy with their own name and ID, so the original is never overwritten; dependent
    styles become an independent copy of their parent style.
  - Preview with citeproc-js, the software Zotero itself uses: in-text citations and bibliography entries for nine
    typical document types, plus your own Zotero items, in a choice of languages.
  - Click a part of a citation to edit exactly that part: text before and after, italic, bold, small caps,
    capitalisation, name format ("and" or "&", initials, order, "et al."), date form, page labels; move, remove or add
    fields. Parts used in several places are flagged, and the examples changed by the last edit are marked.
  - Code view with live preview and error messages, undo/redo, earlier versions.
  - "Install in Zotero" uses the ZotLLM plugin and Zotero's own install function: the style is immediately available in
    Zotero, in the Word plugin and in ZotLLM. Without the current plugin, the style is saved as a .csl file.
- The Zotero plugin can install styles from the CSL editor – reinstall it once (Settings → Zotero and export → Save
  plugin).

### Changed
- **Literature review in five steps:** "Keywords" (search queries) and "Select literature" are now separate steps.
  Every step has the same layout: the steps at the top, below them the collapsed prompt (title, research question,
  corpora) on the left and the buttons for the next step on the right, always in the same place.
- After writing, the review switches to "Check" and shows the text there; the check findings are collapsed into one
  summary line.
- **Evaluation sheets can be viewed:** in "Evaluate", a click on a text shows its sheet – fields, key findings, key
  quotations (opening the PDF in Zotero at the page) and keywords. "Recreate sheet" re-reads a single text.
- Outline sections can now also be moved up.
- **CSL editor:** a change can apply only to in-text citations or only to the bibliography, even where both use the
  same macro (e.g. the year) – the clicked part gets its own copy of the macro. The filter for styles installed in
  Zotero also searches short titles and ignores accents ("fhnw" finds "Schreibberatung PH FHNW").
- **CSL editor – examples:**
  - "Choose item types": besides the nine default examples, every other item type Zotero knows (e.g. case,
    statute, conference paper, film); default examples can be hidden. The list comes from Zotero's schema.
  - Examples come from your own library where a matching item exists (for articles with the matching number of
    authors); otherwise made-up English examples, mapped to CSL the way Zotero does it.
  - "Collection …": show the items of a Zotero collection as examples.
- **CSL editor – moving parts:** "Earlier"/"Later" leave a group at its edge, "To the start"/"To the end" jump
  there. If the selected part stands alone (like the year in a date macro), the place of the macro or the whole
  condition is moved – e.g. the year to the end of the bibliography entry. The bar above the selection shows the
  path through the macros.
- **CSL editor – "et al.":** clearer fields ("et al." from … names / of these, show) with an example.

### Fixed
- Static files in folders starting with "v" were mistaken for versioned paths.
- Formulas in LaTeX notation written by the language model (`$\beta = .35$`, `$\ge 21$`) now appear as text (β = .35,
  ≥ 21) in Word, Markdown, copied text, the Zotero note and the app; the LaTeX export keeps them as formulas. The
  writing prompt now asks for plain text with Unicode characters instead.
- "Shin et al. [@KEY]" no longer becomes "Shin et al. (Shin et al. 2021)": if the author is named right before the
  citation, it only shows year and page – in Word via Zotero's "suppress-author", in LaTeX via `\parencite*`.

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
