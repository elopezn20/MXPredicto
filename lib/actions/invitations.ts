"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resend, FROM_EMAIL } from "@/lib/email/resend";
import { getAppOrigin } from "@/lib/app-url";
import { randomUUID } from "crypto";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ ok: false; error: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!profile?.is_admin) return { ok: false, error: "Forbidden" };
  return null;
}

// ── Create invitation ─────────────────────────────────────────────────────────

const InviteSchema = z.object({
  email: z.string().email(),
  locale: z.string().default("es"),
});

export async function createInvitation(
  email: string,
  locale = "es"
): Promise<ActionResult<{ id: string; emailSent: boolean; emailError: string | null }>> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const parsed = InviteSchema.safeParse({ email, locale });
  if (!parsed.success) return { ok: false, error: "Invalid email" };

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  const token = randomUUID();
  const signupUrl = `${getAppOrigin()}/${locale}/signup?token=${token}`;

  const { data: invitation, error: insertErr } = await admin
    .from("invitations")
    .insert({
      email: parsed.data.email,
      token,
      invited_by: user!.id,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.message.includes("unique")) {
      return { ok: false, error: "An invitation for this email already exists." };
    }
    return { ok: false, error: insertErr.message };
  }
  console.log("Invitation created with ID:", invitation!.id);

  // Send invitation email via Resend
  let emailError: string | null = null;
  if (process.env.RESEND_API_KEY) {
    const { error: sendErr } = await resend.emails.send({
      from: FROM_EMAIL,
      to: parsed.data.email,
      subject: "You're invited to MX Predicto 🏆",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to MX Predicto</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:ui-sans-serif,system-ui,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td align="center" style="background-color:#111111;border-radius:12px 12px 0 0;padding:40px 40px 32px;">
              <!-- Wordmark -->
              <h1 style="margin:0 0 8px;font-size:32px;font-weight:800;letter-spacing:-0.5px;line-height:1;">
                <span style="color:#ffffff;">MX</span><span style="color:#e91e8c;">Predicto</span>
              </h1>
              <p style="margin:0;color:#888888;font-size:13px;letter-spacing:0.3px;">
                Predict the game. Own the leaderboard.
              </p>
            </td>
          </tr>

          <!-- Pink divider -->
          <tr>
            <td style="background-color:#e91e8c;height:2px;"></td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#161616;padding:40px 40px 36px;">

              <h2 style="margin:0 0 12px;color:#ffffff;font-size:20px;font-weight:700;">
                You're invited ⚽
              </h2>
              <p style="margin:0 0 28px;color:#aaaaaa;font-size:15px;line-height:1.7;">
                You've been exclusively invited to join <strong style="color:#ffffff;">MX Predicto</strong> —
                the prediction league for the FIFA World Cup 2026.
                Pick your match winners, rack up points, and fight for the top of the table.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 36px;">
                <tr>
                  <td align="center" style="background-color:#e91e8c;border-radius:8px;">
                    <a
                      href="${signupUrl}"
                      style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px;"
                    >
                      Accept Invitation →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiry note -->
              <p style="margin:0 0 12px;color:#666666;font-size:13px;line-height:1.6;">
                This link expires in <strong style="color:#aaaaaa;">7 days</strong>.
                If the button doesn't work, copy this URL into your browser:
              </p>
              <p style="margin:0;word-break:break-all;">
                <a href="${signupUrl}" style="color:#e91e8c;font-size:12px;text-decoration:none;">${signupUrl}</a>
              </p>

            </td>
          </tr>

          <!-- Pink divider -->
          <tr>
            <td style="background-color:#e91e8c;height:2px;"></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#111111;border-radius:0 0 12px 12px;padding:24px 40px;">
              <p style="margin:0;color:#555555;font-size:12px;text-align:center;line-height:1.6;">
                © 2026 MX Predicto · <a href="https://mxpredicto.com" style="color:#e91e8c;text-decoration:none;">mxpredicto.com</a><br/>
                You received this because someone invited you. If this was a mistake, ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`,
    });
    if (sendErr) {
      console.error("[createInvitation] Resend send failed", {
        to: parsed.data.email,
        from: FROM_EMAIL,
        name: sendErr.name,
        message: sendErr.message,
      });
      emailError = sendErr.message;
    }
  } else {
    console.warn("[createInvitation] RESEND_API_KEY not set; skipping email send");
    emailError = "missingApiKey";
  }

  return { ok: true, data: { id: invitation!.id, emailSent: emailError === null, emailError } };
}

// ── Revoke invitation ─────────────────────────────────────────────────────────

export async function revokeInvitation(id: string): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (guard) return guard;

  const admin = createAdminClient();
  const { error } = await admin
    .from("invitations")
    .delete()
    .eq("id", id)
    .is("accepted_at", null); // don't delete accepted invitations

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── List invitations ──────────────────────────────────────────────────────────

export async function listInvitations() {
  const guard = await requireAdmin();
  if (guard) return { ok: false as const, error: guard.error, data: [] };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("invitations")
    .select("id, email, accepted_at, expires_at, created_at")
    .order("created_at", { ascending: false });

  if (error) return { ok: false as const, error: error.message, data: [] };
  return { ok: true as const, data: data ?? [] };
}
