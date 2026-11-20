# shared/schemas

JSON Schemas (draft 2020-12) for the SECEP contracts in SRS §6.4. Owner: M6 (Akashdeep), per SRS §6.2.

| File | Contract |
| --- | --- |
| `envelope.v1.json` | `emails.ingested` stream payload. Derived from the §6.4 example: the same fields, all required, nothing added |
| `triage.v1.json` | Triage result, verbatim from §6.4 (v1.1 `source` includes `"rule"`) |
| `enrich.v1.json` | Decoder output, verbatim from §6.4 |

Each file's `$id` matches its file name. These contracts are frozen: change the SRS first, then the file.
Formats (`uuid`, `date`, `date-time`, `email`) need `ajv-formats` when validating.
