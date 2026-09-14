import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, ShieldCheck, ListChecks, Sliders, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader, StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatKES } from "@/lib/format";
import {
  APPROVAL_DOCUMENT_TYPES, APPROVAL_DOCUMENT_TYPE_LABELS,
  PERMISSION_TABLE_KEYS, PERMISSION_TABLE_LABELS, type PermissionTableKey,
  type ApprovalMatrixRule, type PermissionTableRule, type DefinitionList, type DefinitionListItem,
  type SafeUser,
} from "@shared/schema";

// ================= Approval Matrix =================
const ruleFormSchema = z.object({
  documentType: z.string().min(1),
  name: z.string().min(1, "Rule name is required"),
  minAmount: z.coerce.number().min(0).default(0),
  maxAmount: z.union([z.coerce.number().positive(), z.literal("")]).optional().nullable(),
  reviewerUserId: z.union([z.coerce.number().positive(), z.literal("")]).optional().nullable(),
  approverUserId: z.coerce.number().min(1, "Approver is required"),
  active: z.coerce.number().default(1),
});

function ApprovalRuleFormDialog({ rule, users, trigger }: { rule?: ApprovalMatrixRule; users: SafeUser[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const form = useForm<z.infer<typeof ruleFormSchema>>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: rule
      ? { documentType: rule.documentType, name: rule.name, minAmount: rule.minAmount, maxAmount: rule.maxAmount ?? "", reviewerUserId: rule.reviewerUserId ?? "", approverUserId: rule.approverUserId, active: rule.active }
      : { documentType: APPROVAL_DOCUMENT_TYPES[0], name: "", minAmount: 0, maxAmount: "", reviewerUserId: "", approverUserId: users[0]?.id ?? 0, active: 1 },
  });
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof ruleFormSchema>) => {
      const payload = {
        ...values,
        maxAmount: values.maxAmount === "" ? null : Number(values.maxAmount),
        reviewerUserId: values.reviewerUserId === "" ? null : Number(values.reviewerUserId),
      };
      if (rule) return apiRequest("PATCH", `/api/admin/approval-matrix/${rule.id}`, payload);
      return apiRequest("POST", "/api/admin/approval-matrix", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/approval-matrix"] });
      toast({ title: rule ? "Rule updated" : "Rule created" });
      setOpen(false); form.reset();
    },
    onError: (err: Error) => toast({ title: "Something went wrong", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{rule ? "Edit approval rule" : "New approval rule"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Rule name</FormLabel><FormControl><Input placeholder="e.g. Payments up to 50,000" {...field} data-testid="input-rule-name" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="documentType" render={({ field }) => (
              <FormItem>
                <FormLabel>Document type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-rule-doctype"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{APPROVAL_DOCUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{APPROVAL_DOCUMENT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="minAmount" render={({ field }) => (
                <FormItem><FormLabel>Min amount (KES)</FormLabel><FormControl><Input type="number" {...field} data-testid="input-rule-min" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="maxAmount" render={({ field }) => (
                <FormItem><FormLabel>Max amount (leave blank = unbounded)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} data-testid="input-rule-max" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="reviewerUserId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Reviewer (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={String(field.value ?? "")}>
                    <FormControl><SelectTrigger data-testid="select-rule-reviewer"><SelectValue placeholder="None" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="approverUserId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Final approver</FormLabel>
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <FormControl><SelectTrigger data-testid="select-rule-approver"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {users.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.fullName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutation.isPending} data-testid="button-save-rule">{mutation.isPending ? "Saving..." : "Save rule"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalMatrixTab() {
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useQuery<ApprovalMatrixRule[]>({ queryKey: ["/api/admin/approval-matrix"] });
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const deleteRule = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/approval-matrix/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/approval-matrix"] }); toast({ title: "Rule deleted" }); },
    onError: (err: Error) => toast({ title: "Couldn't delete rule", description: err.message, variant: "destructive" }),
  });
  const userName = (id: number | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  return (
    <Card>
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="text-sm text-muted-foreground">{rules.length} rule{rules.length === 1 ? "" : "s"} — routes requester → reviewer → approver by document type and amount band.</div>
        <ApprovalRuleFormDialog users={users} trigger={<Button size="sm" data-testid="button-new-rule"><Plus className="h-4 w-4 mr-1" /> New rule</Button>} />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading approval matrix…</div>
      ) : rules.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No approval rules configured yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead><TableHead>Document type</TableHead><TableHead className="text-right">Amount band</TableHead>
                <TableHead>Reviewer</TableHead><TableHead>Approver</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} data-testid={`row-rule-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{APPROVAL_DOCUMENT_TYPE_LABELS[r.documentType as keyof typeof APPROVAL_DOCUMENT_TYPE_LABELS] ?? r.documentType}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKES(r.minAmount)} – {r.maxAmount != null ? formatKES(r.maxAmount) : "∞"}</TableCell>
                  <TableCell>{userName(r.reviewerUserId)}</TableCell>
                  <TableCell>{userName(r.approverUserId)}</TableCell>
                  <TableCell><Badge variant={r.active ? "secondary" : "outline"}>{r.active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <ApprovalRuleFormDialog rule={r} users={users} trigger={<Button size="icon" variant="ghost" title="Edit" data-testid={`button-edit-rule-${r.id}`}><Pencil className="h-4 w-4" /></Button>} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button size="icon" variant="ghost" title="Delete" data-testid={`button-delete-rule-${r.id}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {r.name}?</AlertDialogTitle><AlertDialogDescription>This removes the approval rule.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteRule.mutate(r.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ================= Table Permissions =================
function TablePermissionsTab() {
  const { toast } = useToast();
  const { data: users = [] } = useQuery<SafeUser[]>({ queryKey: ["/api/users"] });
  const { data: perms } = useQuery<{ tableKeys: readonly PermissionTableKey[]; rules: PermissionTableRule[] }>({ queryKey: ["/api/admin/table-permissions"] });
  const setRule = useMutation({
    mutationFn: (payload: { userId: number; tableKey: PermissionTableKey; canWrite: boolean }) => apiRequest("PUT", "/api/admin/table-permissions", payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/table-permissions"] }); },
    onError: (err: Error) => toast({ title: "Couldn't save permission", description: err.message, variant: "destructive" }),
  });
  const nonAdminUsers = users.filter((u) => !u.isAdmin);
  const tableKeys = perms?.tableKeys ?? PERMISSION_TABLE_KEYS;
  const canWrite = (userId: number, tableKey: PermissionTableKey) => {
    const rule = perms?.rules.find((r) => r.userId === userId && r.tableKey === tableKey);
    return rule ? !!rule.canWrite : true; // no row = no restriction configured, defaults to allowed
  };
  return (
    <Card className="p-4 space-y-4">
      <p className="text-sm text-muted-foreground">
        Fine-grained write control within a module a user already has access to. Admins always bypass. A user with no row here for a table has full write access to it — untick to restrict.
      </p>
      {nonAdminUsers.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No non-administrator users yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                {tableKeys.map((k) => <TableHead key={k} className="text-center">{PERMISSION_TABLE_LABELS[k]}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {nonAdminUsers.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-permissions-${u.id}`}>
                  <TableCell className="font-medium">{u.fullName}</TableCell>
                  {tableKeys.map((k) => (
                    <TableCell key={k} className="text-center">
                      <Switch
                        checked={canWrite(u.id, k)}
                        onCheckedChange={(checked) => setRule.mutate({ userId: u.id, tableKey: k, canWrite: checked })}
                        data-testid={`switch-permission-${u.id}-${k}`}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// ================= Definitions (admin-editable dropdown lists) =================
function DefinitionListItemsRow({ list }: { list: DefinitionList }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const { data: items = [] } = useQuery<DefinitionListItem[]>({
    queryKey: [`/api/admin/definitions/${list.listKey}/items`],
    enabled: expanded,
  });
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const createItem = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/definitions/${list.listKey}/items`, { code: newCode, label: newLabel, sortOrder: items.length, active: 1 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [`/api/admin/definitions/${list.listKey}/items`] }); setNewCode(""); setNewLabel(""); toast({ title: "Option added" }); },
    onError: (err: Error) => toast({ title: "Couldn't add option", description: err.message, variant: "destructive" }),
  });
  const toggleActive = useMutation({
    mutationFn: (item: DefinitionListItem) => apiRequest("PATCH", `/api/admin/definitions/items/${item.id}`, { active: item.active ? 0 : 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/admin/definitions/${list.listKey}/items`] }),
  });
  const deleteItem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/definitions/items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [`/api/admin/definitions/${list.listKey}/items`] }); toast({ title: "Option removed" }); },
  });

  return (
    <div className="border border-border rounded-md">
      <button className="w-full flex items-center justify-between p-3 text-left" onClick={() => setExpanded((v) => !v)} data-testid={`button-toggle-list-${list.listKey}`}>
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="font-medium">{list.label}</span>
          <span className="text-xs text-muted-foreground">({list.listKey})</span>
        </div>
        {list.isSystem ? <Badge variant="outline">Built-in list</Badge> : null}
      </button>
      {expanded && (
        <div className="p-3 border-t border-border space-y-3">
          {list.description && <p className="text-sm text-muted-foreground">{list.description}</p>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Label</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                  <TableRow key={item.id} data-testid={`row-definition-item-${item.id}`}>
                    <TableCell className="font-mono">{item.code}</TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell><Badge variant={item.active ? "secondary" : "outline"}>{item.active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate(item)} data-testid={`button-toggle-item-${item.id}`}>
                          {item.active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button size="icon" variant="ghost" title="Delete" onClick={() => deleteItem.mutate(item.id)} data-testid={`button-delete-item-${item.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Code</label>
              <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} data-testid={`input-new-item-code-${list.listKey}`} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Label</label>
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} data-testid={`input-new-item-label-${list.listKey}`} />
            </div>
            <Button size="sm" disabled={!newCode || !newLabel || createItem.isPending} onClick={() => createItem.mutate()} data-testid={`button-add-item-${list.listKey}`}>
              <Plus className="h-4 w-4 mr-1" /> Add option
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewDefinitionListDialog() {
  const [open, setOpen] = useState(false);
  const [listKey, setListKey] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const { toast } = useToast();
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/definitions", { listKey, label, description, isSystem: 0 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/definitions"] }); toast({ title: "List created" }); setOpen(false); setListKey(""); setLabel(""); setDescription(""); },
    onError: (err: Error) => toast({ title: "Couldn't create list", description: err.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" data-testid="button-new-definition-list"><Plus className="h-4 w-4 mr-1" /> New list</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New definition list</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-sm font-medium">List key (stable, no spaces)</label><Input value={listKey} onChange={(e) => setListKey(e.target.value.trim().replace(/\s+/g, "_"))} data-testid="input-new-list-key" /></div>
          <div><label className="text-sm font-medium">Display label</label><Input value={label} onChange={(e) => setLabel(e.target.value)} data-testid="input-new-list-label" /></div>
          <div><label className="text-sm font-medium">Description (optional)</label><Input value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-new-list-description" /></div>
        </div>
        <DialogFooter>
          <Button disabled={!listKey || !label || mutation.isPending} onClick={() => mutation.mutate()} data-testid="button-save-definition-list">Create list</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DefinitionsTab() {
  const { data: lists = [], isLoading } = useQuery<DefinitionList[]>({ queryKey: ["/api/admin/definitions"] });
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Admin-editable dropdown option lists used across the system — e.g. Time &amp; Attendance Status, Shift Code, and Leave Type. Add any future list here without needing code changes.</p>
        <NewDefinitionListDialog />
      </div>
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading definitions…</div>
      ) : lists.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No definition lists yet.</div>
      ) : (
        <div className="space-y-2">
          {lists.map((list) => <DefinitionListItemsRow key={list.id} list={list} />)}
        </div>
      )}
    </Card>
  );
}

// ================= Page =================
export default function SystemAdmin() {
  const { data: rules = [] } = useQuery<ApprovalMatrixRule[]>({ queryKey: ["/api/admin/approval-matrix"] });
  const { data: lists = [] } = useQuery<DefinitionList[]>({ queryKey: ["/api/admin/definitions"] });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader title="System Administration" description="Approval matrix, table-level permissions, and admin-editable option lists used across every module." />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Approval rules" value={String(rules.length)} icon={ShieldCheck} testId="stat-approval-rules" />
        <StatCard label="Definition lists" value={String(lists.length)} icon={ListChecks} accent="success" testId="stat-definition-lists" />
        <StatCard label="Permission tables" value={String(PERMISSION_TABLE_KEYS.length)} icon={Sliders} accent="warning" testId="stat-permission-tables" />
      </div>

      <Tabs defaultValue="approval">
        <TabsList>
          <TabsTrigger value="approval" data-testid="tab-approval-matrix">Approval Matrix</TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-table-permissions">Table Permissions</TabsTrigger>
          <TabsTrigger value="definitions" data-testid="tab-definitions">Definitions</TabsTrigger>
        </TabsList>
        <TabsContent value="approval" className="mt-4"><ApprovalMatrixTab /></TabsContent>
        <TabsContent value="permissions" className="mt-4"><TablePermissionsTab /></TabsContent>
        <TabsContent value="definitions" className="mt-4"><DefinitionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
