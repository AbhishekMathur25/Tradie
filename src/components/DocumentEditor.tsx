"use client";

/**
 * Line-item editor for quotes and invoices, with optional voice/AI drafting.
 *
 * The editor keeps what the person typed as text (so "1." mid-typing isn't
 * rejected), converts to exact cents and thousandths for the totals, and
 * posts the lines as JSON. The server validates everything again.
 */
import { useMemo, useRef, useState } from "react";
import {
  centsToInput,
  documentTotals,
  formatCents,
  formatQuantity,
  lineAmountCents,
  parseDollars,
  parseQuantity,
  type Line,
} from "@/domain/money";
import { SubmitButton } from "./buttons";

export interface EditorPriceItem {
  id: string;
  name: string;
  unit: string;
  priceCents: number;
  costCents: number;
  taxable: boolean;
}

export interface DraftResponse {
  lines: Line[];
  source: "ai" | "keywords";
  notes: string[];
}

interface Row {
  key: number;
  priceItemId: string | null;
  description: string;
  quantity: string;
  price: string;
  costCents: number;
  taxable: boolean;
}

let nextKey = 1;

function toRow(line: Line): Row {
  return {
    key: nextKey++,
    priceItemId: line.priceItemId,
    description: line.description,
    quantity: formatQuantity(line.quantityMilli).replace(/,/g, ""),
    price: centsToInput(line.unitPriceCents),
    costCents: line.unitCostCents,
    taxable: line.taxable,
  };
}

const emptyRow = (): Row => ({
  key: nextKey++,
  priceItemId: null,
  description: "",
  quantity: "1",
  price: "",
  costCents: 0,
  taxable: true,
});

/** Converts a row to a Line, or null while it is incomplete. */
function toLine(row: Row): Line | null {
  const quantityMilli = parseQuantity(row.quantity);
  const unitPriceCents = parseDollars(row.price);
  if (!row.description.trim() || quantityMilli === null || unitPriceCents === null) return null;
  return {
    description: row.description.trim(),
    quantityMilli,
    unitPriceCents,
    unitCostCents: row.costCents,
    taxable: row.taxable,
    priceItemId: row.priceItemId,
  };
}

// The browser speech API isn't in TypeScript's DOM types everywhere.
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};

export function DocumentEditor({
  action,
  priceItems,
  initialLines,
  gstRegistered,
  hidden = {},
  submitLabel,
  draftAction,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  priceItems: EditorPriceItem[];
  initialLines: Line[];
  gstRegistered: boolean;
  hidden?: Record<string, string>;
  submitLabel: string;
  /** When set, shows the "describe the job" box that drafts lines. */
  draftAction?: (description: string) => Promise<DraftResponse>;
  children?: React.ReactNode;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.length > 0 ? initialLines.map(toRow) : [emptyRow()],
  );
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  const lines = useMemo(() => rows.map(toLine), [rows]);
  const validLines = lines.filter((line): line is Line => line !== null);
  const incomplete = rows.some(
    (row, index) => lines[index] === null && row.description.trim() !== "",
  );
  const totals = documentTotals(validLines, gstRegistered);

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const pickItem = (key: number, itemId: string) => {
    const item = priceItems.find((candidate) => candidate.id === itemId);
    if (!item) return update(key, { priceItemId: null });
    update(key, {
      priceItemId: item.id,
      description: item.name,
      price: centsToInput(item.priceCents),
      costCents: item.costCents,
      taxable: item.taxable,
    });
  };

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) {
      setDraftNotes(["Voice input needs Chrome or Edge. You can type the description instead."]);
      return;
    }
    const instance = new Recognition();
    instance.lang = "en-AU";
    instance.continuous = true;
    instance.interimResults = false;
    const before = description ? `${description.trim()} ` : "";
    instance.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ");
      setDescription(before + spoken);
    };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    instance.start();
    setListening(true);
  };

  const runDraft = async () => {
    if (!draftAction || !description.trim()) return;
    setDrafting(true);
    setDraftNotes([]);
    try {
      const result = await draftAction(description);
      const drafted = result.lines.map(toRow);
      const onlyBlank = rows.length === 1 && !rows[0].description.trim();
      if (drafted.length > 0)
        setRows((current) => (onlyBlank ? drafted : [...current, ...drafted]));
      setDraftNotes([
        result.source === "ai"
          ? "Drafted by AI from your description. Check every line before saving."
          : "Drafted by keyword matching against your price list. Check every line before saving.",
        ...result.notes,
      ]);
    } catch {
      setDraftNotes(["Drafting failed. Add the lines by hand."]);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <form action={action} className="stack">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="lines" value={JSON.stringify(validLines)} />
      {children}

      {draftAction ? (
        <div className="voice">
          <label className="label-text" htmlFor="job-description">
            Describe the job
          </label>
          <textarea
            id="job-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Strip and retile ensuite, 12 square metres wall tiling, 8 hours carpenter, new 900 vanity"
          />
          <div className="actions">
            <button type="button" onClick={toggleVoice}>
              {listening ? "Stop recording" : "Speak"}
            </button>
            <button type="button" onClick={runDraft} disabled={drafting || !description.trim()}>
              {drafting ? "Drafting…" : "Draft lines"}
            </button>
            <span className="muted small">
              Leave out names and addresses. You check every line.
            </span>
          </div>
          {draftNotes.map((note) => (
            <p key={note} className="small muted" style={{ margin: 0 }}>
              {note}
            </p>
          ))}
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th>Price list</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price (ex GST)</th>
              <th className="right">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const line = lines[index];
              return (
                <tr key={row.key}>
                  <td>
                    <select
                      aria-label="Price list item"
                      value={row.priceItemId ?? ""}
                      onChange={(event) => pickItem(row.key, event.target.value)}
                    >
                      <option value="">Custom</option>
                      {priceItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.unit})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="text"
                      aria-label="Description"
                      value={row.description}
                      onChange={(event) => update(row.key, { description: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="qty"
                      aria-label="Quantity"
                      value={row.quantity}
                      onChange={(event) => update(row.key, { quantity: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="price"
                      aria-label="Unit price excluding GST"
                      value={row.price}
                      onChange={(event) => update(row.key, { price: event.target.value })}
                    />
                  </td>
                  <td className="right num">{line ? formatCents(lineAmountCents(line)) : "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                      disabled={rows.length === 1}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>
          Add line
        </button>
        {incomplete ? (
          <span className="small" style={{ color: "var(--bad)" }}>
            Some lines need a quantity and price.
          </span>
        ) : null}
      </div>

      <div className="totals">
        <span>Subtotal (ex GST) {formatCents(totals.subtotalCents)}</span>
        <span>
          {gstRegistered ? `GST ${formatCents(totals.gstCents)}` : "No GST (not registered)"}
        </span>
        <span className="grand">Total {formatCents(totals.totalCents)}</span>
      </div>

      <div className="actions">
        <SubmitButton className="primary" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
