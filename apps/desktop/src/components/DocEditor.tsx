import { useCallback, useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { useTabs } from "../state/tabsStore";
import DocFindReplace from "./DocFindReplace";

interface Props {
  tabId: number;
}

export default function DocEditor({ tabId }: Props) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const setDocxContent = useTabs((s) => s.setDocxContent);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: tab?.docx?.html ?? "<p></p>",
    onUpdate: ({ editor }) => {
      setDocxContent(tabId, editor.getHTML(), editor.getJSON());
    },
  });

  // seed the store with the initial JSON so Ctrl+S works before first edit
  useEffect(() => {
    if (editor && tab && !tab.docx?.json) {
      useTabs.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.docx
            ? { ...t, docx: { ...t.docx, json: editor.getJSON() } }
            : t,
        ),
      }));
    }
    return () => {
      void editor;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const cmd = useCallback(
    (action: (e: NonNullable<ReturnType<typeof useEditor>>) => void) => {
      if (!editor) return;
      action(editor);
      editor.commands.focus();
    },
    [editor],
  );

  if (!tab || !tab.docx) return null;

  const btn = (
    label: string,
    title: string,
    action: () => void,
    active = false,
  ) => (
    <button
      key={label + title}
      className={"tb-btn" + (active ? " toggle on" : "")}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={action}
    >
      {label}
    </button>
  );

  return (
    <div className="doc-wrap">
      <div className="doc-toolbar">
        {btn("B", "Bold (Ctrl+B)", () => cmd((e) => e.chain().focus().toggleBold().run()), editor?.isActive("bold") ?? false)}
        {btn("I", "Italic (Ctrl+I)", () => cmd((e) => e.chain().focus().toggleItalic().run()), editor?.isActive("italic") ?? false)}
        {btn("U", "Underline (Ctrl+U)", () => cmd((e) => e.chain().focus().toggleUnderline().run()), editor?.isActive("underline") ?? false)}
        <span className="tb-sep" />
        {btn("H1", "Heading 1", () => cmd((e) => e.chain().focus().toggleHeading({ level: 1 }).run()), editor?.isActive("heading", { level: 1 }) ?? false)}
        {btn("H2", "Heading 2", () => cmd((e) => e.chain().focus().toggleHeading({ level: 2 }).run()), editor?.isActive("heading", { level: 2 }) ?? false)}
        {btn(
          "¶",
          "Body text",
          () => cmd((e) => e.chain().focus().setParagraph().run()),
          Boolean(editor?.isActive("paragraph") && !editor?.isActive("heading")),
        )}
        <span className="tb-sep" />
        {btn("•", "Bullet list", () => cmd((e) => e.chain().focus().toggleBulletList().run()), editor?.isActive("bulletList") ?? false)}
        {btn("1.", "Numbered list", () => cmd((e) => e.chain().focus().toggleOrderedList().run()), editor?.isActive("orderedList") ?? false)}
        <span className="tb-sep" />
        {btn("⯇", "Align left", () => cmd((e) => e.chain().focus().setTextAlign("left").run()), editor?.isActive({ textAlign: "left" }) ?? false)}
        {btn("≡", "Align center", () => cmd((e) => e.chain().focus().setTextAlign("center").run()), editor?.isActive({ textAlign: "center" }) ?? false)}
        {btn("⯈", "Align right", () => cmd((e) => e.chain().focus().setTextAlign("right").run()), editor?.isActive({ textAlign: "right" }) ?? false)}
        <span className="tb-sep" />
        {btn(
          "Link",
          "Insert/edit link",
          () => {
            const url = window.prompt("Link URL", editor?.getAttributes("link").href ?? "https://");
            if (url === null) return;
            if (url === "") {
              cmd((e) => e.chain().focus().unsetLink().run());
            } else {
              cmd((e) => e.chain().focus().setLink({ href: url }).run());
            }
          },
          editor?.isActive("link") ?? false,
        )}
        <span className="tb-sep" />
        {btn(
          "Find",
          "Find & replace (Ctrl+F)",
          () => useTabs.getState().setDocFindOpen(true),
        )}
        <span className="tb-sep" />
        {btn("⊞", "Insert table 3×3", () =>
          cmd((e) =>
            e
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run(),
          ),
        )}
        {btn("+R", "Add row", () => cmd((e) => e.chain().focus().addRowAfter().run()))}
        {btn("+C", "Add column", () => cmd((e) => e.chain().focus().addColumnAfter().run()))}
        {btn("✕T", "Delete table", () => cmd((e) => e.chain().focus().deleteTable().run()))}
      </div>
      <div className="doc-area">
        <EditorContent editor={editor} className="doc-page" />
      </div>
      <DocFindReplace editor={editor} />
      <DocHint />
    </div>
  );
}

function DocHint() {
  return (
    <div className="grid-hint">
      Type to edit · formatting above · Ctrl+Z/Y undo & redo inside the
      document · tables: click a cell first
    </div>
  );
}
