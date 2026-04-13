"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { ChecklistFlow } from "@/components/checklist-flow";
import { ChatInterface } from "@/components/chat-interface";

export default function ChatSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const setSessionId = useAppStore((s) => s.setSessionId);
  const [checklistComplete, setChecklistComplete] = useState(false);

  // Store session ID in Zustand and localStorage
  useEffect(() => {
    if (sessionId) {
      setSessionId(sessionId);
      localStorage.setItem("onboardbot-session-id", sessionId);
    }
  }, [sessionId, setSessionId]);

  // Fetch checklist state to determine if we should show the checklist
  const stateQuery = useQuery({
    queryKey: ["checklist-state", sessionId],
    queryFn: () => api.checklistState(sessionId),
    enabled: !!sessionId,
  });

  const configQuery = useQuery({
    queryKey: ["checklist-config"],
    queryFn: api.checklistConfig,
    enabled: !!sessionId,
  });

  const state = stateQuery.data;
  const config = configQuery.data;

  // Determine if checklist is complete based on API state
  const allAnswered =
    config && state
      ? config.questions.every((q) => q.id in state.answers)
      : false;

  const isChecklistDone = allAnswered || state?.skipped === true;

  // Show chat if checklist is completed (from API or from flow callback)
  const showChat = checklistComplete || isChecklistDone;

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

  if (showChat) {
    return <ChatInterface sessionId={sessionId} />;
  }

  return (
    <ChecklistFlow
      sessionId={sessionId}
      onComplete={() => setChecklistComplete(true)}
    />
  );
}
