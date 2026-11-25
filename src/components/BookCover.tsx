import { useState } from 'react';
import { BookMarked } from 'lucide-react';

interface BookCoverProps {
  src: string | null;
  title: string;
  author: string;
  year?: number | string | null;
  className?: string;
}

export function BookCover({ src, title, author, year, className = '' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col justify-between bg-[#EEEAE1] border border-[#DFD9CE] p-5 text-[#1A1816] ${className}`}
      >
        <div className="flex items-center justify-between text-xs font-mono text-[#78716C] tabular-nums">
          <span>FOLIO ARCHIVE</span>
          {year ? <span>{year}</span> : null}
        </div>
        <div className="my-auto py-4">
          <BookMarked className="w-6 h-6 text-[#78350F] mb-3" strokeWidth={1.5} />
          <p className="font-serif text-lg font-medium leading-snug text-[#1A1816] line-clamp-3">
            {title}
          </p>
          <p className="mt-1.5 text-xs text-[#57534E] truncate">{author}</p>
        </div>
        <div className="border-t border-[#DFD9CE] pt-2 text-[11px] font-mono text-[#78716C]">
          PDF EDITION
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Archival cover plate for ${title} by ${author}`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover bg-[#EEEAE1] ${className}`}
    />
  );
}
