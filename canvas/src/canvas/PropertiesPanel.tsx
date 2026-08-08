import type { Node } from "@xyflow/react";
import { patchNodeData, type ModelNodeData, type ParamField, type ParamSchema } from "../types";

const ASPECTS = ["default", "1:1", "9:16", "16:9", "4:5", "3:4", "3:2"];

const labelFor = (key: string, field: ParamField) =>
  field.label ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function PropertiesPanel({
  nodes,
  onRun,
}: {
  nodes: Node[];
  onRun: (models: Node[]) => void;
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
  const totalCoins = models.reduce((sum, n) => sum + (dataOf(n).costCoins ?? 0), 0);

  return (
    <aside className="fc-props">
      <div className="fc-props-title">
        <span className="fc-dot" style={{ background: "#8b5cf6" }} />
        {many ? `${models.length} models` : first.modelName}
        {totalCoins > 0 && <span className="fc-cost">✳ {totalCoins}</span>}
      </div>

      {many && <div className="fc-hint">{names.join(" · ")}</div>}

      {schemaKeys.map((key) => {
        const field = schema[key];
        const value = valueOf(key);

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
                    {String(o)}
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
          Accepts up to {first.maxRefImages} reference image{first.maxRefImages > 1 ? "s" : ""} —
          wire Image or Model nodes into the left handle.
        </div>
      )}

      <div className="fc-props-footer">
        <button className="fc-run-btn" onClick={() => onRun(models)} disabled={running}>
          {running ? "Running…" : many ? `→ Run ${models.length} models` : "→ Run selected"}
        </button>
      </div>
    </aside>
  );
}
