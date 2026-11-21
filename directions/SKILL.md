---
name: freym-directions
description: Which AI generation models to use for which job, and in what order (freym's directions layer). Load it whenever someone asks for a video, a hero video, a background loop, an animation, "animate this", a generated image or key visual, product shots, or "which model should I use", in any project. It holds Eugene's recipe "video from nothing" (3 key images on 3 named models → the user picks → 2 animations on 2 named models → the user picks) and model notes learned from real runs. Use it together with the `board` CLI when a board is set up.
---

# freym directions

This is Eugene's standing knowledge about generation, written so every project uses the same
choices. It is **directions, not code**:
- The tools that run the models are `board gen` (fal direct) and the freym canvas (Pika).
- This file says **which model, for which job, and in which order**.
- Model facts (endpoints, prices, strengths, limits) are in `models.md` in this folder. Read it before
  you pick a model, and update it after real runs.

## Rules for every generation job

1. **Budget first.** Set a cap (`board budget <usd>`) and tell the user the estimate before paid
   calls. Prices in `models.md` are estimates until you compare them with the fal dashboard.
2. **Use the models named here.** If one is missing or broken, stop and ask the user. A fallback is a
   note for that run, not a change to this recipe.
3. **The user picks between steps.** Do not animate before the user picks the image. On a board, the
   user picks with a comment on the node, and you post your ★ pick with one design reason
   (`board note <node> "★ … because …"`).
4. **Privacy:** no client name or private project details in prompts sent to model providers.
5. **Prompts come from a brief.** Research first, then one concept and one shared prompt. The same
   prompt goes to every model in a step, so the comparison is fair.

## Recipe: video from nothing

Use it for a hero video, a background loop, a product loop or an animated key visual.

| step | what | models | output |
|---|---|---|---|
| 0 | Brief: research the subject, write 1 concept and 1 prompt | — | `brief.md` |
| 1 | **Key images ×3**: the same prompt, 16:9, 2K | **Nano Banana 2.1**, **GPT Image 2.6 Sunburst**, **Seedream 5.5** | 3 image nodes in one row |
| 2 | ★ note on your pick; **the user picks** | — | a comment on the chosen node |
| 3 | **Animations ×2** from the picked image, 6 s, slow camera | **FLUX 3 Max** (good, cheap, very fast), **MiniMax H3** | 2 video nodes |
| 4 | ★ note; **the user picks**; then build (hero, site, ad) | — | the chosen video |

Commands (board):

```bash
board budget 10
board gen image --model nano-banana-2.1        --prompt-file prompt.txt --title "Key · nano-banana-2.1" --x 0    --y 3000
board gen image --model gpt-image-2.6-sunburst --prompt-file prompt.txt --title "Key · gpt-image-2.6"   --x 1040 --y 3000
board gen image --model seedream-5.5           --prompt-file prompt.txt --title "Key · seedream-5.5"    --x 2080 --y 3000
# after the pick (node n_xxxx):
board gen video --model flux-3-max --from n_xxxx --end same --duration 6 --prompt-file motion.txt
board gen video --model minimax-h3 --from n_xxxx --end same --duration 6 --prompt-file motion.txt
```

### Motion prompts for a loop

- **Plan for a seamless loop:**
  - One slow camera move (a push-in, a drift or an orbit of a few degrees).
  - No cuts and no new objects.
  - Light that does not change.
  - Use `--end same`, so the last frame equals the first.
  - With `--end same` the move must **return**: "eases in and back out", "drifts left and back". A
    one-way push-in or orbit cannot end on its first frame, and the model then jumps or stalls.
- **Say what moves and how slowly:** "particles drift slowly", "a gentle parallax". Do not write "dynamic",
  "fast" or "explosion" for a background loop.
- **A hero video sits under text.** Keep a calm zone for the headline and avoid strobing highlights.
- **Turn audio off** (`generate_audio: false`); a hero video autoplays muted anyway.

### FPV variant (Eugene liked it, 2026-11-21)
- A drone-like flight through the subject ("first-person FPV drone flight … threading through the gaps
  … soft motion blur"), 8 s, FLUX 3 Max.
- It loops too: with `--end same`, a field of repeating objects lets the flight "arrive" back at the
  opening view, like an infinite zoom (seam 33.8 dB in the first test).

## Recipe: logo

Eugene's order: **marks first, type separately, then combine (or keep type only).**

1. **Marks only**, 5–7 of them, with no letters ("Logo symbol only: no letters, no text"):
   - Engines: **Recraft V4 vector** (`recraft-4-vector`, $0.08, SVG) and **QuiverAI**
     (needs `~/.config/quiverai/key`).
   - Give the palette with `--colors`.
   - Cover both directions: evolve the current logo's idea, and new symbols from the product or
     science.
2. **Type separately:** the name set in 4–6 open-source families from **typedump.com**, as one HTML
   card sheet with 16 px / 11 px tests. AI logo models warp letters, so the name is always real type.
3. **The user picks** a mark (or none) and a type, then build the lockups: mark + type in 2–3
   arrangements, or type only.
4. Every mark gets an art-director note: concept, legibility at 16 px, cliché risk. For science
   brands, also check that the symbol is true to the science.
5. **Vector wordmark: do not trust opentype.js kerning.**
   - opentype.js 1.3.4 does not read most fonts' GPOS kerning, and `getKerningValue` returns 0.
     On Instrument Sans this lost V–a −81 and a–V −83, so the V floated away from its neighbours.
   - Measure the real pair kerning with the browser (canvas `measureText` of a pair minus its two
     letters, `fontKerning = "normal"`), store it in `kerning.json`, and build from that.
   - Give the user a kerning tool (one slider per pair, on top of the font's kerning) for optical
     fixes. TheraVac reference: `~/theravac/logo/kerning-tool.html` + `build-wordmark.mjs`.

## Where it runs

- `board gen`: fal direct, key in `~/.config/fal/key`, aliases in `~/board/src/gen.ts`.
- freym canvas (freym.app/canvas): the same model families through Pika. Prices and slugs are in
  freym's `models` / `model_pricing` tables.
