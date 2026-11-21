import { redirect } from "next/navigation";
import { REQUIRED_ENV, envIssues } from "@/lib/env";
import SetupNeededForm from "@/components/setup/SetupNeededForm";

/**
 * Shown, in place of every other page, while required configuration is
 * missing (src/proxy.ts sends visitors here). Public on purpose: nothing
 * works yet, so there is no account to sign in with. It lists variable
 * names only, never values, and stores nothing.
 */
export default function SetupNeededPage() {
  const issues = envIssues();
  if (issues.length === 0) redirect("/");

  const problems: Record<string, "missing" | "invalid"> = {};
  for (const i of issues) problems[i.name] = i.problem;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">
        <span className="text-[var(--accent)]">Lex</span>arr needs a little setup
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Lexarr is running, but it is missing settings it cannot work without. Fill in the form to
        build a ready-to-paste <code>.env</code> block, add it to your container&apos;s settings and
        restart. Nothing you type here is sent anywhere or saved.
      </p>
      <SetupNeededForm required={[...REQUIRED_ENV]} problems={problems} />
    </main>
  );
}
