"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <main className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-50 to-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icons/logo.png" alt="" width={56} height={56} className="mx-auto mb-4 size-14 rounded-2xl shadow-lg shadow-yellow-500/20" />
          <h1 className="text-xl font-semibold tracking-tight">Delivery Tracker</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>

        <form action={action} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="login">Username or email</label>
            <input
              id="login"
              name="login"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
          <button disabled={pending} className="btn-primary w-full">
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
