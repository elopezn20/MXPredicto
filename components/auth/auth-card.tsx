import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  children: ReactNode;
}

export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden">
      
      {/* 🔥 Background Image */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/login.png')", // 👉 move your image here
        }}
      />

      {/* 🔥 Dark overlay (cinematic) */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />

      {/* 🔥 Content */}
      <div className="relative z-10 w-full max-w-sm px-4">
        
        {/* 🔥 Logo */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            MX<span className="text-pink-500">Predicto</span>
          </h1>
          <p className="mt-1 text-sm text-gray-300">
            Predict the game. Own the leaderboard.
          </p>
        </div>

        {/* 🔥 Card */}
        <Card className="border border-white/10 bg-white/10 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl text-white">{title}</CardTitle>
          </CardHeader>
          <CardContent className="text-white">
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}