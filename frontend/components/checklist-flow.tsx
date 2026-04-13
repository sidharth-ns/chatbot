"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, SkipForward, ExternalLink, Terminal } from "lucide-react";

import { api } from "@/lib/api";
import type { HelpContent } from "@/lib/types";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";

interface ChecklistFlowProps {
  sessionId: string;
  onComplete: () => void;
}

export function ChecklistFlow({ sessionId, onComplete }: ChecklistFlowProps) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [helpMap, setHelpMap] = useState<Record<string, HelpContent>>({});
  const [answering, setAnswering] = useState(false);
  const [completed, setCompleted] = useState(false);

  const configQuery = useQuery({
    queryKey: ["checklist-config"],
    queryFn: api.checklistConfig,
  });

  const stateQuery = useQuery({
    queryKey: ["checklist-state", sessionId],
    queryFn: () => api.checklistState(sessionId),
  });

  const config = configQuery.data;
  const state = stateQuery.data;

  // Compute the current unanswered question
  const currentQuestion =
    config && state
      ? config.questions.find((q) => !(q.id in state.answers))
      : undefined;

  // Check completion
  const allAnswered =
    config && state
      ? config.questions.every((q) => q.id in state.answers)
      : false;

  const isComplete = allAnswered || state?.skipped === true;

  useEffect(() => {
    if (isComplete && !completed) {
      setCompleted(true);
      // Small delay so user sees the completion message
      const timer = setTimeout(() => onComplete(), 1500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, completed, onComplete]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state, helpMap, currentQuestion]);

  async function handleAnswer(questionId: string, answer: "yes" | "no") {
    setAnswering(true);
    try {
      await api.checklistAnswer(sessionId, questionId, answer);
      if (answer === "no") {
        const help = await api.checklistHelp(questionId);
        setHelpMap((prev) => ({ ...prev, [questionId]: help }));
      }
      queryClient.invalidateQueries({
        queryKey: ["checklist-state", sessionId],
      });
    } catch (err) {
      console.error("Checklist answer failed:", err);
    } finally {
      setAnswering(false);
    }
  }

  async function handleSkip() {
    setAnswering(true);
    try {
      await api.checklistSkip(sessionId);
      queryClient.invalidateQueries({
        queryKey: ["checklist-state", sessionId],
      });
    } catch (err) {
      console.error("Checklist skip failed:", err);
    } finally {
      setAnswering(false);
    }
  }

  if (configQuery.isLoading || stateQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!config || !state) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-zinc-500">
          Failed to load checklist configuration.
        </p>
      </div>
    );
  }

  const answeredQuestions = config.questions.filter(
    (q) => q.id in state.answers
  );
  const total = config.questions.length;
  const completedCount = answeredQuestions.length;
  const progressPct = total > 0 ? (completedCount / total) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Progress bar */}
      <div className="shrink-0 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">
              Onboarding Checklist
            </span>
          </div>
          <span className="text-xs text-zinc-500">
            {completedCount} / {total} completed
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {/* Welcome message */}
          <ChatMessage role="assistant" content={config.welcome_message} />

          {/* Answered questions */}
          {answeredQuestions.map((q) => {
            const answer = state.answers[q.id];
            const help = helpMap[q.id];
            return (
              <div key={q.id} className="flex flex-col gap-4">
                <ChatMessage role="assistant" content={q.question} />
                <ChatMessage
                  role="user"
                  content={answer === "yes" ? "Yes" : "No"}
                />
                {answer === "no" && help && (
                  <div className="flex flex-col gap-2">
                    <ChatMessage role="assistant" content={help.message} />
                    {(help.command || help.link) && (
                      <div className="ml-10 flex flex-col gap-2">
                        {help.command && (
                          <div className="flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-300">
                            <Terminal className="size-3.5 shrink-0 text-zinc-500" />
                            <code>{help.command}</code>
                          </div>
                        )}
                        {help.link && (
                          <a
                            href={help.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
                          >
                            <ExternalLink className="size-3" />
                            {help.link}
                          </a>
                        )}
                      </div>
                    )}
                    {help.doc_content && (
                      <ChatMessage
                        role="assistant"
                        content={help.doc_content}
                      />
                    )}
                  </div>
                )}
                {answer === "no" && !help && (
                  <ChatMessage
                    role="assistant"
                    content={q.on_no.message}
                  />
                )}
              </div>
            );
          })}

          {/* Current unanswered question */}
          {currentQuestion && !isComplete && (
            <div className="flex flex-col gap-4">
              <ChatMessage
                role="assistant"
                content={currentQuestion.question}
              />
              <div className="flex gap-2 pl-10">
                <Button
                  size="sm"
                  className="bg-green-600 text-white hover:bg-green-700"
                  onClick={() => handleAnswer(currentQuestion.id, "yes")}
                  disabled={answering}
                >
                  {answering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Yes"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => handleAnswer(currentQuestion.id, "no")}
                  disabled={answering}
                >
                  {answering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "No"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Completion message */}
          {isComplete && (
            <ChatMessage
              role="assistant"
              content={
                state.skipped
                  ? "Checklist skipped. Let's jump into the chat!"
                  : config.completion_message
              }
            />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Skip button */}
      {!isComplete && (
        <div className="shrink-0 border-t border-zinc-800 px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-500 hover:text-zinc-300"
            onClick={handleSkip}
            disabled={answering}
          >
            <SkipForward className="size-3.5" />
            Skip Checklist
          </Button>
        </div>
      )}
    </div>
  );
}
