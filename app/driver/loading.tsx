import { Spinner } from "@/components/Spinner";

/** Shown while the driver page fetches the day's jobs (e.g. after picking another date). */
export default function Loading() {
  return (
    <div className="mx-auto min-h-dvh max-w-lg bg-white">
      <header className="flex h-[148px] items-center bg-black px-4">
        <img src="/kowhock-logo.png" alt="Kow Hock" width={400} height={278} className="h-12 w-auto" />
      </header>
      <Spinner className="border-kh-yellow" />
    </div>
  );
}
