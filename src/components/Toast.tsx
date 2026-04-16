"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

interface ToastMessage {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback(
    (message: string, type: "success" | "error" | "info" = "info") => {
      const id = nextId++;
      setMessages((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }, 3500);
    },
    [],
  );

  const bgColor = {
    success: "bg-green-600",
    error: "bg-red-600",
    info: "bg-[var(--accent)]",
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col gap-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`animate-fade-in-up rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-2xl ${bgColor[m.type]}`}
          >
            {m.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
