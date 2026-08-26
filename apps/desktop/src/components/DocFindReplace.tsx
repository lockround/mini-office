import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useTabs } from "../state/tabsStore";

interface TextRange {
  from: number;
  to: number;
}

/** Collect all occurrences of `query` as document positions. */
export function findMatches(doc: Editor["state"]["doc"], query: string, caseSensitive: boolean): TextRange[] {
  if (!query) return [];
  // build full text with position index per character
  const chars: number[] = [];
  let text = "";
  doc.descendants((node, pos) => {
    if (node.isText && typeof node.text === "string") {
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i];
        chars.push(pos + i);
      }
      // account for the text node's opening token
    }
    return true;
  });

  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: TextRange[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    const startChar = idx;
    const endChar = idx + needle.length - 1;
    matches.push({ from: chars[startChar]!, to: chars[endChar]! + 1 });
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return matches;
}

interface Props {
  editor: Editor | null;
}

export default function DocFindReplace({ editor }: Props) {
  const open = useTabs((s) => s.docFindOpen);
  const setOpen = useTabs((s) => s.setDocFindOpen);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => (editor && open ? findMatches(editor.state.doc, query, caseSensitive) : []),
    [editor, open, query, caseSensitive],
  );

  useEffect(() => {
    setIndex(0);
  }, [query, caseSensitive]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const jumpTo = useCallback(
    (i: number) => {
      if (!editor || matches.length === 0) return;
      const m = matches[((i % matches.length) + matches.length) % matches.length]!;
      editor.chain().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
    },
    [editor, matches],
  );

  if (!open) return null;

  const replaceCurrent = () => {
    if (!editor || matches.length === 0) return;
    const m = matches[index % matches.length]!;
    editor.chain().insertContentAt({ from: m.from, to: m.to }, replacement).run();
    setIndex(index); // recompute happens via memo; stay on same slot
  };

  const replaceAll = () => {
    if (!editor || matches.length === 0) return;
    let chain = editor.chain().focus();
    // apply from the end so earlier positions stay valid
    for (const m of [...matches].reverse()) {
      chain = chain.insertContentAt({ from: m.from, to: m.to }, replacement);
    }
    chain.run();
    useTabs.getState().setStatus(`Replaced ${matches.length} occurrence(s)`);
  };

  return (
    <div className="search-overlay doc-find">
      <input
        ref={inputRef}
        value={query}
        placeholder="Find…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            jumpTo(index + (e.shiftKey ? -1 : 1));
            setIndex((i) => i + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <input
        className="doc-replace"
        value={replacement}
        placeholder="Replace with…"
        onChange={(e) => setReplacement(e.target.value)}
      />
      <label className="doc-find-case" title="Match case">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(e) => setCaseSensitive(e.target.checked)}
        />
        Aa
      </label>
      <span className="search-count">
        {query
          ? matches.length > 0
            ? `${((index % matches.length) + matches.length) % matches.length + 1} / ${matches.length}`
            : "no matches"
          : ""}
      </span>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={() => {
          jumpTo(index - 1);
          setIndex((i) => i - 1);
        }}
      >
        ↑
      </button>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={() => {
          jumpTo(index + 1);
          setIndex((i) => i + 1);
        }}
      >
        ↓
      </button>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={replaceCurrent}
        title="Replace current match"
      >
        Repl.
      </button>
      <button
        className="tb-btn"
        disabled={matches.length === 0}
        onClick={replaceAll}
        title="Replace all matches"
      >
        All
      </button>
      <button className="tb-btn" onClick={() => setOpen(false)}>
        ×
      </button>
    </div>
  );
}
