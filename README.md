![OneFlow icon](assets/icon.png)

# OneFlow

OneFlow turns the dreaded “status update” into a one-click performance—and it is ready to grow into blog automation, custom flows, and whatever repetitive storytelling you want to retire. Point it at your work-in-progress tab, tap a quick action, and let the extension collect context, reason with Chrome’s Prompt API, and file a polished update that makes you look effortlessly on top of things.

## Highlights

- **Daily dev debrief** – Understand the ticket, capture what matters, and spin it into a shine-worthy async update (draft PR copy included).
- **Weekly highlight reel** – Roll seven days of recaps into a leadership-ready briefing without rereading a single doc.
- **Blog research capture** – Clip any article and auto-extract summaries, tags, key insights, technical angles, writing directions, and the source link for your next post.
- **Future-ready workflows** – The same automation engine can power blog posts, changelog blurbs, or bespoke multi-step flows as you extend the presets.
- **Automation timeline** – Watch each action report in as the workflow runs, with optional debug crumb trails for deep dives.
- **Result stash & viewer** – Every run is archived, searchable, and viewable in a dedicated tab complete with Markdown export.

## How to Run It

```bash
pnpm install
pnpm dev
```

Then load `build/chrome-mv3-dev` as an unpacked extension in Chrome. The popup hot-reloads while `pnpm dev` is running.

### Debug Mode

- `pnpm run dev:debug` flips on verbose traces and richer timeline metadata.
- In the popup console, run `window.__AUTO_BORING_DEBUG__ = true` to toggle debug mode at runtime.

## Automated Workflows

1. **Daily dev debrief** (`daily-dev`)
	- Reads the active tab (or uses sample notes) and normalizes the content.
	- Generates JSON structured insights (summary, highlights, blockers, next focus, action items).
	- Drafts pull request copy: title, body, potential regressions, and blast radius.
	- Persists the recap for later rollups.
2. **Weekly highlight reel** (`weekly-summary`)
	- Collects recent daily recaps from storage.
	- Synthesizes an exec-friendly weekly brief with per-day breakdowns.
	- Stashes the result so you can download or share it on demand.
3. **Blog research capture** (`blog-draft`)
	- Reads a page or supplied text to gather source material.
	- Uses the blog prompt action to structure summaries, tags, key insights, technical highlights, narrative directions, and supporting links (including the original URL).
	- Stores the JSON artifact (`blog-research-note`) for future drafting or sharing.

## Testing & Quality Gates

```bash
pnpm test
```

The Vitest suite exercises end-to-end workflow execution, action fallbacks, structured prompt normalization (including the pull-request draft helper), storage persistence, and workflow-manager queueing.

## Production Builds

```bash
pnpm build
```

This emits ready-to-zip bundles under `build/`. Pair it with Plasmo’s packaging workflow (`pnpm package`) when you’re ready to ship.

## Contributing Tips

- Keep new actions focused: return `{ success, output, meta }` and stash viewer-ready data when possible.
- Update `lib/automation/presets.ts` and `popup.tsx` together so the UI copy always matches the underlying workflow.
- Extend the Vitest suite alongside new automation logic—tests run fast enough for every PR.

Now go automate the boring parts so the fun work can actually be fun.
