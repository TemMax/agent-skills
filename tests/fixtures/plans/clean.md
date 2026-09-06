status: draft
base: pending

# Plan — sample feature

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "fable", "effort": "high" },
    "tasks": [
      { "id": "http-retry",
        "branch": "wave/http-retry",
        "executor": { "model": "sonnet", "effort": "medium" },
        "ladder": ["opus"],
        "contract": {
          "files_allowed": ["src/http/**"],
          "files_forbidden": ["src/auth/**"],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["Which call sites now retry?"] } },
      { "id": "docs-sync",
        "branch": "wave/docs-sync",
        "executor": { "model": "haiku" },
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
