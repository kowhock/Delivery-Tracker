"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { signIn } from "../actions";

const PIN_LENGTH = 6;
/** Desktop (lg and up) gets the normal username + password form; phones get the PIN keypad. */
const DESKTOP = "(min-width: 1024px)";
/** The last username used on this phone, so drivers only key in their PIN next time. */
const LAST_LOGIN_KEY = "lastLogin";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, undefined);
  const [, startTransition] = useTransition();
  const [login, setLogin] = useState("");
  const [remembered, setRemembered] = useState(false);
  const [pin, setPin] = useState("");
  // Staff with a normal (letters) password switch to the password box.
  const [usePassword, setUsePassword] = useState(false);
  const [hint, setHint] = useState("");
  const [shake, setShake] = useState(false);
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_LOGIN_KEY);
      if (last) {
        setLogin(last);
        setRemembered(true);
      }
    } catch {}
  }, []);

  // Wrong PIN: clear the dots and shake so the driver can try again.
  useEffect(() => {
    if (!state?.error) return;
    setPin("");
    setShake(true);
    const t = setTimeout(() => setShake(false), 500);
    return () => clearTimeout(t);
  }, [state]);

  const submit = (password: string) => {
    const name = login.trim();
    if (!name) {
      setHint("Enter your username first");
      setRemembered(false);
      setTimeout(() => loginRef.current?.focus());
      return;
    }
    setHint("");
    try {
      localStorage.setItem(LAST_LOGIN_KEY, name);
    } catch {}
    const fd = new FormData();
    fd.set("login", name);
    fd.set("password", password);
    startTransition(() => action(fd));
  };

  const press = (digit: string) => {
    if (pending || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) submit(next);
  };
  const backspace = () => !pending && setPin((p) => p.slice(0, -1));

  // Typing digits on a keyboard works too (unless a text box has focus, or it's the desktop form).
  useEffect(() => {
    if (usePassword) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || window.matchMedia(DESKTOP).matches) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") backspace();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const error = hint || state?.error;

  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-slate-950 px-4 py-8 text-white">
      {/* Background: the Kow Hock lorry on phones, the team photo on desktop — darkened and blurred so the form stays readable. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 scale-110 bg-[url(/login-bg.jpg)] bg-cover bg-center blur-xs lg:scale-105 lg:bg-[url(/login-bg-desktop.jpg)] lg:blur-[2px]"
      />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/55 to-black/80 lg:from-black/60 lg:via-black/40 sm:to-black/70" />

      {/* Desktop: the usual staff sign-in. */}
      <div className="hidden w-full max-w-sm lg:block">
        <div className="mb-8 text-center">
          <img src="/icons/logo.png" alt="" width={56} height={56} className="mx-auto mb-4 size-14 rounded-2xl shadow-lg shadow-black/40" />
          <h1 className="text-xl font-semibold tracking-tight">KH Delivery</h1>
          <p className="mt-1 text-sm text-white/70">Kow Hock Hardware</p>
        </div>
        {/* Solid dark navy box with yellow accents, like the team photo (navy shirts, yellow lorries). */}
        <form action={action} className="space-y-4 rounded-2xl border border-white/10 border-t-4 border-t-yellow-400 bg-[#0f1524] p-6 shadow-2xl shadow-black/60">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="d-login">Username or email</label>
            <input
              id="d-login"
              name="login"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-white/10 bg-[#1a2133] px-3 py-2.5 text-sm text-white outline-none transition focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400" htmlFor="d-password">Password</label>
            <input id="d-password" name="password" type="password" required autoComplete="current-password" className="w-full rounded-xl border border-white/10 bg-[#1a2133] px-3 py-2.5 text-sm text-white outline-none transition focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/20" />
          </div>
          {state?.error && <p className="text-sm text-rose-400">{state.error}</p>}
          <button disabled={pending} className="btn w-full bg-yellow-400 text-slate-900 hover:bg-yellow-300">
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>

      {/* Phone: PIN keypad (office staff can switch to their password). */}
      <div className="w-full max-w-xs lg:hidden">
        <div className="mb-6 text-center">
          <img src="/icons/logo.png" alt="" width={56} height={56} className="mx-auto mb-3 size-14 rounded-2xl shadow-lg shadow-black/40" />
          <h1 className="text-xl font-semibold tracking-tight">KH Delivery</h1>
          <p className="mt-1 text-sm text-white/60">Kow Hock Hardware</p>
        </div>

        <div>
          {remembered ? (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm">
              <span className="truncate">
                <span className="text-white/60">Hi, </span>
                <span className="font-semibold">{login}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setRemembered(false);
                  setLogin("");
                  setPin("");
                  setTimeout(() => loginRef.current?.focus());
                }}
                className="shrink-0 text-xs font-medium text-yellow-300 hover:text-yellow-200"
              >
                Not you?
              </button>
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="login">Username</label>
              <input
                ref={loginRef}
                id="login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. ali"
                className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-yellow-300/70 focus:ring-4 focus:ring-yellow-300/15"
              />
            </div>
          )}

          {usePassword ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit(String(new FormData(e.currentTarget).get("password") ?? ""));
              }}
            >
              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60" htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-sm text-white outline-none transition focus:border-yellow-300/70 focus:ring-4 focus:ring-yellow-300/15"
                />
              </div>
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <button disabled={pending} className="btn w-full bg-yellow-400 text-slate-900 hover:bg-yellow-300">
                {pending ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <>
              <p className="mt-5 text-center text-xs font-medium text-white/60">{pending ? "Signing in…" : "Enter your 6-digit PIN"}</p>
              <div className={`mt-3 flex justify-center gap-3 ${shake ? "pin-shake" : ""}`} aria-live="polite" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
                {Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span
                    key={i}
                    className={`size-3.5 rounded-full border transition ${
                      i < pin.length ? "border-yellow-300 bg-yellow-300" : "border-white/40 bg-transparent"
                    } ${pending ? "animate-pulse" : ""}`}
                  />
                ))}
              </div>
              <p className="mt-3 h-5 text-center text-sm text-rose-300">{error}</p>

              <div className="mx-auto mt-2 grid w-fit grid-cols-3 gap-x-6 gap-y-4">
                {KEYS.map((k) => (
                  <PadKey key={k} onClick={() => press(k)} disabled={pending}>{k}</PadKey>
                ))}
                <span />
                <PadKey onClick={() => press("0")} disabled={pending}>0</PadKey>
                <PadKey onClick={backspace} disabled={pending || !pin} label="Delete" muted>⌫</PadKey>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setUsePassword((u) => !u);
            setPin("");
            setHint("");
          }}
          className="mx-auto mt-5 block text-xs font-medium text-white/60 hover:text-white"
        >
          {usePassword ? "Use PIN keypad" : "Office staff? Use password"}
        </button>
      </div>
    </main>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  label,
  muted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`grid size-[4.5rem] place-items-center rounded-full text-3xl font-light transition select-none active:scale-95 active:bg-white/35 disabled:opacity-40 ${
        muted ? "text-xl text-white/70" : "border border-white/20 bg-white/10 backdrop-blur-md hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}
