import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

const MAX_LEN = 2000;

/**
 * "Message the founder" — same backend as the Aya app: the JWT-verified
 * send-founder-message function stores the note in agent_feedback and emails
 * it via Resend. The function takes no source field, so the text carries a
 * [freym canvas] marker to tell the two products apart.
 */
export default function FounderMessage() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill the reply address for accounts that have one (access-key
  // accounts use a synthetic @guest.local address — not worth showing).
  useEffect(() => {
    if (!open) return;
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email;
      if (email && !email.endsWith("@guest.local")) setReplyEmail((p) => p || email);
    }).catch(() => {});
  }, [open]);

  const close = () => {
    setOpen(false);
    setTimeout(() => { setSent(false); setMessage(""); setErr(null); }, 250);
  };

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("send-founder-message", {
        body: {
          message: `[freym canvas] ${text}`.slice(0, MAX_LEN),
          replyEmail: replyEmail.trim() || undefined,
        },
      });
      if (error || !data?.ok) throw error || new Error("send failed");
      setSent(true);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button className="fc-share" title="Message the founder" onClick={() => setOpen(true)}>
        founder
      </button>
      {open && (
        <div className="fc-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="fc-modal">
            {sent ? (
              <>
                <h2>Thank you — it's sent.</h2>
                <p className="fc-modal-sub">
                  It goes straight to Eugene, who builds freym. Every message is
                  read, and the good ideas tend to ship fast.
                </p>
                <button className="fc-primary fc-pack" onClick={close}>Close</button>
              </>
            ) : (
              <>
                <h2>Message the founder</h2>
                <p className="fc-modal-sub">
                  A bug, a missing model, a feature you want — write it here and it
                  reaches Eugene directly. No support queue.
                </p>
                <textarea
                  className="fc-founder-input"
                  value={message}
                  autoFocus
                  maxLength={MAX_LEN}
                  placeholder="What should freym do better?"
                  onChange={(e) => setMessage(e.target.value)}
                />
                <input
                  className="fc-text-input fc-founder-email"
                  value={replyEmail}
                  placeholder="Email for a reply (optional)"
                  onChange={(e) => setReplyEmail(e.target.value)}
                />
                {err && <div className="fc-error">{err}</div>}
                <button
                  className="fc-primary fc-pack"
                  disabled={!message.trim() || sending}
                  onClick={send}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
                <button className="fc-signout" onClick={close}>close</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
