status: draft
base: pending

# Plan — sample feature

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-fable-5-1", "effort": "high" },
    "tasks": [
      { "id": "http-retry",
        "branch": "wave/http-retry",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": ["claude-opus-5-5"],
        "contract": {
          "files_allowed": ["src/http/**"],
          "files_forbidden": ["src/auth/**"],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["Which call sites now retry?"] } },
      { "id": "docs-sync",
        "branch": "wave/docs-sync",
        "executor": { "model": "claude-haiku-4-5-20251001" },
        "contract": {
          "files_allowed": ["docs/**"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
] }
```

## Task http-retry

Add retry with backoff to the HTTP client. Full description and code go here.

## Task docs-sync

Update the docs to describe retries.
