import { httpRouter } from "convex/server";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import {
  generateToken,
  hashPin,
  normalizeCode,
  randomSaltHex,
  sha256Hex,
  timingSafeEqual,
} from "./lib/crypto";

const http = httpRouter();

// Better Auth routes (staff email+password). Requests arrive proxied through
// the Next.js /api/auth route, same-origin — no CORS needed.
authComponent.registerRoutes(http, createAuth);

// ————————————————————————————————————————————————————————————————————————
// Student code login — /student/login · /student/set-pin · /student/logout
// These are called cross-origin from the browser (convex.site ≠ SITE_URL),
// so every route answers OPTIONS preflight and sets exact-match CORS headers.
// ————————————————————————————————————————————————————————————————————————

const rateLimiter = new RateLimiter(components.rateLimiter, {
  codeLoginPerIp: { kind: "token bucket", rate: 10, period: MINUTE },
  codeLoginGlobal: { kind: "token bucket", rate: 300, period: MINUTE },
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.SITE_URL ?? "",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/**
 * Client IP for rate limiting and audit. Convex's edge appends the true peer
 * address as the LAST x-forwarded-for entry; earlier entries are
 * client-controlled and must be ignored.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  const parts = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : "unknown";
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

const preflight = httpAction(
  async () => new Response(null, { status: 204, headers: corsHeaders() }),
);

for (const path of ["/student/login", "/student/set-pin", "/student/logout"]) {
  http.route({ path, method: "OPTIONS", handler: preflight });
}

http.route({
  path: "/student/login",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const ip = clientIp(request);

    // Rate limit BOTH buckets before verifying anything (wrong PINs and
    // unknown codes consume tokens alike).
    const perIp = await rateLimiter.limit(ctx, "codeLoginPerIp", { key: ip });
    if (!perIp.ok) return json(429, { ok: false, error: "rate_limited" });
    const global = await rateLimiter.limit(ctx, "codeLoginGlobal");
    if (!global.ok) return json(429, { ok: false, error: "rate_limited" });

    const body = await readJsonBody(request);
    const rawCode = body?.code;
    if (
      typeof rawCode !== "string" ||
      rawCode.length === 0 ||
      rawCode.length > 200
    ) {
      return json(400, { ok: false, error: "bad_request" });
    }
    const pin = typeof body?.pin === "string" ? body.pin : undefined;
    const deviceToken =
      typeof body?.deviceToken === "string" && body.deviceToken.length > 0
        ? body.deviceToken
        : undefined;
    const rememberDevice = body?.rememberDevice === true;

    const codeHash = await sha256Hex(normalizeCode(rawCode));
    const codeHashPrefix = codeHash.slice(0, 12);
    const deviceTokenHash =
      deviceToken !== undefined ? await sha256Hex(deviceToken) : undefined;

    const context = await ctx.runQuery(internal.studentAuth.getLoginContext, {
      codeHash,
      deviceTokenHash,
    });
    if (context === null) {
      await ctx.runMutation(internal.studentAuth.recordLoginFailure, {
        codeHashPrefix,
        reason: "code",
        ip,
      });
      return json(401, { ok: false, error: "invalid_code" });
    }

    // PIN gate: required when the code has a PIN and this device isn't
    // remembered for it.
    if (context.hasPin && !context.deviceRemembered) {
      if (pin === undefined || pin.length === 0) {
        return json(200, { ok: false, needsPin: true });
      }
      if (context.pinHash === undefined || context.pinSalt === undefined) {
        // Defensive only — hasPin implies both fields exist.
        return json(200, { ok: false, needsPin: true });
      }
      const suppliedPinHash = await hashPin(pin, context.pinSalt);
      if (!timingSafeEqual(suppliedPinHash, context.pinHash)) {
        await ctx.runMutation(internal.studentAuth.recordLoginFailure, {
          codeHashPrefix,
          reason: "pin",
          accessCodeId: context.accessCodeId,
          ip,
        });
        return json(200, { ok: false, error: "invalid_pin" });
      }
    }

    // Success: mint tokens client-side of the DB (hashes only get stored).
    const sessionToken = generateToken();
    const sessionTokenHash = await sha256Hex(sessionToken);
    let newDeviceToken: string | undefined;
    let newDeviceTokenHash: string | undefined;
    if (rememberDevice) {
      newDeviceToken = generateToken();
      newDeviceTokenHash = await sha256Hex(newDeviceToken);
    }

    const committed = await ctx.runMutation(
      internal.studentAuth.completeLogin,
      {
        accessCodeId: context.accessCodeId,
        sessionTokenHash,
        newDeviceTokenHash,
        rememberedDeviceId: context.deviceRemembered
          ? context.rememberedDeviceId
          : undefined,
        ip,
      },
    );
    if (!committed) {
      // Code revoked between resolution and commit — treat as invalid.
      await ctx.runMutation(internal.studentAuth.recordLoginFailure, {
        codeHashPrefix,
        reason: "code",
        accessCodeId: context.accessCodeId,
        ip,
      });
      return json(401, { ok: false, error: "invalid_code" });
    }

    return json(200, {
      ok: true,
      sessionToken,
      ...(newDeviceToken !== undefined ? { deviceToken: newDeviceToken } : {}),
      needsPinSetup: !context.hasPin,
      student: context.student,
    });
  }),
});

http.route({
  path: "/student/set-pin",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Rate-limit before any work: hashPin is deliberately slow (120k PBKDF2
    // iterations), so an unmetered set-pin is a CPU-exhaustion primitive.
    const ip = clientIp(request);
    const perIp = await rateLimiter.limit(ctx, "codeLoginPerIp", { key: ip });
    if (!perIp.ok) return json(429, { ok: false, error: "rate_limited" });

    const body = await readJsonBody(request);
    const sessionToken = body?.sessionToken;
    const pin = body?.pin;
    if (
      typeof sessionToken !== "string" ||
      sessionToken.length === 0 ||
      typeof pin !== "string" ||
      pin.length < 4 ||
      pin.length > 32
    ) {
      return json(400, { ok: false, error: "bad_request" });
    }
    const sessionTokenHash = await sha256Hex(sessionToken);

    // Validate the session cheaply BEFORE the expensive hash, so garbage
    // tokens never cost us a PBKDF2 run. setPin re-checks (TOCTOU-safe).
    const eligibility = await ctx.runQuery(
      internal.studentAuth.checkSetPinEligibility,
      { sessionTokenHash },
    );
    if (eligibility === "invalid_session") {
      return json(401, { ok: false, error: "invalid_session" });
    }
    if (eligibility === "already_set") {
      return json(409, { ok: false, error: "pin_already_set" });
    }

    const pinSalt = randomSaltHex();
    const pinHash = await hashPin(pin, pinSalt);
    const result = await ctx.runMutation(internal.studentAuth.setPin, {
      sessionTokenHash,
      pinHash,
      pinSalt,
    });
    if (result === "invalid_session") {
      return json(401, { ok: false, error: "invalid_session" });
    }
    if (result === "already_set") {
      return json(409, { ok: false, error: "pin_already_set" });
    }
    return json(200, { ok: true });
  }),
});

http.route({
  path: "/student/logout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await readJsonBody(request);
    const sessionToken = body?.sessionToken;
    if (typeof sessionToken !== "string" || sessionToken.length === 0) {
      return json(400, { ok: false, error: "bad_request" });
    }
    const sessionTokenHash = await sha256Hex(sessionToken);
    await ctx.runMutation(internal.studentAuth.logout, { sessionTokenHash });
    return json(200, { ok: true });
  }),
});

export default http;
