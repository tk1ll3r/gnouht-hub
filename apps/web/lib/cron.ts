import "server-only";
import { safeEqual } from "./crypto";
import { env } from "./env";

/** Cron endpoints are called by pg_cron with `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorizedCron(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && safeEqual(token, env().CRON_SECRET);
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
