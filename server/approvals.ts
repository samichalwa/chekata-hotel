import type { IStorage } from "./storage";
import { sendTransactionalEmail } from "./email";
import { parsePermissions } from "./auth";
import type { ModuleKey, Settings } from "@shared/schema";

// Same pattern used for username-as-email validation elsewhere (see the password
// reset flow in routes.ts) — an account only receives workflow emails if its
// username is itself a real email address (the initial setup admin may not be).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailAddress(value: string | undefined | null): value is string {
  return !!value && EMAIL_REGEX.test(value);
}

async function getApproverEmails(storage: IStorage, moduleKey: ModuleKey): Promise<{ email: string; fullName: string }[]> {
  const users = await storage.listUsers();
  return users
    .filter((u) => u.active && isEmailAddress(u.username))
    .filter((u) => u.isAdmin || parsePermissions(u.permissions).includes(moduleKey))
    .map((u) => ({ email: u.username, fullName: u.fullName }));
}

async function getUserEmailByFullName(storage: IStorage, fullName: string): Promise<string | null> {
  const users = await storage.listUsers();
  const match = users.find((u) => u.active && u.fullName === fullName && isEmailAddress(u.username));
  return match ? match.username : null;
}

export interface NotifyContext {
  storage: IStorage;
  settings: Settings;
  origin: string; // e.g. https://hms.thechekata.com — built from the request in routes.ts
}

export interface ApprovalNotifyInput {
  moduleKey: ModuleKey; // "purchasing" | "internal-requisitions" — whoever holds this module gets notified
  docType: string; // "Purchase Requisition" | "Purchase Order" | "Internal Requisition"
  docNumber: string;
  requestedBy: string;
  purpose?: string | null;
  linkPath: string; // e.g. "/purchasing" or "/internal-requisitions"
}

// Fired when a requester submits a draft for approval. Emails every active user
// who holds the relevant module (admins always count as approvers too).
export async function notifyApproversOfSubmission(ctx: NotifyContext, input: ApprovalNotifyInput): Promise<void> {
  const approvers = await getApproverEmails(ctx.storage, input.moduleKey);
  if (approvers.length === 0) return;
  const hotelName = ctx.settings.hotelName || "The Chekata";
  const link = `${ctx.origin}/#${input.linkPath}`;
  const html = `
    <p>Hello,</p>
    <p><strong>${input.docNumber}</strong> (${input.docType}) has been submitted by <strong>${input.requestedBy}</strong> and is waiting for your approval.</p>
    ${input.purpose ? `<p>Purpose: ${input.purpose}</p>` : ""}
    <p><a href="${link}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Review in ${hotelName}</a></p>
    <p>Or copy and paste this link into your browser:<br/>${link}</p>
  `;
  await Promise.all(
    approvers.map((a) =>
      sendTransactionalEmail({
        settings: ctx.settings,
        to: a.email,
        toName: a.fullName,
        subject: `Approval needed: ${input.docNumber}`,
        html,
      }).catch(() => ({ ok: false })),
    ),
  );
}

export interface DecisionNotifyInput {
  docType: string;
  docNumber: string;
  requestedBy: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  reason?: string | null;
  linkPath: string;
}

// Fired when an approver approves or declines a request. Emails the original requester
// (matched by full name to an active user account whose username is an email address).
export async function notifyRequesterOfDecision(ctx: NotifyContext, input: DecisionNotifyInput): Promise<void> {
  const email = await getUserEmailByFullName(ctx.storage, input.requestedBy);
  if (!email) return;
  const hotelName = ctx.settings.hotelName || "The Chekata";
  const link = `${ctx.origin}/#${input.linkPath}`;
  const verb = input.decision === "approved" ? "approved" : "declined";
  const html = `
    <p>Hello ${input.requestedBy},</p>
    <p>Your ${input.docType} <strong>${input.docNumber}</strong> has been <strong>${verb}</strong> by ${input.decidedBy}.</p>
    ${input.reason ? `<p>Reason: ${input.reason}</p>` : ""}
    <p><a href="${link}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">View in ${hotelName}</a></p>
    <p>Or copy and paste this link into your browser:<br/>${link}</p>
  `;
  await sendTransactionalEmail({
    settings: ctx.settings,
    to: email,
    toName: input.requestedBy,
    subject: `${input.docType} ${verb}: ${input.docNumber}`,
    html,
  }).catch(() => ({ ok: false }));
}

// Builds the "https://host" origin from a request the same way the password-reset
// flow does, so links in these emails point at whichever host actually served the request.
export function buildOriginFromRequest(req: { headers: Record<string, unknown>; protocol: string; get: (name: string) => string | undefined }): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol;
  return `${proto}://${req.get("host")}`;
}
