# Jarvis public receipt journal

A **public, sanitized** journal of receipt metadata for the Jarvis
remote-control transport. Its purpose is to make command-envelope outcomes
publicly auditable **without ever leaking private material**.

The authoritative raw receipts, policy, and source of truth remain private in
`pixenetwork/ai-orchestrator`. This journal is a downstream, sanitized mirror;
it references each private raw receipt only through a one-way hash and depends
on nothing outside this repository.

## What a journal entry is

Each entry is a small JSON object describing one phase of one command
envelope's lifecycle. It carries **only** sanitized metadata.

| Field | Meaning | Format |
| --- | --- | --- |
| `schemaVersion` | Entry format version (structural metadata only). | integer, must be `1` |
| `phase` | Lifecycle phase this receipt attests. | enum: `precheck`, `dispatch`, `execution-postcheck`, `reconcile`, `expiry` |
| `nonce` | The envelope's single-use, non-secret anti-replay nonce. | 32 lowercase hex chars |
| `rawHashRef` | One-way reference to the private raw receipt. | `sha256:` + 64 lowercase hex chars |
| `ttlSeconds` | Validity window duration of the envelope, in whole seconds. | integer, `1`–`86400` |
| `outcome` | Terminal outcome for the phase. | enum: `success`, `failure`, `expired`, `rejected`, `timeout` |

- Machine-readable schema: [`schema/receipt-journal-entry.schema.json`](schema/receipt-journal-entry.schema.json)
- Example (clearly-fake values): [`examples/receipt-journal-entry.example.json`](examples/receipt-journal-entry.example.json)

### Example entry

```json
{
  "schemaVersion": 1,
  "phase": "execution-postcheck",
  "nonce": "00000000000000000000000000000000",
  "rawHashRef": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "ttlSeconds": 600,
  "outcome": "success"
}
```

> The values above are placeholders. Do not treat them as real receipts.

## Hard constraints (never violate)

The journal exists **inside** the transport's security boundary and tightens it:

- **Allow-list only.** The six fields above are the *only* permitted keys. Any
  other key is rejected — there is no "extra metadata" escape hatch.
- **No commands or execution content.** Never include shell/PowerShell
  fragments, command envelopes, action names, or anything executable.
- **No credentials or tokens.** Never include passwords, secrets, API keys,
  bearer/authorization values, GitHub tokens, or private keys.
- **No environment data.** Never include `.env` contents, environment variable
  names/values, or host paths.
- **No Host Ops internals.** Never include `hostOps` fields, task IDs, target
  host names, working directories, `expectedMainSha`, or `receiptPolicy`.
- **No private artifacts.** Never include references to private source files,
  the `ai-orchestrator` repository, or the raw receipt content itself. Only the
  `rawHashRef` hash pointer is allowed.
- **Fail closed.** Anything ambiguous or unrecognized is rejected, not
  published.

These constraints are the sanitization contract. The raw receipt stays private;
only its hash and a handful of enumerated, non-sensitive fields are ever public.

## Validator

[`validate-receipt.mjs`](validate-receipt.mjs) is a zero-dependency, side-effect
free Node ESM module that **enforces** the contract above. It:

1. rejects any input that is not a plain JSON object;
2. rejects any key outside the allow-list;
3. strictly format-checks every field (enum / hex / bounded integer); and
4. as defense-in-depth, deep-scans the entire input — every nested key **and**
   value — for anything resembling commands, credentials, tokens, environment
   data, Host Ops internals, or private artifacts, and rejects on any hit,
   naming the offending category.

It fails closed and never echoes rejected content back to the caller.

```js
import { validateReceipt, validateJournal } from "./validate-receipt.mjs";

const { valid, errors, entry } = validateReceipt(candidate);
// validateJournal(array) validates a whole journal and reports per-index results.
```

## Running validation

From the repository root (Node >= 20):

```bash
npm run check   # node --check on the validator and its tests
npm test        # node --test unit tests for the validator
```
