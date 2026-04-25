import { Link } from "wouter";
import { AlertCircle, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ backgroundColor: "#F7F7F8" }}
    >
      <div className="text-center max-w-md">
        <div
          className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-6"
          style={{
            backgroundColor: "#FEE2E2",
            boxShadow: "6px 6px 12px rgba(0,0,0,0.05), -6px -6px 12px rgba(255,255,255,0.9)",
          }}
        >
          <AlertCircle className="h-7 w-7" style={{ color: "#EF4444" }} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2" style={{ color: "#111827" }}>
          404 — Page not found
        </h1>
        <p className="text-[14px] mb-8" style={{ color: "#6B7280" }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <button
            className="inline-flex items-center gap-2 h-11 px-6 rounded-xl text-[14px] font-semibold text-white transition-all hover:shadow-lg hover:shadow-blue-500/20 hover:-translate-y-0.5"
            style={{ backgroundColor: "#2563EB" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </button>
        </Link>
      </div>
    </div>
  );
}
