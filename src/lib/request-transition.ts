import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { log } from "./log";
import { canTransition, isRequestStatus, type RequestStatus } from "./request-status";

export type RequestWrite = Omit<Prisma.RequestUpdateManyMutationInput, "status"> & {
  status?: RequestStatus;
};

/**
 * Write to a Request only if it is still in one of the statuses the caller
 * read it in. Returns whether the write happened.
 *
 * Status changes come from several places at once -- the 60s background
 * poller, *arr webhooks, the admin "check now" button, and admin
 * approve/deny/cancel/retry -- each acting on a snapshot it read earlier. An
 * unconditional update-by-id lets a stale snapshot overwrite a newer
 * decision (e.g. flip a just-cancelled request to "available") and lets two
 * checkers both run the same transition's side effects (duplicate
 * "available" notifications). Callers must gate pipeline events and
 * notifications on the return value.
 *
 * A status change must also be a move the lifecycle allows
 * (request-status.ts). One that isn't is refused and logged as an error --
 * it means a caller and the transition table disagree, which is a bug.
 */
export async function updateRequestIfStatus(
  id: string,
  expected: string | readonly string[],
  data: RequestWrite,
): Promise<boolean> {
  const from = typeof expected === "string" ? [expected] : [...expected];

  if (data.status !== undefined) {
    const to = data.status;
    const illegal = from.filter((s) => !isRequestStatus(s) || !canTransition(s, to));
    if (illegal.length > 0) {
      log.error("request transition refused: not allowed by the lifecycle", {
        requestId: id,
        from: illegal,
        to,
      });
      return false;
    }
  }

  const { count } = await prisma.request.updateMany({
    where: { id, status: from.length === 1 ? from[0] : { in: from } },
    data,
  });
  return count === 1;
}
