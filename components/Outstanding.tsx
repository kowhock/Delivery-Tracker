"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { addOutstanding, clearOutstanding, getDoHistory, getDoItems, getPodPhotoUrl } from "@/app/actions";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { EVENT_LABEL, TODO_LABEL, todoLabel, type DoItem, type Outstanding, type OutstandingTodo, type StatusEvent } from "@/lib/types";

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

/**
 * A DO number that opens the DO's items, with "Add remark" for flagging outstanding work.
 * `history`: also list who changed the DO and when (admins only).
 * `photo`: the DO has a proof-of-delivery photo to show.
 */
export function DoOutstanding({
  doId,
  doNo,
  customer,
  open,
  history = false,
  photo = false,
}: {
  doId: string;
  doNo: string;
  customer?: string;
  open: Outstanding[];
  history?: boolean;
  photo?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [items, setItems] = useState<DoItem[] | null>(null);
  const [events, setEvents] = useState<StatusEvent[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [adding, setAdding] = useState(false);

  async function show() {
    setOpen(true);
    setState("loading");
    try {
      // Items don't change; history and the photo link (it expires) are fetched fresh on every open.
      const [i, h, p] = await Promise.all([items ?? getDoItems(doId), history ? getDoHistory(doId) : null, photo ? getPodPhotoUrl(doId) : null]);
      setItems(i);
      setEvents(h);
      setPhotoUrl(p);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
  }, [isOpen]);

  return (
    <>
      <button type="button" onClick={show} className="hover:text-brand-700 hover:underline" title={photo ? "See items, delivery photo / add remark" : "See items / add remark"}>
        {doNo}
        {photo && <span className="ml-1" aria-label="has delivery photo">📷</span>}
      </button>
      {/* Portalled to <body> so the popup isn't nested inside the card's markup. */}
      {isOpen &&
        createPortal(
          <dialog
            ref={dialog}
            onClose={() => setOpen(false)}
            // Clicking the dark backdrop closes it.
            onClick={(e) => e.target === dialog.current && dialog.current?.close()}
            className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl p-0 text-left text-sm text-slate-800 shadow-xl backdrop:bg-slate-900/40"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{doNo}</h2>
                {customer && <p className="text-slate-600">{customer}</p>}
              </div>
              <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" className="text-xl leading-none text-slate-400 hover:text-slate-900">
                ×
              </button>
            </div>

            <div className="max-h-[65dvh] space-y-4 overflow-y-auto px-5 py-4">
              {open.length > 0 && <OpenList open={open} />}
              {photo && (
                <div>
                  <h3 className="mb-1 font-semibold">Proof of delivery</h3>
                  {photoUrl ? (
                    <a href={photoUrl} target="_blank" rel="noreferrer" title="Open full size">
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase link, not a static asset */}
                      <img src={photoUrl} alt={`Delivery photo for ${doNo}`} className="max-h-80 w-full rounded-xl border border-slate-100 object-contain" />
                    </a>
                  ) : (
                    state === "loading" ? <p className="text-slate-500">Loading photo…</p> : state === "idle" && <p className="text-slate-500">Photo not found.</p>
                  )}
                </div>
              )}
              <div>
                <h3 className="mb-1 font-semibold">Items</h3>
                {state === "loading" && !items && <p className="text-slate-500">Loading…</p>}
                {state === "error" && <p className="text-rose-600">Couldn&apos;t load this DO. Try again.</p>}
                {items && items.length === 0 && <p className="text-slate-500">No item lines on this DO.</p>}
                {items && items.length > 0 && (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                    {items.map((l) => (
                      <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <div className="font-medium">{l.item_code}</div>
                          {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
                        </div>
                        <span className="whitespace-nowrap tabular-nums">
                          {fmtQty(l.qty)} {l.uom}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {history && events && <History events={events} />}
            </div>

            <div className="flex justify-end border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={() => setAdding(true)} className="btn-primary">
                Add remark
              </button>
            </div>
          </dialog>,
          document.body,
        )}
      {/* Closing the remark popup (×, Cancel or Save) closes the DO popup behind it too. */}
      {adding &&
        createPortal(
          <AddRemark
            doId={doId}
            doNo={doNo}
            onClose={() => {
              setAdding(false);
              dialog.current?.close();
            }}
          />,
          document.body,
        )}
    </>
  );
}

/** Who changed the DO and when, newest first. */
function History({ events }: { events: StatusEvent[] }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold">
        History <span className="text-xs font-normal text-slate-400">· admin only</span>
      </h3>
      {events.length === 0 ? (
        <p className="text-slate-500">No changes recorded yet.</p>
      ) : (
        <ol className="space-y-2.5 border-l border-slate-200 pl-3">
          {events.map((e) => (
            <li key={e.id}>
              <p className="font-medium">{EVENT_LABEL[e.status] ?? e.status}</p>
              {e.note && <p className="text-slate-600">{e.note}</p>}
              <p className="text-xs text-slate-400">
                {fmtDateTime(e.created_at)}
                {e.actor?.full_name && ` · ${e.actor.full_name}`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** What's still outstanding on a DO, each with its Clear button. */
function OpenList({ open }: { open: Outstanding[] }) {
  return (
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
  );
}

/** Second popup over the DO popup: "Add remark / outstanding". */
function AddRemark({ doId, doNo, onClose }: { doId: string; doNo: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [todo, setTodo] = useState<OutstandingTodo | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function save(formData: FormData) {
    setError(null);
    start(async () => {
      try {
        const res = await addOutstanding(formData);
        if (res.error) return setError(res.error);
        dialog.current?.close();
      } catch {
        setError("Couldn't save — try again.");
      }
    });
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
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

      <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">
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
    </dialog>
  );
}
