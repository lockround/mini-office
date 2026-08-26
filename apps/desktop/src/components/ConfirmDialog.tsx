import { useEffect, useState } from "react";
import type { CloseChoice } from "../lib/files";
import { registerConfirmHandler } from "../lib/files";

interface Pending {
  title: string;
  resolve: (c: CloseChoice) => void;
}

export default function ConfirmDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(
    () =>
      registerConfirmHandler(
        (title) =>
          new Promise<CloseChoice>((resolve) => setPending({ title, resolve })),
      ),
    [],
  );

  if (!pending) return null;

  const done = (choice: CloseChoice) => {
    pending.resolve(choice);
    setPending(null);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <p>Save changes to {pending.title}?</p>
        <div className="modal-actions">
          <button className="tb-btn primary" onClick={() => done("save")}>
            Save
          </button>
          <button className="tb-btn" onClick={() => done("discard")}>
            Don&apos;t Save
          </button>
          <button className="tb-btn" onClick={() => done("cancel")}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
