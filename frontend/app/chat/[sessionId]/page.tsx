"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { ChecklistFlow } from "@/components/checklist-flow";
import { ChatInterface } from "@/components/chat-interface";

const CHECKLIST_DONE_KEY = "devguide-checklist-done";

function isChecklistDoneGlobally(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(CHECKLIST_DONE_KEY) === "true";
}

function markChecklistDoneGlobally() {
  localStorage.setItem(CHECKLIST_DONE_KEY, "true");
}

export default function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const setSessionId = useAppStore((s) => s.setSessionId);
  const [checklistComplete, setChecklistComplete] = useState(false);
  const [globallyDone, setGloballyDone] = useState(false);

  // Check localStorage on mount — skip checklist if already done once before
  useEffect(() => {
    setGloballyDone(isChecklistDoneGlobally());
  }, []);

  // Store session ID in Zustand and localStorage
  useEffect(() => {
    if (sessionId) {
      setSessionId(sessionId);
      localStorage.setItem("devguide-session-id", sessionId);
    }
  }, [sessionId, setSessionId]);

  // Fetch checklist state for THIS session
  const stateQuery = useQuery({
    queryKey: ["checklist-state", sessionId],
    queryFn: () => api.checklistState(sessionId),
    enabled: !!sessionId && !globallyDone,
  });

  const configQuery = useQuery({
    queryKey: ["checklist-config"],
    queryFn: api.checklistConfig,
    enabled: !!sessionId && !globallyDone,
  });

  const state = stateQuery.data;
  const config = configQuery.data;

  // Determine if checklist is complete for this session
  const allAnswered =
    config && state
      ? config.questions.every((q) => q.id in state.answers)
      : false;

  const isChecklistDone = allAnswered || state?.skipped === true;

  // If checklist just finished for this session, mark it globally
  useEffect(() => {
    if (isChecklistDone && !globallyDone) {
      markChecklistDoneGlobally();
      setGloballyDone(true);
    }
  }, [isChecklistDone, globallyDone]);

  // If checklist query errors (new session without checklist state), just skip to chat
  // Don't create a new session — the current one is valid
  useEffect(() => {
    if (stateQuery.isError && !globallyDone) {
      setChecklistComplete(true);
    }
  }, [stateQuery.isError, globallyDone]);

  // Skip checklist entirely if already done globally (from a previous session)
  if (globallyDone || checklistComplete || isChecklistDone) {
    return <ChatInterface sessionId={sessionId} />;
  }

  if (stateQuery.isLoading || configQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-zinc-500" />
          <p className="text-sm text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  // If checklist config/state fails to load, go directly to chat
  if (stateQuery.isError || configQuery.isError) {
    return <ChatInterface sessionId={sessionId} />;
  }

  return (
    <ChecklistFlow
      sessionId={sessionId}
      onComplete={() => {
        markChecklistDoneGlobally();
        setGloballyDone(true);
        setChecklistComplete(true);
      }}
    />
  );
}
