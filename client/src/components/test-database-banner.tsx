import { FlaskConical } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-auth";

// Phase 6 (Test/Live split): rendered app-wide, on every page, whenever the
// signed-in session is talking to the Test database — so nobody can mistake
// Test data (or a Test-mode invoice/email/SMS) for the real thing. Renders
// nothing at all in Live mode or while signed out.
export function TestDatabaseBanner() {
  const { data: user } = useCurrentUser();
  if (!user || user.environment !== "test") return null;

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-amber-950"
      data-testid="banner-test-database"
    >
      <FlaskConical className="h-3.5 w-3.5" />
      Test database — no real emails, SMS, or WhatsApp messages are sent from here
    </div>
  );
}
