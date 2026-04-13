"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  SkipForward,
  ExternalLink,
  Terminal,
  PartyPopper,
  Bot,
} from "lucide-react";

import { api } from "@/lib/api";
import type { HelpContent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ChecklistFlowProps {
  sessionId: string;
  onComplete: () => void;
}

function BotAvatar() {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600">
      <Bot className="size-4 text-white" />
    </div>
  );
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

  const currentQuestion =
    config && state
      ? config.questions.find((q) => !(q.id in state.answers))
      : undefined;

  const allAnswered =
    config && state
      ? config.questions.every((q) => q.id in state.answers)
      : false;

  const isComplete = allAnswered || state?.skipped === true;

  useEffect(() => {
    if (isComplete && !completed) {
      setCompleted(true);
      const timer = setTimeout(() => onComplete(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, completed, onComplete]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state, helpMap, currentQuestion]);

  async function handleAnswer(questionId: string, answer: "yes" | "no") {
    setAnswering(true);
    try {
      await api.checklistAnswer(sessionId, questionId, answer === "yes");
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
      {/* Progress header */}
      <div className="shrink-0 border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-blue-500" />
              <span className="text-sm font-medium text-zinc-200">
                Onboarding Checklist
              </span>
            </div>
            <span className="text-xs font-medium text-zinc-400">
              {completedCount} / {total}
            </span>
          </div>
          <Progress value={progressPct} className="mt-2 [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-blue-600 [&_[data-slot=progress-indicator]]:transition-all [&_[data-slot=progress-indicator]]:duration-500" />
          {/* Step indicators */}
          <div className="mt-3 flex gap-1.5">
            {config.questions.map((q) => {
              const answered = q.id in state.answers;
              const isCurrent = currentQuestion?.id === q.id;
              return (
                <div
                  key={q.id}
                  className={`flex size-6 items-center justify-center rounded-full text-[10px] font-medium transition-colors ${
                    answered
                      ? "bg-blue-600 text-white"
                      : isCurrent
                        ? "border-2 border-blue-500 text-blue-400"
                        : "bg-zinc-800 text-zinc-600"
                  }`}
                >
                  {answered ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    config.questions.indexOf(q) + 1
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {/* Welcome message */}
          <div className="flex gap-3">
            <BotAvatar />
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3 text-sm leading-relaxed text-zinc-200">
              {config.welcome_message}
            </div>
          </div>

          {/* Answered questions */}
          {answeredQuestions.map((q) => {
            const answer = state.answers[q.id];
            const help = helpMap[q.id];
            return (
              <div key={q.id} className="flex flex-col gap-3">
                {/* Bot asks question */}
                <div className="flex gap-3">
                  <BotAvatar />
                  <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                    {q.question}
                  </div>
                </div>

                {/* User answers */}
                <div className="flex justify-end">
                  <div
                    className={`rounded-2xl rounded-tr-sm px-4 py-2 text-sm font-medium text-white ${
                      answer === "yes" ? "bg-green-600" : "bg-orange-600"
                    }`}
                  >
                    {answer === "yes" ? "Yes, done!" : "Not yet"}
                  </div>
                </div>

                {/* Help content for "No" answers */}
                {answer === "no" && (help || q.on_no) && (
                  <div className="flex gap-3">
                    <BotAvatar />
                    <div className="max-w-[80%] space-y-3 rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3">
                      <p className="text-sm leading-relaxed text-zinc-200">
                        {help?.message || q.on_no.message}
                      </p>

                      {(help?.command || q.on_no.command) && (
                        <div className="flex items-start gap-2 rounded-lg bg-zinc-900 px-3 py-2.5">
                          <Terminal className="mt-0.5 size-3.5 shrink-0 text-green-400" />
                          <code className="text-xs leading-relaxed text-green-300">
                            {help?.command || q.on_no.command}
                          </code>
                        </div>
                      )}

                      {(help?.link || q.on_no.link) && (
                        <a
                          href={help?.link || q.on_no.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-zinc-900/80 hover:text-blue-300"
                        >
                          <ExternalLink className="size-3" />
                          View guide
                        </a>
                      )}

                      {help?.doc_content && (
                        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                            From your docs
                          </p>
                          <div className="max-h-40 overflow-y-auto text-xs leading-relaxed text-zinc-400">
                            {help.doc_content.slice(0, 500)}
                            {help.doc_content.length > 500 && "..."}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Current unanswered question */}
          {currentQuestion && !isComplete && (
            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <BotAvatar />
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                  {currentQuestion.question}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  className="rounded-full bg-green-600 px-5 text-white hover:bg-green-700"
                  onClick={() => handleAnswer(currentQuestion.id, "yes")}
                  disabled={answering}
                >
                  {answering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Yes, done!"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full border-zinc-700 px-5 text-zinc-300 hover:bg-zinc-800"
                  onClick={() => handleAnswer(currentQuestion.id, "no")}
                  disabled={answering}
                >
                  {answering ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Not yet"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Completion message */}
          {isComplete && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-600">
                <PartyPopper className="size-4 text-white" />
              </div>
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-gradient-to-br from-green-900/40 to-blue-900/40 px-4 py-3 text-sm leading-relaxed text-zinc-200">
                <p className="font-medium">
                  {state.skipped
                    ? "Checklist skipped — let's jump into the chat!"
                    : config.completion_message}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Redirecting to chat...
                </p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Skip button */}
      {!isComplete && (
        <div className="shrink-0 border-t border-zinc-800 px-6 py-3">
          <div className="mx-auto flex max-w-2xl justify-end">
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
        </div>
      )}
    </div>
  );
}
