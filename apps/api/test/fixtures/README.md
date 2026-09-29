# PDF intake fixtures

- `valid.pdf`: copy of `scripts/fixtures/smoke.pdf`, one page.
- `zero-page.pdf`: minimal PDF with a catalog and `/Pages /Count 0`; Poppler rejects it.
- `encrypted.pdf`: one-page PDF generated with PyMuPDF AES-256 and non-empty test user password.
- `encrypted-empty-password.pdf`: same encryption with empty test user password; Poppler can read its metadata but reports `Encrypted: yes`.

Only test data. No source documents from the competition dataset are included here.
