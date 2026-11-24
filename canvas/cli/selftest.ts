// npm run test:cli — offline checks of the shared node factories and the plan → board build.
import assert from "node:assert/strict";
import type { Node } from "@xyflow/react";
import { imageNode, modelToNode, textNode } from "../src/lib/nodes";
import type { CloudModel } from "../src/types";
import { CliError } from "./errors";
import { buildBoard, parsePlan } from "./plan";

const model = (slug: string, category: "image" | "video", max: number, schema: CloudModel["param_schema"] = null): CloudModel => ({
  slug, name: slug, description: null, category, tags: null, icon_url: null, coin_cost: 10,
  price_per_second_cents: null, rate_table: null, provider: "pika", reference_images_min: 0,
  reference_images_max: max, supports_prompt: true, image_parameter_name: "image_urls",
  is_new: false, is_featured: false, param_schema: schema,
});
const models = [
  model("img-a", "image", 4, { aspect_ratio: { type: "select", options: ["1:1", "16:9"], default: "1:1" } }),
  model("img-b", "image", 1),
  model("vid-a", "video", 1),
];
const strip = (n: Node) => ({ ...n, id: "x" });
let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

await check("factories give the nodes the canvas made inline before the move", () => {
  const pos = { x: 1, y: 2 };
  assert.deepEqual(strip(textNode("", pos)), { id: "x", type: "text", position: pos, data: { text: "", fontSize: 24 } });
  assert.deepEqual(strip(imageNode(null, pos)), { id: "x", type: "image", position: pos, data: { url: null } });
  const m = modelToNode(models[0], pos);
  assert.equal(m.type, "model");
  assert.deepEqual((m.data as { params: unknown }).params, { custom: { aspect_ratio: "1:1" } }, "schema defaults seed the params");
});

const plan = parsePlan(JSON.stringify({
  ops: [
    { op: "add_text", key: "t", text: "Title", size: 48 },
    { op: "add_image", key: "i1", src: "a.jpg" },
    { op: "add_image", key: "i2", src: "b.jpg" },
    { op: "add_prompt", key: "p1", text: "one" },
    { op: "add_prompt", key: "p2", text: "two" },
    { op: "add_model", key: "a", slug: "img-a", params: { aspect_ratio: "16:9" } },
    { op: "add_model", key: "b", slug: "img-b" },
    { op: "add_model", key: "v", slug: "vid-a" },
    { op: "connect", from: "p1", to: "a" }, { op: "connect", from: "p1", to: "b" },
    { op: "connect", from: "p2", to: "v" }, { op: "connect", from: "a", to: "v" },
    { op: "connect", from: "i1", to: "a" }, { op: "connect", from: "i2", to: "a" },
  ],
}));
const ratios: Record<string, number> = { "a.jpg": 16 / 9, "b.jpg": 1 };
const resolveImage = async (img: { src: string }) => ({ url: `https://example.test/${img.src}`, ratio: ratios[img.src] });
const boxOf = (n: Node) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? n.width ?? 300, h: n.measured?.height ?? n.height ?? (n.type === "model" ? 380 : n.type === "text" ? 70 : 320) });
const hit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

await check("a plan builds the same layout twice, with no overlaps and no draft look", async () => {
  const r1 = await buildBoard(plan, { nodes: [], edges: [], models, resolveImage });
  const r2 = await buildBoard(plan, { nodes: [], edges: [], models, resolveImage });
  assert.deepEqual(r1.nodes.map((n) => n.position), r2.nodes.map((n) => n.position), "same positions");
  assert.deepEqual(r1.counts, { titles: 1, images: 2, prompts: 2, models: 3, wires: 6 });
  for (const [i, a] of r1.nodes.entries())
    for (const b of r1.nodes.slice(i + 1)) assert.ok(!hit(boxOf(a), boxOf(b)), `${a.type} and ${b.type} overlap`);
  assert.ok(r1.nodes.every((n) => !n.className && !(n.data as { draft?: boolean }).draft), "no draft marks");
  assert.ok(r1.edges.every((e) => e.sourceHandle === "out" && e.targetHandle === "in"), "canvas handles");
  const a = r1.nodes.find((n) => (n.data as { slug?: string }).slug === "img-a")!;
  assert.deepEqual((a.data as { params: unknown }).params, { custom: { aspect_ratio: "16:9" } });
});

await check("adding under a board: the new block starts below every old node", async () => {
  const first = await buildBoard(plan, { nodes: [], edges: [], models, resolveImage });
  const bottom = Math.max(...first.nodes.map((n) => boxOf(n).y + boxOf(n).h));
  const more = await buildBoard(parsePlan('{"ops":[{"op":"add_prompt","key":"q","text":"x"},{"op":"add_model","key":"m","slug":"img-b"},{"op":"connect","from":"q","to":"m"}]}'), {
    nodes: first.nodes, edges: first.edges, models, resolveImage,
  });
  const added = more.nodes.filter((n) => more.created.includes(n.id));
  assert.ok(added.every((n) => n.position.y > bottom), "below everything");
});

await check("images that feed no model go in a grid of 4, above the references and the models", async () => {
  const ops: Record<string, unknown>[] = [{ op: "add_text", key: "t", text: "Set", size: 48 }];
  for (let i = 0; i < 6; i++) ops.push({ op: "add_image", key: `g${i}`, src: i % 2 ? "a.jpg" : "b.jpg" });
  ops.push({ op: "add_image", key: "ref", src: "b.jpg" }, { op: "add_prompt", key: "p", text: "x" }, { op: "add_model", key: "m", slug: "img-a" });
  ops.push({ op: "connect", from: "p", to: "m" }, { op: "connect", from: "ref", to: "m" });
  const r = await buildBoard(parsePlan(JSON.stringify({ ops })), { nodes: [], edges: [], models, resolveImage });
  const imgs = r.nodes.filter((n) => n.type === "image");
  const grid = imgs.slice(0, 6);
  const ref = imgs[6];
  assert.deepEqual(grid.slice(0, 4).map((n) => n.position.y), Array(4).fill(grid[0].position.y), "first row of 4");
  assert.deepEqual(grid.slice(0, 4).map((n) => n.position.x), [0, 360, 720, 1080], "columns 360 apart");
  assert.ok(grid[4].position.y > grid[0].position.y && grid[4].position.x === 0, "the fifth starts row 2");
  const gridBottom = Math.max(...grid.map((n) => boxOf(n).y + boxOf(n).h));
  assert.ok(ref.position.y > gridBottom, "the reference column starts under the grid");
  const m = r.nodes.find((n) => n.type === "model")!;
  assert.ok(m.position.y > gridBottom, "the model row starts under the grid");
  for (const [i, a] of r.nodes.entries())
    for (const b of r.nodes.slice(i + 1)) assert.ok(!hit(boxOf(a), boxOf(b)), `${a.type} and ${b.type} overlap`);
});

await check("every problem comes back at once, and nothing is built", async () => {
  const bad = parsePlan(JSON.stringify({
    ops: [
      { op: "add_model", key: "b", slug: "img-b" },
      { op: "add_image", key: "i", src: "a.jpg" },
      { op: "add_image", key: "j", src: "b.jpg" },
      { op: "connect", from: "i", to: "b" }, { op: "connect", from: "j", to: "b" },
      { op: "add_model", key: "x", slug: "nope" },
      { op: "add_model", key: "a", slug: "img-a", params: { aspect_ratio: "7:3" } },
      { op: "frobnicate" },
    ],
  }));
  await assert.rejects(buildBoard(bad, { nodes: [], edges: [], models, resolveImage }), (e: unknown) => {
    const p = (e as CliError).details as string[];
    assert.ok(p.some((s) => s.includes('unknown model "nope"')), "unknown slug");
    assert.ok(p.some((s) => s.includes("unknown op")), "unknown op");
    assert.ok(p.some((s) => s.includes("at most 1 image")), "ref cap");
    assert.ok(p.some((s) => s.includes('no option "7:3"')), "bad param value");
    return true;
  });
});

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
