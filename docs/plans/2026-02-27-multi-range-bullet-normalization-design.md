# Design: Multi-Range Bullet Point Normalization Fix

Date: 2026-02-27

## Problem

When a quoth embed has multiple ranges and the source content is from a bullet-point line, the rendered output is broken unless the `join` value contains a newline. With the default join of `" ... "`, bullet markers from each fragment are left stranded mid-string.

**Example that breaks:**
```quoth
path: [[Daily 2026-02-27#Friday 27th February 2026]]
ranges: 6:99 to 6:111, " uri like " to ":https://g"
```

**Root cause:**

1. `extractRangeWithContext` prepends `linestart` tokens (e.g. `- `) to each fragment based on the content of the line up to the selection start.
2. Multiple ranges from the same bullet-point line each receive their own `- ` prefix.
3. The fragments are joined with `embed.join` (default `" ... "`, no newline).
4. `normalizeMarkdown` is then called on the full joined string. It splits on `\n`, sees one line, strips only the *first* leading `- `, leaving the second `- ` stranded inline.

**Why newline joins work today:** Each fragment ends up on its own line after joining. `normalizeMarkdown` sees multiple lines, correctly keeps the bullet markers, and the result renders as a proper bullet list.

## Design

Apply a hybrid normalization strategy conditioned on whether `embed.join` contains a newline character.

### When `embed.join` contains `\n`

Keep current behavior:
1. Extract all fragments via `extractRangeWithContext`.
2. Join them with `embed.join`.
3. Call `normalizeMarkdown` on the full joined string.

This preserves correct bullet-list rendering when fragments are newline-separated.

### When `embed.join` does not contain `\n`

Apply per-fragment normalization (Option C):
1. For each range: extract via `extractRangeWithContext`, then immediately call `normalizeMarkdown` on that single fragment.
2. Join the already-normalized fragments with `embed.join`.
3. Do **not** call `normalizeMarkdown` again on the joined result.

Per-fragment normalization means each fragment is treated as a standalone piece of content. `normalizeMarkdown` on a single-line bullet fragment strips the leading `- ` correctly every time.

### No-ranges path

Unchanged: `normalizeMarkdown` is called once on the full file/subpath text.

## Changes Required

All changes are confined to `src/processors/processor.ts`, specifically in `assembleQuote`.

The conditional blocks are restructured so that:
- The multi-range markdown path branches on `embed.join.includes("\n")`.
- The outer unconditional `normalizeMarkdown(quote)` call is folded into each branch rather than sitting outside, so the per-fragment path can skip it.

No changes to `extractRangeWithContext`, `normalizeMarkdown`, or any other file.

## Testing

Add test cases to `src/processors/markdown.test.ts` (or a new processor test) covering:
- Multi-range from a bullet-point line with non-newline join → no stray `- ` markers.
- Multi-range from a bullet-point line with newline join → renders as bullet list (existing behavior preserved).
- Single-range from a bullet-point line → unchanged behavior.
