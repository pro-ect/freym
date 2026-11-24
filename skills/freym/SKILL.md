---
name: freym
description: Make boards on the freym canvas (freym.app/canvas) from any project with the `freym` CLI — titles, reference images, prompts and model cards wired together, checked like the canvas agent checks them. Use it when someone asks for a freym board, to "put this on freym", to compare models on freym, or for a node board of generations.
---

# freym

The `freym` CLI writes boards to the freym canvas (freym.app/canvas): the node canvas where
prompts and reference images are wired into model cards (Pika and fal models, paid in freym coins).
It uses the canvas's own code (`canvas/src/lib/nodes.ts`, `agentPlan.ts`), so a CLI board has the
same nodes, checks and layout as a board the canvas agent makes.

**Boards only.** The CLI never starts a model run and never spends coins. The user presses Run
(or "Run all") in the canvas.

## Setup (check once per session)

```bash
command -v freym || (cd ~/freym/canvas && npm run build:cli && npm link)
freym whoami    # the account and its coins; exit 4 = not signed in
```

No sign-in step on the owner's Mac: `~/.config/freym/owner` holds the owner's user id, and any
command signs in as the owner by itself (no browser) when no session exists. The session then
renews itself. Only if `whoami` still exits 4 (no Supabase CLI login in the keychain, or no
owner file), ask the user to type `! freym login` (Google sign-in in the browser).

## Workflow

1. **Pick models:** `freym models --kind image` or `--kind video`. Each line shows the slug, how
   many images the model takes, `frames` (start/end frames for video), the price and the params
   with their allowed values. aigen-director says which model for which job.
2. **Write a plan:** a JSON file with `ops`. `freym plan-help` prints the format:
   `add_text`, `add_image` (a local file or an https URL), `add_prompt`, `add_model` (slug and
   params), `connect` (a prompt, image or model into a model).
3. **Check it:** `freym check plan.json`. Fix every problem it lists, then check again. It also
   prints what one run of every model costs. Tell the user that number.
4. **Write it:** `freym new "<project> · <topic>" plan.json --open`. Give the user the URL.
   To add a round to a board: `freym show <board>` lists its nodes as n1, n2…; a plan can wire
   into them (`"from": "n3"`). Then `freym add <board> plan.json`.

Give no positions. The layout is automatic: titles on top, reference images in a column on the
left, then one row per prompt with the models it feeds. `freym add` puts the new block under
everything.

## Rules for a consistent board

- One title per block (a round, a question). Name the board `<project> · <topic>`.
- To compare models: wire the **same prompt** and the **same reference images** into every model,
  and set the same aspect ratio on each (`params`). One prompt per row.
- A chain (image → video): connect the image model's card to the video model's card; the video
  card goes to the right of its source.
- Never write a board that fails `freym check`. The CLI refuses anyway: any failed check means
  nothing is written.

## Privacy

- Uploaded reference images go to a **public** bucket (anyone with the URL can open them). Upload
  client or private material only after the user says yes.
- No client names or private project details in prompts (the providers see them).

## Gotchas

- **An open canvas tab** saves its whole board and would drop nodes the CLI added. `freym add`
  refuses if the board changed since it read it; after an add, tell the user to reload the tab.
- `freym login` needs port 5173 free (the canvas dev server uses it).
- Text and music models (prompt writers, MiniMax Music) are not placed by the CLI yet.
- `freym share <board>` makes a read-only link (the user's board stays private otherwise).
- Exit codes: 1 a plan or usage problem, 2 not found, 3 network or IO, 4 sign-in. Every command
  takes `--json`.

## Where things are

- CLI source: `~/freym/canvas/cli/` (`freym.ts`, `plan.ts`, `session.ts`); self-test
  `npm run test:cli`; build `npm run build:cli` (in `~/freym/canvas`).
- Session: `~/.config/freym/session.json` (mode 600, the user's own sign-in; RLS applies).
- `board gen` (the board CLI) is the other route: fal direct, results on a local board. Use freym
  when the user wants the work on the freym canvas, in freym coins.
