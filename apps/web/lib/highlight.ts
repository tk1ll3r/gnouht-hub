import "server-only";
import clojure from "highlight.js/lib/languages/clojure";
import cmake from "highlight.js/lib/languages/cmake";
import dart from "highlight.js/lib/languages/dart";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import fsharp from "highlight.js/lib/languages/fsharp";
import groovy from "highlight.js/lib/languages/groovy";
import haskell from "highlight.js/lib/languages/haskell";
import julia from "highlight.js/lib/languages/julia";
import latex from "highlight.js/lib/languages/latex";
import matlab from "highlight.js/lib/languages/matlab";
import nix from "highlight.js/lib/languages/nix";
import ocaml from "highlight.js/lib/languages/ocaml";
import powershell from "highlight.js/lib/languages/powershell";
import protobuf from "highlight.js/lib/languages/protobuf";
import scala from "highlight.js/lib/languages/scala";
import verilog from "highlight.js/lib/languages/verilog";
import vhdl from "highlight.js/lib/languages/vhdl";
import x86asm from "highlight.js/lib/languages/x86asm";
import type { Element, ElementContent, Root } from "hast";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);
lowlight.register({ clojure, cmake, dart, dockerfile, dos, elixir, erlang, fsharp, groovy, haskell, julia, latex, matlab, nix, ocaml, powershell, protobuf, scala, verilog, vhdl, x86asm });

/** A run of text and the highlight.js classes around it (`hljs-keyword`, …); styled by CSS classes only. */
export interface Segment {
  text: string;
  className?: string;
}
export type HighlightedLine = Segment[];

/** Past this size a file is shown plain: highlighting is for reading, not worth seconds of server time. */
const MAX_HIGHLIGHT_CHARS = 200_000;

function classesOf(node: Element): string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.filter((c): c is string => typeof c === "string" && /^hljs-[\w-]+$|^language-[\w-]+$/.test(c)) : [];
}

/**
 * Highlights `code` and splits the result into lines, so each line can carry its own number and anchor.
 * Tokens that span lines (block comments, template strings) keep their classes on every line. Output is
 * plain text plus class names from highlight.js: nothing from the file can become markup or a style.
 */
export function highlightLines(code: string, language: string | null): HighlightedLine[] {
  const source = code.replace(/\r\n?/g, "\n");
  const plain = () => source.split("\n").map((text) => (text ? [{ text }] : []));
  if (!language || language === "plaintext" || source.length > MAX_HIGHLIGHT_CHARS || !lowlight.registered(language)) return plain();
  let tree: Root;
  try {
    tree = lowlight.highlight(language, source);
  } catch {
    return plain();
  }
  const lines: HighlightedLine[] = [[]];
  const walk = (nodes: (ElementContent | Root["children"][number])[], classes: string[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const parts = node.value.split("\n");
        parts.forEach((part, index) => {
          if (index > 0) lines.push([]);
          if (part) lines.at(-1)!.push(classes.length ? { text: part, className: classes.join(" ") } : { text: part });
        });
      } else if (node.type === "element") {
        walk(node.children, [...classes, ...classesOf(node)]);
      }
    }
  };
  walk(tree.children, []);
  return lines;
}

export function isHighlightable(language: string | null): boolean {
  return Boolean(language && lowlight.registered(language));
}
