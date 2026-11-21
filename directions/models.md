# Model notes (freym directions)

Facts from checks and real runs. "fal price" is from fal's pricing API (`GET api.fal.ai/v1/models/pricing`);
token-billed models show only "units" there, so their cost is an estimate until the dashboard shows it.
Update this file after every real run: what worked, what broke, the real cost.

Checked 2026-11-21: all five endpoints exist (public OpenAPI schema answers 200).

## Images

| model | board alias | fal endpoint | Pika in freym | fal price | key inputs |
|---|---|---|---|---|---|
| Nano Banana 2.1 | `nano-banana-2.1` | `google/nano-banana-2.1` | `nb21-pika` | token-billed (estimate ~$0.10 at 2K) | aspect_ratio (16:9 …), resolution 1K/2K/4K, thinking_level |
| GPT Image 2.6 Sunburst | `gpt-image-2.6-sunburst` | `openai/gpt-image-2.6/sunburst/text-to-image` | `gpt-image-26-sunburst-pika` | token-billed (estimate ~$0.25 at high) | image_size enum (landscape_16_9 …), quality low…max, reasoning_effort |
| Seedream 5.5 | `seedream-5.5` | `bytedance/seedream/v5.5/text-to-image` | `seedream-55-pika` | $0.03 per image (1K); ~$0.04 at 2K | image_size {width,height} or enum |

## Image to video

| model | board alias | fal endpoint | Pika in freym | fal price | key inputs |
|---|---|---|---|---|---|
| FLUX 3 Max | `flux-3-max` | `blackforestlabs/flux-3-max/image-to-video` | — (fal only) | $0.0425/s (720p); ~$0.0725/s at 1080p (promo rates, may rise) | image_url, **end_image_url**, duration 5–20, resolution 720p/1080p/2K/4K, generate_audio (default **on**, turn off) |
| MiniMax H3 | `minimax-h3` | `minimax/h3/image-to-video` | `minimax-h3-i2v-pika` | $0.05/s (768P); 2K estimated ~$0.10/s | image_url, **end_image_url**, duration, resolution 480P/768P/2K/4K, prompt_expansion_mode |

Both video models take an end frame, so `--end same` gives a seamless loop.

## Learned from runs

_(Fill in after each run: date, project, model, what the result was good or bad at, real cost.)_

### 2026-11-21 · biotech hero key image (macro VLP particle, light, 16:9)
- **GPT Image 2.6 Sunburst**, 28 s, est. ~$0.25: the clearest structure (geodesic facets, regular
  pattern), brand colours held well. ★ for the scientific look. **`image_size: landscape_16_9` gives
  only 1088×608**: for a 2K still, pass `{width, height}` instead.
- **Seedream 5.5**, 15 s, est. ~$0.045: 2560×1440 as asked, very regular array, bright and clean.
  It turned "peptide strands" into Y-shapes that read as antibodies. The cheapest and the fastest.
- **Nano Banana 2.1**, 22 s, est. ~$0.10: 2752×1536 at `resolution: 2K`. Good composition, but its
  "particle with strands" became a spiky, corona-like virus. Avoid this look for vaccine or biotech
  brands.
