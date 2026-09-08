import type { Node } from "@xyflow/react";
import DurationControl from "./DurationControl";
import { patchNodeData, type ModelNodeData, type ParamField, type ParamSchema } from "../types";
import { usd } from "../lib/balance";
import { estimateCoins } from "../lib/pricing";
import { resolveInputs, describeCaps } from "../lib/inputMode";

const ASPECTS = ["default", "1:1", "9:16", "16:9", "4:5", "3:4", "3:2"];

const labelFor = (key: string, field: ParamField) =>
  field.label ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Where each aspect ratio is used — shown next to the value so picking the
 *  format for a platform needs no guesswork. */
const RATIO_HINTS: Record<string, string> = {
  "9:16": "TikTok · Reels · Shorts",
  "16:9": "YouTube · landscape",
  "1:1": "square feed post",
  "4:5": "Instagram feed",
  "4:3": "classic TV",
  "3:4": "portrait",
  "21:9": "cinematic wide",
  adaptive: "follow the image",
  auto: "let the model choose",
};
function optionLabel(key: string, o: string | number): string {
  const v = String(o);
  if (key !== "ratio" && key !== "aspect_ratio") return v;
  const hint = RATIO_HINTS[v];
  return hint ? `${v} — ${hint}` : v;
}

export default function PropertiesPanel({
  nodes,
  onRun,
  onClose,
}: {
  nodes: Node[];
  onRun: (models: Node[]) => void;
  onClose?: () => void;
}) {
  const models = nodes.filter((n) => n.type === "model");
  if (!models.length) return null;

  const many = models.length > 1;
  const first = models[0].data as unknown as ModelNodeData;
  const running = models.some((n) => (n.data as unknown as ModelNodeData).status === "running");

  const dataOf = (n: Node) => n.data as unknown as ModelNodeData;

  const patchAll = (params: Partial<ModelNodeData["params"]>) =>
    models.forEach((n) => patchNodeData(n.id, { params: { ...dataOf(n).params, ...params } }));

  // Schema-driven values write to every selected model that has the same key,
  // so a mixed selection only picks up the controls it actually understands.
  const setCustom = (key: string, value: unknown) =>
    models.forEach((n) => {
      const d = dataOf(n);
      if (!d.paramSchema?.[key]) return;
      patchNodeData(n.id, { params: { ...d.params, custom: { ...d.params?.custom, [key]: value } } });
    });

  // With a multi-selection show only controls every selected model shares.
  const schema: ParamSchema = Object.fromEntries(
    Object.entries(first.paramSchema ?? {}).filter(
      ([key, field]) =>
        models.every((n) => dataOf(n).paramSchema?.[key]) &&
        (field.showWhen !== "hasImages" || models.every((n) => dataOf(n).maxRefImages > 0)),
    ),
  );
  const schemaKeys = Object.keys(schema);

  const valueOf = (key: string) => first.params?.custom?.[key] ?? schema[key].default;

  const names = [...new Set(models.map((n) => dataOf(n).modelName))];
  const totalCoins = models.reduce((sum, n) => sum + (estimateCoins(dataOf(n)) ?? 0), 0);

  return (
    <aside className="fc-props">
      <div className="fc-props-title">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        {many ? `${models.length} models` : first.modelName}
        {totalCoins > 0 && <span className="fc-cost">{usd(totalCoins)}</span>}
        {onClose && (
          <button className="fc-panel-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      {many && <div className="fc-hint">{names.join(" · ")}</div>}

      {schemaKeys.map((key) => {
        const field = schema[key];
        const value = valueOf(key);

        if (field.type === "note") {
          // Read-only fact (e.g. a vendor-fixed duration); never sent to the provider.
          return (
            <div key={key} className="fc-field">
              <span>{labelFor(key, field)}</span>
              <em className="fc-field-desc">{field.description}</em>
            </div>
          );
        }

        // Seconds feel better on a slider — with a number box for typing. Only
        // the schema's allowed values are ever written (billing + API safety).
        if (
          field.type === "select" &&
          /duration/i.test(key) &&
          (field.options ?? []).every((o) => Number.isFinite(Number(o))) &&
          (field.options ?? []).length > 1
        ) {
          return (
            <DurationControl
              key={key}
              label={labelFor(key, field)}
              options={(field.options ?? []).map(Number)}
              value={Number(value ?? field.default ?? 0)}
              onChange={(n) => setCustom(key, n)}
            />
          );
        }

        if (field.type === "text") {
          return (
            <label key={key} className="fc-field">
              <span>{labelFor(key, field)}</span>
              {field.description && <em className="fc-field-desc">{field.description}</em>}
              <textarea
                className="fc-field-text"
                rows={5}
                value={String(value ?? "")}
                placeholder={field.label ? `${field.label}…` : undefined}
                onChange={(e) => setCustom(key, e.target.value || undefined)}
              />
            </label>
          );
        }
        if (field.type === "boolean") {
          return (
            <label key={key} className="fc-field fc-field-row">
              <span>{labelFor(key, field)}</span>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => setCustom(key, e.target.checked)}
              />
            </label>
          );
        }

        if (field.type === "number" || field.type === "slider") {
          return (
            <label key={key} className="fc-field">
              <span>
                {labelFor(key, field)}{" "}
                <em className="fc-field-val">{value === undefined ? "auto" : String(value)}</em>
              </span>
              {field.description && <em className="fc-field-desc">{field.description}</em>}
              <input
                type="range"
                min={field.min ?? 0}
                max={field.max ?? 10}
                step={field.step ?? 1}
                value={Number(value ?? field.min ?? 0)}
                onChange={(e) => setCustom(key, Number(e.target.value))}
              />
            </label>
          );
        }

        if (field.type === "select") {
          return (
            <label key={key} className="fc-field">
              <span>{labelFor(key, field)}</span>
              {field.description && <em className="fc-field-desc">{field.description}</em>}
              <select
                value={String(value ?? "")}
                onChange={(e) => {
                  const raw = e.target.value;
                  const opt = (field.options ?? []).find((o) => String(o) === raw);
                  setCustom(key, raw === "" ? undefined : (opt ?? raw));
                }}
              >
                {/* No provider default → leave it unset rather than guessing. */}
                {field.default === undefined && <option value="">auto</option>}
                {(field.options ?? []).map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {optionLabel(key, o)}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        return (
          <label key={key} className="fc-field">
            <span>{labelFor(key, field)}</span>
            <input
              className="fc-text-input"
              value={String(value ?? "")}
              onChange={(e) => setCustom(key, e.target.value)}
            />
          </label>
        );
      })}

      {/* Models with no schema of their own still get the generic controls. */}
      {!schemaKeys.length && (
        <>
          <label className="fc-field">
            <span>Aspect ratio</span>
            <select
              value={first.params?.aspect ?? "default"}
              onChange={(e) => patchAll({ aspect: e.target.value })}
            >
              {ASPECTS.map((a) => (
                <option key={a} value={a}>
                  {a === "default" ? "Default" : a}
                </option>
              ))}
            </select>
          </label>

          <label className="fc-field">
            <span>Images per run</span>
            <select
              value={first.params?.numImages ?? 1}
              onChange={(e) => patchAll({ numImages: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {!many && first.maxRefImages > 0 && (
        <div className="fc-hint">
          Wire Image, Video, Audio or Model nodes into the left handle.
          {describeCaps(resolveInputs(first, [])).map((line) => (
            <div key={line} className="fc-hint-line">{line}</div>
          ))}
        </div>
      )}

      <div className="fc-props-footer">
        <button className="fc-run-btn" onClick={() => onRun(models)} disabled={running}>
          {running ? "Running…" : many ? `→ Run ${models.length} models` : "→ Run selected"}
        </button>
        {running && (
          <button
            className="fc-stop-btn"
            onClick={() =>
              // Stop waiting: the node frees up at once. The submitted job keeps
              // running server-side (no provider-side cancel exists) — if it
              // finishes, its result still appends to the node's history.
              models.forEach((n) => {
                const d = dataOf(n);
                if (d.status !== "running") return;
                patchNodeData(n.id, {
                  status: d.runs?.length || d.images?.length ? "done" : "idle",
                });
              })
            }
          >
            ✕ Stop waiting
          </button>
        )}
        {running && (
          <div className="fc-hint">
            Stopping frees the node but does not refund coins — the job keeps
            running at the provider, and if it finishes the result lands in this
            node's history.
          </div>
        )}
      </div>
    </aside>
  );
}
