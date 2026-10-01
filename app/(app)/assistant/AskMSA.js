"use client";

import { useState, useRef, useEffect } from "react";
import { askAssistant } from "./actions";
import { EXAMPLE_QUESTIONS } from "@/lib/assistant/intents";

export default function AskMSA() {
  const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant', text, examples? }
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = async (question) => {
    const q = question.trim();
    if (!q || pending) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const res = await askAssistant(q);
      if (res.error) {
        setMessages((m) => [...m, { role: "assistant", text: res.error, isError: true }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: res.answer, examples: res.examples, intent: res.intent }]);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col h-[70vh] bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-slate-500 mb-3">
              Ask about fees, salaries, expenses, attendance, or stock — every answer comes straight from
              the same records Reports and the Dashboard use, never a guess.
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((eq) => (
                <button
                  key={eq}
                  onClick={() => ask(eq)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-300 text-slate-600 hover:bg-slate-50"
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-royal text-white"
                  : m.isError
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-slate-100 text-ink"
              }`}
            >
              {m.text}
              {m.intent && (
                <div className="text-[10px] text-slate-400 mt-1.5 font-mono" title="Every number above came from this verified, authorized query — never invented.">
                  verified via {m.intent}
                </div>
              )}
              {m.examples && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {m.examples.map((eq) => (
                    <button
                      key={eq}
                      onClick={() => ask(eq)}
                      className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
                    >
                      {eq}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-400 rounded-xl px-3.5 py-2.5 text-sm">Checking the records…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
        className="border-t border-slate-200 p-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask MSA about fees, salaries, expenses, attendance, stock…"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="bg-royal hover:bg-royal-dark text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-60"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
