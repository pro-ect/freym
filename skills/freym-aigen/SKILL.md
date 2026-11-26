---
name: freym-aigen
description: Make GENERATION boards on the freym canvas (freym.app/canvas) with the `freym-aigen` CLI — prompts and reference images wired into model cards. Use it to compare models or set up a round of images or video on freym. Not for reviews, art-director picks or HTML pages: those go on a `freym` board (the freym.design CLI, old name `board`). Report any freym problem with `freym-aigen feedback`.
---

# freym-aigen

The `freym-aigen` CLI (it was `freym` until 2026-11-26) writes boards to the freym canvas (freym.app/canvas): the node canvas where
prompts and reference images are wired into model cards (Pika and fal models, paid in freym coins).
It uses the canvas's own code (`canvas/src/lib/nodes.ts`, `agentPlan.ts`), so a CLI board has the
same nodes, checks and layout as a board the canvas agent makes.

**Boards only.** The CLI never starts a model run and never spends coins. The user presses Run
(or "Run all") in the canvas.

## What it is for, and what it is not for

| the job | where |
|---|---|
| a round of generations: one prompt and the same references into several models; image → video chains | **freym-aigen** (this skill, the freym canvas) |
| a set of reference pictures to generate from | **freym-aigen**, wired into the model cards |
| an art-director review, options A/B to pick, a design review, screenshots with text, HTML pages | **`freym`** (the freym.design CLI, old name `board`: live pages, comments, picks by comment), never freym-aigen |

The freym canvas shows a picture in a node 300 units wide, with no comments. A screenshot of a
review card is not readable there, and the user cannot pick by comment.

**The user's words.** Since 2026-11-26 `freym` is the freym.design CLI (it was `board`; the old
name still works). "freym board", "on freym" or "via freym" means that CLI. So for review,
art-director, HTML or architecture work "on freym", use **`freym`** (`freym init`, `freym add`,
`freym serve`) and say so in one line. Do not upload screenshots to the freym canvas. Use this skill only when the job is a generation round.
A plan with no model card makes the CLI print a note about this.

## Setup (check once per session)

```bash
command -v freym-aigen || (cd ~/freym/canvas && npm run build:cli && npm link)
freym-aigen whoami    # the account and its coins; exit 4 = not signed in
```

No sign-in step on the owner's Mac: `~/.config/freym/owner` holds the owner's user id, and any
command signs in as the owner by itself (no browser) when no session exists. The session then
renews itself. Only if `whoami` still exits 4 (no Supabase CLI login in the keychain, or no
owner file), ask the user to type `! freym-aigen login` (Google sign-in in the browser).

## Workflow

1. **Pick models:** `freym-aigen models --kind image` or `--kind video`. Each line shows the slug, how
   many images the model takes, `frames` (start/end frames for video), the price and the params
   with their allowed values. aigen-director says which model for which job.
2. **Write a plan:** a JSON file with `ops`. `freym-aigen plan-help` prints the format:
   `add_text`, `add_image` (a local file or an https URL), `add_prompt`, `add_model` (slug and
   params), `connect` (a prompt, image or model into a model).
3. **Check it:** `freym-aigen check plan.json`. Fix every problem it lists, then check again. It also
   prints what one run of every model costs. Tell the user that number.
4. **Write it:** `freym-aigen new "<project> · <topic>" plan.json --open`. Give the user the URL.
   To add a round to a board: `freym-aigen show <board>` lists its nodes as n1, n2…; a plan can wire
   into them (`"from": "n3"`). Then `freym-aigen add <board> plan.json`.

Give no positions. The layout is automatic: titles on top, reference images in a column on the
left, then one row per prompt with the models it feeds. `freym-aigen add` puts the new block under
everything.

## Rules for a consistent board

- One title per block (a round, a question). Name the board `<project> · <topic>`.
- To compare models: wire the **same prompt** and the **same reference images** into every model,
  and set the same aspect ratio on each (`params`). One prompt per row.
- A chain (image → video): connect the image model's card to the video model's card; the video
  card goes to the right of its source.
- Never write a board that fails `freym-aigen check`. The CLI refuses anyway: any failed check means
  nothing is written.

## Privacy

- Uploaded reference images go to a **public** bucket (anyone with the URL can open them). Upload
  client or private material only after the user says yes in chat. Screenshots of a client's
  product or of a review page are client material. Auto mode does not make this question go away.
- No client names or private project details in prompts (the providers see them).

## Gotchas

- **An open canvas tab** saves its whole board and would drop nodes the CLI added. `freym-aigen add`
  refuses if the board changed since it read it; after an add, tell the user to reload the tab.
- `freym-aigen login` needs port 5173 free (the canvas dev server uses it).
- Text and music models (prompt writers, MiniMax Music) are not placed by the CLI yet.
- `freym-aigen share <board>` makes a read-only link (the user's board stays private otherwise).
- Exit codes: 1 a plan or usage problem, 2 not found, 3 network or IO, 4 sign-in. Every command
  takes `--json`.

## Report problems with freym-aigen itself

`freym-aigen feedback` is how freym gets fixed: the freym maintainer reads every report. Report a
problem the moment you meet it, then go on with a workaround. Do not wait for an answer.

**When to report** (one report per problem):

| what happened | kind |
|---|---|
| a command failed and you think freym-aigen is at fault (exit 3 or 4, a crash, a wrong result) | `bug` |
| **the user rejects or corrects a board you made with freym-aigen** ("wrong board", "not like this") | `bug`, `default` or `docs` |
| freym-aigen did what it says, but its default was wrong for the job (layout, a param, a price, a size) | `default` |
| a step took too long or did needless work | `slow` |
| you needed something freym-aigen cannot do (a node type, a command, a model) | `missing` |
| this skill or `freym-aigen help` sent you the wrong way, or left you to guess | `docs` |

A plan that fails `freym-aigen check` is not a report: fix the plan. Report only when the check is wrong.

**How:**

```bash
freym-aigen feedback bug "freym-aigen new: image upload fails with 'Payload too large' for a 12 MB PNG" --last
freym-aigen feedback default "images that feed no model stacked in one tall column; expected a grid"
freym-aigen feedback docs "the skill did not say that reviews belong on board, so I put screenshots on freym" \
  --details "user asked: show changes in artdirector mode via freym; I uploaded 11 screenshots"
```

- The summary is one line: what you did, what you expected, what happened.
- `--last` attaches the facts of the last failed freym-aigen command (arguments, exit code, error,
  problem list, build). Use it right after a failure.
- **Facts only.** No prompt text, no plan contents, no client names, no secrets, no screenshots.
  Say what kind of thing it was ("a 12 MB PNG", "a 9-image plan"), not what was in it.
- The same open summary counts up (3×) instead of a new row, so a repeat is useful: send it.
- The report goes to a local outbox first. If sign-in or the network fails, it waits and goes
  out with the next `freym-aigen feedback`. Exit code 0 means the report is safe.
- Tell the user in one line that you filed it (`filed #2fa421d8`).

## Where things are

- CLI source: `~/freym/canvas/cli/` (`freym.ts`, `plan.ts`, `session.ts`, `feedback.ts`); self-test
  `npm run test:cli`; build `npm run build:cli` (in `~/freym/canvas`).
- Session: `~/.config/freym/session.json` (mode 600, the user's own sign-in; RLS applies).
- `freym gen` (the freym.design CLI, old name `board`) is the other route: fal direct, results on a
  local board. Use freym-aigen when the user wants the work on the freym canvas, in freym coins.
