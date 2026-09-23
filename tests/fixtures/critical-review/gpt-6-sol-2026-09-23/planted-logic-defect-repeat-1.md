Reviewed: Committed diff `5c26713ca5426881df134732cc75bc29f7d4d4c5..HEAD` (1 file, 1 changed line), its full function, and its test. Overall verdict: **Blocker**; the authorization check is inverted. Executed: the requested unit test command. Not verified: broader integration; this review route is uncalibrated, so final judgment remains with the user.

Command evidence | command=python3 -m unittest discover -s tests -t . | exit=1 | output=Ran 1 test; FAILED (failures=1)

| Tier | Finding | Location | Why / failure scenario | Suggested fix |
|---|---|---|---|---|
| Blocker | `own` — inverted authorization comparison | [src/access.py:2](/tmp/review-fixture/workspace/repo/src/access.py:2) | `role != "admin"` allows a non-admin such as `member` to delete and denies an admin. The existing test fails on the admin case. | Restore `role == "admin"`. |