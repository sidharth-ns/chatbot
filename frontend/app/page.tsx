"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
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

const features = [
  {
    title: "Upload Docs",
    description:
      "Upload your onboarding documents so they can be indexed and queried by the AI assistant.",
    icon: Upload,
    href: "/upload",
  },
  {
    title: "Onboarding Checklist",
    description:
      "Walk through a guided onboarding checklist to make sure you have everything set up.",
    icon: ClipboardCheck,
    href: "/chat",
  },
  {
    title: "Chat with Docs",
    description:
      "Ask questions about your documentation and get instant, source-backed answers.",
    icon: MessageCircle,
    href: "/chat",
  },
];

export default function Home() {
  const { data: documents } = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.listDocuments(),
  });

  const docCount = documents?.length ?? 0;

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 font-[family-name:var(--font-geist-sans)]">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        {/* Title */}
        <h1 className="text-5xl font-bold tracking-tight text-zinc-100">
          OnboardBot
        </h1>

        {/* Subtitle */}
        <p className="mt-3 text-xl text-zinc-400">
          Your AI-Powered Onboarding Assistant
        </p>

        {/* Description */}
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-500">
          Upload your company documentation, walk through an onboarding
          checklist, and chat with an AI that knows your docs inside and out.
          Get answers with source citations so you can verify everything.
        </p>

        {/* Feature Cards */}
        <div className="mt-12 grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Link key={feature.title} href={feature.href}>
                <Card className="h-full border-zinc-800 bg-zinc-900 transition-colors hover:bg-zinc-800/80">
                  <CardHeader>
                    <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-zinc-800">
                      <Icon className="size-5 text-zinc-300" />
                    </div>
                    <CardTitle className="text-zinc-100">
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-zinc-500">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>

        {/* Status */}
        <div className="mt-10 flex items-center gap-2 text-sm text-zinc-500">
          <Database className="size-4" />
          <span>
            {docCount} document{docCount !== 1 ? "s" : ""} indexed
          </span>
        </div>
      </div>
    </div>
  );
}
