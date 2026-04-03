export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center flex-1 px-6 text-center py-20">
      <div className="max-w-md w-full">
        <span className="inline-block w-10 h-1 bg-amber rounded-full mb-4" />
        <h1 className="text-4xl font-bold text-white tracking-tight mb-3">
          AI Rugby Coach
        </h1>
        <p className="text-white/50 text-base">
          Upload a match, clip your sequences, then analyse attack and defence with AI.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-3 text-left">
          {[
            { step: "1", title: "Clipping", desc: "Upload a match and mark in/out points to save clips." },
            { step: "2", title: "Attack / Defence", desc: "Browse your saved clips and run AI analysis." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4 bg-white/5 border border-white/10 rounded-xl p-4">
              <span className="text-amber font-bold text-lg leading-none mt-0.5">{step}</span>
              <div>
                <p className="text-white font-semibold text-sm">{title}</p>
                <p className="text-white/40 text-sm mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
