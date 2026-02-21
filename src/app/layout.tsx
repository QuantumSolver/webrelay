import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EXN Web Relay - Webhook Relay Service",
  description: "Modern webhook relay service with real-time monitoring, endpoint management, and secure forwarding. Built with Next.js, TypeScript, and Redis.",
  keywords: ["EXN", "Web Relay", "Webhook", "Next.js", "TypeScript", "Redis", "Real-time", "API", "Webhook forwarding"],
  authors: [{ name: "Marcques", email: "marcques@exn1.uk" }],
  icons: {
    icon: "/logo.png",
  },
  openGraph: {
    title: "EXN Web Relay",
    description: "Webhook relay service with real-time monitoring and secure forwarding",
    url: "https://relay.exn1.uk",
    siteName: "EXN Web Relay",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EXN Web Relay",
    description: "Webhook relay service with real-time monitoring and secure forwarding",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
