/** 词书的封面色块 */
import { BookOpen, FileText } from "lucide-react";
import { MY_BOOK } from "../repo/books";
import { cx } from "./components";

const GRADIENTS: Record<string, string> = {
  violet: "from-[#9a7dff] to-[#5b36f2]",
  amber: "from-[#f7c160] to-[#e0781c]",
  emerald: "from-[#46d6a1] to-[#0e8b60]",
  slate: "from-[#97a0b1] to-[#4b5563]",
};

export function BookCover({
  id,
  color,
  title,
  size = "md",
}: {
  id: string;
  color: string;
  title: string;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = id === MY_BOOK ? FileText : BookOpen;
  return (
    <div
      className={cx(
        "relative flex shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br text-white shadow-sm",
        GRADIENTS[color] ?? GRADIENTS.violet,
        size === "sm" && "h-14 w-11 rounded-lg p-1.5",
        size === "md" && "h-28 w-22 rounded-xl p-2.5",
        size === "lg" && "h-36 w-28 rounded-2xl p-3",
      )}
    >
      <div className="absolute inset-y-0 left-0 w-1.5 bg-black/10" />
      <Icon size={size === "sm" ? 12 : 16} className="relative opacity-80" />
      {size !== "sm" && (
        <div
          className={cx(
            "relative font-semibold leading-tight",
            size === "lg" ? "text-sm" : "text-[11px]",
          )}
        >
          {title}
        </div>
      )}
    </div>
  );
}
