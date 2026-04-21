"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";

export default function ChatPage() {
  const router = useRouter();
  const setSessionId = useAppStore((s) => s.setSessionId);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  useEffect(() => {
    if (creatingRef.current) return;
    creatingRef.current = true;

    api
      .createSession()
      .then((session) => {
        setSessionId(session.id);
        localStorage.setItem("devguide-session-id", session.id);
        router.replace(`/chat/${session.id}`);
      })
      .catch((err) => {
        creatingRef.current = false;
        setError(err instanceof Error ? err.message : "Failed to create session");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
          <p className="mt-2 text-xs text-zinc-500">
            Make sure the backend is running at{" "}
            {process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
        <p className="text-sm text-zinc-500">Creating new session...</p>
      </div>
    </div>
  );
}
