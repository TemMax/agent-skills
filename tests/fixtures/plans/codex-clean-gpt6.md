status: draft
base: pending

# Plan — Codex divide guard

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "gpt-6-astra", "effort": "high" },
    "tasks": [
      { "id": "divide-guard",
        "branch": "wave/divide-guard",
        "executor": { "model": "gpt-6-luna", "effort": "medium" },
        "ladder": ["gpt-6-sol"],
        "contract": {
          "files_allowed": ["src/**"],
          "files_forbidden": ["tests/**"],
          "must_run": [{ "cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["How is division by zero handled?"] } }
    ] }
],
  "ci": "none: fixture repository without CI workflows",
  "e2e": { "task": "divide-guard" },
  "approvals": { "premium": { "models": ["gpt-6-astra"],
    "reason": "Astra required for cross-file divide-by-zero reasoning depth.",
    "approved_by": "fixture", "date": "2026-09-24" } }
}
```

## Task divide-guard

Add a guard for division by zero without modifying the tests.
