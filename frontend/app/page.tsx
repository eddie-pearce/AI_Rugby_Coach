import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center flex-1 min-h-screen px-6 text-center">
      <div className="max-w-xl w-full">
        <div className="mb-3">
          <span className="inline-block w-10 h-1 bg-amber rounded-full" />
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-4">
          AI Rugby Coach
        </h1>
        <p className="text-white/60 text-lg mb-10">
          Analysis with AI, delivered in plain english
        </p>
        <Link
          href="/analyse"
          className="inline-block bg-amber text-navy font-semibold text-base px-8 py-3 rounded-lg hover:brightness-110 transition-all"
        >
          Analyse a Clip
        </Link>
      </div>
    </main>
  );
}
