import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useLogin } from "@/hooks/use-auth";
import chekataLogo from "@/assets/chekata-logo.jpg";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type LoginValues = z.infer<typeof loginSchema>;

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {}
  return body;
}

export default function LoginPage() {
  const login = useLogin();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = (values: LoginValues) => {
    setServerError(null);
    login.mutate(values, {
      onError: (err: any) => setServerError(extractErrorMessage(String(err?.message ?? "Sign in failed"))),
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img
            src={chekataLogo}
            alt="The Chekata Hotel"
            className="h-28 w-28 rounded-2xl object-cover shadow-md ring-1 ring-border"
            data-testid="img-login-logo"
          />
          <p className="text-sm text-muted-foreground">Sign in to the management system</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input autoFocus autoComplete="username" data-testid="input-username" {...field} />
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
                  <FormLabel>Password</FormLabel>
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
      </Card>
    </div>
  );
}
