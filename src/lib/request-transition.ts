import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Write to a Request only if it is still in one of the statuses the caller
 * read it in. Returns whether the write happened.
 *
 * Status changes come from several places at once -- the 60s background
 * poller, *arr webhooks, the admin "check now" button, and admin
 * approve/deny/cancel -- each acting on a snapshot it read earlier. An
 * unconditional update-by-id lets a stale snapshot overwrite a newer
 * decision (e.g. flip a just-cancelled request to "available") and lets two
 * checkers both run the same transition's side effects (duplicate
 * "available" notifications). Callers must gate pipeline events and
 * notifications on the return value. Same guard as the admin actions in
 * services/admin.ts.
 */
export async function updateRequestIfStatus(
  id: string,
  expected: string | readonly string[],
  data: Prisma.RequestUpdateManyMutationInput,
): Promise<boolean> {
  const status =
    typeof expected === "string" ? expected : { in: [...expected] };
  const { count } = await prisma.request.updateMany({
    where: { id, status },
    data,
  });
  return count === 1;
}
