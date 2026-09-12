import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Logo } from "@/components/logo";
import { useSetup } from "@/hooks/use-auth";

const setupSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  username: z.string().min(3, "Username must be at least 3 characters").regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

type SetupValues = z.infer<typeof setupSchema>;

function extractErrorMessage(raw: string): string {
  const match = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) return parsed.error;
  } catch {}
  return body;
}

export default function SetupPage() {
  const setup = useSetup();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<SetupValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { fullName: "", username: "", password: "" },
  });

  const onSubmit = (values: SetupValues) => {
    setServerError(null);
    setup.mutate(values, {
      onError: (err: any) => setServerError(extractErrorMessage(String(err?.message ?? "Setup failed"))),
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-10 w-10 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Welcome to The Chekata</h1>
            <p className="text-sm text-muted-foreground">Create the first administrator account to get started</p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input autoFocus data-testid="input-fullname" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input autoComplete="username" data-testid="input-username" {...field} />
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
                    <Input type="password" autoComplete="new-password" data-testid="input-password" {...field} />
                  </FormControl>
                  <FormDescription>At least 6 characters. You can create more staff accounts later from Settings.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {serverError && <p className="text-sm text-destructive" data-testid="text-setup-error">{serverError}</p>}
            <Button type="submit" className="w-full gap-2" disabled={setup.isPending} data-testid="button-setup">
              <ShieldCheck className="h-4 w-4" />
              {setup.isPending ? "Creating account..." : "Create administrator account"}
            </Button>
          </form>
        </Form>
      </Card>
    </div>
  );
}
