# Protocol report fonts

Unmodified DejaVu Sans regular and bold copied from the installed local
`/usr/share/fonts/truetype/dejavu/` directory. Whole-file SHA-256 and sizes:
`font-pins.json`. `LICENSE.txt` preserves the installed distribution's complete
copyright/permission notice. Font terms are Bitstream Vera; DejaVu changes are
public domain. The separate Debian packaging notice does not relicense fonts.

PDFKit embeds subsets of these two TTFs. No runtime system-font search or network
fallback is used. Ship this directory beside `src/` or `dist/` under `apps/api/`.
DOCX declares the DejaVu Sans family; Word may substitute fonts if absent on the
reader's machine. DOCX does not embed the TTFs. Glyph coverage is DejaVu Sans;
Cyrillic is tested, arbitrary scripts and PDF/A/signatures are not claimed.

Renderer dependencies: pdfkit 0.20.2, yazl 3.3.1; @types/pdfkit and @types/yazl
are compile-time only. Output uses fixed snapshot dates/identity, stable ZIP
entry order/DOS timestamps and no network, DB, model or converter. PDF includes
exact `canonical-snapshot.json` and structured `protocol-report.xml` attachments;
DOCX includes the same structured snapshot as a custom XML package part.

PDF uses A4 landscape, repeated table headings and line fragments for rows
larger than a page. Tables wider than eight columns use ordered column bands;
very long headings are printed completely in a legend with numbered repeated
headers. DOCX allows row splitting and uses equivalent bands/legends. Full
exports buffer in memory; memory grows with document/page/output size.

Ordinary XML 1.0-invalid characters become visible U+FFFD. Valid JSON with raw
XML-invalid scalar characters is rejected instead of rewriting immutable
snapshot text. Standard JSON escaped controls/surrogates remain exact. XML
contains no DTD or external references; DOCX relationships are package-local.

Focused checks:

    vitest run --root apps/api --maxWorkers=1 test/protocol-report-renderer.test.ts

Tests independently read PDF ToUnicode/content streams, unzip all DOCX parts
and parse XML. They do not require external converters or Chrome. Office/Word
visual rendering, PDF/A compliance and digital signatures are outside scope.
