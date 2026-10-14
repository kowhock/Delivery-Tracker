"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { addOutstanding, clearOutstanding } from "@/app/actions";
import { fmtDateTime } from "@/lib/format";
import { TODO_LABEL, todoLabel, type Outstanding, type OutstandingTodo } from "@/lib/types";

/** Green "Clear" button: marks an outstanding item as done. */
export function ClearButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            await clearOutstanding(id);
          } catch {
            setError(true);
          }
        })
      }
      title={error ? "Couldn't clear — try again" : undefined}
      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {pending ? "Clearing…" : error ? "Retry" : "Clear"}
    </button>
  );
}

/** A DO number that opens "Add remark / outstanding" for that DO, listing what's still open. */
export function DoOutstanding({ doId, doNo, open }: { doId: string; doNo: string; open: Outstanding[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [todo, setTodo] = useState<OutstandingTodo | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
  }, [isOpen]);

  function save(formData: FormData) {
    setError(null);
    start(async () => {
      try {
        const res = await addOutstanding(formData);
        if (res.error) return setError(res.error);
        setTodo("");
        dialog.current?.close();
      } catch {
        setError("Couldn't save — try again.");
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hover:text-brand-700 hover:underline" title="Add remark / outstanding">
        {doNo}
      </button>
      {/* Portalled to <body> so the form isn't nested inside the card's markup. */}
      {isOpen &&
        createPortal(
          <dialog
            ref={dialog}
            onClose={() => setOpen(false)}
            // Clicking the dark backdrop closes it.
            onClick={(e) => e.target === dialog.current && dialog.current?.close()}
            className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-2xl p-0 text-left text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/40"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Add remark / outstanding</h2>
                <p className="text-slate-500">{doNo}</p>
              </div>
              <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="text-xl leading-none text-slate-400 hover:text-slate-900">
                ×
              </button>
            </div>

            <div className="max-h-[75dvh] space-y-4 overflow-y-auto px-5 py-4">
              {open.length > 0 && (
                <ul className="space-y-2">
                  {open.map((o) => (
                    <li key={o.id} className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
                      <div className="min-w-0">
                        <p className="font-medium text-rose-800">{todoLabel(o)}</p>
                        <p className="text-slate-700">{o.reason}</p>
                        {o.description && <p className="text-xs text-slate-500">{o.description}</p>}
                        <p className="mt-1 text-xs text-slate-400">
                          {fmtDateTime(o.created_at)}
                          {o.creator?.full_name && ` · ${o.creator.full_name}`}
                        </p>
                      </div>
                      <ClearButton id={o.id} />
                    </li>
                  ))}
                </ul>
              )}

              <form action={save} className="space-y-3">
                <input type="hidden" name="do_id" value={doId} />
                <div>
                  <label className="label" htmlFor={`reason-${doId}`}>Reason</label>
                  <input id={`reason-${doId}`} name="reason" required placeholder="e.g. Customer returned 2 bags" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor={`todo-${doId}`}>To-do</label>
                  <select
                    id={`todo-${doId}`}
                    name="todo"
                    required
                    value={todo}
                    onChange={(e) => setTodo(e.target.value as OutstandingTodo)}
                    className="input"
                  >
                    <option value="" disabled>Choose…</option>
                    {(Object.keys(TODO_LABEL) as OutstandingTodo[]).map((k) => (
                      <option key={k} value={k}>{TODO_LABEL[k]}</option>
                    ))}
                  </select>
                </div>
                {todo === "other" && (
                  <div>
                    <label className="label" htmlFor={`other-${doId}`}>Other to-do</label>
                    <input id={`other-${doId}`} name="todo_other" required placeholder="What needs to be done?" className="input" />
                  </div>
                )}
                <div>
                  <label className="label" htmlFor={`desc-${doId}`}>
                    Description <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea id={`desc-${doId}`} name="description" rows={2} className="input" />
                </div>
                {error && <p className="text-rose-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => dialog.current?.close()} className="btn-secondary">Cancel</button>
                  <button disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
                </div>
              </form>
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
