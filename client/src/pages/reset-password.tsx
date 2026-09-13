import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useResetPassword } from "@/hooks/use-auth";
import chekataLogo from "@/assets/chekata-logo.jpg";

const resetSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetValues = z.infer<typeof resetSchema>;

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {}
  return body;
}

export default function ResetPasswordPage({ token }: { token: string | null }) {
  const resetPassword = useResetPassword();
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = (values: ResetValues) => {
    if (!token) return;
    setServerError(null);
    resetPassword.mutate(
      { token, password: values.password },
      {
        onSuccess: () => setDone(true),
        onError: (err: any) => setServerError(extractErrorMessage(String(err?.message ?? "Failed to reset password"))),
      }
    );
  };

  const goToSignIn = () => {
    window.location.hash = "/";
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img
            src={chekataLogo}
            alt="The Chekata Hotel"
            className="h-28 w-28 rounded-2xl object-cover shadow-md ring-1 ring-border"
            data-testid="img-reset-logo"
          />
          <p className="text-sm text-muted-foreground">Choose a new password</p>
        </div>

        {!token ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive" data-testid="text-reset-missing-token">
              This link is missing its reset code. Please use the link from your password reset email, or request a new one.
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={goToSignIn} data-testid="button-reset-back">
              Back to sign in
            </Button>
          </div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground" data-testid="text-reset-success">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              Your password has been updated. You can now sign in.
            </div>
            <Button type="button" className="w-full" onClick={goToSignIn} data-testid="button-reset-go-to-signin">
              Go to sign in
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input autoFocus type="password" autoComplete="new-password" data-testid="input-new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" data-testid="input-confirm-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {serverError && <p className="text-sm text-destructive" data-testid="text-reset-error">{serverError}</p>}
              <Button type="submit" className="w-full gap-2" disabled={resetPassword.isPending} data-testid="button-reset-submit">
                <KeyRound className="h-4 w-4" />
                {resetPassword.isPending ? "Updating..." : "Update password"}
              </Button>
            </form>
          </Form>
        )}
      </Card>
    </div>
  );
}
