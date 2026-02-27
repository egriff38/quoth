# Multi-Range Bullet Normalization Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix multi-range quoth embeds sourced from bullet-point lines so they render correctly when joined without a newline.

**Architecture:** When `embed.join` contains a newline, keep the current pipeline (extract all → join → `normalizeMarkdown` once). When `embed.join` does not contain a newline, normalize each extracted fragment individually before joining. All changes are in `src/processors/processor.ts`'s `assembleQuote` function; no other files change.

**Tech Stack:** TypeScript, Jest (test runner: `npx jest --maxWorkers=1`)

---

### Task 1: Add failing test for multi-range bullet normalization

**Files:**
- Modify: `src/processors/markdown.test.ts` (append after existing `normalizeMarkdown` describe block)

**Step 1: Write the failing test**

The test lives in `markdown.test.ts` because `normalizeMarkdown` and `extractRangeWithContext` are what we're testing in combination. Add a new `describe` block at the bottom of the file:

```typescript
describe("multi-range normalization (per-fragment)", () => {
  it("strips bullet prefix from each fragment when joining without newline", () => {
    const text = "- Alias matching the original link, plus additional aliases for other abbreviated forms\n- Content construction based on the second part of the URI";
    const range1 = new WholeString("Alias matching");
    const range2 = new WholeString("Content construction");
    const join = " ... ";

    const fragments = [range1, range2].map((r) =>
      normalizeMarkdown(extractRangeWithContext(text, r))
    );
    const result = fragments.join(join);

    expect(result).toBe("Alias matching ... Content construction");
  });

  it("preserves bullet prefix from each fragment when joining with newline", () => {
    const text = "- Alias matching the original link, plus additional aliases for other abbreviated forms\n- Content construction based on the second part of the URI";
    const range1 = new WholeString("Alias matching");
    const range2 = new WholeString("Content construction");
    const join = "\n";

    // Current (unmodified) pipeline: extract all, join, normalize once
    const raw = [range1, range2]
      .map((r) => extractRangeWithContext(text, r))
      .join(join);
    const result = normalizeMarkdown(raw);

    expect(result).toBe("- Alias matching\n- Content construction");
  });
});
```

Note: `WholeString` is already imported at the top of the file. You do not need to add any imports.

**Step 2: Run tests to verify the new tests pass**

The tests above are pure unit tests on functions that already exist; they should **pass already** because they directly test the composition strategy, not the processor. This confirms the logic is sound before we wire it into the processor.

```bash
npx jest --maxWorkers=1 src/processors/markdown.test.ts
```

Expected: All tests PASS (the new tests encode the correct composition — they will pass because they already call `normalizeMarkdown` per-fragment or per-joined-string directly).

**Step 3: Commit**

```bash
git add src/processors/markdown.test.ts
git commit -m "test: add multi-range bullet normalization unit tests"
```

---

### Task 2: Restructure `assembleQuote` in `processor.ts`

**Files:**
- Modify: `src/processors/processor.ts:57-77`

**Context:** The current relevant section of `assembleQuote` looks like this (lines 57–77):

```typescript
let quote: string;
if (embed.ranges.length > 0) {
  if (file.extension.toLowerCase() == "md") {
    quote = embed.ranges
      .map((r) => extractRangeWithContext(text, r))
      .join(embed.join);
  } else {
    quote = embed.ranges
      .map((r) => {
        const { start, end } = r.indexes(text);
        return text.slice(start, end);
      })
      .join(embed.join);
  }
} else {
  quote = text;
}

if (file.extension.toLowerCase() == "md") {
  quote = normalizeMarkdown(quote);
}
```

**Step 1: Restructure the markdown multi-range branch**

Replace the entire block above with:

```typescript
let quote: string;
if (embed.ranges.length > 0) {
  if (file.extension.toLowerCase() == "md") {
    if (embed.join.includes("\n")) {
      quote = normalizeMarkdown(
        embed.ranges
          .map((r) => extractRangeWithContext(text, r))
          .join(embed.join)
      );
    } else {
      quote = embed.ranges
        .map((r) => normalizeMarkdown(extractRangeWithContext(text, r)))
        .join(embed.join);
    }
  } else {
    quote = embed.ranges
      .map((r) => {
        const { start, end } = r.indexes(text);
        return text.slice(start, end);
      })
      .join(embed.join);
  }
} else {
  quote = text;
}

if (file.extension.toLowerCase() == "md") {
  quote = normalizeMarkdown(quote);
}
```

Wait — there is a subtlety: the outer `if (file.extension.toLowerCase() == "md") { quote = normalizeMarkdown(quote); }` block still runs after. For the **new** per-fragment path (no-newline join), we've already normalized each fragment. Running `normalizeMarkdown` again on the joined result is harmless for plain text joins like `" ... "` (it won't find any markdown structures to strip), but to be precise we should avoid it.

Replace the entire block above with this cleaner version that inlines `normalizeMarkdown` into the branches and removes the trailing unconditional call for the multi-range markdown cases:

```typescript
let quote: string;
if (embed.ranges.length > 0) {
  if (file.extension.toLowerCase() == "md") {
    if (embed.join.includes("\n")) {
      quote = normalizeMarkdown(
        embed.ranges
          .map((r) => extractRangeWithContext(text, r))
          .join(embed.join)
      );
    } else {
      quote = embed.ranges
        .map((r) => normalizeMarkdown(extractRangeWithContext(text, r)))
        .join(embed.join);
    }
    // normalizeMarkdown already applied in both branches above
  } else {
    quote = embed.ranges
      .map((r) => {
        const { start, end } = r.indexes(text);
        return text.slice(start, end);
      })
      .join(embed.join);
  }
} else {
  quote = text;
  if (file.extension.toLowerCase() == "md") {
    quote = normalizeMarkdown(quote);
  }
}

// non-md range path does not call normalizeMarkdown (unchanged)
if (embed.ranges.length > 0 && file.extension.toLowerCase() !== "md") {
  // already set above, nothing to do
}
```

Actually, the cleanest approach is to simply inline `normalizeMarkdown` where needed and restructure the extension check. Here is the exact final replacement for lines 57–77 of `src/processors/processor.ts`:

```typescript
let quote: string;
if (embed.ranges.length > 0) {
  if (file.extension.toLowerCase() == "md") {
    if (embed.join.includes("\n")) {
      quote = normalizeMarkdown(
        embed.ranges
          .map((r) => extractRangeWithContext(text, r))
          .join(embed.join)
      );
    } else {
      quote = embed.ranges
        .map((r) => normalizeMarkdown(extractRangeWithContext(text, r)))
        .join(embed.join);
    }
  } else {
    quote = embed.ranges
      .map((r) => {
        const { start, end } = r.indexes(text);
        return text.slice(start, end);
      })
      .join(embed.join);
  }
} else {
  quote = text;
  if (file.extension.toLowerCase() == "md") {
    quote = normalizeMarkdown(quote);
  }
}
```

This removes the trailing unconditional `normalizeMarkdown` call and handles all four cases:
1. Multi-range markdown, join has newline → normalize after joining (current behavior)
2. Multi-range markdown, join no newline → normalize per fragment (new fix)
3. Multi-range non-markdown → no normalize (unchanged)
4. No ranges → normalize full text if markdown (unchanged)

**Step 2: Check for TypeScript errors**

```bash
npx tsc --noEmit
```

Expected: No errors.

**Step 3: Run the full test suite**

```bash
npx jest --maxWorkers=1
```

Expected: All tests PASS.

**Step 4: Commit**

```bash
git add src/processors/processor.ts
git commit -m "fix: normalize each fragment individually for multi-range non-newline joins"
```

---

### Task 3: Manual smoke test in Obsidian

This task cannot be automated. Load the plugin in Obsidian and open `Daily 2026-02-27.md`. Verify:

1. **"Quoth breaks (bullet point)"** block now renders the two fragments joined cleanly without a stray `- ` marker.
2. **"Quoth works (newline)"** block still renders as a bullet list (two bullet items).
3. **"Quoth works (not from a bullet point)"** block is unaffected.

If all three look correct, the fix is complete.
