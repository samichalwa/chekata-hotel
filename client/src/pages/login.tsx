import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn, Mail, ArrowLeft, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLogin, useForgotPassword, useSetupStatus, type DbEnvironment } from "@/hooks/use-auth";
import { ChaimsMark, ChaimsWordmark } from "@/components/chaims-logo";

const loginSchema = z.object({
  username: z.string().min(1, "Email address is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

const forgotSchema = z.object({
  username: z.string().min(1, "Email address is required"),
});

type ForgotValues = z.infer<typeof forgotSchema>;

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {}
  return body;
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const forgot = useForgotPassword();
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const form = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { username: "" },
  });

  const onSubmit = (values: ForgotValues) => {
    setSentMessage(null);
    forgot.mutate(values, {
      onSuccess: (body) => setSentMessage(body.message),
      onError: () => setSentMessage("If that account has an email on file, a password reset link has been sent to it."),
    });
  };

  if (sentMessage) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground" data-testid="text-forgot-success">{sentMessage}</p>
        <Button type="button" variant="outline" className="w-full gap-2" onClick={onBack} data-testid="button-back-to-login">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-sm text-muted-foreground">Enter your email address and we'll send you a link to reset your password.</p>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email address</FormLabel>
              <FormControl>
                <Input autoFocus type="email" placeholder="name@thechekata.com" autoComplete="username" data-testid="input-forgot-username" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full gap-2" disabled={forgot.isPending} data-testid="button-send-reset-link">
          <Mail className="h-4 w-4" />
          {forgot.isPending ? "Sending..." : "Send reset link"}
        </Button>
        <Button type="button" variant="ghost" className="w-full gap-2" onClick={onBack} data-testid="button-cancel-forgot">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Button>
      </form>
    </Form>
  );
}

export default function LoginPage() {
  const login = useLogin();
  const { data: setupStatus } = useSetupStatus();
  const [serverError, setServerError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  // Phase 6 (Test/Live split): the toggle only appears once a Test database
  // is actually wired up on this server — otherwise there is nothing to pick.
  const [environment, setEnvironment] = useState<DbEnvironment>("live");

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = (values: LoginValues) => {
    setServerError(null);
    login.mutate({ ...values, environment }, {
      onError: (err: any) => setServerError(extractErrorMessage(String(err?.message ?? "Sign in failed"))),
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <ChaimsMark className="h-20 w-20" />
          <div className="flex flex-col items-center gap-1">
            <ChaimsWordmark className="text-2xl text-foreground" />
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Multi-Property Hotel Management Platform
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {mode === "login" ? "Sign in to the management system" : "Reset your password"}
          </p>
        </div>

        {mode === "forgot" ? (
          <ForgotPasswordForm onBack={() => setMode("login")} />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {setupStatus?.testDbConfigured && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">Sign in to</p>
                  <ToggleGroup
                    type="single"
                    value={environment}
                    onValueChange={(value) => value && setEnvironment(value as DbEnvironment)}
                    className="grid w-full grid-cols-2 gap-2"
                    data-testid="toggle-login-environment"
                  >
                    <ToggleGroupItem value="live" className="gap-1.5 border data-[state=on]:border-primary" data-testid="toggle-environment-live">
                      Live
                    </ToggleGroupItem>
                    <ToggleGroupItem value="test" className="gap-1.5 border data-[state=on]:border-primary" data-testid="toggle-environment-test">
                      <FlaskConical className="h-3.5 w-3.5" /> Test
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {environment === "test" && (
                    <p className="text-xs text-muted-foreground" data-testid="text-test-environment-note">
                      Test mode is for administrators only and never sends real emails, SMS, or WhatsApp messages.
                    </p>
                  )}
                </div>
              )}
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email or username</FormLabel>
                    <FormControl>
                      <Input autoFocus type="text" placeholder="name@thechekata.com" autoComplete="username" data-testid="input-username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Password</FormLabel>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setMode("forgot")}
                        data-testid="link-forgot-password"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" data-testid="input-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError && <p className="text-sm text-destructive" data-testid="text-login-error">{serverError}</p>}
              <Button type="submit" className="w-full gap-2" disabled={login.isPending} data-testid="button-login">
                <LogIn className="h-4 w-4" />
                {login.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-foreground/70" data-testid="text-login-developer-credit">
          Developed by SAMIC
        </p>
      </Card>
    </div>
  );
}
