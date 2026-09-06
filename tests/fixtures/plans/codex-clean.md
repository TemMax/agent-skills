status: draft
base: pending

# Plan — Codex divide guard

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "gpt-5.6-terra", "effort": "high" },
    "tasks": [
      { "id": "divide-guard",
        "branch": "wave/divide-guard",
        "executor": { "model": "gpt-5.6-luna", "effort": "medium" },
        "ladder": ["gpt-5.6-sol"],
        "contract": {
          "files_allowed": ["src/**"],
          "files_forbidden": ["tests/**"],
          "must_run": [{ "cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["How is division by zero handled?"] } }
    ] }
] }
```

## Task divide-guard

Add a guard for division by zero without modifying the tests.
