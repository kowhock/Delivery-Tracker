"use client";

import { useState, useTransition } from "react";
import { saveItemNote } from "@/app/actions";
import { ITEM_NOTE_MAX, itemNoteLines } from "@/lib/item-note";

/**
 * M- DOs: the items the office typed, one per line ("Cement x 1 bag"); AutoCount sends none for
 * invoices. Those allowed (lib/item-note.ts canEditItemNote) get a box to type or change them.
 */
export function ItemNote({ doId, note, canEdit }: { doId: string; note: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lines = itemNoteLines(note);

  if (editing) {
    return (
      <div className="space-y-1.5">
        <textarea
          autoFocus
          rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
          maxLength={ITEM_NOTE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"One item per line, e.g.\nCement x 1 bag\nBRC A6 x 2 pcs"}
          className="input text-xs"
          aria-label="Items"
        />
        {error && <p className="text-xs text-rose-600">{error}</p>}
        <div className="flex gap-1.5">
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await saveItemNote(doId, text).catch(() => ({ error: "Couldn't save — try again." }));
                if (res?.error) setError(res.error);
                else setEditing(false);
              })
            }
            className="btn-primary px-3 py-1 text-xs disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save items"}
          </button>
          <button
            disabled={pending}
            onClick={() => {
              setText(note ?? "");
              setError(null);
              setEditing(false);
            }}
            className="btn-secondary px-3 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!lines.length && !canEdit) return null;
  return (
    <div className="rounded bg-slate-50 px-1.5 py-1 text-xs">
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-slate-700">
          {lines.map((l, i) => <li key={i}>📦 {l}</li>)}
        </ul>
      )}
      {canEdit && (
        <button
          onClick={() => {
            setText(note ?? "");
            setEditing(true);
          }}
          className={`font-medium text-brand-700 hover:underline ${lines.length ? "mt-1" : ""}`}
        >
          {lines.length ? "Edit items" : "+ Add items"}
        </button>
      )}
    </div>
  );
}
