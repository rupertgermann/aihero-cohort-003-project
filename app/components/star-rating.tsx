import { Star } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { cn } from "~/lib/utils";

interface StarRatingDisplayProps {
  average: number | null;
  count: number;
  className?: string;
}

export function StarRatingDisplay({
  average,
  count,
  className,
}: StarRatingDisplayProps) {
  if (!average || count === 0) return null;

  return (
    <span className={cn("flex items-center gap-1 text-sm", className)}>
      <Star className="size-4 fill-yellow-400 text-yellow-400" />
      <span className="font-medium">{average.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}

interface StarRatingInputProps {
  currentRating?: number | null;
}

export function StarRatingInput({ currentRating }: StarRatingInputProps) {
  const fetcher = useFetcher();
  const [hovered, setHovered] = useState<number | null>(null);

  const optimisticRating = fetcher.formData
    ? Number(fetcher.formData.get("rating"))
    : currentRating;
  const displayRating = hovered ?? optimisticRating ?? 0;

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-sm text-muted-foreground">
        {currentRating ? "Your rating:" : "Rate this course:"}
      </span>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => {
            const formData = new FormData();
            formData.set("intent", "rate");
            formData.set("rating", String(star));
            fetcher.submit(formData, { method: "post" });
          }}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(null)}
          className="p-0.5 transition-transform hover:scale-110"
          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <Star
            className={cn(
              "size-4",
              star <= displayRating
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground hover:text-yellow-300"
            )}
          />
        </button>
      ))}
    </div>
  );
}
