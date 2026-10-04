status: draft
base: pending

# Plan — discounts and receipt lines

Two independent additions to the `shop` package, side by side in one
wave: a discounted gross price in `shop/pricing.py`, and a labelled
receipt line in `shop/display.py`. Both modules already import from
`shop/constants.py`; neither task changes it or `shop/__init__.py`, and
neither task uses what the other adds.

```json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: two library additions with no shipped fixtures to run",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
   "tasks": [
    {
     "id": "pricing-discount",
     "branch": "wave/pricing-discount",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["shop/pricing.py", "tests/test_pricing.py"],
      "files_forbidden": ["shop/constants.py", "shop/__init__.py"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_pricing", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing gross()"],
      "report_must_answer": ["Show discounted_gross and its tests."]
     }
    },
    {
     "id": "display-line",
     "branch": "wave/display-line",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["shop/display.py", "tests/test_display.py"],
      "files_forbidden": ["shop/constants.py", "shop/__init__.py"],
      "must_run": [
       { "cmd": "python3 -B -m unittest tests.test_display", "evidence": "required" }
      ],
      "forbidden_moves": ["weakening, deleting or skipping an existing test", "changing format_amount()"],
      "report_must_answer": ["Show format_line and its tests."]
     }
    }
   ]
  }
 ]
}
```

## Task pricing-discount

Add `discounted_gross(net, percent)` to `shop/pricing.py`.

1. It returns `gross(net * (1 - percent / 100))` — the existing `gross`
   applied to the discounted net price, so it reads `TAX_RATE` from
   `shop/constants.py` exactly as `gross` does. Leave `gross` unchanged.
2. In `tests/test_pricing.py`, add a `DiscountedGrossTest` class:
   `discounted_gross(10, 0) == gross(10)`, and
   `discounted_gross(10, 50) == gross(5)`. Do not modify `GrossTest`.

Read-only for this task: `shop/constants.py`, `shop/__init__.py`.

Base status: the `must_run` is green at base (`GrossTest` passes) and must
stay green with the new tests added.

## Task display-line

Add `format_line(label, amount)` to `shop/display.py`.

1. It returns `label + ": " + format_amount(amount)`, e.g.
   `format_line("Coffee", 3)` is `"Coffee: 3.00 EUR"` with the current
   `CURRENCY`. Leave `format_amount` unchanged.
2. In `tests/test_display.py`, add a `FormatLineTest` class asserting
   `format_line("Coffee", 3) == "Coffee: " + format_amount(3)`. Do not
   modify `FormatAmountTest`.

Read-only for this task: `shop/constants.py`, `shop/__init__.py`.

Base status: the `must_run` is green at base (`FormatAmountTest` passes)
and must stay green with the new test added.
