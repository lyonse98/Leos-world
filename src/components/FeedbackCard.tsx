import { useEffect, useState } from 'react';
import { ThumbsDown, ThumbsUp, AudioLines } from 'lucide-react';

interface FeedbackCardProps {
  // The subject of the story currently on air. Null between stories, when
  // there is nothing to rate yet.
  topic: string | null;
  // What this listener has already said about the story on air: 1, -1, or 0
  // for "no opinion recorded".
  rating: 1 | -1 | 0;
  onRate: (value: 1 | -1) => void;
  onMoreLikeThis: () => void;
}

// Rating a story while driving. Everything here is built for a glance and a
// thumb: two large targets, no reading required, and a confirmation that is
// both seen and heard. Nothing in this control can be mistaken for a control
// that stops the tour.
export default function FeedbackCard({ topic, rating, onRate, onMoreLikeThis }: FeedbackCardProps) {
  const [flash, setFlash] = useState<string | null>(null);
  const enabled = topic !== null;

  // The confirmation fades on its own. Nothing here needs dismissing, because
  // dismissing things is exactly what the listener cannot do at 60 mph.
  useEffect(() => {
    if (rating === 0) {
      setFlash(null);
      return;
    }
    setFlash(rating === 1 ? 'Noted — more like this' : 'Noted — less of this');
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(timer);
  }, [rating, topic]);

  const baseButton =
    'flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all duration-200 active:scale-[0.93]';

  return (
    <div className="mt-5 w-full max-w-xs">
      <div className="flex items-center justify-center gap-1.5 mb-2.5">
        <AudioLines size={12} className={enabled ? 'text-slate-500' : 'text-slate-700'} />
        <span className={`text-[10px] font-semibold tracking-[0.2em] transition-colors duration-500 ${enabled ? 'text-slate-500' : 'text-slate-700'}`}>
          {enabled ? 'HOW WAS THAT ONE?' : 'RATE LEO\u2019S NEXT STORY'}
        </span>
      </div>

      <div className="flex items-stretch gap-2.5">
        <button
          type="button"
          onClick={() => onRate(1)}
          disabled={!enabled}
          aria-pressed={rating === 1}
          title="More stories like this one"
          className={`${baseButton} ${
            rating === 1
              ? 'bg-emerald-500/15 border-emerald-400/60 text-emerald-300 shadow-lg shadow-emerald-950/50'
              : enabled
                ? 'bg-slate-800/70 border-slate-700/60 text-slate-300 hover:bg-slate-700/80 hover:border-slate-600'
                : 'bg-slate-900/50 border-slate-800/60 text-slate-700 cursor-not-allowed'
          }`}
        >
          <ThumbsUp size={24} strokeWidth={1.8} />
          <span className="text-[10px] font-bold tracking-wide">LIKED IT</span>
        </button>

        <button
          type="button"
          onClick={() => onRate(-1)}
          disabled={!enabled}
          aria-pressed={rating === -1}
          title="Fewer stories like this one"
          className={`${baseButton} ${
            rating === -1
              ? 'bg-rose-500/15 border-rose-400/60 text-rose-300 shadow-lg shadow-rose-950/50'
              : enabled
                ? 'bg-slate-800/70 border-slate-700/60 text-slate-300 hover:bg-slate-700/80 hover:border-slate-600'
                : 'bg-slate-900/50 border-slate-800/60 text-slate-700 cursor-not-allowed'
          }`}
        >
          <ThumbsDown size={24} strokeWidth={1.8} />
          <span className="text-[10px] font-bold tracking-wide">NOT FOR ME</span>
        </button>
      </div>

      {/* The strongest signal, and the one that keeps Leo on a subject the
          listener is clearly enjoying. Only offered once a story is on air. */}
      <button
        type="button"
        onClick={onMoreLikeThis}
        disabled={!enabled}
        title="Stay on this subject"
        className={`mt-2 w-full flex items-center justify-center gap-2 py-2 rounded-xl border text-[11px] font-bold tracking-wide transition-all duration-200 active:scale-[0.97] ${
          enabled
            ? 'bg-cyan-950/50 border-cyan-800/60 text-cyan-300 hover:bg-cyan-900/60 hover:border-cyan-700'
            : 'bg-slate-900/50 border-slate-800/60 text-slate-700 cursor-not-allowed'
        }`}
      >
        <AudioLines size={15} />
        KEEP GOING ON THIS
      </button>

      <div className="h-5 mt-2">
        {flash ? (
          <p className="text-[11px] font-medium text-slate-400 text-center leo-fade-up">{flash}</p>
        ) : (
          enabled && (
            <p className="text-[10px] text-slate-600 text-center">
              Or just say &ldquo;liked it&rdquo; or &ldquo;not for me&rdquo;
            </p>
          )
        )}
      </div>
    </div>
  );
}
