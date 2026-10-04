status: draft
base: pending

# Plan — clearer init step in the setup doc

Users skip the init step because the setup doc buries why it matters. Reword
that one sentence. Docs only; one task, one wave.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: a one-sentence documentation edit with no runtime behaviour",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "setup-doc-wording",
     "branch": "wave/setup-doc-wording",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["docs/setup.md"],
      "files_forbidden": ["src/**"],
      "must_run": [
       { "cmd": "grep -qF 'creates the notes directory' docs/setup.md", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing the CLI"],
      "report_must_answer": ["Quote the old and the new sentence."]
     }
    }
   ]
  }
 ]
}
```

## Task setup-doc-wording

In `docs/setup.md`, replace the sentence

> Run `python3 -m src.notes --init` once before adding your first note.

with

> Before your first note, run `python3 -m src.notes --init` once — it creates the notes directory the CLI writes to.

Leave the rest of the file as it is. Nothing outside the doc changes.

Base status: the `must_run` is expected-red at base (the new wording does
not exist yet).
