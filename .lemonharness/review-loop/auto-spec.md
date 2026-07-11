# Investigation Results — Review Loop Skill

## Issue
The `/review-loop` command starts the review loop but never produces useful reviews. Every cycle reports "0 findings" and the loop terminates prematurely with "diminishing returns reached."

## Root Cause

The critical bug is in `.pi/extensions/lemonharness/integration-review-loop.ts`.

When the reviewer delegate completes, the handler takes `revResult.summary` (a one-line text summary from the delegate's `=== DELEGATE RESULT ===` section) and passes it to `processReview()`. The `processReview()` method calls `parseReviewJson()` which tries to parse this text as a structured JSON review. Since the summary is just a short text sentence, it cannot be parsed as JSON, and the method falls back to creating a default review with 0 findings.

Additionally, `parseReviewJson()` has a `extractSeverityFromText()` fallback, but the summary text is too short and lacks severity keywords, so even the fallback extraction produces no findings.

## The Fix Applied

1. **`integration-review-loop.ts`**: After the reviewer delegate completes, try to read the `review.json` file from the cycle directory (`.lemonharness/review-loop/cycle-{n}/review.json`). The reviewer task instructs the delegate to write this file. If the file exists and is valid JSON, use its content as the review output. Fall back to the delegate's full output text, then to the summary text.

2. **`review-loop.ts` (`buildReviewerTask`)**: Updated the reviewer task to explicitly instruct the reviewer to:
   - Write the review JSON to the file using `workspace_write`
   - ALSO include the full JSON content in the response text before the `=== DELEGATE RESULT ===` marker
   - Include the file path in the `FILES` field of the result section

3. **`review-loop.ts` (`buildImplementerTask`)**: Added explicit instruction to use `workspace_write` for all file changes.

## Secondary Concerns

The delegate runner (`.lemonharness/delegate-runner.mjs`) spawns `pi -p` as a subprocess. The previous review cycle run (at 19:09) showed the delegate runner produced only log lines without the pi output, suggesting potential issues with the `pi -p` subprocess invocation. This may need further investigation if the above fixes don't resolve the issue.
