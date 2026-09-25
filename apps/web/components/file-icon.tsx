import { File, FileBraces, FileCode, FileText, Presentation, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** File icons by kind and language; source files in ink, everything else in pencil. */
export function FileIcon({ kind, language, className }: { kind: string; language?: string | null; className?: string }) {
  let Icon: LucideIcon = File;
  if (kind === "code") Icon = language === "json" || language === "yaml" || language === "ini" ? FileBraces : FileCode;
  else if (kind === "markdown" || kind === "text" || kind === "docx") Icon = FileText;
  else if (kind === "pptx") Icon = Presentation;
  return <Icon className={cn("size-3.5 shrink-0", kind === "code" ? "text-accent" : "text-muted", className)} aria-hidden />;
}
