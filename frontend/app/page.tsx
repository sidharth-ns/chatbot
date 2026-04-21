"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import {
  Upload,
  ClipboardCheck,
  MessageCircle,
  Database,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export default function Home() {
  const router = useRouter();
  const creatingRef = useRef(false);

  const { data: documents } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.listDocuments(),
  });

  const docCount = documents?.length ?? 0;

  async function handleStartChat() {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const session = await api.createSession();
      localStorage.setItem("devguide-session-id", session.id);
      router.push(`/chat/${session.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      creatingRef.current = false;
    }
  }

  const features = [
    {
      title: "Upload Docs",
      description:
        "Upload your onboarding documents so they can be indexed and queried by the AI assistant.",
      icon: Upload,
      onClick: () => router.push("/upload"),
    },
    {
      title: "Onboarding Checklist",
      description:
        "Walk through a guided onboarding checklist to make sure you have everything set up.",
      icon: ClipboardCheck,
      onClick: handleStartChat,
    },
    {
      title: "Chat with Docs",
      description:
        "Ask questions about your documentation and get instant, source-backed answers.",
      icon: MessageCircle,
      onClick: handleStartChat,
    },
  ];

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 font-[family-name:var(--font-geist-sans)]">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          DevGuide
        </h1>

        <p className="mt-3 text-xl text-zinc-500 dark:text-zinc-400">
          Your AI-Powered Onboarding Assistant
        </p>

        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 dark:text-zinc-500">
          Upload your company documentation, walk through an onboarding
          checklist, and chat with an AI that knows your docs inside and out.
          Get answers with source citations so you can verify everything.
        </p>

        <div className="mt-12 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <button
                key={feature.title}
                onClick={feature.onClick}
                className="text-left"
              >
                <Card className="h-full border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 hover:shadow-md">
                  <CardHeader>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-600/10 ring-1 ring-blue-500/20">
                      <Icon className="size-5 text-blue-400" />
                    </div>
                    <CardTitle className="text-zinc-900 dark:text-zinc-100">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-zinc-400 dark:text-zinc-500">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        <div className="mt-10 flex items-center gap-2 text-sm text-zinc-400 dark:text-zinc-500">
          <Database className="size-4" />
          <span>
            {docCount} document{docCount !== 1 ? "s" : ""} indexed
          </span>
        </div>
      </div>
    </div>
  );
}
