import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  accent?: "primary" | "success" | "warning" | "muted";
  testId?: string;
}

const accentMap: Record<string, string> = {
  primary: "text-primary",
  success: "text-[hsl(var(--chart-3))]",
  warning: "text-[hsl(var(--chart-2))]",
  muted: "text-muted-foreground",
};

export function StatCard({ label, value, icon: Icon, hint, accent = "primary", testId }: StatCardProps) {
  return (
    <Card className="p-4 flex flex-col gap-2" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className={cn("h-4 w-4", accentMap[accent])} />
      </div>
      <span className="text-lg font-semibold tabular-nums" data-testid={testId ? `text-${testId}-value` : undefined}>
        {value}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </Card>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-page-title">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}
