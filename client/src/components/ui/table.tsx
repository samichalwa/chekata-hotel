import * as React from "react"

import { cn } from "@/lib/utils"

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /**
   * On phones (< 640px) each row is shown as a stacked card, every value
   * labelled with its column heading (labels are read from the header row
   * automatically). Pass `stack={false}` for wide grids that should keep
   * horizontal scrolling instead (e.g. day-by-day matrices).
   */
  stack?: boolean
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(({ className, stack = true, ...props }, ref) => {
  const innerRef = React.useRef<HTMLTableElement | null>(null)
  const setRefs = React.useCallback((node: HTMLTableElement | null) => {
    innerRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLTableElement | null>).current = node
  }, [ref])

  React.useLayoutEffect(() => {
    const table = innerRef.current
    if (!table || !stack) return
    let frame = 0
    const apply = () => {
      frame = 0
      const headRow = table.querySelector(":scope > thead > tr:last-child")
      const labels: string[] = []
      if (headRow) {
        for (const th of Array.from(headRow.children) as HTMLTableCellElement[]) {
          const text = (th.getAttribute("data-label") ?? th.textContent ?? "").trim()
          for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text)
        }
      }
      for (const tr of Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tfoot > tr"))) {
        let col = 0
        for (const td of Array.from(tr.children) as HTMLTableCellElement[]) {
          const span = td.colSpan || 1
          if (!td.hasAttribute("data-label-fixed")) {
            const label = span > 1 ? "" : labels[col] ?? ""
            if (td.getAttribute("data-label") !== label) td.setAttribute("data-label", label)
          }
          col += span
        }
      }
    }
    apply()
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(apply) })
    observer.observe(table, { childList: true, subtree: true, characterData: true })
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [stack])

  return (
    <div className="relative w-full overflow-auto">
      <table
        ref={setRefs}
        className={cn("w-full caption-bottom text-sm", stack && "table-stack", className)}
        {...props}
      />
    </div>
  )
})
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-12 whitespace-nowrap px-3 sm:px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-3 py-3 sm:p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
